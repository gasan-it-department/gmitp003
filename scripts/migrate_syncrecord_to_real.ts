/**
 * One-time migration: move records that were pushed into the generic SyncRecord
 * store (before real-table sync existed) into the REAL web tables, so they show
 * up in the web app. Idempotent (upsert by id). Removes the SyncRecord row once
 * applied. Tables without a real mapping yet (prescription, prescription_item)
 * are left in SyncRecord.
 *
 * Run:  npx ts-node scripts/migrate_syncrecord_to_real.ts
 */
import "dotenv/config";
import { prisma } from "../src/barrel/prisma";
import { REAL_PUSH, isRealTable } from "../src/controller/realSync";

(async () => {
  const records = await prisma.syncRecord.findMany();
  console.log("SyncRecord rows:", records.length);

  // resolve a User id per line (prescriptions need one) — pick any account
  // on the line that has a linked User
  const userForLine = new Map<string, string | null>();
  async function lineUser(lineId: string | null): Promise<string | null> {
    if (!lineId) return null;
    if (userForLine.has(lineId)) return userForLine.get(lineId)!;
    const acct = await prisma.account.findFirst({
      where: { lineId, User: { isNot: null } },
      select: { User: { select: { id: true } } },
    });
    const uid = acct?.User?.id ?? null;
    userForLine.set(lineId, uid);
    return uid;
  }

  let moved = 0;
  const skipped: Record<string, number> = {};
  for (const rec of records) {
    if (!isRealTable(rec.tableName)) {
      skipped[rec.tableName] = (skipped[rec.tableName] ?? 0) + 1;
      continue;
    }
    try {
      const payload = rec.payload as Record<string, unknown>;
      const userId = await lineUser(rec.lineId);
      await REAL_PUSH[rec.tableName](payload, { lineId: rec.lineId, userId });
      await prisma.syncRecord.delete({ where: { id: rec.id } });
      const label = (payload as any)?.firstname
        ? `${(payload as any).firstname} ${(payload as any).lastname}`
        : (payload as any)?.name ?? rec.recordId;
      console.log(`  moved ${rec.tableName}: ${label}  (line ${rec.lineId})`);
      moved++;
    } catch (e) {
      console.log(`  FAILED ${rec.tableName} ${rec.recordId}: ${e instanceof Error ? e.message : e}`);
    }
  }

  console.log(`\nMoved ${moved} record(s) into the real tables.`);
  if (Object.keys(skipped).length)
    console.log("Left in SyncRecord (no real mapping yet):", skipped);
  await prisma.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
