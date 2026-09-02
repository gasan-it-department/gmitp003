/* PROOF of the expiry-list line rule, exactly as specified:
 * rows merge into ONE line ONLY when medicine + storage + unit of
 * measure + per-unit quantity + manufacturing date + expiration date ALL
 * match (times-of-day ignored). Any field differing → separate lines.
 * Run: npx ts-node --transpile-only e2e_expiry_grouping.ts */
import { prisma } from "./src/barrel/prisma";
import { expirationList } from "./src/controller/medicineController";

const TS = Date.now();
const mockRes = () => {
  const r: any = {
    _code: 0,
    _body: null,
    code(n: number) {
      this._code = n;
      return this;
    },
    send(b: unknown) {
      this._body = b;
      return this;
    },
    status(n: number) {
      return this.code(n);
    },
  };
  return r;
};

(async () => {
  let pass = 0,
    fail = 0;
  const ok = (l: string, c: boolean, d = "") => {
    if (c) {
      pass++;
      console.log("PASS  " + l);
    } else {
      fail++;
      console.log("FAIL  " + l + (d ? "  → " + d : ""));
    }
  };
  const made = { medId: "", storageId: "" };

  try {
    const line = await prisma.line.findFirst({ select: { id: true } });
    const dept = await prisma.department.findFirst({ select: { id: true } });
    if (!line || !dept) {
      console.log("NO FIXTURE");
      process.exit(2);
    }
    const storage = await prisma.medicineStorage.create({
      data: {
        name: `QA-EXPG-${TS}`,
        refNumber: `QAEG-${TS}`,
        desc: "QA fixture",
        lineId: line.id,
        departmentId: dept.id,
        status: 1,
        timestamp: new Date().toISOString(),
      },
      select: { id: true },
    });
    made.storageId = storage.id;
    const med = await prisma.medicine.create({
      data: {
        serialNumber: `QAEG-${TS}`,
        name: `QA EXP MONTELUKAST ${TS}`,
        desc: "None",
        lineId: line.id,
      },
      select: { id: true },
    });
    made.medId = med.id;

    // Expiry ~70 days out (inside the 6-month window), as a clean UTC day.
    const expMid =
      Math.round((Date.now() + 70 * 86_400_000) / 86_400_000) * 86_400_000;
    const mfgMid =
      Math.round((Date.now() - 100 * 86_400_000) / 86_400_000) * 86_400_000;
    const base = {
      medicineId: med.id,
      medicineStorageId: storage.id,
      lineId: line.id,
      quarter: 1,
      quality: "box",
      threshold: 5,
    };

    // A) SAME full identity, but web-style (+08 midnight = 16:00Z of the
    //    previous day) vs mobile-style (UTC midnight) times → ONE line.
    await prisma.medicineStock.create({
      data: {
        ...base,
        perQuantity: 1,
        quantity: 56,
        actualStock: 56,
        expiration: new Date(expMid - 8 * 3_600_000),
        manufacturingDate: new Date(mfgMid - 8 * 3_600_000),
      },
    });
    await prisma.medicineStock.create({
      data: {
        ...base,
        perQuantity: 1,
        quantity: 400,
        actualStock: 400,
        expiration: new Date(expMid),
        manufacturingDate: new Date(mfgMid),
      },
    });

    const res1 = mockRes();
    await expirationList(
      { query: { lineId: line.id, mode: "soon", limit: "100" } } as any,
      res1,
    );
    const l1 = (res1._body?.list ?? []).filter(
      (r: any) => r.medicineId === med.id,
    );
    ok(
      "identical batch (all identity fields equal) → ONE line",
      l1.length === 1,
      `lines=${l1.length}`,
    );
    ok(
      "that line is the SUM: 56 + 400 = 456",
      l1[0]?.actualStock === 456 && l1[0]?.batchCount === 2,
      JSON.stringify({ stock: l1[0]?.actualStock, batches: l1[0]?.batchCount }),
    );

    // B) same medicine/dates/UoM but DIFFERENT per-unit packing —
    //    the montelukast case: still ONE line, units summed, per-unit "—".
    await prisma.medicineStock.create({
      data: {
        ...base,
        perQuantity: 100,
        quantity: 4,
        actualStock: 400,
        expiration: new Date(expMid),
        manufacturingDate: new Date(mfgMid),
      },
    });

    const res2 = mockRes();
    await expirationList(
      { query: { lineId: line.id, mode: "soon", limit: "100" } } as any,
      res2,
    );
    const l2 = (res2._body?.list ?? []).filter(
      (r: any) => r.medicineId === med.id,
    );
    ok(
      "different per-unit packing STILL one line (montelukast case)",
      l2.length === 1 && l2[0]?.actualStock === 856 && l2[0]?.batchCount === 3,
      JSON.stringify(l2.map((r: any) => [r.actualStock, r.batchCount])),
    );
    ok(
      "mixed packing renders per-unit as null (web shows —)",
      l2[0]?.perQuantity === null,
      JSON.stringify({ perQuantity: l2[0]?.perQuantity }),
    );

    // C) DIFFERENT expiry day → its own line.
    await prisma.medicineStock.create({
      data: {
        ...base,
        perQuantity: 1,
        quantity: 7,
        actualStock: 7,
        expiration: new Date(expMid + 30 * 86_400_000),
        manufacturingDate: new Date(mfgMid),
      },
    });
    const res3 = mockRes();
    await expirationList(
      { query: { lineId: line.id, mode: "soon", limit: "100" } } as any,
      res3,
    );
    const l3 = (res3._body?.list ?? []).filter(
      (r: any) => r.medicineId === med.id,
    );
    ok(
      "a different expiry date is its own line (2 lines)",
      l3.length === 2,
      `lines=${l3.length}`,
    );
  } catch (e: any) {
    fail++;
    console.log("FATAL:", e?.message || e);
  } finally {
    try {
      const stocks = await prisma.medicineStock.findMany({
        where: { medicineId: made.medId },
        select: { id: true },
      });
      const sids = stocks.map((s) => s.id);
      await prisma.medicineAlert.deleteMany({
        where: { medicineStockId: { in: sids } },
      });
      await prisma.medicinePriceTrack.deleteMany({
        where: { medicineStockId: { in: sids } },
      });
      await prisma.medicineStock.deleteMany({ where: { id: { in: sids } } });
      await prisma.medicine.deleteMany({ where: { id: made.medId } });
      await prisma.medicineStorage.deleteMany({
        where: { id: made.storageId },
      });
      console.log("cleanup: done");
    } catch (e: any) {
      console.log("CLEANUP WARNING:", e?.message || e);
    }
    await prisma.$disconnect();
    console.log(`RESULT: ${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
  }
})();
