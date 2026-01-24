/*
  Warnings:

  - You are about to drop the column `designation` on the `JobPost` table. All the data in the column will be lost.

*/
-- DropForeignKey
ALTER TABLE "public"."JobPost" DROP CONSTRAINT "JobPost_positionId_fkey";

-- DropForeignKey
ALTER TABLE "public"."JobPostAssets" DROP CONSTRAINT "JobPostAssets_jobPostRequirementsId_fkey";

-- DropForeignKey
ALTER TABLE "public"."Medicine" DROP CONSTRAINT "Medicine_lineId_fkey";

-- DropForeignKey
ALTER TABLE "public"."MedicineHistory" DROP CONSTRAINT "MedicineHistory_medicineId_fkey";

-- DropForeignKey
ALTER TABLE "public"."MedicineLogs" DROP CONSTRAINT "MedicineLogs_lineId_fkey";

-- DropForeignKey
ALTER TABLE "public"."MedicineNotification" DROP CONSTRAINT "MedicineNotification_lineId_fkey";

-- DropForeignKey
ALTER TABLE "public"."MedicinePriceTrack" DROP CONSTRAINT "MedicinePriceTrack_medicineStockId_fkey";

-- DropForeignKey
ALTER TABLE "public"."MedicineQuality" DROP CONSTRAINT "MedicineQuality_medicineStockId_fkey";

-- DropForeignKey
ALTER TABLE "public"."MedicineStorage" DROP CONSTRAINT "MedicineStorage_departmentId_fkey";

-- DropForeignKey
ALTER TABLE "public"."MedicineStorage" DROP CONSTRAINT "MedicineStorage_lineId_fkey";

-- DropForeignKey
ALTER TABLE "public"."MedicineTrack" DROP CONSTRAINT "MedicineTrack_medicineId_fkey";

-- DropForeignKey
ALTER TABLE "public"."MedicineTransaction" DROP CONSTRAINT "MedicineTransaction_lineId_fkey";

-- DropForeignKey
ALTER TABLE "public"."MedicineTransaction" DROP CONSTRAINT "MedicineTransaction_userId_fkey";

-- DropForeignKey
ALTER TABLE "public"."MedicineTransactionItem" DROP CONSTRAINT "MedicineTransactionItem_medicineTransactionId_fkey";

-- DropForeignKey
ALTER TABLE "public"."PrecribeMedicine" DROP CONSTRAINT "PrecribeMedicine_medicineId_fkey";

-- DropForeignKey
ALTER TABLE "public"."PrecribeMedicine" DROP CONSTRAINT "PrecribeMedicine_prescriptionId_fkey";

-- DropForeignKey
ALTER TABLE "public"."Prescription" DROP CONSTRAINT "Prescription_barangayId_fkey";

-- DropForeignKey
ALTER TABLE "public"."Prescription" DROP CONSTRAINT "Prescription_municipalId_fkey";

-- DropForeignKey
ALTER TABLE "public"."Prescription" DROP CONSTRAINT "Prescription_provinceId_fkey";

-- DropForeignKey
ALTER TABLE "public"."Prescription" DROP CONSTRAINT "Prescription_respondedByUserId_fkey";

-- DropForeignKey
ALTER TABLE "public"."PrescriptionAsset" DROP CONSTRAINT "PrescriptionAsset_prescriptionId_fkey";

-- DropForeignKey
ALTER TABLE "public"."PrescriptionComment" DROP CONSTRAINT "PrescriptionComment_prescriptionId_fkey";

-- DropForeignKey
ALTER TABLE "public"."PrescriptionProgress" DROP CONSTRAINT "PrescriptionProgress_prescriptionId_fkey";

-- AlterTable
ALTER TABLE "JobPost" DROP COLUMN "designation",
ALTER COLUMN "hideSG" SET DEFAULT false;

