/* PROOF: QR attendance end-to-end.
 *  - the ID-card QR (verify-id?code=) resolves to the right employee
 *  - resolve is READ-ONLY, confirm writes, re-confirm is idempotent
 *  - only HR-selected columns are captured, frozen at scan time
 *  - a profile edit after the scan does NOT rewrite the record
 *  - cross-line scans are refused
 *  - a closed sheet refuses new scans
 *  - Excel export streams with the chosen columns
 * Run: npx ts-node --transpile-only e2e_attendance.ts */
import { prisma } from "./src/barrel/prisma";
import {
  extractVerifyCode,
  resolveAttendanceScan,
  confirmAttendance,
  confirmAttendanceBulk,
  attendanceRecords,
  exportAttendance,
  createAttendanceEvent,
  updateAttendanceEvent,
} from "./src/controller/attendanceController";
import { randomUUID } from "crypto";

const TS = Date.now();

const mockRes = () => {
  const r: any = {
    _code: 0,
    _body: null as any,
    _headers: {} as Record<string, string>,
    code(n: number) { this._code = n; return this; },
    send(b: unknown) { this._body = b; return this; },
    status(n: number) { return this.code(n); },
    header(k: string, v: string) { this._headers[k] = v; return this; },
  };
  return r;
};
const reqAs = (accountId: string, extra: any = {}) =>
  ({ user: { id: accountId }, ...extra }) as any;

