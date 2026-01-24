/*
  Warnings:

  - Added the required column `lineId` to the `MedicineNotification` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "MedicineNotification" ADD COLUMN     "lineId" TEXT NOT NULL,
ALTER COLUMN "view" SET DEFAULT 0;

-- AddForeignKey
ALTER TABLE "MedicineNotification" ADD CONSTRAINT "MedicineNotification_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "Line"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
