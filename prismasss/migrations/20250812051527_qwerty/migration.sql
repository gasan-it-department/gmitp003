-- AlterTable
ALTER TABLE "Supplies" ADD COLUMN     "supplierId" TEXT;

-- AlterTable
ALTER TABLE "SupplyOrder" ADD COLUMN     "desc" TEXT DEFAULT 'None';

-- CreateTable
CREATE TABLE "Supplier" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "Supplies" ADD CONSTRAINT "Supplies_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;
