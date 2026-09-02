/* PROOF test for directDispenseBulk against the local dev DB (mock req/res).
 * Covers: strict storage-access refusal, FEFO deduction across batches,
 * expired-batch exclusion, insufficient-stock error, idempotent replay,
 * audit log row. Creates its own fixture rows and removes them after. */
import { prisma } from "./src/barrel/prisma";
import { directDispenseBulk } from "./src/controller/medicineController";

const TS = Date.now();
const mockRes = () => {
  const r: any = {
    _code: 0, _body: null,
    code(n: number) { this._code = n; return this; },
    send(b: unknown) { this._body = b; return this; },
  };
  return r;
};
const call = async (ops: any[], accountId: string | null) => {
  const res = mockRes();
  await directDispenseBulk({ body: { ops }, user: { id: accountId } } as any, res);
  return res._body;
};

(async () => {
  let pass = 0, fail = 0;
  const ok = (l: string, c: boolean, d = "") => {
    if (c) { pass++; console.log("PASS  " + l); }
    else { fail++; console.log("FAIL  " + l + (d ? " → " + d : "")); }
  };
  const made = { medId: null as string | null, stockIds: [] as string[], grantId: null as string | null, opIds: [] as string[] };

  try {
    const storage = await prisma.medicineStorage.findFirst({
      where: { status: { not: 0 } },
      select: { id: true, lineId: true, name: true },
    });
    const user = storage
      ? await prisma.user.findFirst({
          where: { lineId: storage.lineId, NOT: { accountId: null } },
          select: { id: true, accountId: true },
        })
      : null;
    if (!storage || !user) { console.log("NO FIXTURE"); process.exit(2); }

    const med = await prisma.medicine.create({
      data: { name: `QA DirectDispense ${TS}`, serialNumber: `QA-DD-${TS}`, lineId: storage.lineId },
      select: { id: true, name: true },
    });
    made.medId = med.id;
    const day = 86_400_000;
    const mkStock = async (units: number, exp: Date) => {
      const s = await prisma.medicineStock.create({
        data: {
          medicineId: med.id, medicineStorageId: storage.id, lineId: storage.lineId,
          quantity: units, perQuantity: 1, actualStock: units, quality: "box",
          threshold: 0, quarter: 1, expiration: exp,
          manufacturingDate: new Date(Date.now() - 90 * day),
        },
        select: { id: true },
      });
      made.stockIds.push(s.id);
      return s.id;
    };
    const expiredId = await mkStock(5, new Date(Date.now() - 10 * day));
    const earlyId = await mkStock(4, new Date(Date.now() + 30 * day));
    const lateId = await mkStock(6, new Date(Date.now() + 300 * day));

    await prisma.medicineStorageAccess.deleteMany({
      where: { userId: user.id, medicineStorageId: storage.id },
    });
    const op = (tag: string, qty: number) => {
      const o = {
        clientOpId: `qa-dd-${TS}-${tag}`, lineId: storage.lineId as string,
        storageId: storage.id, medicineId: med.id, quantity: qty, patientName: "Walk-in QA",
      };
      made.opIds.push(o.clientOpId);
      return o;
    };

    const r1 = await call([op("deny", 3)], user.accountId);
    ok("WITHOUT access: refused with the Dispense & Stock Access message",
      r1?.results?.[0]?.status === "error" && String(r1.results[0].message).includes("Dispense & Stock Access"),
      JSON.stringify(r1?.results?.[0]));

    const g = await prisma.medicineStorageAccess.create({
      data: { userId: user.id, medicineStorageId: storage.id },
      select: { id: true },
    });
    made.grantId = g.id;

    const r2 = await call([op("ok", 7)], user.accountId);
    ok("WITH access: dispensed", r2?.results?.[0]?.status === "dispensed", JSON.stringify(r2?.results?.[0]));

    const after = Object.fromEntries(
      (await prisma.medicineStock.findMany({
        where: { id: { in: made.stockIds } }, select: { id: true, actualStock: true },
      })).map((s) => [s.id, s.actualStock]),
    );
    ok("FEFO: earliest non-expired batch drained first (4→0)", after[earlyId] === 0, JSON.stringify(after));
    ok("FEFO: remainder from the later batch (6→3)", after[lateId] === 3, JSON.stringify(after));
    ok("expired batch NEVER touched (still 5)", after[expiredId] === 5, JSON.stringify(after));

    const r3 = await call([{ ...op("ok", 7), clientOpId: `qa-dd-${TS}-ok` }], user.accountId);
    made.opIds.pop();
    ok("replaying the same clientOpId is a duplicate (no double deduction)", r3?.results?.[0]?.status === "duplicate", JSON.stringify(r3?.results?.[0]));
    const again = await prisma.medicineStock.findUnique({ where: { id: lateId }, select: { actualStock: true } });
    ok("stock unchanged after replay", again?.actualStock === 3, JSON.stringify(again));

    const r4 = await call([op("over", 99)], user.accountId);
    ok("over-dispense refused with available count",
      r4?.results?.[0]?.status === "error" && String(r4.results[0].message).includes("Only 3"),
      JSON.stringify(r4?.results?.[0]));

    const log = await prisma.medicineLogs.findFirst({
      where: { message: { contains: `QA-DD-${TS}` }, action: 4 },
      select: { message: true, userId: true },
    });
    ok("Medicine Logs audit row written (action=4, names patient)",
      !!log && log.userId === user.id && log.message.includes("Walk-in QA"), JSON.stringify(log));
  } catch (e: any) {
    fail++;
    console.log("FATAL:", e?.message || e);
  } finally {
    try {
      await prisma.mobileUploadLog.deleteMany({ where: { clientOpId: { in: made.opIds } } });
      await prisma.medicineLogs.deleteMany({ where: { message: { contains: `QA-DD-${TS}` } } });
      if (made.grantId) await prisma.medicineStorageAccess.delete({ where: { id: made.grantId } }).catch(() => {});
      for (const id of made.stockIds) {
        await prisma.medicinePriceTrack.deleteMany({ where: { medicineStockId: id } }).catch(() => {});
        await prisma.medicineAlert.deleteMany({ where: { medicineStockId: id } }).catch(() => {});
        await prisma.medicineStock.delete({ where: { id } }).catch(() => {});
      }
      if (made.medId) await prisma.medicine.delete({ where: { id: made.medId } }).catch(() => {});
      console.log("cleanup: done");
    } catch (e: any) {
      console.log("CLEANUP WARNING:", e?.message || e);
    }
    await prisma.$disconnect();
    console.log(`RESULT: ${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
  }
})();
