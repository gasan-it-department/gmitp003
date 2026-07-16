/**
 * Find (and optionally merge) duplicate medicine catalog rows.
 *
 * Duplicates split a medicine's stock: the storage shows units under one row
 * while a prescription points at the other, which then reads "0 on-hand" and
 * can't be dispensed.
 *
 * Usage — from gmitp003-api:
 *   node -r dotenv/config scripts/find_duplicate_medicines.js
 *       -> READ-ONLY. Lists duplicate name groups and what each row holds.
 *
 *   node -r dotenv/config scripts/find_duplicate_medicines.js --merge
 *       -> For each group, KEEPS the row with stock (or the oldest) and
 *          repoints prescriptions/history/transactions at it, then removes
 *          the emptied duplicates. Prints every change. Take a backup first.
 */
const { PrismaClient } = require("../generated/prisma/client");
const prisma = new PrismaClient();

const MERGE = process.argv.includes("--merge");
const key = (n) => n.trim().toLowerCase().replace(/\s+/g, " ");

(async () => {
  const meds = await prisma.medicine.findMany({
    select: {
      id: true,
      name: true,
      serialNumber: true,
      lineId: true,
      timestamp: true,
      MedicineStock: { select: { actualStock: true } },
      _count: { select: { PrecribeMedicine: true } },
    },
    orderBy: { timestamp: "asc" },
  });

  // group by (line, normalised name)
  const groups = new Map();
  for (const m of meds) {
    const k = m.lineId + "|" + key(m.name);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(m);
  }
  const dupes = [...groups.values()].filter((g) => g.length > 1);

  if (dupes.length === 0) {
    console.log("No duplicate medicine names found. Nothing to do.");
    return;
  }

  console.log(`Found ${dupes.length} duplicated medicine name(s):\n`);
  for (const g of dupes) {
    const onHand = (m) => m.MedicineStock.reduce((s, x) => s + (x.actualStock || 0), 0);
    console.log(`  "${g[0].name}"  (${g.length} catalog rows)`);
    for (const m of g) {
      console.log(
        `     ${m.id.slice(0, 8)}  serial=${m.serialNumber}  on-hand=${onHand(m)}` +
          `  usedByPrescriptions=${m._count.PrecribeMedicine}  added=${m.timestamp.toISOString().slice(0, 10)}`,
      );
    }

    if (!MERGE) {
      console.log("");
      continue;
    }

    // Keep the row holding stock; ties/none -> the oldest row.
    const keep = [...g].sort((a, b) => onHand(b) - onHand(a) || a.timestamp - b.timestamp)[0];
    const drop = g.filter((m) => m.id !== keep.id);
    console.log(`     -> keeping ${keep.id.slice(0, 8)} (on-hand ${onHand(keep)})`);

    for (const d of drop) {
      await prisma.$transaction(async (tx) => {
        // Repoint EVERYTHING that references the duplicate. MedicineHistory,
        // MedicineTrack and MedicineReceivedRecords cascade-delete off
        // medicineId, so they must be moved before the row is removed or
        // their history would be destroyed with it.
        const moved = {};
        for (const [label, model] of [
          ["prescription item", tx.precribeMedicine],
          ["stock batch", tx.medicineStock],
          ["transaction item", tx.medicineTransactionItem],
          ["history entry", tx.medicineHistory],
          ["stock track", tx.medicineTrack],
          ["received record", tx.medicineReceivedRecords],
        ]) {
          const r = await model.updateMany({
            where: { medicineId: d.id },
            data: { medicineId: keep.id },
          });
          if (r.count > 0) moved[label] = r.count;
        }
        await tx.medicine.delete({ where: { id: d.id } });
        const summary =
          Object.entries(moved)
            .map(([k, v]) => `${v} ${k}(s)`)
            .join(", ") || "nothing to move";
        console.log(`     -> merged ${d.id.slice(0, 8)}: ${summary}; row removed`);
      });
    }
    console.log("");
  }

  if (!MERGE) {
    console.log("Read-only. Re-run with --merge to consolidate them.");
  }
})()
  .catch((e) => {
    console.error("FAILED:", e.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
