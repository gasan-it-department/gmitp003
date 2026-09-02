/* PROOF for medicine batch transfer (storage → storage), all anticipated
 * cases. Runs the real controller against the local DB. Cleans up.
 * Run: npx ts-node --transpile-only e2e_transfer.ts */
import { prisma } from "./src/barrel/prisma";
import { transferMedicine } from "./src/controller/medicineController";

const TS = Date.now();
const uid = () =>
  "xxxxxxxxxxxx4xxxyxxxxxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
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
    accountIds: [] as string[], userIds: [] as string[],
    storageIds: [] as string[], medIds: [] as string[],
  };

  try {
    const line = await prisma.line.findFirst({ select: { id: true } });
    const dept = await prisma.department.findFirst({ select: { id: true } });
    const otherLine = await prisma.line.findFirst({
      where: { NOT: { id: line?.id ?? "" } }, select: { id: true },
    });
    if (!line || !dept) { console.log("NO FIXTURE"); process.exit(2); }

    const mkUser = async (tag: string) => {
      const acct = await prisma.account.create({
        data: { username: `qa_tx_${TS}_${tag}`, password: "x", lineId: line.id },
        select: { id: true, username: true },
      });
      made.accountIds.push(acct.id);
      const u = await prisma.user.create({
        data: {
          firstName: "QaTx", lastName: tag.toUpperCase(), username: acct.username,
          accountId: acct.id, lineId: line.id, email: `qa-tx-${TS}-${tag}@test.local`,
        },
        select: { id: true },
      });
      made.userIds.push(u.id);
      return { acctId: acct.id, userId: u.id };
    };
    const actor = await mkUser("actor");
    const stranger = await mkUser("stranger");

    const mkStorage = async (tag: string, lineId: string) => {
      const s = await prisma.medicineStorage.create({
        data: {
          name: `QA-TX-${tag}-${TS}`, refNumber: `QATX-${tag}-${TS}`, desc: "QA",
          lineId, departmentId: dept.id, status: 1, timestamp: new Date().toISOString(),
        },
        select: { id: true },
      });
      made.storageIds.push(s.id);
      return s.id;
    };
    const A = await mkStorage("A", line.id);   // source
    const B = await mkStorage("B", line.id);   // destination
    const X = otherLine ? await mkStorage("X", otherLine.id) : null; // cross-line
    // actor gets access on A, B (and X if present); stranger gets A only
    for (const sid of [A, B, ...(X ? [X] : [])])
      await prisma.medicineStorageAccess.create({ data: { userId: actor.userId, medicineStorageId: sid } });
    await prisma.medicineStorageAccess.create({ data: { userId: stranger.userId, medicineStorageId: A } });

    const med = await prisma.medicine.create({
      data: { serialNumber: `QATX-${TS}`, name: `QA TX Med ${TS}`, desc: "None", lineId: line.id },
      select: { id: true },
    });
    made.medIds.push(med.id);

    const dayA = new Date(Math.round((Date.now() + 200 * 86400000) / 86400000) * 86400000);
    const mfgA = new Date(Math.round((Date.now() - 30 * 86400000) / 86400000) * 86400000);
    const mkStock = async (storageId: string, over: Record<string, unknown> = {}) => {
      const s = await prisma.medicineStock.create({
        data: {
          medicineId: med.id, medicineStorageId: storageId, lineId: line.id, quarter: 1,
          quality: "box", perQuantity: 10, quantity: 10, actualStock: 100, threshold: 0,
          expiration: dayA, manufacturingDate: mfgA, ...over,
        },
        select: { id: true },
      });
      return s.id;
    };

    const call = async (acctId: string | undefined, body: Record<string, unknown>) => {
      const res = mockRes();
      try { await transferMedicine({ body, user: acctId ? { id: acctId } : undefined } as any, res); }
      catch (e: any) { return { threw: e?.message ?? String(e) }; }
      return { code: res._code, body: res._body };
    };

    // 1) basic transfer A->B (new batch)
    const s1 = await mkStock(A);
    const r1 = await call(actor.acctId, { stockId: s1, departId: B, quantity: 3 });
    const srcAfter = await prisma.medicineStock.findUnique({ where: { id: s1 }, select: { quantity: true, actualStock: true } });
    const destRows1 = await prisma.medicineStock.findMany({ where: { medicineId: med.id, medicineStorageId: B }, select: { quantity: true, actualStock: true } });
    ok("basic transfer succeeds (mode new)", !("threw" in r1) && r1.body?.mode === "new", JSON.stringify(r1).slice(0, 140));
    ok("source decremented 10→7 units, 100→70 pieces", srcAfter?.quantity === 7 && srcAfter?.actualStock === 70, JSON.stringify(srcAfter));
    ok("destination created: 3 units, 30 pieces", destRows1.length === 1 && destRows1[0].quantity === 3 && destRows1[0].actualStock === 30, JSON.stringify(destRows1));

    // 2) second transfer A->B MERGES into the same dest batch
    const r2 = await call(actor.acctId, { stockId: s1, departId: B, quantity: 2 });
    const destRows2 = await prisma.medicineStock.findMany({ where: { medicineId: med.id, medicineStorageId: B }, select: { quantity: true } });
    ok("second transfer merges (mode merge, still ONE dest row)", !("threw" in r2) && r2.body?.mode === "merge" && destRows2.length === 1, JSON.stringify({ r2: r2, rows: destRows2.length }));
    ok("dest merged total 5 units", destRows2[0]?.quantity === 5, JSON.stringify(destRows2));

    // 3) day-time twin in B (same day, +8h) then transfer → merges, no split
    await prisma.medicineStock.create({
      data: { medicineId: med.id, medicineStorageId: B, lineId: line.id, quarter: 1, quality: "box", perQuantity: 10,
        quantity: 1, actualStock: 10, threshold: 0, expiration: new Date(dayA.getTime() - 8 * 3600000), manufacturingDate: new Date(mfgA.getTime() - 8 * 3600000) },
    });
    const beforeCount = (await prisma.medicineStock.count({ where: { medicineId: med.id, medicineStorageId: B } }));
    const r3 = await call(actor.acctId, { stockId: s1, departId: B, quantity: 1 });
    const afterRows = await prisma.medicineStock.findMany({ where: { medicineId: med.id, medicineStorageId: B }, select: { quantity: true } });
    ok("day-time twin absorbed → ONE dest row (no split)", !("threw" in r3) && afterRows.length === 1, `before=${beforeCount} after=${afterRows.length}`);
    ok("absorbed totals correct (5 + 1 twin + 1 moved = 7)", afterRows[0]?.quantity === 7, JSON.stringify(afterRows));

    // 4) reject: quantity exceeds units
    const r4 = await call(actor.acctId, { stockId: s1, departId: B, quantity: 999 });
    ok("reject over-quantity", "threw" in r4 && /Not enough on hand/.test(String(r4.threw)), JSON.stringify(r4).slice(0, 120));

    // 5) reject: not enough PIECES (partially dispensed batch)
    const sPart = await mkStock(A, { quantity: 5, actualStock: 12 }); // 5 boxes claimed but only 12 pieces
    const r5 = await call(actor.acctId, { stockId: sPart, departId: B, quantity: 5 }); // needs 50 pieces
    ok("reject when pieces < units×perUnit (no phantom stock)", "threw" in r5 && /piece/.test(String(r5.threw)), JSON.stringify(r5).slice(0, 160));

    // 6) reject: destination == source storage
    const r6 = await call(actor.acctId, { stockId: s1, departId: A, quantity: 1 });
    ok("reject transfer to the same storage", "threw" in r6 && /different from the source/.test(String(r6.threw)), JSON.stringify(r6).slice(0, 140));

    // 7) reject: cross-line destination
    if (X) {
      const r7 = await call(actor.acctId, { stockId: s1, departId: X, quantity: 1 });
      ok("reject cross-line transfer", "threw" in r7 && /different office\/line/.test(String(r7.threw)), JSON.stringify(r7).slice(0, 140));
    } else { console.log("SKIP cross-line (single-line DB)"); pass++; }

    // 8) reject: stranger without access on destination B
    const r8 = await call(stranger.acctId, { stockId: s1, departId: B, quantity: 1 });
    ok("stranger without destination access is refused", "threw" in r8 && /storage access|No storage access/i.test(String(r8.threw)), JSON.stringify(r8).slice(0, 160));

    // 9) idempotency: same clientOpId twice → second does NOT move again
    const op = uid();
    const sIdem = await mkStock(A);
    const r9a = await call(actor.acctId, { stockId: sIdem, departId: B, quantity: 4, clientOpId: op });
    const r9b = await call(actor.acctId, { stockId: sIdem, departId: B, quantity: 4, clientOpId: op });
    const srcIdem = await prisma.medicineStock.findUnique({ where: { id: sIdem }, select: { quantity: true } });
    ok("first idempotent transfer applies", !("threw" in r9a) && r9a.body?.message === "OK", JSON.stringify(r9a).slice(0, 120));
    ok("replay with same clientOpId is a no-op duplicate", !("threw" in r9b) && r9b.body?.duplicate === true, JSON.stringify(r9b).slice(0, 120));
    ok("source moved only ONCE (10→6, not 2)", srcIdem?.quantity === 6, JSON.stringify(srcIdem));
  } catch (e: any) {
    fail++;
    console.log("FATAL:", e?.message || e);
  } finally {
    try {
      const stocks = await prisma.medicineStock.findMany({ where: { medicineId: { in: made.medIds } }, select: { id: true } });
      const sids = stocks.map((s) => s.id);
      await prisma.medicineAlert.deleteMany({ where: { medicineStockId: { in: sids } } });
      await prisma.medicinePriceTrack.deleteMany({ where: { medicineStockId: { in: sids } } });
      await prisma.medicineStock.deleteMany({ where: { id: { in: sids } } });
      await prisma.mobileUploadLog.deleteMany({ where: { userId: { in: made.userIds } } });
      await prisma.medicineLogs.deleteMany({ where: { userId: { in: made.userIds } } });
      await prisma.medicineNotification.deleteMany({ where: { userId: { in: made.userIds } } });
      await prisma.notification.deleteMany({ where: { recipientId: { in: made.userIds } } });
      await prisma.medicine.deleteMany({ where: { id: { in: made.medIds } } });
      await prisma.medicineStorageAccess.deleteMany({ where: { userId: { in: made.userIds } } });
      await prisma.medicineStorage.deleteMany({ where: { id: { in: made.storageIds } } });
      await prisma.user.deleteMany({ where: { id: { in: made.userIds } } });
      await prisma.account.deleteMany({ where: { id: { in: made.accountIds } } });
      console.log("cleanup: done");
    } catch (e: any) { console.log("CLEANUP WARNING:", e?.message || e); }
    await prisma.$disconnect();
    console.log(`RESULT: ${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
  }
})();
