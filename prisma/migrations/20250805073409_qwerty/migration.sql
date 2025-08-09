-- AlterTable
ALTER TABLE "Supplies" ADD COLUMN     "suppliesDataSetId" TEXT;

-- AddForeignKey
ALTER TABLE "Supplies" ADD CONSTRAINT "Supplies_suppliesDataSetId_fkey" FOREIGN KEY ("suppliesDataSetId") REFERENCES "SuppliesDataSet"("id") ON DELETE CASCADE ON UPDATE CASCADE;
