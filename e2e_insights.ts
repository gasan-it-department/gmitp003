/* PROOF: medicine dispense insights aggregate prescription + direct
 * dispenses (no double count), rank fast/slow movers, flag reorder
 * priority, and bucket a trend. Real controller + local DB. Run:
 * npx ts-node --transpile-only e2e_insights.ts */
import { prisma } from "./src/barrel/prisma";
import { medicineDispenseInsights } from "./src/controller/medicineController";

const TS = Date.now();
const mockRes = () => {
  const r: any = {
    _code: 0, _body: null,
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
  const made = {
    accountId: "", userId: "", storageId: "", medIds: [] as string[],
    txIds: [] as string[], recIds: [] as string[],
  };

  try {
    const line = await prisma.line.findFirst({ select: { id: true } });
    const dept = await prisma.department.findFirst({ select: { id: true } });
    if (!line || !dept) { console.log("NO FIXTURE"); process.exit(2); }

    const acct = await prisma.account.create({
      data: { username: `qa_ins_${TS}`, password: "x", lineId: line.id },
      select: { id: true, username: true },
    });
    made.accountId = acct.id;
    const user = await prisma.user.create({
      data: { firstName: "QaIns", lastName: "U", username: acct.username, accountId: acct.id, lineId: line.id, email: `qa-ins-${TS}@t.local` },
      select: { id: true },
    });
    made.userId = user.id;
    const storage = await prisma.medicineStorage.create({
      data: { name: `QA-INS-${TS}`, refNumber: `QAINS-${TS}`, desc: "QA", lineId: line.id, departmentId: dept.id, status: 1, timestamp: new Date().toISOString() },
      select: { id: true },
    });
    made.storageId = storage.id;

    const mkMed = async (tag: string, onHand: number) => {
      const m = await prisma.medicine.create({
        data: { serialNumber: `QAINS-${tag}-${TS}`, name: `QA INS ${tag} ${TS}`, desc: "None", lineId: line.id },
        select: { id: true },
      });
      made.medIds.push(m.id);
      if (onHand > 0)
        await prisma.medicineStock.create({
          data: { medicineId: m.id, medicineStorageId: storage.id, lineId: line.id, quarter: 1, quality: "box", perQuantity: 1, quantity: onHand, actualStock: onHand, threshold: 0, expiration: new Date(Date.now() + 300 * 86400000), manufacturingDate: new Date(Date.now() - 10 * 86400000) },
        });
      return m.id;
    };
    // FAST (heavy prescription dispense), MID (direct only), SLOW (in stock, never dispensed)
    const fast = await mkMed("FAST", 5);   // low stock, high demand → reorder
    const mid = await mkMed("MID", 50);
    const slow = await mkMed("SLOW", 40);  // stock, zero dispensed → slow-mover

    const now = new Date();
    // Prescription dispense for FAST: 80 units via a MedicineTransaction + item
    const tx = await prisma.medicineTransaction.create({
      data: { quantity: 80, unit: "box", lineId: line.id, timestamp: now, action: 1, userId: user.id, medicineStorageId: storage.id },
      select: { id: true },
    });
    made.txIds.push(tx.id);
    await prisma.medicineTransactionItem.create({
      data: { medicineTransactionId: tx.id, medicineId: fast, prescribeQuantity: 80, releasedQuantity: 80, medicineStorageId: storage.id },
    });
    // Direct dispense for MID: 12 units via DispenseRecord kind 0
    const rec = await prisma.dispenseRecord.create({
      data: {
        lineId: line.id, kind: 0, dispensedById: user.id, totalUnits: 12, timestamp: now,
        items: { create: [{ medicineId: mid, medicineName: `QA INS MID ${TS}`, quantity: 12, unit: "box" }] },
      },
      select: { id: true },
    });
    made.recIds.push(rec.id);
    // A prescription-kind DispenseRecord for FAST too — must NOT be double-counted
    const rec2 = await prisma.dispenseRecord.create({
      data: {
        lineId: line.id, kind: 1, dispensedById: user.id, totalUnits: 80, timestamp: now, prescriptionId: null,
        items: { create: [{ medicineId: fast, medicineName: `QA INS FAST ${TS}`, quantity: 80, unit: "box" }] },
      },
      select: { id: true },
    });
    made.recIds.push(rec2.id);

    const res = mockRes();
    await medicineDispenseInsights({ query: { lineId: line.id, days: "90" } } as any, res);
    const b = res._body;
    const topFast = (b?.top ?? []).find((x: any) => x.medicineId === fast);
    const topMid = (b?.top ?? []).find((x: any) => x.medicineId === mid);

    ok("endpoint returns insight payload", res._code === 200 && Array.isArray(b?.top), JSON.stringify(b).slice(0, 120));
    ok("FAST counted from prescription (80), NOT double-counted with its kind=1 record",
      topFast?.units === 80, JSON.stringify(topFast));
    ok("MID counted from direct dispense (12)", topMid?.units === 12, JSON.stringify(topMid));
    ok("FAST ranks above MID (fast-moving first)",
      (b?.top ?? [])[0]?.medicineId === fast, JSON.stringify((b?.top ?? []).map((x: any) => [x.name?.slice(-12), x.units])));
    const slowRow = (b?.slow ?? []).find((x: any) => x.medicineId === slow);
    ok("SLOW (stock, zero dispensed) appears in slow-movers", !!slowRow && slowRow.units === 0, JSON.stringify(slowRow));
    const reorderFast = (b?.reorder ?? []).find((x: any) => x.medicineId === fast);
    ok("FAST flagged for reorder (demand 80 > on-hand 5)", !!reorderFast && reorderFast.shortfall === 75, JSON.stringify(reorderFast));
    ok("total includes our 92 fixture units (line-wide, may include other data)", (b?.totalDispensedUnits ?? 0) >= 92, JSON.stringify({ total: b?.totalDispensedUnits }));
    ok("trend has at least one bucket with units", Array.isArray(b?.trend) && b.trend.some((t: any) => t.units > 0), JSON.stringify(b?.trend));
  } catch (e: any) {
    fail++;
    console.log("FATAL:", e?.message || e);
  } finally {
    try {
      await prisma.dispenseItem.deleteMany({ where: { record: { id: { in: made.recIds } } } });
      await prisma.dispenseRecord.deleteMany({ where: { id: { in: made.recIds } } });
      await prisma.medicineTransactionItem.deleteMany({ where: { medicineTransactionId: { in: made.txIds } } });
      await prisma.medicineTransaction.deleteMany({ where: { id: { in: made.txIds } } });
      const stocks = await prisma.medicineStock.findMany({ where: { medicineId: { in: made.medIds } }, select: { id: true } });
      const sids = stocks.map((s) => s.id);
      await prisma.medicineAlert.deleteMany({ where: { medicineStockId: { in: sids } } });
      await prisma.medicinePriceTrack.deleteMany({ where: { medicineStockId: { in: sids } } });
      await prisma.medicineStock.deleteMany({ where: { id: { in: sids } } });
      await prisma.medicine.deleteMany({ where: { id: { in: made.medIds } } });
      await prisma.medicineStorage.deleteMany({ where: { id: made.storageId } });
      await prisma.user.deleteMany({ where: { id: made.userId } });
      await prisma.account.deleteMany({ where: { id: made.accountId } });
      console.log("cleanup: done");
    } catch (e: any) { console.log("CLEANUP WARNING:", e?.message || e); }
    await prisma.$disconnect();
    console.log(`RESULT: ${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
  }
})();
