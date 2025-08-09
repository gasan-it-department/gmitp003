-- DropForeignKey
ALTER TABLE "Department" DROP CONSTRAINT "Department_lineId_fkey";

-- DropIndex
DROP INDEX "InvitationLink_code_key";

-- AlterTable
ALTER TABLE "Department" ALTER COLUMN "lineId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "Assets" (
    "id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "fileSize" TEXT NOT NULL,
    "fileType" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "suppliesId" TEXT,

    CONSTRAINT "Assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Supplies" (
    "id" TEXT NOT NULL,
    "item" TEXT NOT NULL,
    "description" TEXT DEFAULT 'N/A',
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lineId" TEXT NOT NULL,
    "userId" TEXT,
    "condition" TEXT DEFAULT 'New',
    "status" TEXT DEFAULT 'Available',

    CONSTRAINT "Supplies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TransferredSupplies" (
    "id" TEXT NOT NULL,
    "suppliesId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "transferredToId" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "condition" TEXT DEFAULT 'New',

    CONSTRAINT "TransferredSupplies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SuppliesRecord" (
    "id" TEXT NOT NULL,
    "suppliesId" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "description" TEXT,
    "modifiedId" TEXT,

    CONSTRAINT "SuppliesRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LogRecord" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LogRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SuppliesRecord_modifiedId_key" ON "SuppliesRecord"("modifiedId");

-- AddForeignKey
ALTER TABLE "Assets" ADD CONSTRAINT "Assets_suppliesId_fkey" FOREIGN KEY ("suppliesId") REFERENCES "Supplies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Supplies" ADD CONSTRAINT "Supplies_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "Line"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Supplies" ADD CONSTRAINT "Supplies_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransferredSupplies" ADD CONSTRAINT "TransferredSupplies_suppliesId_fkey" FOREIGN KEY ("suppliesId") REFERENCES "Supplies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransferredSupplies" ADD CONSTRAINT "TransferredSupplies_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransferredSupplies" ADD CONSTRAINT "TransferredSupplies_transferredToId_fkey" FOREIGN KEY ("transferredToId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SuppliesRecord" ADD CONSTRAINT "SuppliesRecord_suppliesId_fkey" FOREIGN KEY ("suppliesId") REFERENCES "Supplies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SuppliesRecord" ADD CONSTRAINT "SuppliesRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SuppliesRecord" ADD CONSTRAINT "SuppliesRecord_modifiedId_fkey" FOREIGN KEY ("modifiedId") REFERENCES "Supplies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Department" ADD CONSTRAINT "Department_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "Line"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LogRecord" ADD CONSTRAINT "LogRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
