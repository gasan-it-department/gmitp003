/*
  Warnings:

  - A unique constraint covering the columns `[refNumber]` on the table `Supplies` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "Supplies" ADD COLUMN     "refNumber" TEXT;

-- AlterTable
ALTER TABLE "SupplyBatchOrder" ADD COLUMN     "supplyBatchId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Supplies_refNumber_key" ON "Supplies"("refNumber");

-- AddForeignKey
ALTER TABLE "SupplyBatchOrder" ADD CONSTRAINT "SupplyBatchOrder_supplyBatchId_fkey" FOREIGN KEY ("supplyBatchId") REFERENCES "SupplyBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
