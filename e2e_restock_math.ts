/* PROOF test: does the deployed bulk add-stock code store Quantity 10 ×
 * Per-unit 1 (bottle) as 10 — or as 1? Calls the REAL controller against
 * the local dev DB with a mocked req/res (auth bypassed; identity passed
 * the same way pharmacyMobileAuth resolves it). Cleans up after itself.
 * Run: npx ts-node --transpile-only e2e_restock_math.ts */
import { prisma } from "./src/barrel/prisma";
import { bulkAddMedicineStock } from "./src/controller/medicineController";

const TS = Date.now();
const sh = (s?: string | null) => (s ? ".." + String(s).slice(-6) : "-");

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
  const ok = (label: string, cond: boolean, detail = "") => {
    if (cond) { pass++; console.log("PASS  " + label); }
    else { fail++; console.log("FAIL  " + label + (detail ? "  → " + detail : "")); }
  };

  let grantId: string | null = null;
  const stockIds: string[] = [];
  const opIds: string[] = [];

  try {
    // ── fixture: any active storage + any medicine + a user of that line
    const storage = await prisma.medicineStorage.findFirst({
      where: { status: { not: 0 } },
      select: { id: true, lineId: true, refNumber: true },
    });
    const medicine = await prisma.medicine.findFirst({ select: { id: true, name: true } });
    const user = storage
      ? await prisma.user.findFirst({
          where: { lineId: storage.lineId, NOT: { accountId: null } },
          select: { id: true, accountId: true },
        })
      : null;
    if (!storage || !medicine || !user) {
      console.log("NO FIXTURE:", { storage: !!storage, medicine: !!medicine, user: !!user });
      process.exit(2);
    }
    console.log(`fixture: storage${sh(storage.id)} (${storage.refNumber}) med${sh(medicine.id)} user${sh(user.id)}`);

    // storage grant (so assertStorageAccess passes); remember for cleanup
    const had = await prisma.medicineStorageAccess.findFirst({
      where: { userId: user.id, medicineStorageId: storage.id },
      select: { id: true },
    });
    if (!had) {
      const g = await prisma.medicineStorageAccess.create({
        data: { userId: user.id, medicineStorageId: storage.id },
        select: { id: true },
      });
      grantId = g.id;
    }

    const exp = new Date(Date.now() + 365 * 86_400_000).toISOString();
    const mfg = new Date(Date.now() - 30 * 86_400_000).toISOString();
    const mkOp = (tag: string) => ({
      clientOpId: `qa-math-${TS}-${tag}`,
      medicineId: medicine.id,
      storageId: storage.id,
      lineId: storage.lineId as string,
      userId: user.id,
      unitOfMeasure: `bottle-qa-${TS}`, // unique unit → guaranteed NEW batch
      quantity: 10,
      perUnit: 1,
      thresHold: 5,
      price: 0,
      expiration: exp,
      manufacturingDate: mfg,
    });

    // ── 1) the user's exact case: Quantity 10 × Per-unit 1, bottle
    const req1: any = { body: { ops: [mkOp("a")] }, user: { id: user.accountId } };
    opIds.push(req1.body.ops[0].clientOpId);
    const res1 = mockRes();
    await bulkAddMedicineStock(req1, res1);
    const r1 = res1._body?.results?.[0];
    ok("upload accepted as a new batch", res1._code === 200 && r1?.status === "created", JSON.stringify(res1._body).slice(0, 200));
    if (r1?.stockId) stockIds.push(r1.stockId);

    const row1 = r1?.stockId
      ? await prisma.medicineStock.findUnique({
          where: { id: r1.stockId },
          select: { quantity: true, perQuantity: true, actualStock: true, quality: true },
        })
      : null;
    ok(
      "stored EXACTLY quantity=10, perQuantity=1, actualStock=10",
      !!row1 && row1.quantity === 10 && row1.perQuantity === 1 && row1.actualStock === 10,
      JSON.stringify(row1),
    );

    // ── 2) restock the SAME batch again (10 × 1) → totals must double
    const req2: any = { body: { ops: [mkOp("b")] }, user: { id: user.accountId } };
    opIds.push(req2.body.ops[0].clientOpId);
    const res2 = mockRes();
    await bulkAddMedicineStock(req2, res2);
    const r2 = res2._body?.results?.[0];
    ok("second upload merges as a restock", res2._code === 200 && r2?.status === "restocked", JSON.stringify(res2._body).slice(0, 200));

    const row2 = r1?.stockId
      ? await prisma.medicineStock.findUnique({
          where: { id: r1.stockId },
          select: { quantity: true, perQuantity: true, actualStock: true },
        })
      : null;
    ok(
      "after restock: quantity=20, actualStock=20 (10 more items)",
      !!row2 && row2.quantity === 20 && row2.actualStock === 20,
      JSON.stringify(row2),
    );
  } catch (e: any) {
    fail++;
    console.log("FATAL:", e?.message ?? e);
  } finally {
    try {
      if (opIds.length)
        await prisma.mobileUploadLog.deleteMany({ where: { clientOpId: { in: opIds } } });
      for (const id of stockIds) {
        await prisma.medicinePriceTrack.deleteMany({ where: { medicineStockId: id } }).catch(() => {});
        await prisma.medicineStock.delete({ where: { id } }).catch(() => {});
      }
      if (grantId)
        await prisma.medicineStorageAccess.delete({ where: { id: grantId } }).catch(() => {});
      await prisma.medicineLogs
        .deleteMany({ where: { message: { contains: `bottle-qa-${TS}` } } })
        .catch(() => {});
      console.log("cleanup: done");
    } catch (e: any) {
      console.log("CLEANUP WARNING:", e?.message ?? e);
    }
    await prisma.$disconnect();
    console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
  }
})();
