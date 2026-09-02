/* PROOF: (1) medicine-level low-stock alerts — ONE threshold per medicine,
 * fires on the TOTAL across batches, once per dip, re-arms after restock;
 * (2) the storage CREATOR can stock/restock without an explicit grant,
 * strangers still refused, grant-holders still allowed.
 * Run: npx ts-node --transpile-only e2e_med_threshold.ts */
import { prisma } from "./src/barrel/prisma";
import {
  checkAndNotifyLowStock,
  clearLowStockAlerts,
} from "./src/service/medicineAlerts";
import { assertStorageAccess } from "./src/controller/storageAccessController";

const TS = Date.now();

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
    accountIds: [] as string[],
    userIds: [] as string[],
    medId: "",
    storageId: "",
  };

  try {
    const line = await prisma.line.findFirst({ select: { id: true } });
    const dept = await prisma.department.findFirst({ select: { id: true } });
    if (!line || !dept) {
      console.log("NO FIXTURE");
      process.exit(2);
    }
    const mkUser = async (tag: string) => {
      const acct = await prisma.account.create({
        data: { username: `qa_thr_${TS}_${tag}`, password: "x", lineId: line.id },
        select: { id: true, username: true },
      });
      made.accountIds.push(acct.id);
      const u = await prisma.user.create({
        data: {
          firstName: "QaThr",
          lastName: tag.toUpperCase(),
          username: acct.username,
          accountId: acct.id,
          lineId: line.id,
          email: `qa-thr-${TS}-${tag}@test.local`,
        },
        select: { id: true },
      });
      made.userIds.push(u.id);
      return u;
    };
    const creator = await mkUser("creator");
    const stranger = await mkUser("stranger");
    const granted = await mkUser("granted");

    const storage = await prisma.medicineStorage.create({
      data: {
        name: `QA-THR-${TS}`,
        refNumber: `QATH-${TS}`,
        desc: "QA fixture",
        lineId: line.id,
        departmentId: dept.id,
        status: 1,
        timestamp: new Date().toISOString(),
        createdById: creator.id,
      },
      select: { id: true },
    });
    made.storageId = storage.id;
    await prisma.medicineStorageAccess.create({
      data: { userId: granted.id, medicineStorageId: storage.id },
    });

    // ── (2) storage write access: creator / stranger / grant-holder ────
    let creatorOk = true;
    try {
      await assertStorageAccess(creator.id, [storage.id], "restock");
    } catch {
      creatorOk = false;
    }
    ok("storage CREATOR allowed without an explicit grant", creatorOk);

    let strangerBlocked = false;
    try {
      await assertStorageAccess(stranger.id, [storage.id], "restock");
    } catch {
      strangerBlocked = true;
    }
    ok("stranger without grant still refused", strangerBlocked);

    let grantedOk = true;
    try {
      await assertStorageAccess(granted.id, [storage.id], "restock");
    } catch {
      grantedOk = false;
    }
    ok("Dispense & Stock Access holder still allowed", grantedOk);

    // ── (1) medicine-level threshold on the TOTAL ───────────────────────
    const med = await prisma.medicine.create({
      data: {
        serialNumber: `QATH-${TS}`,
        name: `QA THRESH MED ${TS}`,
        desc: "None",
        lineId: line.id,
        lowStockThreshold: 50,
      },
      select: { id: true },
    });
    made.medId = med.id;
    const mkStock = (qty: number) =>
      prisma.medicineStock.create({
        data: {
          medicineId: med.id,
          medicineStorageId: storage.id,
          lineId: line.id,
          quarter: 1,
          quality: "box",
          perQuantity: 1,
          threshold: 0,
          quantity: qty,
          actualStock: qty,
          expiration: new Date(Date.now() + 300 * 86_400_000),
          manufacturingDate: new Date(Date.now() - 30 * 86_400_000),
        },
        select: { id: true },
      });
    // Two batches: 60 + 40 = 100 total, threshold 50 → NOT low.
    const s1 = await mkStock(60);
    const s2 = await mkStock(40);

    const r1 = await prisma.$transaction((tx) =>
      checkAndNotifyLowStock(tx, s1.id),
    );
    ok("total 100 > threshold 50 → NO alert", r1 === null);

    // Dispense 60 from batch 1 → total 40 <= 50 → ALERT once.
    await prisma.medicineStock.update({
      where: { id: s1.id },
      data: { actualStock: 0, quantity: 0 },
    });
    const r2 = await prisma.$transaction((tx) =>
      checkAndNotifyLowStock(tx, s1.id),
    );
    ok(
      "total dips to 40 ≤ 50 → alert fires (medicine-level)",
      r2 !== null && (r2?.notified ?? 0) >= 0,
      JSON.stringify(r2),
    );
    const sentinels = await prisma.medicineAlert.count({
      where: { medicineId: med.id, type: 1 },
    });
    ok("ONE medicine-level sentinel exists", sentinels === 1, `n=${sentinels}`);

    // Another mutation while still low → NO second alert (no spam).
    const r3 = await prisma.$transaction((tx) =>
      checkAndNotifyLowStock(tx, s2.id),
    );
    ok("still low → no duplicate alert", r3 === null);

    // Restock batch 1 back to 60 → total 100 > 50 → alert cleared (re-armed).
    await prisma.medicineStock.update({
      where: { id: s1.id },
      data: { actualStock: 60, quantity: 60 },
    });
    await prisma.$transaction((tx) => clearLowStockAlerts(tx, s1.id));
    const after = await prisma.medicineAlert.count({
      where: { medicineId: med.id, type: 1 },
    });
    ok("restock above threshold clears the sentinel (re-armed)", after === 0);

    // Dip again → fires again.
    await prisma.medicineStock.update({
      where: { id: s2.id },
      data: { actualStock: 0, quantity: 0 },
    });
    await prisma.medicineStock.update({
      where: { id: s1.id },
      data: { actualStock: 45, quantity: 45 },
    });
    const r4 = await prisma.$transaction((tx) =>
      checkAndNotifyLowStock(tx, s1.id),
    );
    ok("next dip after re-arm fires again", r4 !== null, JSON.stringify(r4));
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
        where: { OR: [{ medicineId: made.medId }, { medicineStockId: { in: sids } }] },
      });
      await prisma.medicineNotification.deleteMany({
        where: { userId: { in: made.userIds } },
      });
      await prisma.medicinePriceTrack.deleteMany({
        where: { medicineStockId: { in: sids } },
      });
      await prisma.medicineStock.deleteMany({ where: { id: { in: sids } } });
      await prisma.medicine.deleteMany({ where: { id: made.medId } });
      await prisma.medicineStorageAccess.deleteMany({
        where: { userId: { in: made.userIds } },
      });
      await prisma.medicineStorage.deleteMany({ where: { id: made.storageId } });
      await prisma.notification.deleteMany({
        where: { recipientId: { in: made.userIds } },
      });
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
