/**
 * Verifies the Pharmacy "Mobile Access" feature end-to-end:
 *   - a user with no grant: /mobile-access/me = false AND the gated mobile
 *     endpoint (/medicine/sync) returns 403
 *   - grant → /me = true, gate opens, list shows the user, candidates hides them
 *   - re-grant is idempotent (1 row)
 *   - revoke → /me = false, gate closes (403 again)
 *
 * Run:  npx ts-node scripts/mobile_access_itest.ts   (API must be running)
 */
import "dotenv/config";
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
  console.log("account", account.id, "line", lineId, "user", userId);

  try {
    // clean slate
    await prisma.pharmacyMobileAccess.deleteMany({ where: { lineId, userId } });

    // ── not granted → /me false, gate 403 ──
    let r = await fetch(BASE + "/medicine/mobile-access/me", { headers: H });
    let j: any = await r.json();
    ok("me = not granted initially", j.granted === false, j);

    let gate = await fetch(BASE + "/medicine/sync", { headers: H });
    ok("gated /medicine/sync = 403 when NOT granted", gate.status === 403, gate.status);

    // ── grant ──
    r = await fetch(BASE + "/medicine/mobile-access", {
      method: "POST", headers: H,
      body: JSON.stringify({ lineId, userId, grantedById: userId }),
    });
    ok("grant returns 200", r.status === 200, r.status);

    r = await fetch(BASE + "/medicine/mobile-access/me", { headers: H });
    j = await r.json();
    ok("me = granted after grant", j.granted === true, j);

    gate = await fetch(BASE + "/medicine/sync", { headers: H });
    ok("gate OPENS when granted (/medicine/sync no longer 403)", gate.status !== 403, gate.status);

    // list shows the user
    r = await fetch(BASE + "/medicine/mobile-access?lineId=" + lineId, { headers: H });
    j = await r.json();
    ok("list includes the granted user", (j.list ?? []).some((x: any) => x.userId === userId), (j.list ?? []).length);

    // candidates hides the already-granted user
    r = await fetch(BASE + "/medicine/mobile-access/candidates?lineId=" + lineId, { headers: H });
    j = await r.json();
    ok("candidates EXCLUDES the granted user", !(j.list ?? []).some((x: any) => x.id === userId), (j.list ?? []).length);

    // re-grant idempotent
    await fetch(BASE + "/medicine/mobile-access", {
      method: "POST", headers: H,
      body: JSON.stringify({ lineId, userId, grantedById: userId }),
    });
    const cnt = await prisma.pharmacyMobileAccess.count({ where: { lineId, userId } });
    ok("re-grant is idempotent (exactly 1 row)", cnt === 1, cnt);

    // ── revoke ──
    r = await fetch(BASE + "/medicine/mobile-access", {
      method: "DELETE", headers: H,
      body: JSON.stringify({ lineId, userId, revokedById: userId }),
    });
    ok("revoke returns 200", r.status === 200, r.status);

    r = await fetch(BASE + "/medicine/mobile-access/me", { headers: H });
    j = await r.json();
    ok("me = not granted after revoke", j.granted === false, j);

    gate = await fetch(BASE + "/medicine/sync", { headers: H });
    ok("gate CLOSES again after revoke (403)", gate.status === 403, gate.status);

    console.log("\nMOBILE ACCESS ITEST OK");
  } finally {
    await prisma.pharmacyMobileAccess.deleteMany({ where: { lineId, userId } });
    await prisma.medicineLogs.deleteMany({ where: { message: { contains: "mobile pharmacy access" } } });
    await prisma.$disconnect();
  }
}

main().catch(async (e) => { console.error(e); process.exitCode = 1; await prisma.$disconnect(); });
