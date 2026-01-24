/*
  Warnings:

  - You are about to drop the column `suppliesId` on the `SupplyBatch` table. All the data in the column will be lost.

*/
-- DropForeignKey
ALTER TABLE "SupplyBatch" DROP CONSTRAINT "SupplyBatch_suppliesId_fkey";

-- DropForeignKey
ALTER TABLE "TransferredSupplies" DROP CONSTRAINT "TransferredSupplies_suppliesId_fkey";

-- DropIndex
DROP INDEX "SupplyBatch_suppliesId_key";

-- AlterTable
ALTER TABLE "SupplyBatch" DROP COLUMN "suppliesId";

-- AlterTable
ALTER TABLE "TransferredSupplies" ALTER COLUMN "suppliesId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "TransferredSupplies" ADD CONSTRAINT "TransferredSupplies_suppliesId_fkey" FOREIGN KEY ("suppliesId") REFERENCES "Supplies"("id") ON DELETE SET NULL ON UPDATE CASCADE;
