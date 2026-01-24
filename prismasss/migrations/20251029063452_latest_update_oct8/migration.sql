/*
  Warnings:

  - Added the required column `lineId` to the `Prescription` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "PrecribeMedicine" ADD COLUMN     "comments" TEXT,
ADD COLUMN     "releaseQuantity" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "Prescription" ADD COLUMN     "lineId" TEXT NOT NULL;

-- CreateTable
CREATE TABLE "MedicineTransactionItem" (
    "id" TEXT NOT NULL,
    "medicineTransactionId" TEXT NOT NULL,
    "precribeMedicineId" TEXT,
    "prescribeQuantity" INTEGER NOT NULL DEFAULT 0,
    "releasedQuantity" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "MedicineTransactionItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MedicineTransactionItem_precribeMedicineId_key" ON "MedicineTransactionItem"("precribeMedicineId");

-- AddForeignKey
ALTER TABLE "MedicineTransactionItem" ADD CONSTRAINT "MedicineTransactionItem_medicineTransactionId_fkey" FOREIGN KEY ("medicineTransactionId") REFERENCES "MedicineTransaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MedicineTransactionItem" ADD CONSTRAINT "MedicineTransactionItem_precribeMedicineId_fkey" FOREIGN KEY ("precribeMedicineId") REFERENCES "PrecribeMedicine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Prescription" ADD CONSTRAINT "Prescription_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "Line"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
