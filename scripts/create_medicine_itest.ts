/**
 * Verifies the mobile "create medicine on the spot" upload path
 * (POST /medicine/scan-log with a client-supplied id):
 *   - gated: 403 without PharmacyMobileAccess
 *   - create honours the client id + generates a serial + writes the
 *     web-parity MedicineLogs entry
 *   - replaying the same op (same barcode) → mode "updated", same id
 *   - a barcode that already belongs to ANOTHER medicine → returns that
 *     medicine's id (mobile remaps its local references)
 *
 * Run:  npx ts-node scripts/create_medicine_itest.ts   (API must be running)
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

  const clientId = randomUUID();
  const otherId = randomUUID();
  const BARCODE = "ITEST-CRT-" + Date.now();
  const OTHER_BARCODE = "ITEST-CRT2-" + Date.now();

  try {
    await prisma.pharmacyMobileAccess.deleteMany({ where: { lineId, userId } });

    // gated without access
    let r = await fetch(BASE + "/medicine/scan-log", {
      method: "POST", headers: H,
      body: JSON.stringify({ id: clientId, barcode: BARCODE, name: "ITEST CreateMed", lineId, scannedByUserId: userId }),
    });
    ok("create is gated (403 without mobile access)", r.status === 403, r.status);

    await prisma.pharmacyMobileAccess.create({ data: { lineId, userId } });

    // create honours the client id
    r = await fetch(BASE + "/medicine/scan-log", {
      method: "POST", headers: H,
      body: JSON.stringify({ id: clientId, barcode: BARCODE, name: "ITEST CreateMed", notes: "500mg tab", lineId, scannedByUserId: userId }),
    });
    let j: any = await r.json();
    ok("create returns 200 + mode created", r.status === 200 && j.mode === "created", j);
    ok("server used the CLIENT id (queued stock-adds stay resolvable)", j.id === clientId, { got: j.id });
    ok("serial generated server-side", typeof j.serialNumber === "string" && j.serialNumber.length > 0, j.serialNumber);
    const log = await prisma.medicineLogs.findFirst({
      where: { message: { contains: `Label: ITEST CreateMed` } },
    });
    ok("web-parity MedicineLogs entry written (action 1)", !!log && log.action === 1, log?.message);

    // replay (offline queue retry) → updated, same id, no duplicate row
    r = await fetch(BASE + "/medicine/scan-log", {
      method: "POST", headers: H,
      body: JSON.stringify({ id: clientId, barcode: BARCODE, name: "ITEST CreateMed", lineId, scannedByUserId: userId }),
    });
    j = await r.json();
    ok("replay → mode updated with the same id (idempotent)", j.mode === "updated" && j.id === clientId, j);
    const cnt = await prisma.medicine.count({ where: { OR: [{ id: clientId }, { barcode: BARCODE }] } });
    ok("no duplicate medicine row", cnt === 1, cnt);

    // remap case: create op whose barcode already belongs to another med
    await prisma.medicine.create({
      data: { id: otherId, name: "ITEST OtherMed", serialNumber: "IT-OTH-" + Date.now(), barcode: OTHER_BARCODE, lineId },
    });
    const wantedId = randomUUID();
    r = await fetch(BASE + "/medicine/scan-log", {
      method: "POST", headers: H,
      body: JSON.stringify({ id: wantedId, barcode: OTHER_BARCODE, name: "ITEST OtherMed renamed", lineId, scannedByUserId: userId }),
    });
    j = await r.json();
    ok("existing-barcode create → returns the EXISTING medicine id (mobile remaps)",
      j.mode === "updated" && j.id === otherId, { got: j.id, wanted: wantedId });

    console.log("\nCREATE MEDICINE ITEST OK");
  } finally {
    await prisma.medicineLogs.deleteMany({ where: { message: { contains: "ITEST CreateMed" } } });
    await prisma.medicine.deleteMany({ where: { id: { in: [clientId, otherId] } } });
    await prisma.pharmacyMobileAccess.deleteMany({ where: { lineId, userId } });
    await prisma.$disconnect();
  }
}

main().catch(async (e) => { console.error(e); process.exitCode = 1; await prisma.$disconnect(); });
