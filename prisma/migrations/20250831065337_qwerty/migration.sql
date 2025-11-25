-- DropForeignKey
ALTER TABLE "SupplyBatchAccess" DROP CONSTRAINT "SupplyBatchAccess_supplyBatchId_fkey";

-- DropForeignKey
ALTER TABLE "SupplyBatchAccess" DROP CONSTRAINT "SupplyBatchAccess_userId_fkey";

-- AlterTable
ALTER TABLE "SupplyBatchAccess" ADD COLUMN     "privilege" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "SupplyStockTrack" ADD COLUMN     "inventoryBoxId" TEXT,
ADD COLUMN     "supplyBatchId" TEXT;

-- AddForeignKey
ALTER TABLE "SupplyBatchAccess" ADD CONSTRAINT "SupplyBatchAccess_supplyBatchId_fkey" FOREIGN KEY ("supplyBatchId") REFERENCES "SupplyBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyBatchAccess" ADD CONSTRAINT "SupplyBatchAccess_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyStockTrack" ADD CONSTRAINT "SupplyStockTrack_supplyBatchId_fkey" FOREIGN KEY ("supplyBatchId") REFERENCES "SupplyBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyStockTrack" ADD CONSTRAINT "SupplyStockTrack_inventoryBoxId_fkey" FOREIGN KEY ("inventoryBoxId") REFERENCES "InventoryBox"("id") ON DELETE SET NULL ON UPDATE CASCADE;
