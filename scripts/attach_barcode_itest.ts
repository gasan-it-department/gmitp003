/**
 * Verifies the mobile "Barcode registration" endpoint:
 *   - gated: 403 without PharmacyMobileAccess
 *   - attach → 200, barcode set, timestamp TOUCHED (so incremental
 *     /medicine/sync?since=<before> re-delivers the medicine)
 *   - attaching the same barcode to another medicine → 409 + existingMedicineId
 *   - replacing a medicine's own barcode → 200
 *
 * Run:  npx ts-node scripts/attach_barcode_itest.ts   (API must be running)
 */
import "dotenv/config";
import { randomUUID } from "crypto";
import { createSigner } from "fast-jwt";
import { prisma } from "../src/barrel/prisma";

const BASE = "http://localhost:3000";

function ok(label: string, cond: boolean, extra?: unknown) {
  console.log((cond ? "  PASS  " : "  FAIL  ") + label + (extra !== undefined ? "  " + JSON.stringify(extra) : ""));
  if (!cond) throw new Error("FAILED: " + label);
}

async function main() {
  const candidates = await prisma.account.findMany({
    where: { User: { isNot: null } },
    select: { id: true, lineId: true, User: { select: { id: true } } },
  });
  const account = candidates.find((a) => a.lineId && a.User?.id);
  if (!account?.lineId || !account.User?.id)
    throw new Error("Need an account with a lineId and a linked User.");
  const lineId = account.lineId;
  const userId = account.User.id;
  const token = createSigner({ key: process.env.JWT_SECRET as string })({ id: account.id });
  const H = { Authorization: "Bearer " + token, "Content-Type": "application/json" };

  const medA = randomUUID();
  const medB = randomUUID();
  const BARCODE = "ITEST-BAR-" + Date.now();
  const BARCODE2 = "ITEST-BAR2-" + Date.now();

  try {
    await prisma.pharmacyMobileAccess.deleteMany({ where: { lineId, userId } });
    await prisma.medicine.createMany({
      data: [
        { id: medA, name: "ITEST BarMed A", serialNumber: "IT-BA-" + Date.now(), lineId },
        { id: medB, name: "ITEST BarMed B", serialNumber: "IT-BB-" + Date.now(), lineId },
      ],
    });
    const before = Date.now();

    // gated without access
    let r = await fetch(BASE + "/medicine/attach-barcode", {
      method: "PATCH", headers: H,
      body: JSON.stringify({ medicineId: medA, barcode: BARCODE, lineId, userId }),
    });
    ok("attach is gated (403 without mobile access)", r.status === 403, r.status);

    // grant access
    await prisma.pharmacyMobileAccess.create({ data: { lineId, userId } });

    // attach to A
    r = await fetch(BASE + "/medicine/attach-barcode", {
      method: "PATCH", headers: H,
      body: JSON.stringify({ medicineId: medA, barcode: BARCODE, lineId, userId }),
    });
    let j: any = await r.json();
    ok("attach returns 200", r.status === 200, j);
    const a = await prisma.medicine.findUnique({ where: { id: medA }, select: { barcode: true, timestamp: true } });
    ok("barcode stored on the medicine", a?.barcode === BARCODE, a?.barcode);
    ok("timestamp touched (incremental sync will re-deliver)", (a?.timestamp?.getTime() ?? 0) >= before, a?.timestamp);

    // incremental sync picks it up
    r = await fetch(BASE + `/medicine/sync?lineId=${lineId}&since=${before - 1}`, { headers: H });
    j = await r.json();
    const synced = (j.medicines ?? []).find((m: any) => m.id === medA);
    ok("/medicine/sync?since=<before> includes the updated medicine w/ barcode",
      !!synced && synced.barcode === BARCODE, synced && { barcode: synced.barcode });

    // same barcode on B -> 409 with pointer to A
    r = await fetch(BASE + "/medicine/attach-barcode", {
      method: "PATCH", headers: H,
      body: JSON.stringify({ medicineId: medB, barcode: BARCODE, lineId, userId }),
    });
    j = await r.json();
    ok("attaching a taken barcode → 409", r.status === 409, r.status);
    ok("409 carries existingMedicineId (app redirects to restock)", j.existingMedicineId === medA, j);

    // replacing A's own barcode is allowed
    r = await fetch(BASE + "/medicine/attach-barcode", {
      method: "PATCH", headers: H,
      body: JSON.stringify({ medicineId: medA, barcode: BARCODE2, lineId, userId }),
    });
    ok("replacing the medicine's own barcode → 200", r.status === 200, r.status);
    const a2 = await prisma.medicine.findUnique({ where: { id: medA }, select: { barcode: true } });
    ok("replacement stored", a2?.barcode === BARCODE2, a2?.barcode);

    // offline-queue idempotency: same clientOpId replayed → short-circuit
    const opId = randomUUID();
    const BARCODE3 = "ITEST-BAR3-" + Date.now();
    r = await fetch(BASE + "/medicine/attach-barcode", {
      method: "PATCH", headers: H,
      body: JSON.stringify({ medicineId: medB, barcode: BARCODE3, lineId, userId, clientOpId: opId }),
    });
    j = await r.json();
    ok("attach with clientOpId → 200 (first apply)", r.status === 200 && !j.duplicate, j);
    const logRow = await prisma.mobileUploadLog.findUnique({ where: { clientOpId: opId } });
    ok("MobileUploadLog recorded (kind attach-barcode)", logRow?.kind === "attach-barcode", logRow?.kind);
    r = await fetch(BASE + "/medicine/attach-barcode", {
      method: "PATCH", headers: H,
      body: JSON.stringify({ medicineId: medB, barcode: BARCODE3, lineId, userId, clientOpId: opId }),
    });
    j = await r.json();
    ok("replaying the same clientOpId → duplicate:true (no double-apply)",
      r.status === 200 && j.duplicate === true, j);

    console.log("\nATTACH BARCODE ITEST OK");
  } finally {
    await prisma.medicineLogs.deleteMany({ where: { message: { contains: "ITEST BarMed" } } });
    await prisma.mobileUploadLog.deleteMany({ where: { resultId: { in: [medA, medB] }, kind: "attach-barcode" } });
    await prisma.medicine.deleteMany({ where: { id: { in: [medA, medB] } } });
    await prisma.pharmacyMobileAccess.deleteMany({ where: { lineId, userId } });
    await prisma.$disconnect();
  }
}

main().catch(async (e) => { console.error(e); process.exitCode = 1; await prisma.$disconnect(); });
