/*
  Warnings:

  - Added the required column `suppliesId` to the `SupplyOrder` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "SupplyBatchOrder" ADD COLUMN     "inventoryBoxId" TEXT,
ADD COLUMN     "title" TEXT DEFAULT 'N/A';

-- AlterTable
ALTER TABLE "SupplyOrder" ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'Pending',
ADD COLUMN     "suppliesId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "allowedBoxId" TEXT;

-- CreateTable
CREATE TABLE "InventoryBox" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "lineId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "departmentId" TEXT,

    CONSTRAINT "InventoryBox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryAccessLogs" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "inventoryBoxId" TEXT NOT NULL,
    "action" TEXT NOT NULL DEFAULT 'Viewed',
    "suppliesId" TEXT,

    CONSTRAINT "InventoryAccessLogs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplyBatch" (
    "id" TEXT NOT NULL,
    "suppliesId" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplyBatch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "InventoryBox_name_key" ON "InventoryBox"("name");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryBox_code_key" ON "InventoryBox"("code");

-- CreateIndex
CREATE UNIQUE INDEX "SupplyBatch_suppliesId_key" ON "SupplyBatch"("suppliesId");

-- AddForeignKey
ALTER TABLE "InventoryBox" ADD CONSTRAINT "InventoryBox_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "Line"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryBox" ADD CONSTRAINT "InventoryBox_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryBox" ADD CONSTRAINT "InventoryBox_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryAccessLogs" ADD CONSTRAINT "InventoryAccessLogs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryAccessLogs" ADD CONSTRAINT "InventoryAccessLogs_inventoryBoxId_fkey" FOREIGN KEY ("inventoryBoxId") REFERENCES "InventoryBox"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryAccessLogs" ADD CONSTRAINT "InventoryAccessLogs_suppliesId_fkey" FOREIGN KEY ("suppliesId") REFERENCES "Supplies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyBatch" ADD CONSTRAINT "SupplyBatch_suppliesId_fkey" FOREIGN KEY ("suppliesId") REFERENCES "Supplies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyBatchOrder" ADD CONSTRAINT "SupplyBatchOrder_inventoryBoxId_fkey" FOREIGN KEY ("inventoryBoxId") REFERENCES "InventoryBox"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyOrder" ADD CONSTRAINT "SupplyOrder_suppliesId_fkey" FOREIGN KEY ("suppliesId") REFERENCES "Supplies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_allowedBoxId_fkey" FOREIGN KEY ("allowedBoxId") REFERENCES "InventoryBox"("id") ON DELETE SET NULL ON UPDATE CASCADE;
