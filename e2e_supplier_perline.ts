/* Per-line supplier uniqueness proof. Run: npx ts-node --transpile-only e2e_supplier_perline.ts */
import { prisma } from "./src/barrel/prisma";

(async () => {
  let fail = 0;
  const ts = Date.now();
  const name = "QA Same Supplier " + ts;
  try {
    const lines = await prisma.line.findMany({ select: { id: true }, take: 2 });
    if (lines.length < 2) {
      console.log("SKIP (single-line DB)");
      return;
    }
    await prisma.supplier.create({ data: { name, lineId: lines[0].id } });
    let b = null;
    let err = "";
    try {
      b = await prisma.supplier.create({ data: { name, lineId: lines[1].id } });
    } catch (e) {
      err = String(e).slice(0, 140);
    }
    if (b) console.log("PASS  same supplier name in TWO lines both register");
    else {
      fail++;
      console.log("FAIL  cross-line supplier blocked → " + err);
    }
    let dup = null;
    try {
      dup = await prisma.supplier.create({ data: { name, lineId: lines[0].id } });
    } catch {
      /* expected */
    }
    if (!dup) console.log("PASS  duplicate within the SAME line still refused");
    else {
      fail++;
      console.log("FAIL  same-line duplicate allowed");
    }
  } finally {
    await prisma.supplier.deleteMany({ where: { name } });
    console.log("cleanup: done");
    await prisma.$disconnect();
    process.exit(fail ? 1 : 0);
  }
})();
