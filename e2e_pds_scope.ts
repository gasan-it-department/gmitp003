/* Who can export whose Personal Data Sheet?
 *
 *   npx ts-node --transpile-only e2e_pds_scope.ts
 *
 * A PDS holds a person's birth date, place of birth, TIN, PhilHealth
 * number, home address and parents' names. The id comes from the query
 * string, so the only thing standing between a curious employee and a
 * colleague's file is this check.
 *
 * It used to be requireSameLine, which is a ceiling and not a fence: it
 * stopped another municipality and nothing else. Now it is the person
 * themselves, or HR of the municipality the record belongs to.
 *
 * Six cases, because a test that only proves refusal would also pass if
 * the feature were welded shut, and one that only proves access would
 * pass with no check at all:
 *
 *   1. the person themselves        allowed
 *   2. a colleague, same line       REFUSED   <- the gap being closed
 *   3. HR of that line              allowed
 *   4. HR whose grant is suspended  REFUSED   <- status, not just the row
 *   5. another municipality         REFUSED
 *   6. the applicant's own copy     allowed   (temp token, unaffected)
 *
 * Case 3 needs an HR user in the same line as an application and the
 * development database has none, so the test grants one, uses it, and
 * removes it again in a finally block. Nothing else is written.
 */
import path from "path";
const entry = path.join(process.cwd(), "src", "index.ts");
require.cache[entry] = {
  id: entry,
  filename: entry,
  loaded: true,
  exports: {
    notificationSocket: { emitUserNotification: () => undefined },
  },
} as never;

import { prisma } from "./src/barrel/prisma";
import {
  exportOwnPdsExcel,
  exportPdsExcel,
} from "./src/controller/pdsExportController";

