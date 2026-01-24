/*
  Warnings:

  - A unique constraint covering the columns `[supplierId]` on the table `SupplyOrder` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "SupplyOrder" ADD COLUMN     "supplierId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "SupplyOrder_supplierId_key" ON "SupplyOrder"("supplierId");

-- AddForeignKey
ALTER TABLE "SupplyOrder" ADD CONSTRAINT "SupplyOrder_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;
