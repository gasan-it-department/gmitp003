-- AlterTable
ALTER TABLE "SupplyStockTrack" ADD COLUMN     "supplierId" TEXT;

-- AddForeignKey
ALTER TABLE "SupplyStockTrack" ADD CONSTRAINT "SupplyStockTrack_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;