let pass = 0;
const fails: string[] = [];
const ok = (name: string, cond: boolean, detail = "") => {
  if (cond) {
    pass++;
    console.log(`  ok    ${name}`);
  } else {
    fails.push(`${name}${detail ? ` — ${detail}` : ""}`);
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
};

const makeRes = () => {
  const r: any = {
    headers: {} as Record<string, string>,
    body: null as Buffer | null,
    header(k: string, v: string) {
      r.headers[k] = v;
      return r;
    },
    code() {
      return r;
    },
    send(b: Buffer) {
      r.body = b;
      return r;
    },
  };
  return r;
};

type Outcome =
  | { kind: "sent"; bytes: number }
  | { kind: "threw"; name: string; message: string };

const run = async (
  handler: (req: any, res: any) => Promise<unknown>,
  req: any,
): Promise<Outcome> => {
  const res = makeRes();
  try {
    await handler(req, res);
    return { kind: "sent", bytes: res.body ? res.body.length : 0 };
  } catch (e: any) {
    return {
      kind: "threw",
      name: e?.constructor?.name ?? "Error",
      message: String(e?.message ?? e),
    };
  }
};

const allowed = (o: Outcome) => o.kind === "sent" && o.bytes > 10000;
const why = (o: Outcome) =>
  o.kind === "threw" ? `${o.name}: ${o.message}` : `${o.bytes} bytes`;

(async () => {
  let grantId: string | null = null;
  try {
    // ── an application that belongs to a real employee ─────────────────
    const app = await prisma.submittedApplication.findFirst({
      where: { userId: { not: null } },
      select: { id: true, lineId: true, userId: true, lastname: true },
    });
    if (!app?.userId) {
      console.log("no application linked to a user — cannot test");
      process.exit(1);
    }

    // the person themselves
    const self = await prisma.account.findFirst({
      where: { User: { is: { id: app.userId } } },
      select: { id: true },
    });
    // a colleague in the same municipality who is not that person
    const colleague = await prisma.account.findFirst({
      where: {
        User: { is: { lineId: app.lineId, id: { not: app.userId } } },
      },
      select: { id: true, User: { select: { id: true } } },
    });
    const outsider = await prisma.account.findFirst({
      where: { User: { is: { lineId: { not: app.lineId } } } },
      select: { id: true },
    });

    console.log(
      `\napplication ${app.id.slice(0, 8)} (${app.lastname}) ` +
        `belongs to user ${app.userId.slice(0, 8)} in line ${app.lineId.slice(0, 8)}`,
    );
    if (!self || !colleague?.User || !outsider) {
      console.log("  need self + a same-line colleague + an outsider");
      process.exit(1);
    }
    console.log(`  self      account ${self.id.slice(0, 8)}`);
    console.log(`  colleague account ${colleague.id.slice(0, 8)}`);
    console.log(`  outsider  account ${outsider.id.slice(0, 8)}`);

    const asHr = { query: { id: app.id }, headers: {} };

    // ── 1. the person themselves ───────────────────────────────────────
    console.log("\n── 1. the person themselves ──");
    const mine = await run(exportPdsExcel, { ...asHr, user: { id: self.id } });
    ok("a person can export their own PDS", allowed(mine), why(mine));

    // ── 2. a colleague in the same municipality ────────────────────────
    console.log("\n── 2. a colleague, same municipality, not HR ──");
    const peer = await run(exportPdsExcel, {
      ...asHr,
      user: { id: colleague.id },
    });
    ok(
      "a colleague is refused",
      peer.kind === "threw",
      peer.kind === "sent"
        ? `LEAK: got ${peer.bytes} bytes of someone else's PDS`
        : why(peer),
    );
    if (peer.kind === "threw") {
      ok(
        "and told it is an HR-only action",
        /only hr/i.test(peer.message),
        peer.message,
      );
    }

    // ── 3. HR of that municipality ─────────────────────────────────────
    console.log("\n── 3. HR of that municipality ──");
    const grant = await prisma.module.create({
      data: {
        userId: colleague.User.id,
        lineId: app.lineId,
        moduleName: "human-resources",
        moduleIndex: "hr",
        privilege: 1,
        status: 1,
      },
      select: { id: true },
    });
    grantId = grant.id;
    const hr = await run(exportPdsExcel, {
      ...asHr,
      user: { id: colleague.id },
    });
    ok("HR can export a colleague's PDS", allowed(hr), why(hr));

    // ── 4. a suspended grant ───────────────────────────────────────────
    console.log("\n── 4. the same HR, access suspended ──");
    await prisma.module.update({
      where: { id: grant.id },
      data: { status: 0 },
    });
    const susp = await run(exportPdsExcel, {
      ...asHr,
      user: { id: colleague.id },
    });
    ok(
      "a suspended HR grant is refused",
      susp.kind === "threw",
      susp.kind === "sent"
        ? "LEAK: revoked access still worked"
        : why(susp),
    );

    // ── 5. another municipality ────────────────────────────────────────
    console.log("\n── 5. another municipality ──");
    const other = await run(exportPdsExcel, {
      ...asHr,
      user: { id: outsider.id },
    });
    ok(
      "another line is refused",
      other.kind === "threw",
      other.kind === "sent" ? "LEAK" : why(other),
    );
    if (other.kind === "threw") {
      ok(
        "and told it is another municipality's data",
        /municipality/i.test(other.message),
        other.message,
      );
    }

    // ── 6. a super-admin borrowing the line ────────────────────────────
    console.log("\n-- 6. super-admin impersonating this line --");
    // The colleague's grant is still suspended from case 4, so this
    // proves the impersonation flag carried it, not a lingering module.
    const imp = await run(exportPdsExcel, {
      ...asHr,
      user: { id: colleague.id },
      impersonated: true,
    });
    ok("an impersonated session can export", allowed(imp), why(imp));

    const impElsewhere = await run(exportPdsExcel, {
      ...asHr,
      user: { id: outsider.id },
      impersonated: true,
    });
    ok(
      "but is still confined to the line it borrowed",
      impElsewhere.kind === "threw",
      impElsewhere.kind === "sent"
        ? "LEAK: impersonation crossed a municipality"
        : why(impElsewhere),
    );

    // ── 7. the applicant's own copy ────────────────────────────────────
    console.log("\n── 7. the applicant's own copy (temp token) ──");
    const own = await run(exportOwnPdsExcel, {
      user: { id: app.id },
      query: {},
      headers: {},
    });
    ok("the applicant still gets their own workbook", allowed(own), why(own));

    const stolen = await run(exportOwnPdsExcel, {
      user: { id: app.id },
      query: { id: "some-other-application" },
      headers: {},
    });
    ok(
      "and the query id is still ignored",
      allowed(stolen),
      why(stolen),
    );
  } finally {
    if (grantId) {
      await prisma.module.delete({ where: { id: grantId } });
      console.log("\n(temporary HR grant removed)");
    }
    await prisma.$disconnect();
  }

  console.log(`\n${pass} passed, ${fails.length} failed`);
  if (fails.length) for (const f of fails) console.log(`  FAIL  ${f}`);
  process.exit(fails.length ? 1 : 0);
})();
