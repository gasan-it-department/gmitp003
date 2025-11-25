-- AlterTable
ALTER TABLE "SupplyPriceTrack" ADD COLUMN     "supplyStockTrackId" TEXT;

-- AddForeignKey
ALTER TABLE "SupplyPriceTrack" ADD CONSTRAINT "SupplyPriceTrack_supplyStockTrackId_fkey" FOREIGN KEY ("supplyStockTrackId") REFERENCES "SupplyStockTrack"("id") ON DELETE SET NULL ON UPDATE CASCADE;
