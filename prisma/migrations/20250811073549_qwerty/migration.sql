/*
  Warnings:

  - A unique constraint covering the columns `[refNumber]` on the table `SupplyOrder` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `refNumber` to the `SupplyOrder` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "SupplyOrder" ADD COLUMN     "refNumber" TEXT NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "SupplyOrder_refNumber_key" ON "SupplyOrder"("refNumber");
