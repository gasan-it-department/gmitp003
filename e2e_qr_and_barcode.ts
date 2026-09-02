/* Does QR work WITHOUT breaking barcodes? Both paths, side by side,
 * through the REAL controllers — including medicines whose barcodes were
 * stored BEFORE normalization existed (the regression that would matter).
 * Run: npx ts-node --transpile-only e2e_qr_and_barcode.ts */
import { prisma } from "./src/barrel/prisma";
import {
  recordMedicineScan,
  attachMedicineBarcode,
} from "./src/controller/medicineController";

const TS = Date.now();
const mockRes = () => {
  const r: any = {
    _code: 0,
    _body: null,
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
    else { fail++; console.log("FAIL  " + l + (d ? "  → " + d : "")); }
  };
  const made = { medIds: [] as string[], userId: "", accountId: "" };

  try {
    const line = await prisma.line.findFirst({ select: { id: true } });
    if (!line) { console.log("NO FIXTURE"); process.exit(2); }

    const acct = await prisma.account.create({
      data: { username: `qa_qr_${TS}`, password: "x", lineId: line.id },
      select: { id: true, username: true },
    });
    made.accountId = acct.id;
    const user = await prisma.user.create({
      data: {
        firstName: "QaQr", lastName: "SCAN", username: acct.username,
        accountId: acct.id, lineId: line.id,
        email: `qa-qr-${TS}@test.local`,
      },
      select: { id: true },
    });
    made.userId = user.id;

    const scan = async (barcode: string, name: string) => {
      const res = mockRes();
      try {
        await recordMedicineScan(
          { body: { barcode, name, lineId: line.id, scannedByUserId: user.id } } as any,
          res,
        );
      } catch (e: any) {
        return { threw: e?.message ?? String(e) };
      }
      if (res._body?.id) made.medIds.push(res._body.id);
      return { code: res._code, body: res._body };
    };

    // ── 1. PLAIN 1D BARCODE still registers, exactly as before ──────────
    const ean = `48065${String(TS).slice(-8)}`; // 13-digit numeric
    const b1 = await scan(ean, `QA Barcode Med ${TS}`);
    ok("plain barcode registers (mode=created)",
      !("threw" in b1) && b1.body?.mode === "created", JSON.stringify(b1).slice(0, 140));

    // ── 2. re-scanning that SAME barcode finds it — no duplicate ────────
    const b2 = await scan(ean, `QA Barcode Med ${TS}`);
    ok("re-scanning the barcode FINDS it (no duplicate)",
      !("threw" in b2) && b2.body?.mode === "updated" && b2.body?.id === b1.body?.id,
      JSON.stringify(b2).slice(0, 140));

    // ── 3. QR (GS1 Digital Link) for a DIFFERENT product registers ──────
    const gtin = `09506${String(TS).slice(-9)}`; // 14-digit GTIN
    const qrUrl = `https://id.gs1.org/01/${gtin}/17/261231/10/LOT-A`;
    const q1 = await scan(qrUrl, `QA QR Med ${TS}`);
    ok("GS1 QR registers a medicine",
      !("threw" in q1) && q1.body?.mode === "created", JSON.stringify(q1).slice(0, 140));
    ok("QR stored the GTIN, not the URL",
      typeof q1.body?.barcode === "string" && !q1.body.barcode.includes("http"),
      JSON.stringify(q1.body?.barcode));

    // ── 4. a DIFFERENT LOT of that product resolves to the SAME medicine ─
    const q2 = await scan(
      `https://id.gs1.org/01/${gtin}/17/270630/10/LOT-B`,
      `QA QR Med ${TS}`,
    );
    ok("second LOT maps to the SAME medicine (no duplicate)",
      !("threw" in q2) && q2.body?.id === q1.body?.id,
      `${q2.body?.id} vs ${q1.body?.id}`);

    // ── 5. the QR product's 1D barcode (EAN-13 form) finds the same row ──
    const ean13OfGtin = gtin.replace(/^0+/, "");
    const q3 = await scan(ean13OfGtin, `QA QR Med ${TS}`);
    ok("scanning that product's 1D barcode finds the SAME medicine",
      !("threw" in q3) && q3.body?.id === q1.body?.id,
      `${q3.body?.id} vs ${q1.body?.id}`);

    // ── 6. LEGACY row: barcode stored raw/lowercase BEFORE normalization ─
    const legacyRaw = `qa-legacy-${TS}`;
    const legacy = await prisma.medicine.create({
      data: {
        serialNumber: `QAL-${TS}`, name: `QA Legacy Med ${TS}`,
        desc: "None", barcode: legacyRaw, lineId: line.id,
      },
      select: { id: true },
    });
    made.medIds.push(legacy.id);
    const l1 = await scan(legacyRaw, `QA Legacy Med ${TS}`);
    ok("a medicine registered BEFORE normalization is still found",
      !("threw" in l1) && l1.body?.id === legacy.id,
      `${l1.body?.id} vs ${legacy.id}`);

    // ── 7. attach-barcode accepts a QR for an existing medicine ─────────
    const target = await prisma.medicine.create({
      data: {
        serialNumber: `QAA-${TS}`, name: `QA Attach Med ${TS}`,
        desc: "None", lineId: line.id,
      },
      select: { id: true },
    });
    made.medIds.push(target.id);
    const resA = mockRes();
    await attachMedicineBarcode(
      {
        body: {
          medicineId: target.id,
          barcode: `(01)0750${String(TS).slice(-10)}(17)271130(10)L9`,
          lineId: line.id, userId: user.id,
        },
      } as any,
      resA,
    );
    ok("attach-barcode accepts a GS1 QR and stores the GTIN",
      resA._code === 200 && !String(resA._body?.barcode ?? "").includes("("),
      JSON.stringify(resA._body).slice(0, 140));

    // ── 8. a FOREIGN QR is refused, and registers nothing ───────────────
    const foreign = await scan(
      "https://www.lgu-portal.xyz/verify-id?code=deadbeef1234",
      "Should never exist",
    );
    ok("employee-ID QR is refused by the server",
      "threw" in foreign, JSON.stringify(foreign).slice(0, 140));
    const junk = await prisma.medicine.count({
      where: { lineId: line.id, name: "Should never exist" },
    });
    ok("refused QR created NO medicine", junk === 0, `rows=${junk}`);
  } catch (e: any) {
    fail++;
    console.log("FATAL:", e?.message || e);
  } finally {
    try {
      await prisma.medicineLogs.deleteMany({ where: { userId: made.userId } });
      await prisma.medicine.deleteMany({ where: { id: { in: made.medIds } } });
      await prisma.user.deleteMany({ where: { id: made.userId } });
      await prisma.account.deleteMany({ where: { id: made.accountId } });
      console.log("cleanup: done");
    } catch (e: any) {
      console.log("CLEANUP WARNING:", e?.message || e);
    }
    await prisma.$disconnect();
    console.log(`RESULT: ${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
  }
})();
