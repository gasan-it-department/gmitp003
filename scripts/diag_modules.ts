import "dotenv/config";
import { prisma } from "../src/barrel/prisma";

const PHARMACY = ["medicine", "patients-record", "patient-diagnose", "prescribe-medicine"];

(async () => {
  // accounts -> their User -> their Module grants (pharmacy slugs)
  const accounts = await prisma.account.findMany({
    select: { username: true, lineId: true, User: { select: { id: true } } },
  });

  console.log("Pharmacy module grants per account (username -> [slugs]):\n");
  for (const a of accounts) {
    if (!a.User?.id) { console.log(`  ${a.username}: (no linked User)`); continue; }
    const mods = await prisma.module.findMany({
      where: { userId: a.User.id, moduleName: { in: PHARMACY } },
      select: { moduleName: true },
    });
    const slugs = mods.map((m) => m.moduleName);
    if (slugs.length) console.log(`  ${a.username}:  ${slugs.join(", ")}`);
  }

  console.log("\nAll distinct moduleName values in the Module table:");
  const all = await prisma.module.groupBy({ by: ["moduleName"], _count: { _all: true } });
  for (const g of all.sort((x, y) => x.moduleName.localeCompare(y.moduleName)))
    console.log(`  ${g.moduleName}  (${(g._count as any)._all})`);

  await prisma.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
