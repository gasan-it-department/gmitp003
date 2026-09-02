/* PROOF: split batches (same batch, different hidden times-of-day) merge.
 * Recreates the montelukast case: 56 box saved web-style (+08 midnight)
 * + 400 box saved mobile-style (UTC midnight) → consolidate → ONE row of
 * 456; then a fresh mobile restock of 10 MERGES (466), never splits.
 * Run: npx ts-node --transpile-only e2e_batch_merge.ts */
import { prisma } from "./src/barrel/prisma";
import {
  consolidateSplitBatches,
  bulkAddMedicineStock,
} from "./src/controller/medicineController";

const TS = Date.now();
const uid = () =>
  "xxxxxxxxxxxx4xxxyxxxxxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
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
  const made = {
    accountId: "",
    userId: "",
    medId: "",
    storageId: "",
    opIds: [] as string[],
  };

  try {
    const line = await prisma.line.findFirst({ select: { id: true } });
    const dept = await prisma.department.findFirst({ select: { id: true } });
    if (!line || !dept) {
      console.log("NO FIXTURE");
      process.exit(2);
    }
    const acct = await prisma.account.create({
      data: { username: `qa_merge_${TS}`, password: "x", lineId: line.id },
      select: { id: true, username: true },
    });
    made.accountId = acct.id;
    const user = await prisma.user.create({
      data: {
        firstName: "QaMerge",
        lastName: "TESTER",
        username: acct.username,
        accountId: acct.id,
        lineId: line.id,
        email: `qa-merge-${TS}@test.local`,
      },
      select: { id: true },
    });
    made.userId = user.id;
    await prisma.pharmacyMobileAccess.create({
      data: { lineId: line.id, userId: user.id },
    });
    const storage = await prisma.medicineStorage.create({
      data: {
        name: `QA-MERGE-${TS}`,
        refNumber: `QAMG-${TS}`,
        desc: "QA fixture",
        lineId: line.id,
        departmentId: dept.id,
        status: 1,
        timestamp: new Date().toISOString(),
      },
      select: { id: true },
    });
    made.storageId = storage.id;
    await prisma.medicineStorageAccess.create({
      data: { userId: user.id, medicineStorageId: storage.id },
    });
    const med = await prisma.medicine.create({
      data: {
        serialNumber: `QAMG-${TS}`,
        name: `QA MONTELUKAST ${TS}`,
        desc: "None",
        lineId: line.id,
      },
      select: { id: true },
    });
    made.medId = med.id;

    // ── the split: SAME batch, two client date styles ───────────────────
    const webExp = new Date("2026-09-30T16:00:00.000Z"); // Oct 1 midnight +08
    const mobExp = new Date("2026-10-01T00:00:00.000Z"); // Oct 1 midnight UTC
    const webMfg = new Date("2026-01-31T16:00:00.000Z"); // Feb 1 +08
    const mobMfg = new Date("2026-02-01T00:00:00.000Z"); // Feb 1 UTC
    const base = {
      medicineId: med.id,
      medicineStorageId: storage.id,
      lineId: line.id,
      quarter: 1,
      quality: "box",
      perQuantity: 1,
      threshold: 5,
    };
    const rowA = await prisma.medicineStock.create({
      data: { ...base, quantity: 56, actualStock: 56, expiration: webExp, manufacturingDate: webMfg },
      select: { id: true },
    });
    await prisma.medicineStock.create({
      data: { ...base, quantity: 400, actualStock: 400, expiration: mobExp, manufacturingDate: mobMfg },
      select: { id: true },
    });
    // price history on BOTH rows — must survive the merge on the keeper
    await prisma.medicinePriceTrack.create({
      data: { value: 10, medicineStockId: rowA.id },
    });

    // ── 1) boot healer merges them into ONE row of 456 ──────────────────
    const merged = await consolidateSplitBatches();
    ok("consolidation merged at least one duplicate", merged >= 1, `merged=${merged}`);
    const after = await prisma.medicineStock.findMany({
      where: { medicineId: med.id },
      select: { id: true, quantity: true, actualStock: true, expiration: true },
    });
    ok(
      "ONE row remains with 456 box (56+400)",
      after.length === 1 && after[0].quantity === 456 && after[0].actualStock === 456,
      JSON.stringify(after),
    );
    const tracks = await prisma.medicinePriceTrack.count({
      where: { medicineStockId: after[0]?.id ?? "none" },
    });
    ok("price history survived onto the keeper", tracks >= 1, `tracks=${tracks}`);

    // ── 2) fresh mobile restock (+08 style date) MERGES, never splits ───
    const opId = uid();
    made.opIds.push(opId);
    const res = mockRes();
    await bulkAddMedicineStock(
      {
        body: {
          ops: [
            {
              clientOpId: opId,
              medicineId: med.id,
              storageId: storage.id,
              lineId: line.id,
              userId: user.id,
              unitOfMeasure: "box",
              quantity: 10,
              perUnit: 1,
              thresHold: 5,
              price: 10,
              expiration: "2026-10-01T00:00:00.000+08:00",
              manufacturingDate: "2026-02-01T00:00:00.000+08:00",
            },
          ],
        },
        user: { id: acct.id },
      } as any,
      res,
    );
    const r = res._body?.results?.[0];
    const finalRows = await prisma.medicineStock.findMany({
      where: { medicineId: med.id },
      select: { quantity: true, actualStock: true },
    });
    ok(
      "new restock RESTOCKED the survivor (no new row)",
      r?.status === "restocked" && finalRows.length === 1,
      JSON.stringify({ r, rows: finalRows.length }),
    );
    ok(
      "totals right: 456 + 10 = 466",
      finalRows[0]?.quantity === 466 && finalRows[0]?.actualStock === 466,
      JSON.stringify(finalRows),
    );
  } catch (e: any) {
    fail++;
    console.log("FATAL:", e?.message || e);
  } finally {
    try {
      await prisma.mobileUploadLog.deleteMany({
        where: { clientOpId: { in: made.opIds } },
      });
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
      await prisma.medicineLogs.deleteMany({ where: { userId: made.userId } });
      await prisma.notification.deleteMany({
        where: { recipientId: made.userId },
      });
      await prisma.medicine.deleteMany({ where: { id: made.medId } });
      await prisma.medicineStorageAccess.deleteMany({
        where: { userId: made.userId },
      });
      await prisma.pharmacyMobileAccess.deleteMany({
        where: { userId: made.userId },
      });
      await prisma.medicineStorage.deleteMany({ where: { id: made.storageId } });
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
