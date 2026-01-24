-- AlterTable
ALTER TABLE "SupplyBrand" ADD COLUMN     "brand" TEXT DEFAULT 'N/A',
ADD COLUMN     "model" TEXT DEFAULT 'N/A',
ADD COLUMN     "supplyStockTrackId" TEXT;

-- AlterTable
ALTER TABLE "SupplyOrder" ADD COLUMN     "comments" TEXT DEFAULT 'N/A';

-- AddForeignKey
ALTER TABLE "SupplyBrand" ADD CONSTRAINT "SupplyBrand_supplyStockTrackId_fkey" FOREIGN KEY ("supplyStockTrackId") REFERENCES "SupplyStockTrack"("id") ON DELETE SET NULL ON UPDATE CASCADE;
