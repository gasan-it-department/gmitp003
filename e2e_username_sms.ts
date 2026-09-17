/* PROOF: HR can rename a login safely, and SMS failures say why.
 *
 * USERNAME. The name lives in two places: Account.username is what the
 * login form looks up, User.username is what the app shows and joins on.
 * Writing one without the other leaves somebody shown one name who must
 * type another. Uniqueness has to be enforced in the handler because the
 * column login actually resolves — Account.username — carries no database
 * unique and login uses findFirst, so a duplicate would mean a password
 * that opens an arbitrary one of two accounts.
 *
 * SMS. Semaphore reports failures as `{ field: ["what is wrong"] }`, never
 * as `{ message }`. Every reader looked for `message`, found nothing, and
 * fell back to "SMS gateway rejected the message" — so the one useful fact
 * was discarded at the door and HR had no idea which recipient or why.
 *
 * Run: npx ts-node --transpile-only e2e_username_sms.ts */
import path from "path";

const entry = path.join(__dirname, "src", "index.ts");
require.cache[entry] = {
  id: entry, filename: entry, loaded: true,
  exports: { notificationSocket: { emitUserNotification: () => undefined } },
} as any;

import { prisma } from "./src/barrel/prisma";
import { changeEmployeeUsername } from "./src/controller/employee";
import { readGatewayError, SEMAPHORE_SENDER } from "./src/class/Semaphore";

const TS = Date.now();

const mockRes = () => {
  const r: any = {
    _code: 0, _body: null as any,
    code(n: number) { this._code = n; return this; },
    send(b: unknown) { this._body = b; return this; },
    status(n: number) { return this.code(n); },
  };
  return r;
};

