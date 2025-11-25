/*
  Warnings:

  - Added the required column `lineId` to the `MedicineStock` table without a default value. This is not possible if the table is not empty.
  - Added the required column `lineId` to the `MedicineTransaction` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "MedicineLogs" ADD COLUMN     "lineId" TEXT;

-- AlterTable
ALTER TABLE "MedicineStock" ADD COLUMN     "lineId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "MedicineTransaction" ADD COLUMN     "lineId" TEXT NOT NULL;

-- AddForeignKey
ALTER TABLE "MedicineLogs" ADD CONSTRAINT "MedicineLogs_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "Line"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MedicineTransaction" ADD CONSTRAINT "MedicineTransaction_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "Line"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MedicineStock" ADD CONSTRAINT "MedicineStock_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "Line"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
