/* PROOF: an entry accepts the same person again — but only after the cool-down.
 *
 * A sheet used to allow exactly one row per person per entry, enforced by a
 * unique constraint, so a second tap was swallowed forever. It is now a TIME
 * rule: inside SCAN_COOLDOWN_MS the scan comes back as a duplicate and writes
 * nothing; past it, it is a real second row.
 *
 * The cool-down is measured against the SCAN's own timestamp, not "now", so
 * these tests drive it with scannedAt instead of sleeping for three minutes.
 *
 * Run: npx ts-node --transpile-only e2e_attendance_cooldown.ts */
import { randomUUID } from "crypto";
import { prisma } from "./src/barrel/prisma";
import {
  createAttendanceEvent,
  confirmAttendance,
  confirmAttendanceBulk,
  resolveAttendanceScan,
  attendanceEventDetail,
  listAttendanceEvents,
  SCAN_COOLDOWN_MS,
} from "./src/controller/attendanceController";

const TS = Date.now();
const MIN = 60_000;

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
  const made = { userIds: [] as string[], accountIds: [] as string[], eventIds: [] as string[] };

  try {
    ok("the cool-down is three minutes", SCAN_COOLDOWN_MS === 3 * MIN,
      String(SCAN_COOLDOWN_MS));

    const line = await prisma.line.findFirst({ select: { id: true } });
    if (!line) { console.log("NO FIXTURE (line)"); process.exit(2); }

    const mk = async (tag: string) => {
      const acct = await prisma.account.create({
        data: { username: `qa_cd_${TS}_${tag}`, password: "x", lineId: line.id },
        select: { id: true, username: true },
      });
      made.accountIds.push(acct.id);
      const u = await prisma.user.create({
        data: {
          firstName: "Qa", lastName: `CD${TS}${tag.toUpperCase()}`,
          username: acct.username, accountId: acct.id, lineId: line.id,
          email: `qa-cd-${TS}-${tag}@test.local`,
          verifyCode: randomUUID().replace(/-/g, ""),
        },
        select: { id: true, verifyCode: true },
      });
      made.userIds.push(u.id);
      return { accountId: acct.id, userId: u.id, code: u.verifyCode! };
    };

    const HR = await mk("hr");
    const EMP = await mk("emp");
    const OTHER = await mk("other");

    const as = (body: any) => ({ user: { id: HR.accountId }, body }) as any;
    const scan = async (userId: string, entry: string, at: Date) => {
      const r = mockRes();
      await confirmAttendance(
        as({ eventId: EVENT, userId, entry, scannedAt: at.toISOString() }), r);
      return r._body;
    };
    const rowCount = (entry?: string) =>
      prisma.attendanceRecord.count({
        where: { eventId: EVENT, userId: EMP.userId, ...(entry ? { entry } : {}) },
      });

    // A two-entry sheet, so the cool-down can be shown NOT to bleed across.
    let res = mockRes();
    await createAttendanceEvent(
      as({ lineId: line.id, title: `QA cooldown ${TS}`,
           fields: ["fullName"], entries: ["AM In", "AM Out"] }), res);
    const EVENT: string = res._body.id;
    made.eventIds.push(EVENT);

    const T0 = new Date(Date.now() - 60 * MIN); // an hour ago, well in the past

    // ── First scan lands ────────────────────────────────────────────────
    let b = await scan(EMP.userId, "AM In", T0);
    ok("the first scan is recorded", b?.duplicate === false, JSON.stringify(b?.duplicate));
    ok("…as one row", (await rowCount("AM In")) === 1);
    ok("it says when the next one is allowed",
      !!b?.nextAllowedAt &&
        Math.abs(new Date(b.nextAllowedAt).getTime() - (T0.getTime() + SCAN_COOLDOWN_MS)) < 1500,
      String(b?.nextAllowedAt));
    ok("and publishes the cool-down length", b?.cooldownMs === SCAN_COOLDOWN_MS);

    // ── Inside the cool-down: refused, and NOTHING is written ───────────
    for (const mins of [0, 1, 2.9]) {
      const at = new Date(T0.getTime() + mins * MIN);
      b = await scan(EMP.userId, "AM In", at);
      ok(`a re-scan at +${mins}min is a duplicate`, b?.duplicate === true,
        JSON.stringify(b?.duplicate));
    }
    ok("no extra row was written inside the cool-down",
      (await rowCount("AM In")) === 1, String(await rowCount("AM In")));

    // ── Past the cool-down: a real second row ───────────────────────────
    const T1 = new Date(T0.getTime() + 3 * MIN + 1000);
    b = await scan(EMP.userId, "AM In", T1);
    ok("a re-scan just past 3 minutes IS recorded", b?.duplicate === false,
      JSON.stringify(b?.duplicate));
    ok("…and it is a NEW row", (await rowCount("AM In")) === 2,
      String(await rowCount("AM In")));

    // The clock restarts from the newest row, not the first.
    b = await scan(EMP.userId, "AM In", new Date(T1.getTime() + 1 * MIN));
    ok("the cool-down restarts from the latest scan", b?.duplicate === true);
    ok("still two rows", (await rowCount("AM In")) === 2);

    // ── Counts stay about PEOPLE, not scans ─────────────────────────────
    ok("the entry count is people, not rows", b?.entryCount === 1,
      String(b?.entryCount));
    await scan(OTHER.userId, "AM In", T0);
    b = await scan(EMP.userId, "AM In", new Date(T1.getTime() + 10 * MIN));
    ok("a second person makes it two", b?.entryCount === 2, String(b?.entryCount));

    res = mockRes();
    await attendanceEventDetail(
      { user: { id: HR.accountId }, params: { eventId: EVENT } } as any, res);
    ok("the sheet header counts people too", res._body?.attendees === 2,
      String(res._body?.attendees));

    res = mockRes();
    await listAttendanceEvents(
      { user: { id: HR.accountId }, query: { lineId: line.id } } as any, res);
    const listed = (res._body?.events ?? []).find((e: any) => e.id === EVENT);
    ok("the sheet LIST counts people too", listed?.attendees === 2,
      String(listed?.attendees));

    // ── A different entry has its own clock ─────────────────────────────
    b = await scan(EMP.userId, "AM Out", T0);
    ok("the same moment in a DIFFERENT entry is fine", b?.duplicate === false,
      JSON.stringify(b?.duplicate));
    ok("AM Out has its own row", (await rowCount("AM Out")) === 1);

    // ── The preview stops crying wolf ───────────────────────────────────
    // EMP's last AM Out was an hour ago, so scanning now must look allowed.
    res = mockRes();
    await resolveAttendanceScan(
      as({ eventId: EVENT, code: EMP.code, entry: "AM Out" }), res);
    ok("preview: an hour-old scan is NOT flagged as already recorded",
      res._body?.alreadyRecorded === false, JSON.stringify(res._body?.alreadyRecorded));
    ok("preview still reports when it happened", !!res._body?.recordedAt);

    // …but a scan a moment ago must be.
    await scan(EMP.userId, "AM Out", new Date());
    res = mockRes();
    await resolveAttendanceScan(
      as({ eventId: EVENT, code: EMP.code, entry: "AM Out" }), res);
    ok("preview: a scan seconds ago IS flagged",
      res._body?.alreadyRecorded === true, JSON.stringify(res._body?.alreadyRecorded));
    ok("preview says when they may scan again", !!res._body?.nextAllowedAt);

    // ── The offline flush obeys the same rule, by SCAN time ─────────────
    const T2 = new Date(Date.now() - 30 * MIN);
    res = mockRes();
    await confirmAttendanceBulk(
      as({
        rows: [
          // two taps 20 seconds apart at the door — the second is the accident
          { clientOpId: `qa-${TS}-1`, eventId: EVENT, code: OTHER.code,
            entry: "AM Out", scannedAt: T2.toISOString() },
          { clientOpId: `qa-${TS}-2`, eventId: EVENT, code: OTHER.code,
            entry: "AM Out", scannedAt: new Date(T2.getTime() + 20_000).toISOString() },
          // …and a genuine re-tap ten minutes later
          { clientOpId: `qa-${TS}-3`, eventId: EVENT, code: OTHER.code,
            entry: "AM Out", scannedAt: new Date(T2.getTime() + 10 * MIN).toISOString() },
        ],
      }),
      res,
    );
    const statuses = (res._body?.results ?? []).map((r: any) => r.status);
    ok("offline flush: first accepted, second refused, third accepted",
      JSON.stringify(statuses) === JSON.stringify(["ok", "duplicate", "ok"]),
      JSON.stringify(statuses));
    ok("…leaving two rows, not three",
      (await prisma.attendanceRecord.count({
        where: { eventId: EVENT, userId: OTHER.userId, entry: "AM Out" },
      })) === 2);

    // Out-of-order flush: an EARLIER scan inside an existing row's window
    // must still be refused, or the window only works one way.
    res = mockRes();
    await confirmAttendanceBulk(
      as({
        rows: [{ clientOpId: `qa-${TS}-4`, eventId: EVENT, code: OTHER.code,
                 entry: "AM Out",
                 scannedAt: new Date(T2.getTime() - 30_000).toISOString() }],
      }),
      res,
    );
    ok("a late-arriving EARLIER scan inside the window is refused too",
      res._body?.results?.[0]?.status === "duplicate",
      JSON.stringify(res._body?.results?.[0]?.status));
  } catch (e: any) {
    fail++;
    console.log("FAIL  threw: " + (e?.stack ?? e?.message ?? String(e)));
  } finally {
    try {
      if (made.eventIds.length) {
        await prisma.attendanceRecord.deleteMany({ where: { eventId: { in: made.eventIds } } });
        await prisma.attendanceEvent.deleteMany({ where: { id: { in: made.eventIds } } });
      }
      if (made.userIds.length)
        await prisma.user.deleteMany({ where: { id: { in: made.userIds } } });
      if (made.accountIds.length)
        await prisma.account.deleteMany({ where: { id: { in: made.accountIds } } });
      const left = await prisma.user.count({
        where: { username: { startsWith: `qa_cd_${TS}_` } },
      });
      console.log(`CLEANUP  leftover users=${left}`);
      if (left) fail++;
    } catch (e: any) {
      console.log("CLEANUP FAILED: " + (e?.message ?? e));
      fail++;
    }
    console.log(`\n${pass} passed, ${fail} failed`);
    await prisma.$disconnect();
    process.exit(fail ? 1 : 0);
  }
})();