-- AlterTable
ALTER TABLE "MedicineTransaction" ALTER COLUMN "userId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "PositionSlot" ADD COLUMN     "occupied" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "PrecribeMedicine" ALTER COLUMN "medicineId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Prescription" ALTER COLUMN "barangayId" DROP NOT NULL,
ALTER COLUMN "municipalId" DROP NOT NULL,
ALTER COLUMN "provinceId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "ApplicationInquiry" (
    "id" TEXT NOT NULL,
    "jobPostId" TEXT NOT NULL,

    CONSTRAINT "ApplicationInquiry_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "MedicineStorage" ADD CONSTRAINT "MedicineStorage_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET DEFAULT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MedicineStorage" ADD CONSTRAINT "MedicineStorage_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "Line"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MedicineNotification" ADD CONSTRAINT "MedicineNotification_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "Line"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MedicineLogs" ADD CONSTRAINT "MedicineLogs_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "Line"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Medicine" ADD CONSTRAINT "Medicine_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "Line"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MedicineTransaction" ADD CONSTRAINT "MedicineTransaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MedicineTransaction" ADD CONSTRAINT "MedicineTransaction_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "Line"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MedicineTransactionItem" ADD CONSTRAINT "MedicineTransactionItem_medicineTransactionId_fkey" FOREIGN KEY ("medicineTransactionId") REFERENCES "MedicineTransaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MedicineQuality" ADD CONSTRAINT "MedicineQuality_medicineStockId_fkey" FOREIGN KEY ("medicineStockId") REFERENCES "MedicineStock"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MedicineTrack" ADD CONSTRAINT "MedicineTrack_medicineId_fkey" FOREIGN KEY ("medicineId") REFERENCES "Medicine"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MedicineHistory" ADD CONSTRAINT "MedicineHistory_medicineId_fkey" FOREIGN KEY ("medicineId") REFERENCES "Medicine"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MedicinePriceTrack" ADD CONSTRAINT "MedicinePriceTrack_medicineStockId_fkey" FOREIGN KEY ("medicineStockId") REFERENCES "MedicineStock"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Prescription" ADD CONSTRAINT "Prescription_barangayId_fkey" FOREIGN KEY ("barangayId") REFERENCES "Barangay"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Prescription" ADD CONSTRAINT "Prescription_municipalId_fkey" FOREIGN KEY ("municipalId") REFERENCES "Municipal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Prescription" ADD CONSTRAINT "Prescription_provinceId_fkey" FOREIGN KEY ("provinceId") REFERENCES "Province"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Prescription" ADD CONSTRAINT "Prescription_respondedByUserId_fkey" FOREIGN KEY ("respondedByUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrescriptionAsset" ADD CONSTRAINT "PrescriptionAsset_prescriptionId_fkey" FOREIGN KEY ("prescriptionId") REFERENCES "Prescription"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrescriptionProgress" ADD CONSTRAINT "PrescriptionProgress_prescriptionId_fkey" FOREIGN KEY ("prescriptionId") REFERENCES "Prescription"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrescriptionComment" ADD CONSTRAINT "PrescriptionComment_prescriptionId_fkey" FOREIGN KEY ("prescriptionId") REFERENCES "Prescription"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrecribeMedicine" ADD CONSTRAINT "PrecribeMedicine_medicineId_fkey" FOREIGN KEY ("medicineId") REFERENCES "Medicine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrecribeMedicine" ADD CONSTRAINT "PrecribeMedicine_prescriptionId_fkey" FOREIGN KEY ("prescriptionId") REFERENCES "Prescription"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobPost" ADD CONSTRAINT "JobPost_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "Position"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobPostAssets" ADD CONSTRAINT "JobPostAssets_jobPostRequirementsId_fkey" FOREIGN KEY ("jobPostRequirementsId") REFERENCES "JobPostRequirements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApplicationInquiry" ADD CONSTRAINT "ApplicationInquiry_jobPostId_fkey" FOREIGN KEY ("jobPostId") REFERENCES "JobPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;
