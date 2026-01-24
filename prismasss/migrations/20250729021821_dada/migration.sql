/*
  Warnings:

  - A unique constraint covering the columns `[privilegeId]` on the table `User` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "Announcement" ADD COLUMN     "departmentId" TEXT,
ADD COLUMN     "important" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "path" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "privilegeId" TEXT;

-- CreateTable
CREATE TABLE "SupplyBatchOrder" (
    "id" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT,
    "status" INTEGER NOT NULL DEFAULT 0,
    "lineId" TEXT,

    CONSTRAINT "SupplyBatchOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplyOrderSupportFile" (
    "id" TEXT NOT NULL,
    "assetsId" TEXT NOT NULL,
    "supplyBatchOrderId" TEXT,

    CONSTRAINT "SupplyOrderSupportFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplyOrder" (
    "id" TEXT NOT NULL,
    "supplyBatchOrderId" TEXT,

    CONSTRAINT "SupplyOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Application" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "positionId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Application_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Privilege" (
    "id" TEXT NOT NULL,
    "humanResources" BOOLEAN NOT NULL DEFAULT false,
    "inventory" BOOLEAN NOT NULL DEFAULT false,
    "super" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Privilege_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_privilegeId_key" ON "User"("privilegeId");

-- AddForeignKey
ALTER TABLE "SupplyBatchOrder" ADD CONSTRAINT "SupplyBatchOrder_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyBatchOrder" ADD CONSTRAINT "SupplyBatchOrder_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "Line"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyOrderSupportFile" ADD CONSTRAINT "SupplyOrderSupportFile_assetsId_fkey" FOREIGN KEY ("assetsId") REFERENCES "Assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyOrderSupportFile" ADD CONSTRAINT "SupplyOrderSupportFile_supplyBatchOrderId_fkey" FOREIGN KEY ("supplyBatchOrderId") REFERENCES "SupplyBatchOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyOrder" ADD CONSTRAINT "SupplyOrder_supplyBatchOrderId_fkey" FOREIGN KEY ("supplyBatchOrderId") REFERENCES "SupplyBatchOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Application" ADD CONSTRAINT "Application_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Application" ADD CONSTRAINT "Application_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "Position"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_privilegeId_fkey" FOREIGN KEY ("privilegeId") REFERENCES "Privilege"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Announcement" ADD CONSTRAINT "Announcement_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;
