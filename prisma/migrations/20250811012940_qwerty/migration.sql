/*
  Warnings:

  - You are about to drop the column `refNumber` on the `SupplyOrder` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[refNumber]` on the table `SupplyBatchOrder` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `refNumber` to the `SupplyBatchOrder` table without a default value. This is not possible if the table is not empty.

*/
-- DropIndex
DROP INDEX "SupplyOrder_refNumber_key";

-- AlterTable
ALTER TABLE "SupplyBatchOrder" ADD COLUMN     "refNumber" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "SupplyOrder" DROP COLUMN "refNumber";

-- CreateIndex
CREATE UNIQUE INDEX "SupplyBatchOrder_refNumber_key" ON "SupplyBatchOrder"("refNumber");
