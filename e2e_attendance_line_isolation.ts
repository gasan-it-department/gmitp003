/* PROOF: attendance never crosses a line boundary.
 *
 * Reported: a user on line A could see line B's attendance sheets. Cause was
 * `q.lineId || callerLine` on four endpoints — the CLIENT's lineId won, so
 * changing it in the URL returned another office's sheets, and on the write
 * paths created sheets and granted scanner access inside that office.
 *
 * Run: npx ts-node --transpile-only e2e_attendance_line_isolation.ts */
import { prisma } from "./src/barrel/prisma";
import {
  createAttendanceEvent,
  listAttendanceEvents,
  attendanceEventDetail,
  attendanceRecords,
  listAttendanceAccess,
  grantAttendanceAccess,
} from "./src/controller/attendanceController";

const TS = Date.now();

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
  const made = {
    userIds: [] as string[],
    accountIds: [] as string[],
    eventIds: [] as string[],
  };
  // Declared out here so the cleanup in `finally` can still see them.
  let LINE_A = "";
  let LINE_B = "";

  try {
    // Two existing lines. Creating one needs a barangay tree, and this test is
    // about the boundary between lines, not about how a line is made.
    const lines = await prisma.line.findMany({ select: { id: true }, take: 2 });
    if (lines.length < 2) {
      console.log("NEEDS 2 LINES — this database has " + lines.length);
      process.exit(2);
    }
    LINE_A = lines[0].id;
    LINE_B = lines[1].id;

    const mkUser = async (tag: string, lineId: string) => {
      const acct = await prisma.account.create({
        data: { username: `qa_iso_${TS}_${tag}`, password: "x", lineId },
        select: { id: true, username: true },
      });
      made.accountIds.push(acct.id);
      const u = await prisma.user.create({
        data: {
          firstName: "Qa", lastName: `ISO${TS}${tag.toUpperCase()}`,
          username: acct.username, accountId: acct.id, lineId,
          email: `qa-iso-${TS}-${tag}@test.local`,
        },
        select: { id: true },
      });
      made.userIds.push(u.id);
      return { accountId: acct.id, userId: u.id };
    };

    const A = await mkUser("a", LINE_A);
    const B = await mkUser("b", LINE_B);

    const as = (who: { accountId: string }, extra: any = {}) =>
      ({ user: { id: who.accountId }, ...extra }) as any;

    // A sheet in each line, created by that line's own user.
    const mkSheet = async (who: any, lineId: string, title: string) => {
      const r = mockRes();
      await createAttendanceEvent(
        as(who, { body: { lineId, title, fields: ["fullName"] } }), r);
      made.eventIds.push(r._body.id);
      return r._body.id;
    };
    const SHEET_A = await mkSheet(A, LINE_A, `QA A sheet ${TS}`);
    const SHEET_B = await mkSheet(B, LINE_B, `QA B sheet ${TS}`);

    // ── The reported leak ───────────────────────────────────────────────
    let res = mockRes();
    await listAttendanceEvents(as(A, { query: { lineId: LINE_A } }), res);
    const own = (res._body?.events ?? []).map((e: any) => e.id);
    ok("A sees their own line's sheet", own.includes(SHEET_A));
    ok("…and only that one", !own.includes(SHEET_B));

    ok("A asking for line B's sheets is REFUSED",
      /not your line/i.test(
        await threw(async () =>
          listAttendanceEvents(as(A, { query: { lineId: LINE_B } }), mockRes())),
      ));

    // Omitting lineId must fall back to the caller's own line, not everything.
    res = mockRes();
    await listAttendanceEvents(as(A, { query: {} }), res);
    const implicit = (res._body?.events ?? []).map((e: any) => e.id);
    ok("with no lineId the caller gets their OWN line",
      implicit.includes(SHEET_A) && !implicit.includes(SHEET_B));

    // ── Writes ──────────────────────────────────────────────────────────
    ok("A cannot CREATE a sheet inside line B",
      /not your line/i.test(
        await threw(async () =>
          createAttendanceEvent(
            as(A, { body: { lineId: LINE_B, title: `QA intruder ${TS}`, fields: ["fullName"] } }),
            mockRes(),
          )),
      ));
    const intruders = await prisma.attendanceEvent.count({
      where: { lineId: LINE_B, title: { contains: "intruder" } },
    });
    ok("no sheet was created in line B", intruders === 0, String(intruders));

    ok("A cannot GRANT scanner access inside line B",
      /not your line/i.test(
        await threw(async () =>
          grantAttendanceAccess(
            as(A, { body: { lineId: LINE_B, userId: B.userId } }), mockRes())),
      ));
    ok("no grant was written in line B",
      (await prisma.attendanceMobileAccess.count({ where: { lineId: LINE_B } })) === 0);

    ok("A cannot LIST line B's scanner grants",
      /not your line/i.test(
        await threw(async () =>
          listAttendanceAccess(as(A, { query: { lineId: LINE_B } }), mockRes())),
      ));

    // ── Opening one sheet across the boundary (was already guarded) ─────
    ok("A cannot open line B's sheet by id",
      !!(await threw(async () =>
        attendanceEventDetail(as(A, { params: { eventId: SHEET_B } }), mockRes()))));
    ok("A cannot read line B's records",
      !!(await threw(async () =>
        attendanceRecords(
          as(A, { params: { eventId: SHEET_B }, query: {} }), mockRes()))));

    // ── A super-admin still crosses on purpose ──────────────────────────
    const sup = await prisma.admin.findFirst({ select: { userId: true } }).catch(() => null);
    if (sup?.userId) {
      const supAcct = await prisma.user.findUnique({
        where: { id: sup.userId }, select: { accountId: true },
      });
      if (supAcct?.accountId) {
        res = mockRes();
        const err = await threw(async () =>
          listAttendanceEvents(
            { user: { id: supAcct.accountId }, query: { lineId: LINE_B } } as any, res));
        ok("a super-admin CAN still read another line", err === "",
          err || "(allowed)");
      } else {
        console.log("SKIP  super-admin has no account row");
      }
    } else {
      console.log("SKIP  no super-admin in this database");
    }
  } catch (e: any) {
    fail++;
    console.log("FAIL  threw: " + (e?.stack ?? e?.message ?? String(e)));
  } finally {
    try {
      if (made.eventIds.length) {
        await prisma.attendanceRecord.deleteMany({ where: { eventId: { in: made.eventIds } } });
        await prisma.attendanceEvent.deleteMany({ where: { id: { in: made.eventIds } } });
      }
      await prisma.attendanceMobileAccess
        .deleteMany({ where: { lineId: { in: [LINE_A, LINE_B] }, userId: { in: made.userIds } } })
        .catch(() => undefined);
      if (made.userIds.length)
        await prisma.user.deleteMany({ where: { id: { in: made.userIds } } });
      if (made.accountIds.length)
        await prisma.account.deleteMany({ where: { id: { in: made.accountIds } } });
      const leftU = await prisma.user.count({
        where: { username: { startsWith: `qa_iso_${TS}_` } },
      });
      console.log(`CLEANUP  leftover users=${leftU}`);
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
