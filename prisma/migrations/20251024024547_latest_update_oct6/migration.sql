-- AlterTable
ALTER TABLE "MedicineStock" ADD COLUMN     "actualStock" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "threshold" INTEGER NOT NULL DEFAULT 5;
