/*
  Warnings:

  - Added the required column `title` to the `MedicineNotification` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "MedicineNotification" ADD COLUMN     "title" TEXT NOT NULL,
ADD COLUMN     "type" INTEGER NOT NULL DEFAULT 1;
