/**
 * Integration test for the desktop sync endpoints. Mints a real JWT for an
 * existing account, then exercises ping -> push -> push-again (dedup) ->
 * pull -> update -> pull, asserting idempotency + last-write-wins.
 *
 * Run:  npx ts-node scripts/sync_itest.ts
 */
import "dotenv/config";
import { randomUUID } from "crypto";
import { createSigner } from "fast-jwt";
import { prisma } from "../src/barrel/prisma";

const BASE = "http://localhost:3000";

function assert(label: string, ok: boolean, extra?: unknown) {
  console.log((ok ? "  PASS  " : "  FAIL  ") + label + (extra !== undefined ? "  " + JSON.stringify(extra) : ""));
  if (!ok) throw new Error("FAILED: " + label);
}

async function main() {
  const account = await prisma.account.findFirst({ select: { id: true, lineId: true } });
  if (!account) throw new Error("No account in DB to authenticate as.");
  console.log("Using account", account.id, "line", account.lineId);

  const sign = createSigner({ key: process.env.JWT_SECRET as string });
  const token = sign({ id: account.id });
  const H = { Authorization: "Bearer " + token, "Content-Type": "application/json" };

  // 1) ping
  let r = await fetch(BASE + "/sync/ping", { headers: H });
  let j = await r.json();
  assert("ping ok", r.status === 200 && j.ok === true);

  // 2) push a medicine row
  const id = randomUUID();
  const row = {
    id,
    serial_number: "MED-ITEST",
    barcode: "ITEST-0001",
    name: "ITEST Amoxicillin",
    descr: "Antibiotic 500mg",
    updated_at: new Date().toISOString(),
    deleted_at: null,
  };
  r = await fetch(BASE + "/sync/push", { method: "POST", headers: H, body: JSON.stringify({ table: "medicine", rows: [row] }) });
  j = await r.json();
  assert("push inserts 1", r.status === 200 && j.count === 1, j);

  // 3) push the SAME row again -> idempotent upsert, no duplicate row created
  r = await fetch(BASE + "/sync/push", { method: "POST", headers: H, body: JSON.stringify({ table: "medicine", rows: [row] }) });
  await r.json();
  const dupCount = await prisma.syncRecord.count({ where: { tableName: "medicine", recordId: id } });
  assert("re-push does not duplicate (exactly 1 stored row)", dupCount === 1, { dupCount });

  // 4) pull from scratch -> our row is returned
  r = await fetch(BASE + "/sync/pull?table=medicine", { headers: H });
  j = await r.json();
  const pulled = (j.rows as any[]).find((x) => x.id === id);
  assert("pull returns the pushed row", !!pulled && pulled.name === "ITEST Amoxicillin");
  assert("pull returns a cursor", typeof j.cursor === "string" && j.cursor.length > 0, { cursor: j.cursor });

  // 5) update with a NEWER updated_at -> last-write-wins
  const newer = { ...row, name: "ITEST Amoxicillin 500mg", updated_at: new Date(Date.now() + 5000).toISOString() };
  r = await fetch(BASE + "/sync/push", { method: "POST", headers: H, body: JSON.stringify({ table: "medicine", rows: [newer] }) });
  await r.json();

  // 6) incremental pull using the previous cursor returns the updated payload
  r = await fetch(BASE + "/sync/pull?table=medicine&since=" + encodeURIComponent(j.cursor), { headers: H });
  const j2 = await r.json();
  const updated = (j2.rows as any[]).find((x) => x.id === id);
  assert("incremental pull returns updated row", !!updated && updated.name === "ITEST Amoxicillin 500mg", updated?.name);

  // 7) stale push (older updated_at) is ignored
  const stale = { ...row, name: "STALE SHOULD NOT WIN", updated_at: new Date(Date.now() - 60000).toISOString() };
  await fetch(BASE + "/sync/push", { method: "POST", headers: H, body: JSON.stringify({ table: "medicine", rows: [stale] }) });
  const finalRec = await prisma.syncRecord.findUnique({ where: { tableName_recordId: { tableName: "medicine", recordId: id } }, select: { payload: true } });
  assert("stale write is rejected (newer value kept)", (finalRec?.payload as any)?.name === "ITEST Amoxicillin 500mg", (finalRec?.payload as any)?.name);

  // cleanup test rows
  await prisma.syncRecord.deleteMany({ where: { tableName: "medicine", recordId: id } });
  console.log("\nSYNC ITEST OK — cleaned up.");
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(async () => { await prisma.$disconnect(); });
