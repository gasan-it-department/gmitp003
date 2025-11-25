-- DropForeignKey
ALTER TABLE "public"."MedicineTransaction" DROP CONSTRAINT "MedicineTransaction_medicineStorageId_fkey";

-- AlterTable
ALTER TABLE "MedicineTransaction" ALTER COLUMN "medicineStorageId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "MedicineTransaction" ADD CONSTRAINT "MedicineTransaction_medicineStorageId_fkey" FOREIGN KEY ("medicineStorageId") REFERENCES "MedicineStorage"("id") ON DELETE SET NULL ON UPDATE CASCADE;
