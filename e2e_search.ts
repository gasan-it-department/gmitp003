/* Quick proof of searchMedicineStock: real local DB, mock req/res.
 * Asserts shape + per-storage accessible flag reflects a real grant. */
import { prisma } from "./src/barrel/prisma";
import { searchMedicineStock } from "./src/controller/medicineController";

const mockRes = () => {
  const r: any = {
    _code: 0, _body: null,
    code(n: number) { this._code = n; return this; },
    send(b: unknown) { this._body = b; return this; },
  };
  return r;
};

(async () => {
  let pass = 0, fail = 0;
  const ok = (l: string, c: boolean, d = "") => {
    if (c) { pass++; console.log("PASS  " + l); }
    else { fail++; console.log("FAIL  " + l + (d ? " → " + d : "")); }
  };
  let grantId: string | null = null;
  try {
    const stocks = await prisma.medicineStock.findMany({
      where: { actualStock: { gt: 0 } },
      take: 50,
      select: {
        medicineStorageId: true,
        medicine: { select: { name: true, lineId: true } },
      },
    });
    const stock = stocks.find((s) => s.medicineStorageId && s.medicine);
    if (!stock?.medicine) { console.log("NO FIXTURE"); process.exit(2); }
    const lineId = stock.medicine.lineId;
    const q = stock.medicine.name.slice(0, 4);
    const user = await prisma.user.findFirst({
      where: { lineId, NOT: { accountId: null } },
      select: { id: true, accountId: true },
    });
    if (!user) { console.log("NO FIXTURE (no user)"); process.exit(2); }

    await prisma.medicineStorageAccess.deleteMany({
      where: { userId: user.id, medicineStorageId: stock.medicineStorageId! },
    });
    const res1 = mockRes();
    await searchMedicineStock(
      { query: { id: lineId, query: q }, user: { id: user.accountId } } as any,
      res1,
    );
    const hit1 = res1._body?.list?.find((m: any) =>
      m.storages.some((s: any) => s.id === stock.medicineStorageId),
    );
    const st1 = hit1?.storages.find((s: any) => s.id === stock.medicineStorageId);
    ok("search returns the medicine with per-storage rows", !!hit1 && hit1.storages.length > 0);
    ok("without a grant the storage is View-only (accessible=false)", st1?.accessible === false, JSON.stringify(st1));

    const g = await prisma.medicineStorageAccess.create({
      data: { userId: user.id, medicineStorageId: stock.medicineStorageId! },
      select: { id: true },
    });
    grantId = g.id;
    const res2 = mockRes();
    await searchMedicineStock(
      { query: { id: lineId, query: q }, user: { id: user.accountId } } as any,
      res2,
    );
    const st2 = res2._body?.list
      ?.find((m: any) => m.storages.some((s: any) => s.id === stock.medicineStorageId))
      ?.storages.find((s: any) => s.id === stock.medicineStorageId);
    ok("with a grant the same storage flips to accessible=true", st2?.accessible === true, JSON.stringify(st2));
  } catch (e: any) {
    fail++; console.log("FATAL:", e?.message || e);
  } finally {
    if (grantId) await prisma.medicineStorageAccess.delete({ where: { id: grantId } }).catch(() => {});
    await prisma.$disconnect();
    console.log(`RESULT: ${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
  }
})();
