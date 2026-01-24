/*
  Warnings:

  - You are about to drop the column `allowedBoxId` on the `User` table. All the data in the column will be lost.
  - Added the required column `inventoryBoxId` to the `SupplyBatch` table without a default value. This is not possible if the table is not empty.
  - Added the required column `title` to the `SupplyBatch` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "User" DROP CONSTRAINT "User_allowedBoxId_fkey";

-- AlterTable
ALTER TABLE "InventoryBox" ALTER COLUMN "createdAt" SET DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "SupplyBatch" ADD COLUMN     "inventoryBoxId" TEXT NOT NULL,
ADD COLUMN     "title" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "User" DROP COLUMN "allowedBoxId";

-- CreateTable
CREATE TABLE "ContainerAllowedUser" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "inventoryBoxId" TEXT NOT NULL,
    "grantByUserId" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContainerAllowedUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplyBatchItem" (
    "id" TEXT NOT NULL,
    "supplyBatchId" TEXT NOT NULL,
    "suppliesId" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplyBatchItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplyPriceTrack" (
    "id" TEXT NOT NULL,
    "value" INTEGER NOT NULL DEFAULT 0,
    "suppliesId" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplyPriceTrack_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SupplyBatchItem_suppliesId_key" ON "SupplyBatchItem"("suppliesId");

-- CreateIndex
CREATE INDEX "id_idx" ON "User"("id");

-- AddForeignKey
ALTER TABLE "ContainerAllowedUser" ADD CONSTRAINT "ContainerAllowedUser_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContainerAllowedUser" ADD CONSTRAINT "ContainerAllowedUser_inventoryBoxId_fkey" FOREIGN KEY ("inventoryBoxId") REFERENCES "InventoryBox"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContainerAllowedUser" ADD CONSTRAINT "ContainerAllowedUser_grantByUserId_fkey" FOREIGN KEY ("grantByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyBatch" ADD CONSTRAINT "SupplyBatch_inventoryBoxId_fkey" FOREIGN KEY ("inventoryBoxId") REFERENCES "InventoryBox"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyBatchItem" ADD CONSTRAINT "SupplyBatchItem_supplyBatchId_fkey" FOREIGN KEY ("supplyBatchId") REFERENCES "SupplyBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyBatchItem" ADD CONSTRAINT "SupplyBatchItem_suppliesId_fkey" FOREIGN KEY ("suppliesId") REFERENCES "Supplies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyPriceTrack" ADD CONSTRAINT "SupplyPriceTrack_suppliesId_fkey" FOREIGN KEY ("suppliesId") REFERENCES "Supplies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
