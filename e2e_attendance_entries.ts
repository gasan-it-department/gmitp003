/* PROOF: HR-defined scan entries on an attendance sheet.
 *
 * A sheet declares its own entries — ["AM In","AM Out","PM In","PM Out"], or
 * just one for a plain headcount. A person may be recorded ONCE PER ENTRY, so
 * tapping out after tapping in is a new row, while scanning the same entry
 * twice is still idempotent.
 *
 * Run: npx ts-node --transpile-only e2e_attendance_entries.ts */
import { prisma } from "./src/barrel/prisma";
import {
  createAttendanceEvent,
  confirmAttendance,
  resolveAttendanceScan,
  attendanceRecords,
  sanitizeEntries,
  resolveEntry,
  DEFAULT_ENTRY,
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
  const made = { userIds: [] as string[], accountIds: [] as string[], eventIds: [] as string[] };

  try {
    const line = await prisma.line.findFirst({ select: { id: true } });
    if (!line) { console.log("NO FIXTURE (line)"); process.exit(2); }

    // ── Pure helpers ──────────────────────────────────────────────────
    ok("an empty entry list falls back to a single default",
      JSON.stringify(sanitizeEntries([])) === JSON.stringify([DEFAULT_ENTRY]));
    ok("labels are trimmed and de-duplicated case-insensitively",
      JSON.stringify(sanitizeEntries([" AM In ", "am in", "AM Out"])) ===
        JSON.stringify(["AM In", "AM Out"]),
      JSON.stringify(sanitizeEntries([" AM In ", "am in", "AM Out"])));
    ok("order is preserved as HR typed it",
      JSON.stringify(sanitizeEntries(["PM Out", "AM In"])) ===
        JSON.stringify(["PM Out", "AM In"]));
    ok("the list is capped",
      sanitizeEntries(Array.from({ length: 30 }, (_, i) => "E" + i)).length === 8);

    ok("a single-entry sheet does not need the entry named",
      resolveEntry(["Attendance"]) === "Attendance");
    ok("entry matching is case-insensitive",
      resolveEntry(["AM In", "AM Out"], "am in") === "AM In");
    ok("a multi-entry sheet REFUSES an unnamed scan",
      !!(await threw(async () => resolveEntry(["AM In", "AM Out"]))));
    ok("an unknown entry is refused rather than silently defaulted",
      !!(await threw(async () => resolveEntry(["AM In"], "Lunch"))));

    // ── Fixtures ──────────────────────────────────────────────────────
    const mk = async (tag: string) => {
      const acct = await prisma.account.create({
        data: { username: `qa_ent_${TS}_${tag}`, password: "x", lineId: line.id },
        select: { id: true, username: true },
      });
      made.accountIds.push(acct.id);
      const u = await prisma.user.create({
        data: {
          firstName: "Qa", lastName: `ENTRY${TS}`, username: acct.username,
          accountId: acct.id, lineId: line.id,
          email: `qa-ent-${TS}-${tag}@test.local`,
          verifyCode: `QAENT${TS}${tag}`,
        },
        select: { id: true, verifyCode: true },
      });
      made.userIds.push(u.id);
      return u;
    };
    const HR = await mk("hr");
    const EMP = await mk("emp");
    const req = (extra: any = {}) =>
      ({ user: { id: made.accountIds[0] }, ...extra }) as any;

    // ── A four-entry sheet, created the way HR would ──────────────────
    let res = mockRes();
    await createAttendanceEvent(
      req({
        body: {
          lineId: line.id,
          title: `QA entries ${TS}`,
          fields: ["fullName"],
          entries: ["AM In", "AM Out", "PM In", "PM Out"],
        },
      }),
      res,
    );
    const ev = res._body;
    if (ev?.id) made.eventIds.push(ev.id);
    ok("the sheet is created with HR's four entries",
      JSON.stringify(ev?.entries) ===
        JSON.stringify(["AM In", "AM Out", "PM In", "PM Out"]),
      JSON.stringify(ev?.entries));

    // ── The same person, across the day ───────────────────────────────
    const scan = async (entry?: string) => {
      const r = mockRes();
      await confirmAttendance(
        req({ body: { eventId: ev.id, userId: EMP.id, ...(entry ? { entry } : {}) } }),
        r,
      );
      return r._body;
    };

    let out = await scan("AM In");
    ok("AM In records", out?.duplicate === false && out?.entry === "AM In");
    out = await scan("AM Out");
    ok("AM Out is a SEPARATE record, not a duplicate",
      out?.duplicate === false && out?.entry === "AM Out", JSON.stringify(out));
    out = await scan("PM In");
    out = await scan("PM Out");
    ok("all four entries are recorded for one person",
      out?.attendees === 4, JSON.stringify({ attendees: out?.attendees }));
    ok("the per-entry count is reported separately from the sheet total",
      out?.entryCount === 1 && out?.attendees === 4,
      JSON.stringify({ entryCount: out?.entryCount, attendees: out?.attendees }));

    // Re-scanning ONE entry must still be idempotent.
    out = await scan("AM In");
    ok("re-scanning the same entry is still a duplicate", out?.duplicate === true);
    const rowCount = await prisma.attendanceRecord.count({
      where: { eventId: ev.id, userId: EMP.id },
    });
    ok("the re-scan created no extra row", rowCount === 4, String(rowCount));

    // A scan with no entry on a multi-entry sheet must be refused.
    ok("scanning without naming the entry is refused on a 4-entry sheet",
      !!(await threw(async () => scan())));
    ok("an entry that is not on this sheet is refused",
      !!(await threw(async () => scan("Merienda"))));

    // ── Preview knows which entry it is checking ──────────────────────
    res = mockRes();
    await resolveAttendanceScan(
      req({ body: { eventId: ev.id, code: EMP.verifyCode, entry: "AM In" } }),
      res,
    );
    ok("preview reports the entry it resolved", res._body?.entry === "AM In");
    ok("preview flags AM In as already recorded", res._body?.alreadyRecorded === true);
    ok("preview lists the sheet's entries for the scanner UI",
      Array.isArray(res._body?.entries) && res._body.entries.length === 4);

    res = mockRes();
    await resolveAttendanceScan(
      req({ body: { eventId: ev.id, code: EMP.verifyCode, entry: "PM Out" } }),
      res,
    );
    ok("…but the SAME person is not 'already recorded' once PM Out is cleared",
      res._body?.entry === "PM Out");

    // ── The sheet lists rows per entry, and can be filtered ───────────
    res = mockRes();
    await attendanceRecords(req({ params: { eventId: ev.id }, query: {} }), res);
    ok("the sheet shows all four rows", res._body?.total === 4, String(res._body?.total));
    ok("each row names its entry",
      (res._body?.records ?? []).every((r: any) => !!r.entry));
    ok("the response advertises the sheet's entries",
      JSON.stringify(res._body?.entries) ===
        JSON.stringify(["AM In", "AM Out", "PM In", "PM Out"]));

    res = mockRes();
    await attendanceRecords(
      req({ params: { eventId: ev.id }, query: { entry: "AM Out" } }), res);
    ok("the list can be narrowed to one entry",
      res._body?.total === 1 && res._body.records[0].entry === "AM Out",
      JSON.stringify({ total: res._body?.total }));

    // ── A single-entry sheet stays effortless ─────────────────────────
    res = mockRes();
    await createAttendanceEvent(
      req({
        body: {
          lineId: line.id, title: `QA single ${TS}`,
          fields: ["fullName"], entries: [],
        },
      }),
      res,
    );
    const solo = res._body;
    made.eventIds.push(solo.id);
    ok("a sheet created with no entries gets the single default",
      JSON.stringify(solo?.entries) === JSON.stringify([DEFAULT_ENTRY]));

    const r2 = mockRes();
    await confirmAttendance(
      req({ body: { eventId: solo.id, userId: EMP.id } }), r2);
    ok("a single-entry sheet records with no entry named",
      r2._body?.duplicate === false && r2._body?.entry === DEFAULT_ENTRY,
      JSON.stringify(r2._body));

    const r3 = mockRes();
    await confirmAttendance(
      req({ body: { eventId: solo.id, userId: EMP.id } }), r3);
    ok("and is still idempotent", r3._body?.duplicate === true);
  } catch (e: any) {
    fail++;
    console.log("FAIL  threw: " + (e?.stack ?? e?.message ?? String(e)));
  } finally {
    try {
      if (made.eventIds.length) {
        await prisma.attendanceRecord.deleteMany({
          where: { eventId: { in: made.eventIds } },
        });
        await prisma.attendanceEvent.deleteMany({
          where: { id: { in: made.eventIds } },
        });
      }
      if (made.userIds.length)
        await prisma.user.deleteMany({ where: { id: { in: made.userIds } } });
      if (made.accountIds.length)
        await prisma.account.deleteMany({ where: { id: { in: made.accountIds } } });
      const left = await prisma.user.count({
        where: { username: { startsWith: `qa_ent_${TS}_` } },
      });
      const leftE = await prisma.attendanceEvent.count({
        where: { title: { startsWith: `QA ` , contains: String(TS) } },
      });
      console.log(`CLEANUP  leftover users=${left} events=${leftE}`);
      if (left || leftE) fail++;
    } catch (e: any) {
      console.log("CLEANUP FAILED: " + (e?.message ?? e));
      fail++;
    }
    console.log(`\n${pass} passed, ${fail} failed`);
    await prisma.$disconnect();
    process.exit(fail ? 1 : 0);
  }
})();
