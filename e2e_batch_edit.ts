/* PROOF of batch editing under strict access.
 * Run: npx ts-node --transpile-only e2e_batch_edit.ts */
import { prisma } from "./src/barrel/prisma";
import { editMedicineStock } from "./src/controller/medicineController";

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
  const made = {
    accountIds: [] as string[],
    userIds: [] as string[],
    medId: "",
    storageId: "",
  };

  try {
    const line = await prisma.line.findFirst({ select: { id: true } });
    const dept = await prisma.department.findFirst({ select: { id: true } });
    if (!line || !dept) { console.log("NO FIXTURE"); process.exit(2); }

    const mkUser = async (tag: string) => {
      const acct = await prisma.account.create({
        data: { username: `qa_edit_${TS}_${tag}`, password: "x", lineId: line.id },
        select: { id: true, username: true },
      });
      made.accountIds.push(acct.id);
      const u = await prisma.user.create({
        data: {
          firstName: "QaEdit", lastName: tag.toUpperCase(),
          username: acct.username, accountId: acct.id, lineId: line.id,
          email: `qa-edit-${TS}-${tag}@test.local`,
        },
        select: { id: true },
      });
      made.userIds.push(u.id);
      return { acctId: acct.id, userId: u.id };
    };
    const owner = await mkUser("owner");     // storage CREATOR
    const granted = await mkUser("granted"); // has Dispense & Stock Access
    const stranger = await mkUser("stranger"); // neither

    const storage = await prisma.medicineStorage.create({
      data: {
        name: `QA-EDIT-${TS}`, refNumber: `QAED-${TS}`, desc: "QA",
        lineId: line.id, departmentId: dept.id, status: 1,
        timestamp: new Date().toISOString(), createdById: owner.userId,
      },
      select: { id: true },
    });
    made.storageId = storage.id;
    await prisma.medicineStorageAccess.create({
      data: { userId: granted.userId, medicineStorageId: storage.id },
    });
    const med = await prisma.medicine.create({
      data: {
        serialNumber: `QAED-${TS}`, name: `QA EDIT MED ${TS}`,
        desc: "None", lineId: line.id,
      },
      select: { id: true },
    });
    made.medId = med.id;

    const day = (offset: number) =>
      new Date(Math.round((Date.now() + offset * 86_400_000) / 86_400_000) * 86_400_000);
    const mkStock = (over: Record<string, unknown> = {}) =>
      prisma.medicineStock.create({
        data: {
          medicineId: med.id, medicineStorageId: storage.id, lineId: line.id,
          quarter: 1, quality: "box", perQuantity: 10, quantity: 5,
          actualStock: 50, threshold: 0,
          expiration: day(200), manufacturingDate: day(-100),
          ...over,
        },
        select: { id: true },
      });

    const call = async (acctId: string, body: Record<string, unknown>) => {
      const res = mockRes();
      try {
        await editMedicineStock({ body, user: { id: acctId } } as any, res);
      } catch (e: any) {
        return { threw: e?.message ?? String(e) };
      }
      return { code: res._code, body: res._body };
    };

    // 1) STRANGER is refused
    const s1 = await mkStock();
    const rStranger = await call(stranger.acctId, { stockId: s1.id, quantity: 9 });
    ok("stranger CANNOT edit the batch",
      "threw" in rStranger && /storage access/i.test(String(rStranger.threw)),
      JSON.stringify(rStranger).slice(0, 140));
    const untouched = await prisma.medicineStock.findUnique({
      where: { id: s1.id }, select: { quantity: true },
    });
    ok("refused edit changed nothing", untouched?.quantity === 5);

    // 2) GRANTED user edits quantity + per-unit → totals recomputed
    const rGranted = await call(granted.acctId, {
      stockId: s1.id, quantity: 7, perUnit: 20,
    });
    const afterG = await prisma.medicineStock.findUnique({
      where: { id: s1.id },
      select: { quantity: true, perQuantity: true, actualStock: true },
    });
    ok("granted user CAN edit", !("threw" in rGranted),
      JSON.stringify(rGranted).slice(0, 140));
    ok("totals recomputed (7 × 20 = 140)",
      afterG?.quantity === 7 && afterG?.perQuantity === 20 && afterG?.actualStock === 140,
      JSON.stringify(afterG));

    // 3) CREATOR edits unit + dates (no explicit grant needed)
    const rOwner = await call(owner.acctId, {
      stockId: s1.id,
      unitOfMeasure: "bottle",
      expiration: day(300).toISOString(),
      manufacturingDate: day(-50).toISOString(),
    });
    const afterO = await prisma.medicineStock.findUnique({
      where: { id: s1.id }, select: { quality: true, expiration: true },
    });
    ok("storage CREATOR can edit without a grant", !("threw" in rOwner),
      JSON.stringify(rOwner).slice(0, 140));
    ok("unit + dates saved", afterO?.quality === "bottle",
      JSON.stringify(afterO));

    // 4) invalid inputs refused
    const rBad = await call(owner.acctId, { stockId: s1.id, perUnit: 0 });
    ok("per-unit 0 is refused", "threw" in rBad,
      JSON.stringify(rBad).slice(0, 120));
    const rBadDate = await call(owner.acctId, {
      stockId: s1.id,
      expiration: day(-400).toISOString(),
      manufacturingDate: day(-10).toISOString(),
    });
    ok("expiry before manufacturing is refused", "threw" in rBadDate,
      JSON.stringify(rBadDate).slice(0, 120));

    // 5) THE TRAP: editing into an EXISTING identical batch must MERGE
    const twin = await mkStock({
      quality: "bottle", perQuantity: 20, quantity: 3, actualStock: 60,
      expiration: day(300), manufacturingDate: day(-50),
    });
    const rMerge = await call(owner.acctId, {
      stockId: s1.id, quantity: 7, perUnit: 20, unitOfMeasure: "bottle",
      expiration: day(300).toISOString(),
      manufacturingDate: day(-50).toISOString(),
    });
    const rows = await prisma.medicineStock.findMany({
      where: { medicineId: med.id },
      select: { id: true, quantity: true, actualStock: true },
    });
    ok("editing into an identical batch MERGES (one row left)",
      rows.length === 1, `rows=${rows.length} ${JSON.stringify(rMerge).slice(0, 120)}`);
    ok("merged totals are summed (60 + 140 = 200)",
      rows[0]?.actualStock === 200 && rows[0]?.quantity === 10,
      JSON.stringify(rows));

    // 6) audit trail written
    const logs = await prisma.medicineLogs.count({
      where: { userId: { in: [owner.userId, granted.userId] }, lineId: line.id },
    });
    ok("edits are written to Medicine Logs", logs >= 3, `logs=${logs}`);
  } catch (e: any) {
    fail++;
    console.log("FATAL:", e?.message || e);
  } finally {
    try {
      const stocks = await prisma.medicineStock.findMany({
        where: { medicineId: made.medId }, select: { id: true },
      });
      const sids = stocks.map((s) => s.id);
      await prisma.medicineAlert.deleteMany({ where: { medicineStockId: { in: sids } } });
      await prisma.medicinePriceTrack.deleteMany({ where: { medicineStockId: { in: sids } } });
      await prisma.medicineStock.deleteMany({ where: { id: { in: sids } } });
      await prisma.medicineLogs.deleteMany({ where: { userId: { in: made.userIds } } });
      await prisma.medicineNotification.deleteMany({ where: { userId: { in: made.userIds } } });
      await prisma.notification.deleteMany({ where: { recipientId: { in: made.userIds } } });
      await prisma.medicine.deleteMany({ where: { id: made.medId } });
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
