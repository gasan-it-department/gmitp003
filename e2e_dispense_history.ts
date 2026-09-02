/* PROOF: direct (single) + bulk (one patient, many items) dispenses write
 * DispenseRecords; history list + detail return them; bulk is atomic and
 * all-or-nothing; strict storage access is enforced.
 * Run: npx ts-node --transpile-only e2e_dispense_history.ts */
import { prisma } from "./src/barrel/prisma";
import {
  directDispenseBulk,
  directDispenseMulti,
  dispenseHistoryList,
  dispenseHistoryDetail,
} from "./src/controller/medicineController";

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
    medIds: [] as string[], storageId: "", recordIds: [] as string[],
  };

  try {
    const line = await prisma.line.findFirst({ select: { id: true } });
    const dept = await prisma.department.findFirst({ select: { id: true } });
    if (!line || !dept) { console.log("NO FIXTURE"); process.exit(2); }

    const mkUser = async (tag: string, withAccess: boolean) => {
      const acct = await prisma.account.create({
        data: { username: `qa_dh_${TS}_${tag}`, password: "x", lineId: line.id },
        select: { id: true, username: true },
      });
      made.accountIds.push(acct.id);
      const u = await prisma.user.create({
        data: {
          firstName: "QaDh", lastName: tag.toUpperCase(), username: acct.username,
          accountId: acct.id, lineId: line.id, email: `qa-dh-${TS}-${tag}@test.local`,
        },
        select: { id: true },
      });
      made.userIds.push(u.id);
      return { acctId: acct.id, userId: u.id };
    };
    const disp = await mkUser("disp", true);
    const stranger = await mkUser("stranger", false);

    const storage = await prisma.medicineStorage.create({
      data: {
        name: `QA-DH-${TS}`, refNumber: `QADH-${TS}`, desc: "QA",
        lineId: line.id, departmentId: dept.id, status: 1,
        timestamp: new Date().toISOString(), createdById: disp.userId,
      },
      select: { id: true },
    });
    made.storageId = storage.id;
    await prisma.medicineStorageAccess.create({
      data: { userId: disp.userId, medicineStorageId: storage.id },
    });

    const mkMed = async (tag: string, stock: number) => {
      const med = await prisma.medicine.create({
        data: {
          serialNumber: `QADH-${tag}-${TS}`, name: `QA DH Med ${tag} ${TS}`,
          desc: "None", lineId: line.id,
        },
        select: { id: true },
      });
      made.medIds.push(med.id);
      await prisma.medicineStock.create({
        data: {
          medicineId: med.id, medicineStorageId: storage.id, lineId: line.id,
          quarter: 1, quality: "box", perQuantity: 1, quantity: stock,
          actualStock: stock, threshold: 0,
          expiration: new Date(Date.now() + 200 * 86400000),
          manufacturingDate: new Date(Date.now() - 30 * 86400000),
        },
      });
      return med.id;
    };
    const medA = await mkMed("A", 100);
    const medB = await mkMed("B", 50);
    const medC = await mkMed("C", 5);

    // ── 1. SINGLE direct dispense → one record, one item ────────────────
    const r1 = mockRes();
    await directDispenseBulk(
      { body: { ops: [{ clientOpId: uid(), medicineId: medA, storageId: storage.id, lineId: line.id, quantity: 10, patientName: "Juan Single" }] }, user: { id: disp.acctId } } as any,
      r1,
    );
    ok("single direct dispense succeeds",
      r1._body?.results?.[0]?.status === "dispensed", JSON.stringify(r1._body).slice(0, 120));

    // ── 2. BULK: one patient, THREE items → ONE record, three items ─────
    const r2 = mockRes();
    await directDispenseMulti(
      { body: {
          lineId: line.id, patientName: "Maria Bulk", note: "counter release",
          items: [
            { medicineId: medA, storageId: storage.id, quantity: 5 },
            { medicineId: medB, storageId: storage.id, quantity: 7 },
            { medicineId: medC, storageId: storage.id, quantity: 2 },
          ],
        }, user: { id: disp.acctId } } as any,
      r2,
    );
    ok("bulk dispense succeeds", r2._body?.message === "OK" && r2._body?.itemCount === 3,
      JSON.stringify(r2._body).slice(0, 140));
    if (r2._body?.recordId) made.recordIds.push(r2._body.recordId);
    const bulkRec = await prisma.dispenseRecord.findUnique({
      where: { id: r2._body?.recordId ?? "x" },
      include: { items: true },
    });
    ok("bulk produced ONE record with THREE items, one patient",
      bulkRec?.items.length === 3 && bulkRec?.patientName === "Maria Bulk" &&
      bulkRec?.totalUnits === 14, JSON.stringify({ items: bulkRec?.items.length, total: bulkRec?.totalUnits }));
    const stockA = await prisma.medicineStock.findFirst({ where: { medicineId: medA }, select: { actualStock: true } });
    ok("stock deducted across single + bulk (100 - 10 - 5 = 85)",
      stockA?.actualStock === 85, JSON.stringify(stockA));

    // ── 3. BULK is ATOMIC: one bad line → NOTHING dispensed ─────────────
    const before = (await prisma.medicineStock.findFirst({ where: { medicineId: medB }, select: { actualStock: true } }))?.actualStock;
    const r3 = mockRes();
    let threw = false;
    try {
      await directDispenseMulti(
        { body: { lineId: line.id, patientName: "Atomic Test",
            items: [
              { medicineId: medB, storageId: storage.id, quantity: 1 },
              { medicineId: medC, storageId: storage.id, quantity: 9999 }, // impossible
            ] }, user: { id: disp.acctId } } as any,
        r3,
      );
    } catch { threw = true; }
    const after = (await prisma.medicineStock.findFirst({ where: { medicineId: medB }, select: { actualStock: true } }))?.actualStock;
    ok("bulk with one impossible line is refused", threw);
    ok("atomic: the good line in a failed bulk did NOT deduct", before === after,
      `before=${before} after=${after}`);

    // ── 4. STRANGER (no access) is refused ──────────────────────────────
    const r4 = mockRes();
    let threw4 = false;
    try {
      await directDispenseMulti(
        { body: { lineId: line.id, items: [{ medicineId: medA, storageId: storage.id, quantity: 1 }] }, user: { id: stranger.acctId } } as any,
        r4,
      );
    } catch { threw4 = true; }
    ok("stranger without storage access is refused", threw4);

    // ── 5. HISTORY LIST returns the records, newest first ───────────────
    const r5 = mockRes();
    await dispenseHistoryList({ query: { lineId: line.id, limit: "50" } } as any, r5);
    const list = r5._body?.list ?? [];
    const mine = list.filter((x: any) => x.patientName === "Maria Bulk" || x.patientName === "Juan Single");
    ok("history list shows both dispenses", mine.length === 2, `found=${mine.length}`);
    const bulkRow = list.find((x: any) => x.id === r2._body?.recordId);
    ok("bulk row reports itemCount 3 + a preview", bulkRow?.itemCount === 3 && !!bulkRow?.preview,
      JSON.stringify(bulkRow).slice(0, 140));

    // ── 6. HISTORY DETAIL returns the full item list ────────────────────
    const r6 = mockRes();
    await dispenseHistoryDetail({ query: { id: r2._body?.recordId } } as any, r6);
    ok("detail returns the record with all 3 items",
      r6._body?.record?.items?.length === 3 && r6._body?.record?.patientName === "Maria Bulk",
      JSON.stringify({ items: r6._body?.record?.items?.length }));
  } catch (e: any) {
    fail++;
    console.log("FATAL:", e?.message || e);
  } finally {
    try {
      await prisma.dispenseItem.deleteMany({ where: { record: { lineId: (await prisma.line.findFirst({ select: { id: true } }))?.id, dispenserName: { contains: "Qadh" } } } }).catch(() => {});
      await prisma.dispenseRecord.deleteMany({ where: { dispensedById: { in: made.userIds } } });
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
      await prisma.medicineStorage.deleteMany({ where: { id: made.storageId } });
      await prisma.user.deleteMany({ where: { id: { in: made.userIds } } });
      await prisma.account.deleteMany({ where: { id: { in: made.accountIds } } });
      console.log("cleanup: done");
    } catch (e: any) {
      console.log("CLEANUP WARNING:", e?.message || e);
    }
    await prisma.$disconnect();
    console.log(`RESULT: ${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
  }
})();
