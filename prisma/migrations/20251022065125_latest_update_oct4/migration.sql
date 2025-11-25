/*
  Warnings:

  - Added the required column `lineId` to the `Medicine` table without a default value. This is not possible if the table is not empty.
  - Added the required column `view` to the `MedicineNotification` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Medicine" ADD COLUMN     "lineId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "MedicineNotification" ADD COLUMN     "path" TEXT,
ADD COLUMN     "phase" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "view" INTEGER NOT NULL;

-- AlterTable
ALTER TABLE "MedicineStorage" ADD COLUMN     "status" INTEGER NOT NULL DEFAULT 1;

-- AddForeignKey
ALTER TABLE "Medicine" ADD CONSTRAINT "Medicine_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "Line"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
