-- DropIndex
DROP INDEX "id_idx";

-- AlterTable
ALTER TABLE "InventoryAccessLogs" ALTER COLUMN "timestamp" SET DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "Supplies" ADD COLUMN     "inventoryBoxId" TEXT;

-- AlterTable
ALTER TABLE "SupplyBrand" ADD COLUMN     "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateTable
CREATE TABLE "SupplyBatchAccess" (
    "id" TEXT NOT NULL,
    "supplyBatchId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplyBatchAccess_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "department_idx" ON "User"("departmentId");

-- CreateIndex
CREATE INDEX "User_firstName_lastName_idx" ON "User"("firstName", "lastName");

-- AddForeignKey
ALTER TABLE "Supplies" ADD CONSTRAINT "Supplies_inventoryBoxId_fkey" FOREIGN KEY ("inventoryBoxId") REFERENCES "InventoryBox"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyBatchAccess" ADD CONSTRAINT "SupplyBatchAccess_supplyBatchId_fkey" FOREIGN KEY ("supplyBatchId") REFERENCES "SupplyBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyBatchAccess" ADD CONSTRAINT "SupplyBatchAccess_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