(async () => {
  let pass = 0, fail = 0;
  const ok = (l: string, c: boolean, d = "") => {
    if (c) { pass++; console.log("PASS  " + l); }
    else { fail++; console.log("FAIL  " + l + (d ? "  → " + d : "")); }
  };

  const made = {
    accountIds: [] as string[],
    userIds: [] as string[],
    eventIds: [] as string[],
    departmentIds: [] as string[],
  };

  const mkUser = async (tag: string, lineId: string, over: any = {}) => {
    const acct = await prisma.account.create({
      data: { username: `qa_att_${TS}_${tag}`, password: "x", lineId },
      select: { id: true, username: true },
    });
    made.accountIds.push(acct.id);
    const u = await prisma.user.create({
      data: {
        firstName: over.firstName ?? "Juan",
        lastName: over.lastName ?? tag.toUpperCase(),
        middleName: over.middleName ?? "Santos",
        username: acct.username,
        accountId: acct.id,
        lineId,
        email: `qa-att-${TS}-${tag}@test.local`,
        verifyCode: randomUUID().replace(/-/g, ""),
      },
      select: { id: true, verifyCode: true },
    });
    made.userIds.push(u.id);
    return { acctId: acct.id, userId: u.id, code: u.verifyCode as string };
  };

  try {
    // ── fixtures ─────────────────────────────────────────────────────────
    const lines = await prisma.line.findMany({ take: 2, select: { id: true } });
    if (!lines.length) { console.log("NO FIXTURE (line)"); process.exit(2); }
    const lineA = lines[0].id;
    const lineB = lines[1]?.id ?? null;

    const hr = await mkUser("hr", lineA);
    const emp = await mkUser("emp", lineA, {
      firstName: "Maria", lastName: "Dela Cruz", middleName: "Reyes",
    });

    // ── 1. code extraction from every QR shape ───────────────────────────
    ok("extract from full portal URL",
      extractVerifyCode(`https://portal.gasan.ph/verify-id?code=${emp.code}`) === emp.code);
    ok("extract from bare code",
      extractVerifyCode(emp.code) === emp.code);
    ok("extract from url with extra params",
      extractVerifyCode(`https://portal.gasan.ph/verify-id?code=${emp.code}&x=1`) === emp.code);
    ok("garbage QR rejected",
      extractVerifyCode("https://example.com/not-an-id") === null);

    // ── 2. HR creates a sheet with chosen columns ────────────────────────
    let res = mockRes();
    await createAttendanceEvent(
      reqAs(hr.acctId, {
        body: {
          lineId: lineA,
          title: `QA Seminar ${TS}`,
          location: "Municipal Gym",
          fields: ["lastName", "firstName", "middleName", "office", "bogusKey"],
        },
      }),
      res,
    );
    ok("event created", res._code === 201, JSON.stringify(res._body));
    const event = res._body;
    made.eventIds.push(event.id);
    ok("unknown field key dropped",
      !event.fields.includes("bogusKey"), JSON.stringify(event.fields));
    ok("chosen columns kept in order",
      JSON.stringify(event.fields) ===
        JSON.stringify(["lastName", "firstName", "middleName", "office"]),
      JSON.stringify(event.fields));

    // ── 3. resolve is read-only ──────────────────────────────────────────
    res = mockRes();
    await resolveAttendanceScan(
      reqAs(hr.acctId, {
        body: { eventId: event.id, code: `https://portal.gasan.ph/verify-id?code=${emp.code}` },
      }),
      res,
    );
    ok("resolve 200", res._code === 200, JSON.stringify(res._body));
    ok("resolve found the right employee",
      res._body?.user?.id === emp.userId);
    ok("resolve returns ONLY the chosen columns",
      JSON.stringify(res._body.columns.map((c: any) => c.key)) ===
        JSON.stringify(["lastName", "firstName", "middleName", "office"]),
      JSON.stringify(res._body.columns.map((c: any) => c.key)));
    ok("resolve shows real values",
      res._body.columns.find((c: any) => c.key === "lastName")?.value === "Dela Cruz");
    ok("resolve says not yet recorded", res._body.alreadyRecorded === false);

    const afterResolve = await prisma.attendanceRecord.count({ where: { eventId: event.id } });
    ok("resolve WROTE NOTHING", afterResolve === 0, `count=${afterResolve}`);

    // ── 4. confirm writes ────────────────────────────────────────────────
    res = mockRes();
    await confirmAttendance(
      reqAs(hr.acctId, { body: { eventId: event.id, userId: emp.userId } }),
      res,
    );
    ok("confirm 200", res._code === 200, JSON.stringify(res._body));
    ok("confirm reports 1 attendee", res._body?.attendees === 1);
    const firstRecordId = res._body.record.id;
    const firstStamp = res._body.record.timestamp;

    // ── 5. re-confirm is idempotent ──────────────────────────────────────
    res = mockRes();
    await confirmAttendance(
      reqAs(hr.acctId, { body: { eventId: event.id, userId: emp.userId } }),
      res,
    );
    ok("re-confirm returns SAME record (no duplicate)",
      res._body?.record?.id === firstRecordId);
    ok("re-confirm did not move the timestamp",
      new Date(res._body.record.timestamp).getTime() === new Date(firstStamp).getTime());
    const dupCount = await prisma.attendanceRecord.count({ where: { eventId: event.id } });
    ok("still exactly 1 row", dupCount === 1, `count=${dupCount}`);

    // ── 6. snapshot is FROZEN against later profile edits ────────────────
    await prisma.user.update({
      where: { id: emp.userId },
      data: { lastName: "CHANGED-AFTER-SCAN" },
    });
    res = mockRes();
    await attendanceRecords(
      reqAs(hr.acctId, { params: { eventId: event.id }, query: {} }),
      res,
    );
    ok("records 200", res._code === 200);
    const row = res._body.records[0];
    ok("snapshot kept the ORIGINAL name (not the edit)",
      row.values.lastName === "Dela Cruz",
      `got "${row.values.lastName}"`);
    ok("records expose the chosen columns",
      JSON.stringify(res._body.columns.map((c: any) => c.key)) ===
        JSON.stringify(["lastName", "firstName", "middleName", "office"]));

    // ── 7. columns added later are backfilled, not blank ─────────────────
    res = mockRes();
    await updateAttendanceEvent(
      reqAs(hr.acctId, {
        params: { eventId: event.id },
        body: { fields: ["lastName", "firstName", "middleName", "office", "email"] },
      }),
      res,
    );
    ok("event columns updated", res._code === 200);
    res = mockRes();
    await attendanceRecords(
      reqAs(hr.acctId, { params: { eventId: event.id }, query: {} }),
      res,
    );
    ok("newly-added column is backfilled live",
      !!res._body.records[0].values.email,
      JSON.stringify(res._body.records[0].values));
    ok("frozen column still frozen after the edit",
      res._body.records[0].values.lastName === "Dela Cruz");

    // ── 8. cross-line scan refused ───────────────────────────────────────
    if (lineB) {
      const outsider = await mkUser("outsider", lineB);
      let threw = "";
      try {
        await resolveAttendanceScan(
          reqAs(hr.acctId, { body: { eventId: event.id, code: outsider.code } }),
          mockRes(),
        );
      } catch (e: any) { threw = e?.message ?? "err"; }
      ok("cross-line scan REFUSED", !!threw, threw || "no throw");
    } else {
      console.log("SKIP  cross-line scan (only one line in this DB)");
    }

    // ── 8b. OFFLINE UPLOAD: bulk flush of queued scans ───────────────────
    // A second sheet, so the offline rows land somewhere clean.
    res = mockRes();
    await createAttendanceEvent(
      reqAs(hr.acctId, {
        body: {
          lineId: lineA,
          title: `QA Seminar ${TS} offline`,
          fields: ["lastName", "firstName"],
        },
      }),
      res,
    );
    const offEvent = res._body;
    made.eventIds.push(offEvent.id);

    const late = await mkUser("late", lineA, { firstName: "Pedro", lastName: "Bautista" });
    // Door time = 3h ago; the phone only got signal now.
    const doorTime = new Date(Date.now() - 3 * 60 * 60 * 1000);

    res = mockRes();
    await confirmAttendanceBulk(
      reqAs(hr.acctId, {
        body: {
          rows: [
            // queued with only the raw QR (offline scan never got a preview)
            { clientOpId: "op-1", eventId: offEvent.id,
              code: `https://portal.gasan.ph/verify-id?code=${late.code}`,
              scannedAt: doorTime.toISOString() },
            // replay of the same row — must be a duplicate, not a double
            { clientOpId: "op-1-replay", eventId: offEvent.id, code: late.code,
              scannedAt: doorTime.toISOString() },
            // a bad row must not sink the batch
            { clientOpId: "op-bad", eventId: offEvent.id, code: "not-a-real-code",
              scannedAt: doorTime.toISOString() },
          ],
        },
      }),
      res,
    );
    ok("bulk 200", res._code === 200, JSON.stringify(res._body));
    const byOp: Record<string, any> = {};
    for (const r of res._body.results) byOp[r.clientOpId] = r;
    ok("offline row recorded by raw QR alone", byOp["op-1"]?.status === "ok",
      JSON.stringify(byOp["op-1"]));
    ok("bulk resolved the employee name",
      byOp["op-1"]?.fullName?.includes("Bautista"), byOp["op-1"]?.fullName);
    ok("replay reported as duplicate (not a second row)",
      byOp["op-1-replay"]?.status === "duplicate", JSON.stringify(byOp["op-1-replay"]));
    ok("bad row errors on its OWN clientOpId",
      byOp["op-bad"]?.status === "error", JSON.stringify(byOp["op-bad"]));
    ok("one bad row did NOT sink the good ones",
      res._body.results.length === 3);

    const offRows = await prisma.attendanceRecord.findMany({
      where: { eventId: offEvent.id },
      select: { userId: true, timestamp: true },
    });
    ok("exactly 1 row written despite the replay", offRows.length === 1,
      `rows=${offRows.length}`);
    ok("record kept the DOOR time, not the upload time",
      Math.abs(offRows[0].timestamp.getTime() - doorTime.getTime()) < 2000,
      `stored=${offRows[0]?.timestamp?.toISOString()} door=${doorTime.toISOString()}`);

    // A future-dated device clock must not be trusted.
    const future = new Date(Date.now() + 48 * 60 * 60 * 1000);
    const fut = await mkUser("future", lineA);
    res = mockRes();
    await confirmAttendanceBulk(
      reqAs(hr.acctId, {
        body: { rows: [{ clientOpId: "op-future", eventId: offEvent.id,
          code: fut.code, scannedAt: future.toISOString() }] },
      }),
      res,
    );
    const futRow = await prisma.attendanceRecord.findFirst({
      where: { eventId: offEvent.id, userId: fut.userId },
      select: { timestamp: true },
    });
    ok("future device clock rejected, server time used",
      !!futRow && futRow.timestamp.getTime() < Date.now() + 60_000,
      futRow?.timestamp?.toISOString());

    // ── 8c. FILTERS: date, office/department, search, and export parity ──
    // Need two offices to prove the filter narrows. Make our own rather than
    // skipping — the office filter is the point of this block.
    const depts = await prisma.department.findMany({
      where: { lineId: lineA },
      take: 2,
      select: { id: true, name: true },
    });
    while (depts.length < 2) {
      const d = await prisma.department.create({
        data: { name: `QA Office ${TS}-${depts.length}`, lineId: lineA },
        select: { id: true, name: true },
      });
      made.departmentIds.push(d.id);
      depts.push(d);
    }

    res = mockRes();
    await createAttendanceEvent(
      reqAs(hr.acctId, {
        body: {
          lineId: lineA,
          title: `QA Seminar ${TS} filters`,
          fields: ["lastName", "firstName", "office"],
        },
      }),
      res,
    );
    const fEvent = res._body;
    made.eventIds.push(fEvent.id);

    const alpha = await mkUser("alpha", lineA, { firstName: "Ana", lastName: "Alvarez" });
    const bravo = await mkUser("bravo", lineA, { firstName: "Ben", lastName: "Bonifacio" });
    if (depts[0])
      await prisma.user.update({ where: { id: alpha.userId }, data: { departmentId: depts[0].id } });
    if (depts[1])
      await prisma.user.update({ where: { id: bravo.userId }, data: { departmentId: depts[1].id } });

    // Alpha scanned 5 days ago, Bravo today — so a date window can split them.
    const oldDay = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
    await confirmAttendanceBulk(
      reqAs(hr.acctId, {
        body: {
          rows: [
            { clientOpId: "f-a", eventId: fEvent.id, code: alpha.code,
              scannedAt: oldDay.toISOString() },
            { clientOpId: "f-b", eventId: fEvent.id, code: bravo.code,
              scannedAt: new Date().toISOString() },
          ],
        },
      }),
      mockRes(),
    );

    const recs = async (query: any) => {
      const r = mockRes();
      await attendanceRecords(
        reqAs(hr.acctId, { params: { eventId: fEvent.id }, query }),
        r,
      );
      return r._body;
    };

    let out = await recs({});
    ok("filters: unfiltered shows both", out.total === 2, `total=${out.total}`);

    // Date window that excludes the 5-day-old scan.
    const ymd = (d: Date) => d.toISOString().slice(0, 10);
    out = await recs({ dateFrom: ymd(new Date()) });
    ok("filters: dateFrom excludes the older scan",
      out.total === 1 && out.records[0].values.lastName === "Bonifacio",
      `total=${out.total}`);

    out = await recs({ dateTo: ymd(oldDay) });
    ok("filters: dateTo keeps only the older scan (whole-day end)",
      out.total === 1 && out.records[0].values.lastName === "Alvarez",
      `total=${out.total}`);

    // Search must span the WHOLE sheet, and total must reflect the filter.
    out = await recs({ search: "bonifacio" });
    ok("filters: search matches 1 and total agrees",
      out.total === 1 && out.records.length === 1,
      `total=${out.total} rows=${out.records.length}`);
    out = await recs({ search: "zzz-no-such-person" });
    ok("filters: search with no hits returns 0", out.total === 0, `total=${out.total}`);

    {
      out = await recs({ departmentId: depts[0].id });
      ok("filters: office filter narrows to that unit",
        out.total === 1 && out.records[0].values.lastName === "Alvarez",
        `total=${out.total}`);
      out = await recs({});
      const facetIds = (out.departments ?? []).map((d: any) => d.id);
      ok("filters: office facet lists the units present",
        facetIds.includes(depts[0].id) && facetIds.includes(depts[1].id),
        JSON.stringify(out.departments));
      // The facet must NOT collapse to the selected office, or the dropdown
      // would strand the user on one choice.
      out = await recs({ departmentId: depts[0].id });
      ok("filters: facet still offers every office while one is selected",
        (out.departments ?? []).length >= 2, JSON.stringify(out.departments));
    }

    // Export must mirror the on-screen filter, not dump the whole sheet.
    res = mockRes();
    await exportAttendance(
      reqAs(hr.acctId, {
        params: { eventId: fEvent.id },
        query: { search: "bonifacio" },
      }),
      res,
    );
    ok("filters: filtered export still produces a valid xlsx",
      res._body && res._body[0] === 0x50 && res._body[1] === 0x4b);
    const fullRes = mockRes();
    await exportAttendance(
      reqAs(hr.acctId, { params: { eventId: fEvent.id }, query: {} }),
      fullRes,
    );
    ok("filters: filtered export is SMALLER than the unfiltered one",
      res._body.length < fullRes._body.length,
      `filtered=${res._body.length} full=${fullRes._body.length}`);

    // ── 8d. PAGINATION vs SEARCH (the bug only shows past page 1) ────────
    // Old behaviour: `total` was the unfiltered count and search only filtered
    // the rows already sliced for the current page. So a match sitting on
    // page 2 was invisible from page 1, and the page count was wrong.
    res = mockRes();
    await createAttendanceEvent(
      reqAs(hr.acctId, {
        body: {
          lineId: lineA,
          title: `QA Seminar ${TS} paging`,
          fields: ["lastName", "firstName"],
        },
      }),
      res,
    );
    const pEvent = res._body;
    made.eventIds.push(pEvent.id);

    // 30 attendees > one 25-row page. The NEEDLE is scanned earliest, and the
    // list is ordered timestamp DESC, so it sorts last — i.e. onto page 2.
    const PAGE = 25;
    const N = 30;
    const bulkRows: any[] = [];
    const needle = await mkUser("needle", lineA, {
      firstName: "Zorayda", lastName: "Quintupleton",
    });
    bulkRows.push({
      clientOpId: "p-needle", eventId: pEvent.id, code: needle.code,
      scannedAt: new Date(Date.now() - N * 60_000).toISOString(),
    });
    for (let i = 1; i < N; i++) {
      const u = await mkUser(`pg${i}`, lineA, {
        firstName: "Filler", lastName: `Padding${i}`,
      });
      bulkRows.push({
        clientOpId: `p-${i}`, eventId: pEvent.id, code: u.code,
        scannedAt: new Date(Date.now() - (N - i) * 60_000).toISOString(),
      });
    }
    await confirmAttendanceBulk(reqAs(hr.acctId, { body: { rows: bulkRows } }), mockRes());

    const precs = async (query: any) => {
      const r = mockRes();
      await attendanceRecords(
        reqAs(hr.acctId, { params: { eventId: pEvent.id }, query }),
        r,
      );
      return r._body;
    };

    // Baseline: unfiltered paging still behaves.
    let p = await precs({});
    ok("paging: unfiltered total is all 30", p.total === N, `total=${p.total}`);
    ok("paging: 30 rows over 25/page = 2 pages", p.pages === 2, `pages=${p.pages}`);
    ok("paging: page 0 returns a full page", p.records.length === PAGE,
      `rows=${p.records.length}`);
    p = await precs({ page: "1" });
    ok("paging: page 1 returns the remainder", p.records.length === N - PAGE,
      `rows=${p.records.length}`);
    ok("paging: the needle really is on page 2 (not page 1)",
      p.records.some((r: any) => r.values.lastName === "Quintupleton"));

    // THE REGRESSION: searching from page 0 must find a match that lives on
    // page 2, and the totals must describe the FILTERED set.
    p = await precs({ search: "quintupleton" });
    ok("paging+search: page-2 match IS found from page 0",
      p.records.length === 1 && p.records[0].values.lastName === "Quintupleton",
      `rows=${p.records.length}`);
    ok("paging+search: total is the FILTERED count, not 30",
      p.total === 1, `total=${p.total}`);
    ok("paging+search: pages collapses to 1, not 2",
      p.pages === 1, `pages=${p.pages}`);

    // And a filter that spans pages still counts correctly.
    p = await precs({ search: "padding" });
    ok("paging+search: broad match counts across BOTH pages",
      p.total === N - 1, `total=${p.total}`);
    ok("paging+search: broad match still paginates",
      p.pages === 2 && p.records.length === PAGE,
      `pages=${p.pages} rows=${p.records.length}`);

    // ── 9. closed sheet refuses new scans ────────────────────────────────
    await updateAttendanceEvent(
      reqAs(hr.acctId, { params: { eventId: event.id }, body: { status: "closed" } }),
      mockRes(),
    );
    let closedErr = "";
    try {
      await resolveAttendanceScan(
        reqAs(hr.acctId, { body: { eventId: event.id, code: emp.code } }),
        mockRes(),
      );
    } catch (e: any) { closedErr = e?.message ?? "err"; }
    ok("closed sheet refuses scans", !!closedErr, closedErr || "no throw");

    // ── 10. export ───────────────────────────────────────────────────────
    res = mockRes();
    await exportAttendance(
      reqAs(hr.acctId, { params: { eventId: event.id } }),
      res,
    );
    const buf = res._body;
    ok("export streams a non-trivial xlsx",
      !!buf && buf.length > 3000, `bytes=${buf?.length}`);
    ok("export is a zip/xlsx (PK header)",
      buf && buf[0] === 0x50 && buf[1] === 0x4b);
    ok("export sets a download filename",
      /attachment; filename=".*\.xlsx"/.test(res._headers["Content-Disposition"] ?? ""),
      res._headers["Content-Disposition"]);

  } catch (e: any) {
    fail++;
    console.log("FAIL  threw: " + (e?.stack ?? e?.message ?? String(e)));
  } finally {
    // ── cleanup (children first) ───────────────────────────────────────
    try {
      if (made.eventIds.length)
        await prisma.attendanceRecord.deleteMany({ where: { eventId: { in: made.eventIds } } });
      if (made.userIds.length) {
        await prisma.attendanceRecord.deleteMany({ where: { userId: { in: made.userIds } } });
        await prisma.attendanceMobileAccess.deleteMany({ where: { userId: { in: made.userIds } } });
      }
      if (made.eventIds.length)
        await prisma.attendanceEvent.deleteMany({ where: { id: { in: made.eventIds } } });
      if (made.userIds.length)
        await prisma.user.deleteMany({ where: { id: { in: made.userIds } } });
      if (made.accountIds.length)
        await prisma.account.deleteMany({ where: { id: { in: made.accountIds } } });
      if (made.departmentIds.length)
        await prisma.department.deleteMany({
          where: { id: { in: made.departmentIds } },
        });

      const leftEvents = await prisma.attendanceEvent.count({
        where: { title: { contains: `QA Seminar ${TS}` } },
      });
      const leftUsers = await prisma.user.count({
        where: { username: { startsWith: `qa_att_${TS}_` } },
      });
      const leftDepts = await prisma.department.count({
        where: { name: { startsWith: `QA Office ${TS}` } },
      });
      console.log(
        `CLEANUP  leftover events=${leftEvents} users=${leftUsers} depts=${leftDepts}`,
      );
      if (leftEvents || leftUsers || leftDepts) fail++;
    } catch (e: any) {
      console.log("CLEANUP FAILED: " + (e?.message ?? e));
      fail++;
    }
    console.log(`\n${pass} passed, ${fail} failed`);
    await prisma.$disconnect();
    process.exit(fail ? 1 : 0);
  }
})();
