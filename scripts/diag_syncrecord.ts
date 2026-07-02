import "dotenv/config";
import { prisma } from "../src/barrel/prisma";

(async () => {
  const total = await prisma.syncRecord.count();
  console.log("SyncRecord rows total:", total);

  const byTable = await prisma.syncRecord.groupBy({ by: ["tableName"], _count: { _all: true } });
  console.log("by table:");
  for (const g of byTable) console.log("  ", g.tableName, "=", (g._count as any)._all);

  const recent = await prisma.syncRecord.findMany({
    orderBy: { serverAt: "desc" },
    take: 10,
    select: { tableName: true, recordId: true, lineId: true, serverAt: true, payload: true },
  });
  console.log("\nMOST RECENT 10 SyncRecord rows:");
  for (const r of recent) {
    const p: any = r.payload;
    const label = p?.firstname ? p.firstname + " " + p.lastname : p?.name ?? "";
    console.log("  ", r.serverAt.toISOString(), r.tableName, "line:", r.lineId, "|", label);
  }
  await prisma.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
