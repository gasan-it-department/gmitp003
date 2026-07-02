import "dotenv/config";
import { prisma } from "../src/barrel/prisma";

(async () => {
  const lines = await prisma.line.findMany({ select: { id: true } });
  console.log("Per-line syncable record counts (patient / medicine / stock / diagnose=type0):\n");
  for (const l of lines) {
    const [patients, medicines, stock, diag] = await Promise.all([
      prisma.patient.count({ where: { lineId: l.id } }),
      prisma.medicine.count({ where: { lineId: l.id } }),
      prisma.medicineStock.count({ where: { lineId: l.id } }),
      prisma.patientRecord.count({ where: { type: 0, patient: { lineId: l.id } } }),
    ]);
    const total = patients + medicines + stock + diag;
    if (total > 0)
      console.log(
        `  line ${l.id}:  patients=${patients} medicines=${medicines} stock=${stock} diagnose=${diag}  => total ${total}`,
      );
  }
  console.log("\n(The line whose total = 5 is the one your desktop is logged into.)");
  await prisma.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
