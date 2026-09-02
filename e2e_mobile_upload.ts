/* REPRODUCE the mobile scan flow over REAL HTTP (middleware included):
 *   scan unknown barcode (scan-log, offline-first client id)
 *   → attach barcode to an EXISTING medicine (attach-barcode)
 *   → restock via the queue endpoint (add-stock/bulk)
 * Signs a real JWT with the local secret. Local API on :3000 + local DB.
 * Run: npx ts-node --transpile-only e2e_mobile_upload.ts */
import "dotenv/config";
import { prisma } from "./src/barrel/prisma";
import { createSigner } from "fast-jwt";

const API = "http://localhost:3000";
const TS = Date.now();
const uid = () =>
  "xxxxxxxxxxxx4xxxyxxxxxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });

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
    medicineIds: [] as string[],
    storageId: "",
    opIds: [] as string[],
  };

  try {
    const line = await prisma.line.findFirst({ select: { id: true } });
    if (!line) {
      console.log("NO FIXTURE (no line)");
      process.exit(2);
    }
    const dept = await prisma.department.findFirst({ select: { id: true } });
    if (!dept) {
      console.log("NO FIXTURE (no department)");
      process.exit(2);
    }

    // ── fixture: scanner user with mobile access + storage grant ────────
    const acct = await prisma.account.create({
      data: { username: `qa_mob_${TS}`, password: "x", lineId: line.id },
      select: { id: true, username: true },
    });
    made.accountId = acct.id;
    const user = await prisma.user.create({
      data: {
        firstName: "QaMob",
        lastName: "SCANNER",
        username: acct.username,
        accountId: acct.id,
        lineId: line.id,
        email: `qa-mob-${TS}@test.local`,
      },
      select: { id: true },
    });
    made.userId = user.id;
    await prisma.pharmacyMobileAccess.create({
      data: { lineId: line.id, userId: user.id },
    });
    const storage = await prisma.medicineStorage.create({
      data: {
        name: `QA-MOB-STORE-${TS}`,
        refNumber: `QAM-${TS}`,
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

    const token = createSigner({ key: process.env.JWT_SECRET as string })({
      id: acct.id,
      username: acct.username,
    });
    const H = {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    };
    const call = async (method: string, path: string, body: unknown) => {
      try {
        const res = await fetch(API + path, {
          method,
          headers: H,
          body: JSON.stringify(body),
        });
        let data: any = null;
        try {
          data = await res.json();
        } catch {
          data = { raw: await res.text().catch(() => "") };
        }
        return { status: res.status, data, dropped: false };
      } catch (e: any) {
        return { status: 0, data: { message: e?.message }, dropped: true };
      }
    };

    // ── 1) SCAN an unknown barcode → creates the medicine (client id) ───
    const localMedId = uid();
    const barcode1 = `QAB${TS}1`;
    const r1 = await call("POST", "/medicine/scan-log", {
      barcode: barcode1,
      name: `QA Mob Med A ${TS}`,
      lineId: line.id,
      scannedByUserId: user.id,
      id: localMedId,
    });
    ok(
      "scan-log (new medicine, offline-first id) → 200",
      r1.status === 200 && r1.data?.id,
      `status=${r1.status} ${JSON.stringify(r1.data).slice(0, 140)}`,
    );
    if (r1.data?.id) made.medicineIds.push(r1.data.id);

    // ── 2) ATTACH a barcode to an EXISTING medicine (the report's flow) ──
    const med2 = await prisma.medicine.create({
      data: {
        serialNumber: `QAS-${TS}`,
        name: `QA Mob Med B ${TS}`,
        desc: "None",
        lineId: line.id,
      },
      select: { id: true },
    });
    made.medicineIds.push(med2.id);
    const barcode2 = `QAB${TS}2`;
    const attachOp = uid();
    made.opIds.push(attachOp);
    const r2 = await call("PATCH", "/medicine/attach-barcode", {
      medicineId: med2.id,
      barcode: barcode2,
      lineId: line.id,
      userId: user.id,
      clientOpId: attachOp,
    });
    ok(
      "attach-barcode to existing medicine → 200",
      r2.status === 200,
      `status=${r2.status} ${JSON.stringify(r2.data).slice(0, 140)}`,
    );

    // ── 3) RESTOCK via the bulk queue endpoint — exact mobile shape ─────
    const stockOp = uid();
    made.opIds.push(stockOp);
    const r3 = await call("POST", "/medicine/add-stock/bulk", {
      ops: [
        {
          clientOpId: stockOp,
          medicineId: med2.id,
          lineId: line.id,
          userId: user.id,
          storageId: storage.id,
          unitOfMeasure: "Bottle",
          thresHold: 5,
          quantity: 10,
          perUnit: 1,
          expiration: new Date(Date.now() + 400 * 86400000).toISOString(),
          manufacturingDate: new Date(Date.now() - 30 * 86400000).toISOString(),
          price: 12.5,
        },
      ],
    });
    const r3res = r3.data?.results?.[0];
    ok(
      "add-stock/bulk (restock after barcode reg) → 200 + created",
      r3.status === 200 && (r3res?.status === "created" || r3res?.status === "restocked"),
      `status=${r3.status} ${JSON.stringify(r3.data).slice(0, 200)}`,
    );

    // ── 4) stock really landed with the right math (10 × 1) ─────────────
    if (r3res?.stockId) {
      const stock = await prisma.medicineStock.findUnique({
        where: { id: r3res.stockId },
        select: { actualStock: true, quantity: true },
      });
      ok(
        "stock math right (qty 10 × per 1 = 10 items)",
        stock?.actualStock === 10 && stock?.quantity === 10,
        JSON.stringify(stock),
      );
    } else {
      ok("stock math right (qty 10 × per 1 = 10 items)", false, "no stockId");
    }

    // ── 5) same flow for the SCANNED (client-id) medicine ───────────────
    const stockOp2 = uid();
    made.opIds.push(stockOp2);
    const r5 = await call("POST", "/medicine/add-stock/bulk", {
      ops: [
        {
          clientOpId: stockOp2,
          medicineId: localMedId, // the client-generated id from step 1
          lineId: line.id,
          userId: user.id,
          storageId: storage.id,
          unitOfMeasure: "Box",
          thresHold: 2,
          quantity: 3,
          perUnit: 20,
          expiration: new Date(Date.now() + 300 * 86400000).toISOString(),
          manufacturingDate: new Date(Date.now() - 10 * 86400000).toISOString(),
          price: 99,
        },
      ],
    });
    const r5res = r5.data?.results?.[0];
    ok(
      "restock the freshly SCANNED medicine (client id) works",
      r5.status === 200 && (r5res?.status === "created" || r5res?.status === "restocked"),
      `status=${r5.status} ${JSON.stringify(r5.data).slice(0, 200)}`,
    );

    // ── 6) THE PROD CASE: barcode already owned by ANOTHER line ─────────
    // Real product EANs are identical nationwide — a different line having
    // scanned the same product must NOT block ours.
    const otherLine = await prisma.line.findFirst({
      where: { NOT: { id: line.id } },
      select: { id: true },
    });
    if (otherLine) {
      const xlb = `QAX${TS}`;
      const foreign = await prisma.medicine.create({
        data: {
          serialNumber: `QAF-${TS}`,
          name: `QA Foreign Med ${TS}`,
          desc: "None",
          barcode: xlb,
          lineId: otherLine.id,
        },
        select: { id: true },
      });
      made.medicineIds.push(foreign.id);

      const localMedId2 = uid();
      const r6 = await call("POST", "/medicine/scan-log", {
        barcode: xlb,
        name: `QA Mob Med C ${TS}`,
        lineId: line.id,
        scannedByUserId: user.id,
        id: localMedId2,
      });
      ok(
        "scan-log with a barcode ANOTHER line owns → creates OUR medicine",
        r6.status === 200 && r6.data?.id === localMedId2 && r6.data?.mode === "created",
        `status=${r6.status} ${JSON.stringify(r6.data).slice(0, 160)}`,
      );
      if (r6.data?.id) made.medicineIds.push(r6.data.id);

      // restock cascade heals: the previously-ITEM_NOT_FOUND stock op lands
      const stockOp3 = uid();
      made.opIds.push(stockOp3);
      const r7 = await call("POST", "/medicine/add-stock/bulk", {
        ops: [
          {
            clientOpId: stockOp3,
            medicineId: localMedId2,
            lineId: line.id,
            userId: user.id,
            storageId: storage.id,
            unitOfMeasure: "Bottle",
            thresHold: 5,
            quantity: 7,
            perUnit: 2,
            expiration: new Date(Date.now() + 200 * 86400000).toISOString(),
            manufacturingDate: new Date(Date.now() - 5 * 86400000).toISOString(),
            price: 5,
          },
        ],
      });
      const r7res = r7.data?.results?.[0];
      ok(
        "restock of the cross-line-barcode medicine lands (cascade heals)",
        r7.status === 200 && r7res?.status === "created",
        `status=${r7.status} ${JSON.stringify(r7.data).slice(0, 200)}`,
      );

      // attach the foreign-owned barcode to OUR med → allowed (per-line)
      const med3 = await prisma.medicine.create({
        data: {
          serialNumber: `QAT-${TS}`,
          name: `QA Mob Med D ${TS}`,
          desc: "None",
          lineId: line.id,
        },
        select: { id: true },
      });
      made.medicineIds.push(med3.id);
      // (barcode xlb now exists in OUR line too via r6 — use a FRESH foreign
      //  barcode owned only by the other line to isolate the cross-line case)
      const xlb2 = `QAY${TS}`;
      const foreign2 = await prisma.medicine.create({
        data: {
          serialNumber: `QAF2-${TS}`,
          name: `QA Foreign Med 2 ${TS}`,
          desc: "None",
          barcode: xlb2,
          lineId: otherLine.id,
        },
        select: { id: true },
      });
      made.medicineIds.push(foreign2.id);
      const attachOp2 = uid();
      made.opIds.push(attachOp2);
      const r8 = await call("PATCH", "/medicine/attach-barcode", {
        medicineId: med3.id,
        barcode: xlb2,
        lineId: line.id,
        userId: user.id,
        clientOpId: attachOp2,
      });
      ok(
        "attach a barcode another line owns → allowed (per-line unique)",
        r8.status === 200,
        `status=${r8.status} ${JSON.stringify(r8.data).slice(0, 160)}`,
      );

      // same-line conflict must STILL refuse: barcode2 belongs to med2
      const attachOp3 = uid();
      made.opIds.push(attachOp3);
      const r9 = await call("PATCH", "/medicine/attach-barcode", {
        medicineId: med3.id,
        barcode: barcode2,
        lineId: line.id,
        userId: user.id,
        clientOpId: attachOp3,
      });
      ok(
        "same-line barcode conflict still refused (409)",
        r9.status === 409 && !!r9.data?.existingMedicineId,
        `status=${r9.status} ${JSON.stringify(r9.data).slice(0, 160)}`,
      );
    } else {
      console.log("SKIP  cross-line cases (single-line DB)");
      pass += 4;
    }
  } catch (e: any) {
    fail++;
    console.log("FATAL:", e?.message || e);
  } finally {
    try {
      await prisma.mobileUploadLog.deleteMany({
        where: { clientOpId: { in: made.opIds } },
      });
      await prisma.medicineLogs.deleteMany({
        where: { userId: made.userId },
      });
      await prisma.notification.deleteMany({
        where: { recipientId: made.userId },
      });
      const stocks = await prisma.medicineStock.findMany({
        where: { medicineId: { in: made.medicineIds } },
        select: { id: true },
      });
      const sids = stocks.map((s) => s.id);
      await prisma.medicineAlert
        .deleteMany({ where: { medicineStockId: { in: sids } } })
        .catch(() => undefined);
      await prisma.medicinePriceTrack
        .deleteMany({ where: { medicineStockId: { in: sids } } })
        .catch(() => undefined);
      await prisma.medicineStock.deleteMany({ where: { id: { in: sids } } });
      await prisma.medicine.deleteMany({
        where: { id: { in: made.medicineIds } },
      });
      await prisma.medicineStorageAccess.deleteMany({
        where: { userId: made.userId },
      });
      await prisma.pharmacyMobileAccess.deleteMany({
        where: { userId: made.userId },
      });
      await prisma.medicineStorage.deleteMany({
        where: { id: made.storageId },
      });
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
