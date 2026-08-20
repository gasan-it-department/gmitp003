/* REPRODUCTION: scanning user A's QR must record user A — never the operator.
 *
 * Reported: a super-admin driving an HR line scanned "judepogi" and the sheet
 * recorded ANNALEE SALVO — who is the kind of account an impersonation session
 * borrows (the line's HR user). So the suspicion is that the SCANNER's identity
 * leaks into the record instead of the SCANNED person's.
 *
 * This drives the real confirmAttendance exactly as the web scanner does:
 * authenticated as the operator's account, body carrying only the scanned
 * code — no userId.
 *
 * Run: npx ts-node --transpile-only e2e_scan_identity.ts */
import { randomUUID } from "crypto";
import { prisma } from "./src/barrel/prisma";
import {
  createAttendanceEvent,
  confirmAttendance,
  resolveAttendanceScan,
  attendanceRecords,
  extractVerifyCode,
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
  const made = { userIds: [] as string[], accountIds: [] as string[], eventIds: [] as string[] };

  try {
    const line = await prisma.line.findFirst({ select: { id: true } });
    if (!line) { console.log("NO FIXTURE (line)"); process.exit(2); }

    const { EncryptionService: E } = await import("./src/service/encryption");
    const mk = async (tag: string, first: string, last: string) => {
      const acct = await prisma.account.create({
        data: { username: `qa_scan_${TS}_${tag}`, password: "x", lineId: line.id },
        select: { id: true, username: true },
      });
      made.accountIds.push(acct.id);
      const fn = await E.encrypt(first);
      const ln = await E.encrypt(last);
      const u = await prisma.user.create({
        data: {
          firstName: fn.encryptedData, firstNameIv: fn.iv,
          lastName: ln.encryptedData, lastNameIv: ln.iv,
          username: acct.username, accountId: acct.id, lineId: line.id,
          email: `qa-scan-${TS}-${tag}@test.local`,
          verifyCode: randomUUID().replace(/-/g, ""),
        },
        select: { id: true, verifyCode: true },
      });
      made.userIds.push(u.id);
      return { accountId: acct.id, userId: u.id, code: u.verifyCode!, first, last };
    };

    // The operator: the account an impersonation session would borrow.
    const ANNALEE = await mk("operator", "Annalee", `SALVO${TS}`);
    // The person actually holding the badge.
    const JUDE = await mk("scanned", "Jude Demnuvar", `RIBLEZA${TS}`);

    const asOperator = (body: any) =>
      ({ user: { id: ANNALEE.accountId }, body }) as any;

    // ── A sheet that captures the full name ─────────────────────────────
    let res = mockRes();
    await createAttendanceEvent(
      asOperator({
        lineId: line.id,
        title: `QA scan identity ${TS}`,
        fields: ["fullName", "office"],
      }),
      res,
    );
    const ev = res._body;
    made.eventIds.push(ev.id);

    // ── The exact payload the browser scanner sends ─────────────────────
    const scannedUrl = `https://portal.gasan.ph/verify-id?code=${JUDE.code}`;
    ok("the scanned URL extracts to JUDE's code",
      extractVerifyCode(scannedUrl) === JUDE.code,
      `${extractVerifyCode(scannedUrl)} vs ${JUDE.code}`);
    ok("it does NOT extract to the operator's code",
      extractVerifyCode(scannedUrl) !== ANNALEE.code);

    res = mockRes();
    await confirmAttendance(
      // No userId — only the code, exactly like AttendanceQrScanner.
      asOperator({ eventId: ev.id, code: scannedUrl, scannedAt: new Date().toISOString() }),
      res,
    );

    ok("the toast name is JUDE, not the operator",
      /Jude Demnuvar/.test(res._body?.fullName ?? ""),
      JSON.stringify(res._body?.fullName));
    ok("the toast name is NOT Annalee",
      !/Annalee/i.test(res._body?.fullName ?? ""),
      JSON.stringify(res._body?.fullName));

    // ── The stored row ──────────────────────────────────────────────────
    const rows = await prisma.attendanceRecord.findMany({
      where: { eventId: ev.id },
      select: { userId: true, scannedById: true, snapshot: true },
    });
    ok("exactly one row was written", rows.length === 1, String(rows.length));
    ok("the row belongs to JUDE", rows[0]?.userId === JUDE.userId,
      rows[0]?.userId === ANNALEE.userId ? "IT IS THE OPERATOR" : String(rows[0]?.userId));
    ok("the operator is recorded only as who SCANNED it",
      rows[0]?.scannedById === ANNALEE.userId);
    const snap = (rows[0]?.snapshot ?? {}) as Record<string, string>;
    ok("the frozen snapshot names JUDE", /Jude Demnuvar/.test(snap.fullName ?? ""),
      JSON.stringify(snap.fullName));

    // ── What the sheet renders ──────────────────────────────────────────
    res = mockRes();
    await attendanceRecords(
      { user: { id: ANNALEE.accountId }, params: { eventId: ev.id }, query: {} } as any,
      res,
    );
    const shown = res._body?.records?.[0];
    ok("the sheet row shows JUDE in the name column",
      /Jude Demnuvar/.test(shown?.values?.fullName ?? ""),
      JSON.stringify(shown?.values?.fullName));
    ok("the sheet attributes the scan to the operator separately",
      /Annalee/i.test(shown?.scannedBy ?? ""), JSON.stringify(shown?.scannedBy));

    // ── The preview endpoint too ────────────────────────────────────────
    res = mockRes();
    await resolveAttendanceScan(
      asOperator({ eventId: ev.id, code: scannedUrl }), res);
    ok("preview also resolves to JUDE",
      /Jude Demnuvar/.test(res._body?.user?.fullName ?? ""),
      JSON.stringify(res._body?.user?.fullName));

    // ── And the operator scanning THEIR OWN badge still works ───────────
    res = mockRes();
    await confirmAttendance(
      asOperator({
        eventId: ev.id,
        code: `https://portal.gasan.ph/verify-id?code=${ANNALEE.code}`,
      }),
      res,
    );
    ok("the operator's own badge records the operator",
      /Annalee/i.test(res._body?.fullName ?? ""), JSON.stringify(res._body?.fullName));
    const both = await prisma.attendanceRecord.count({ where: { eventId: ev.id } });
    ok("that is a second, distinct row", both === 2, String(both));
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
        where: { username: { startsWith: `qa_scan_${TS}_` } },
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
