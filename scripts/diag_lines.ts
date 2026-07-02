import "dotenv/config";
import { prisma } from "../src/barrel/prisma";

(async () => {
  const lines = await prisma.line.findMany({ select: { id: true } });
  console.log("LINES:", lines.length, lines.map((l) => l.id));

  const accts = await prisma.account.findMany({ select: { username: true, lineId: true } });
  console.log("\nACCOUNTS (username -> lineId):");
  for (const a of accts) console.log("  ", a.username, "->", a.lineId);

  const byLine = await prisma.patient.groupBy({ by: ["lineId"], _count: { _all: true } });
  console.log("\nPATIENTS per lineId:");
  for (const g of byLine) console.log("  ", g.lineId, "=", (g._count as any)._all);

  const recent = await prisma.patient.findMany({
    select: { firstname: true, lastname: true, lineId: true, timestamp: true },
    orderBy: { timestamp: "desc" },
    take: 8,
  });
  console.log("\nMOST RECENT 8 PATIENTS:");
  for (const p of recent)
    console.log("  ", p.timestamp.toISOString(), p.firstname, p.lastname, "line:", p.lineId);

  await prisma.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