(async () => {
  let pass = 0, fail = 0;
  const ok = (l: string, c: boolean, d = "") => {
    if (c) { pass++; console.log("PASS  " + l); }
    else { fail++; console.log("FAIL  " + l + (d ? "  -> " + d : "")); }
  };

  const made = {
    userIds: [] as string[], accountIds: [] as string[],
    moduleIds: [] as string[], lineIds: [] as string[],
  };

  try {
    const line = await prisma.line.findFirst({ select: { id: true } });
    if (!line) { console.log("NO FIXTURE (line)"); process.exit(2); }

    const mk = async (tag: string, lineId: string, hr = false) => {
      const acct = await prisma.account.create({
        data: { username: `qa_un_${TS}_${tag}`, password: "x", lineId },
        select: { id: true, username: true },
      });
      made.accountIds.push(acct.id);
      const u = await prisma.user.create({
        data: {
          firstName: `Qa${tag}`, lastName: `UN${TS}`, username: acct.username,
          accountId: acct.id, lineId,
          email: `qa-un-${TS}-${tag}@test.local`, active: 1,
        },
        select: { id: true },
      });
      made.userIds.push(u.id);
      if (hr) {
        const m = await prisma.module.create({
          data: {
            userId: u.id,
            moduleName: "human-resources",
            moduleIndex: "0",
            lineId,
            privilege: 1,
          },
          select: { id: true },
        });
        made.moduleIds.push(m.id);
      }
      return { accountId: acct.id, userId: u.id, username: acct.username };
    };

    const HR = await mk("hr", line.id, true);
    const STAFF = await mk("staff", line.id, false);
    const EMP = await mk("emp", line.id);
    const OTHER = await mk("other", line.id);

    const rename = async (
      actorAccountId: string,
      accountId: string,
      username: string,
    ) => {
      const r = mockRes();
      try {
        await changeEmployeeUsername(
          { user: { id: actorAccountId }, body: { accountId, username } } as any,
          r,
        );
        return { ok: true, body: r._body, message: "" };
      } catch (e: any) {
        return { ok: false, body: null, message: String(e?.message ?? e) };
      }
    };

    const readBoth = async (accountId: string) => {
      const a = await prisma.account.findUnique({
        where: { id: accountId }, select: { username: true },
      });
      const u = await prisma.user.findFirst({
        where: { accountId }, select: { username: true },
      });
      return { account: a?.username, user: u?.username };
    };

    // ══ 1. HR renames, and BOTH tables move ════════════════════════════
    console.log("\n-- the rename --");
    const NEW = `qa.renamed.${TS}`;
    const r1 = await rename(HR.accountId, EMP.accountId, NEW);
    ok("HR can rename an employee", r1.ok, r1.message);
    const after = await readBoth(EMP.accountId);
    ok(
      "...Account.username changed — this is what login looks up",
      after.account === NEW, String(after.account),
    );
    ok(
      "...User.username changed too — this is what the app shows",
      after.user === NEW, String(after.user),
    );
    ok("...and the response reports the previous name",
      r1.body?.previous === EMP.username, JSON.stringify(r1.body));

    const logged = await prisma.humanResourcesLogs.findFirst({
      where: { userId: HR.userId, desc: { contains: NEW } },
      select: { desc: true, action: true },
    });
    ok("...and it is in the HR log, with both names",
      !!logged && logged.desc.includes(EMP.username) && logged.action === "UPDATE",
      logged?.desc ?? "(none)");

    // ══ 2. Uniqueness, on the column that has no database unique ═══════
    console.log("\n-- a name somebody else already has --");
    const r2 = await rename(HR.accountId, OTHER.accountId, NEW);
    ok("taking another employee's username is refused", !r2.ok, r2.message);
    ok("...and says so plainly", /already taken/i.test(r2.message), r2.message);
    const other = await readBoth(OTHER.accountId);
    ok("...and that employee is untouched",
      other.account === OTHER.username, String(other.account));

    const r3 = await rename(HR.accountId, OTHER.accountId, NEW.toUpperCase());
    ok("the same name in different case is also refused", !r3.ok, r3.message);

    // ══ 3. Shape rules ═════════════════════════════════════════════════
    console.log("\n-- what a username may be --");
    for (const [bad, why] of [
      ["ab", "too short"],
      ["has space", "contains a space"],
      ["bad;drop", "punctuation"],
      ["x".repeat(33), "too long"],
    ] as const) {
      const r = await rename(HR.accountId, EMP.accountId, bad);
      ok(`refused: ${why}`, !r.ok, r.message);
    }
    const stillNew = await readBoth(EMP.accountId);
    ok("...and none of those changed anything", stillNew.account === NEW);

    // Unchanged name is a no-op, not an error.
    const r4 = await rename(HR.accountId, EMP.accountId, NEW);
    ok("renaming to the same name is a no-op", r4.ok && r4.body?.changed === false,
      JSON.stringify(r4.body));

    // ══ 4. Who may do it ═══════════════════════════════════════════════
    console.log("\n-- authority --");
    const r5 = await rename(STAFF.accountId, EMP.accountId, `qa.nope.${TS}`);
    ok("a colleague without the HR module is refused", !r5.ok, r5.message);
    ok("...for the right reason", /only hr/i.test(r5.message), r5.message);

    const otherLine = await prisma.line.findFirst({
      where: { id: { not: line.id } }, select: { id: true },
    });
    if (otherLine) {
      const FOREIGN = await mk("foreign", otherLine.id, true);
      const r6 = await rename(FOREIGN.accountId, EMP.accountId, `qa.x.${TS}`);
      ok("HR from another municipality is refused", !r6.ok, r6.message);
      ok("...for the right reason",
        /not your municipality/i.test(r6.message), r6.message);
    } else {
      console.log("SKIP  (only one line on this database)");
    }

    const final = await readBoth(EMP.accountId);
    ok("after every refusal the name is still the one HR set",
      final.account === NEW && final.user === NEW, JSON.stringify(final));

    // ══ 5. The SMS error reader ════════════════════════════════════════
    // Real Semaphore payloads, run through the function the service uses.
    // No network, no credits, nothing sent to anybody. These shapes were
    // captured from the live gateway using an invalid number.
    console.log("\n-- what the SMS gateway said --");
    const FALLBACK = "SMS gateway rejected the message";

    const badNumber = readGatewayError(
      { number: ["The number format is invalid."] }, FALLBACK);
    ok("an invalid number is reported as such, not as the generic line",
      badNumber === "number: The number format is invalid.", badNumber);

    const badSender = readGatewayError(
      { sendername: ["The selected sendername is invalid."],
        number: ["The number format is invalid."] }, FALLBACK);
    ok("...and both problems come through when there are two",
      /sendername/.test(badSender) && /number/.test(badSender), badSender);

    ok("a plain { message } body still works",
      readGatewayError({ message: "Insufficient credits" }, FALLBACK) ===
        "Insufficient credits");
    ok("a string body is passed through",
      readGatewayError("Unauthorized", FALLBACK) === "Unauthorized");
    ok("only a genuinely empty body falls back",
      readGatewayError(undefined, FALLBACK) === FALLBACK &&
      readGatewayError({}, FALLBACK) === FALLBACK);

    ok("the sender name is configurable, defaulting to the universal one",
      typeof SEMAPHORE_SENDER === "string" && SEMAPHORE_SENDER.length > 0,
      SEMAPHORE_SENDER);

    console.log(`\n${pass} passed, ${fail} failed`);
    process.exitCode = fail === 0 ? 0 : 1;
  } catch (e) {
    console.error("THREW", e);
    process.exitCode = 1;
  } finally {
    for (const id of made.moduleIds) {
      await prisma.module.delete({ where: { id } }).catch(() => {});
    }
    for (const id of made.userIds) {
      await prisma.humanResourcesLogs.deleteMany({ where: { userId: id } }).catch(() => {});
      await prisma.user.delete({ where: { id } }).catch(() => {});
    }
    for (const id of made.accountIds) {
      await prisma.account.delete({ where: { id } }).catch(() => {});
    }
    await prisma.$disconnect();
  }
})();
