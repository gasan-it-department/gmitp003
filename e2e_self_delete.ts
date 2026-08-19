/* PROOF: self-service account deletion (App Store Review 5.1.1(v)).
 *
 * The login must genuinely stop working, the phone must stop being reachable,
 * and the employment record must survive — an employee cannot unilaterally
 * destroy public records by tapping Delete.
 *
 * Run: npx ts-node --transpile-only e2e_self_delete.ts */
import argon from "argon2";
import { prisma } from "./src/barrel/prisma";
import { selfDeleteAccount } from "./src/controller/accountSelfDeleteController";

const TS = Date.now();
const PASSWORD = "correct-horse-battery-staple";

const mockRes = () => {
  const r: any = {
    _code: 0,
    _body: null as any,
    code(n: number) { this._code = n; return this; },
    send(b: unknown) { this._body = b; return this; },
    status(n: number) { return this.code(n); },
    header() { return this; },
  };
  return r;
};

(async () => {
  let pass = 0, fail = 0;
  const ok = (l: string, c: boolean, d = "") => {
    if (c) { pass++; console.log("PASS  " + l); }
    else { fail++; console.log("FAIL  " + l + (d ? "  -> " + d : "")); }
  };
  const threw = async (fn: () => Promise<unknown>) => {
    try { await fn(); return ""; } catch (e: any) { return e?.message ?? "err"; }
  };
  const made = { userIds: [] as string[], accountIds: [] as string[] };

  try {
    const line = await prisma.line.findFirst({ select: { id: true } });
    if (!line) { console.log("NO FIXTURE (line)"); process.exit(2); }

    /** @param tethered attach a record that blocks the FK delete. */
    const mk = async (tag: string, tethered: boolean) => {
      const acct = await prisma.account.create({
        data: {
          username: `qa_del_${TS}_${tag}`,
          password: await argon.hash(PASSWORD),
          lineId: line.id,
          active: true,
        },
        select: { id: true },
      });
      made.accountIds.push(acct.id);
      const u = await prisma.user.create({
        data: {
          firstName: "Qa", lastName: `DEL${TS}${tag.toUpperCase()}`,
          username: `qa_del_${TS}_${tag}`, accountId: acct.id, lineId: line.id,
          email: `qa-del-${TS}-${tag}@test.local`,
        },
        select: { id: true },
      });
      made.userIds.push(u.id);
      await prisma.pushToken.create({
        data: { token: `qa-push-${TS}-${tag}`, userId: u.id, platform: "ios" },
      });
      if (tethered) {
        // An HR log row references the account's user, which is exactly the
        // kind of record that makes a hard delete impossible for real staff.
        await prisma.humanResourcesLogs.create({
          data: {
            action: "CREATE",
            desc: `QA tether ${TS}`,
            lineId: line.id,
            userId: u.id,
          },
        });
      }
      return { accountId: acct.id, userId: u.id };
    };

    const req = (accountId: string, body: any) =>
      ({ user: { id: accountId }, body }) as any;

    // ── Guards ──────────────────────────────────────────────────────────
    const A = await mk("guard", false);
    ok("deletion without the confirm word is refused",
      /type delete/i.test(
        await threw(async () =>
          selfDeleteAccount(req(A.accountId, { password: PASSWORD }), mockRes())),
      ));
    ok("deletion without a password is refused",
      /password/i.test(
        await threw(async () =>
          selfDeleteAccount(req(A.accountId, { confirm: "DELETE" }), mockRes())),
      ));
    ok("a WRONG password is refused",
      /not correct/i.test(
        await threw(async () =>
          selfDeleteAccount(
            req(A.accountId, { confirm: "DELETE", password: "wrong" }),
            mockRes(),
          )),
      ));
    ok("an unauthenticated caller is refused",
      !!(await threw(async () =>
        selfDeleteAccount({ body: { confirm: "DELETE", password: PASSWORD } } as any, mockRes()))));

    const stillThere = await prisma.account.findUnique({
      where: { id: A.accountId }, select: { active: true },
    });
    ok("none of those attempts touched the account", stillThere?.active === true);
    ok("lowercase 'delete' is accepted as the confirm word",
      (await threw(async () =>
        selfDeleteAccount(
          req(A.accountId, { confirm: "delete", password: PASSWORD }),
          mockRes(),
        ))) === "");

    // ── The account is neutralised, the employee is NOT ─────────────────
    // The first version of this deleted the Account row. `User.account` is
    // onDelete: Cascade, so that silently took the whole employment record —
    // attendance, documents, everything. This asserts it never happens again.
    for (const [tag, tethered] of [["clean", false], ["tethered", true]] as const) {
      const S = await mk(tag, tethered);
      const beforeUsername = (await prisma.account.findUnique({
        where: { id: S.accountId }, select: { username: true },
      }))!.username;

      const r = mockRes();
      await selfDeleteAccount(
        req(S.accountId, { confirm: "DELETE", password: PASSWORD }), r);
      ok(`[${tag}] the call succeeds`, r._body?.outcome === "deleted",
        JSON.stringify(r._body));

      const after = await prisma.account.findUnique({
        where: { id: S.accountId },
        select: { username: true, password: true, active: true, status: true },
      });
      ok(`[${tag}] the account row still EXISTS (deleting it would cascade)`, !!after);
      ok(`[${tag}] it is marked inactive`,
        after?.active === false && after?.status === 2);
      ok(`[${tag}] the username is retired, freeing the original`,
        after?.username !== beforeUsername && /^deleted_/.test(after?.username ?? ""),
        after?.username);
      ok(`[${tag}] the old password NO LONGER WORKS`,
        !(await argon.verify(after!.password, PASSWORD).catch(() => false)));
      ok(`[${tag}] the password is not left blank`,
        !!after?.password && after.password.length > 20);

      ok(`[${tag}] the EMPLOYMENT RECORD survives`,
        !!(await prisma.user.findUnique({ where: { id: S.userId } })));
      ok(`[${tag}] push tokens are cleared — the phone stops being reachable`,
        (await prisma.pushToken.count({ where: { userId: S.userId } })) === 0);
      ok(`[${tag}] the response states what is retained`,
        /retained/i.test(r._body?.retained ?? ""));

      if (tethered) {
        ok("[tethered] the HR log that references them is untouched",
          (await prisma.humanResourcesLogs.count({
            where: { userId: S.userId, desc: `QA tether ${TS}` },
          })) === 1);
      }

      // And a second attempt cannot succeed — the password is gone.
      ok(`[${tag}] deleting again with the old password is refused`,
        /not correct/i.test(
          await threw(async () =>
            selfDeleteAccount(
              req(S.accountId, { confirm: "DELETE", password: PASSWORD }),
              mockRes(),
            )),
        ));
    }

  } catch (e: any) {
    fail++;
    console.log("FAIL  threw: " + (e?.stack ?? e?.message ?? String(e)));
  } finally {
    try {
      if (made.userIds.length) {
        await prisma.pushToken.deleteMany({ where: { userId: { in: made.userIds } } }).catch(() => undefined);
        await prisma.humanResourcesLogs.deleteMany({ where: { userId: { in: made.userIds } } }).catch(() => undefined);
        await prisma.notification.deleteMany({
          where: { OR: [{ recipientId: { in: made.userIds } }, { senderId: { in: made.userIds } }] },
        }).catch(() => undefined);
        await prisma.user.deleteMany({ where: { id: { in: made.userIds } } });
      }
      if (made.accountIds.length) {
        await prisma.accountResetLink.deleteMany({ where: { accountId: { in: made.accountIds } } }).catch(() => undefined);
        await prisma.account.deleteMany({ where: { id: { in: made.accountIds } } });
      }
      const left = await prisma.account.count({
        where: { OR: [
          { username: { startsWith: `qa_del_${TS}_` } },
          { username: { startsWith: "deleted_" }, lineId: undefined },
        ] },
      }).catch(() => 0);
      const leftU = await prisma.user.count({
        where: { username: { startsWith: `qa_del_${TS}_` } },
      });
      console.log(`CLEANUP  leftover accounts=${left} users=${leftU}`);
      if (leftU) fail++;
    } catch (e: any) {
      console.log("CLEANUP FAILED: " + (e?.message ?? e));
      fail++;
    }
    console.log(`\n${pass} passed, ${fail} failed`);
    await prisma.$disconnect();
    process.exit(fail ? 1 : 0);
  }
})();
