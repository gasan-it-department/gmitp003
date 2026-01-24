/*
  Warnings:

  - You are about to drop the column `medicinePriceTrackId` on the `MedicineStock` table. All the data in the column will be lost.

*/
-- DropForeignKey
ALTER TABLE "public"."MedicineStock" DROP CONSTRAINT "MedicineStock_medicinePriceTrackId_fkey";

-- AlterTable
ALTER TABLE "MedicinePriceTrack" ADD COLUMN     "medicineStockId" TEXT;

-- AlterTable
ALTER TABLE "MedicineStock" DROP COLUMN "medicinePriceTrackId";

-- AddForeignKey
ALTER TABLE "MedicinePriceTrack" ADD CONSTRAINT "MedicinePriceTrack_medicineStockId_fkey" FOREIGN KEY ("medicineStockId") REFERENCES "MedicineStock"("id") ON DELETE SET NULL ON UPDATE CASCADE;
