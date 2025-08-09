/*
  Warnings:

  - A unique constraint covering the columns `[code]` on the table `Supplies` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `suppliesQualityId` to the `SupplyOrder` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Supplies" ADD COLUMN     "code" SERIAL NOT NULL,
ADD COLUMN     "consumable" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "SupplyOrder" ADD COLUMN     "quantity" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "suppliesQualityId" TEXT NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Supplies_code_key" ON "Supplies"("code");

-- AddForeignKey
ALTER TABLE "SupplyOrder" ADD CONSTRAINT "SupplyOrder_suppliesQualityId_fkey" FOREIGN KEY ("suppliesQualityId") REFERENCES "SuppliesQuality"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
