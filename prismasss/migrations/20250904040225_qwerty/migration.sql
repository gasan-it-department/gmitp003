-- AlterTable
ALTER TABLE "InventoryAccessLogs" ADD COLUMN     "path" TEXT;

-- AlterTable
ALTER TABLE "SupplyOrder" ADD COLUMN     "condition" TEXT DEFAULT 'New',
ADD COLUMN     "remark" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "timestamp" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP;
