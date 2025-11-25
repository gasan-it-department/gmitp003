/*
  Warnings:

  - A unique constraint covering the columns `[refNumber]` on the table `SupplyOrder` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `refNumber` to the `SupplyOrder` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "SupplyOrder" ADD COLUMN     "refNumber" TEXT NOT NULL,
ADD COLUMN     "subject" TEXT DEFAULT 'None',
ALTER COLUMN "status" SET DEFAULT 'Drafted';

-- CreateTable
CREATE TABLE "SupplyBrand" (
    "id" TEXT NOT NULL,
    "suppliesId" TEXT,

    CONSTRAINT "SupplyBrand_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplyOrderReturn" (
    "id" TEXT NOT NULL,
    "supplyBatchOrderId" TEXT NOT NULL,
    "status" INTEGER NOT NULL DEFAULT 0,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplyOrderReturn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplyOrderItemReturn" (
    "id" TEXT NOT NULL,
    "supplyOrderReturnId" TEXT,
    "supplyBrandId" TEXT,
    "suppliesId" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "SupplyOrderItemReturn_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SupplyOrder_refNumber_key" ON "SupplyOrder"("refNumber");

-- AddForeignKey
ALTER TABLE "SupplyBrand" ADD CONSTRAINT "SupplyBrand_suppliesId_fkey" FOREIGN KEY ("suppliesId") REFERENCES "Supplies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyOrderReturn" ADD CONSTRAINT "SupplyOrderReturn_supplyBatchOrderId_fkey" FOREIGN KEY ("supplyBatchOrderId") REFERENCES "SupplyBatchOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyOrderItemReturn" ADD CONSTRAINT "SupplyOrderItemReturn_suppliesId_fkey" FOREIGN KEY ("suppliesId") REFERENCES "Supplies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyOrderItemReturn" ADD CONSTRAINT "SupplyOrderItemReturn_supplyOrderReturnId_fkey" FOREIGN KEY ("supplyOrderReturnId") REFERENCES "SupplyOrderReturn"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyOrderItemReturn" ADD CONSTRAINT "SupplyOrderItemReturn_supplyBrandId_fkey" FOREIGN KEY ("supplyBrandId") REFERENCES "SupplyBrand"("id") ON DELETE SET NULL ON UPDATE CASCADE;
