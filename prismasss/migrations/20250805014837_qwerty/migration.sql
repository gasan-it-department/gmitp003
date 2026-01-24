-- DropForeignKey
ALTER TABLE "Announcement" DROP CONSTRAINT "Announcement_authorId_fkey";

-- DropForeignKey
ALTER TABLE "Application" DROP CONSTRAINT "Application_positionId_fkey";

-- DropForeignKey
ALTER TABLE "Application" DROP CONSTRAINT "Application_userId_fkey";

-- DropForeignKey
ALTER TABLE "ContainerAllowedUser" DROP CONSTRAINT "ContainerAllowedUser_userId_fkey";

-- DropForeignKey
ALTER TABLE "InventoryAccessLogs" DROP CONSTRAINT "InventoryAccessLogs_inventoryBoxId_fkey";

-- DropForeignKey
ALTER TABLE "InvitationLink" DROP CONSTRAINT "InvitationLink_lineId_fkey";

-- DropForeignKey
ALTER TABLE "LogRecord" DROP CONSTRAINT "LogRecord_userId_fkey";

-- DropForeignKey
ALTER TABLE "Notification" DROP CONSTRAINT "Notification_recipientId_fkey";

-- DropForeignKey
ALTER TABLE "Notification" DROP CONSTRAINT "Notification_senderId_fkey";

-- DropForeignKey
ALTER TABLE "ProfilePicture" DROP CONSTRAINT "ProfilePicture_userId_fkey";

-- DropForeignKey
ALTER TABLE "Promotion" DROP CONSTRAINT "Promotion_userId_fkey";

-- DropForeignKey
ALTER TABLE "SalaryGradeHistory" DROP CONSTRAINT "SalaryGradeHistory_salaryGradeId_fkey";

-- DropForeignKey
ALTER TABLE "SupplieRecieveHistory" DROP CONSTRAINT "SupplieRecieveHistory_suppliesId_fkey";

-- DropForeignKey
ALTER TABLE "SuppliesRecord" DROP CONSTRAINT "SuppliesRecord_suppliesId_fkey";

-- DropForeignKey
ALTER TABLE "SupplyPriceTrack" DROP CONSTRAINT "SupplyPriceTrack_suppliesId_fkey";

-- DropIndex
DROP INDEX "Supplies_suppliesQualityId_key";

-- AlterTable
ALTER TABLE "ContainerAllowedUser" ALTER COLUMN "userId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "InventoryAccessLogs" ALTER COLUMN "inventoryBoxId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Supplies" ADD COLUMN     "notifyAtStockOf" INTEGER NOT NULL DEFAULT 10;

-- AlterTable
ALTER TABLE "SuppliesQuality" ADD COLUMN     "suppliesDataSetId" TEXT;

-- AlterTable
ALTER TABLE "SupplyBatch" ADD COLUMN     "suppliesDataSetId" TEXT;

-- CreateTable
CREATE TABLE "SuppliesDataSet" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lineId" TEXT NOT NULL,
    "inventoryBoxId" TEXT NOT NULL,

    CONSTRAINT "SuppliesDataSet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplyStockTrack" (
    "id" TEXT NOT NULL,
    "stock" INTEGER NOT NULL DEFAULT 0,
    "suppliesId" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplyStockTrack_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SuppliesDataSet_title_key" ON "SuppliesDataSet"("title");

-- AddForeignKey
ALTER TABLE "InvitationLink" ADD CONSTRAINT "InvitationLink_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "Line"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfilePicture" ADD CONSTRAINT "ProfilePicture_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContainerAllowedUser" ADD CONSTRAINT "ContainerAllowedUser_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryAccessLogs" ADD CONSTRAINT "InventoryAccessLogs_inventoryBoxId_fkey" FOREIGN KEY ("inventoryBoxId") REFERENCES "InventoryBox"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyBatch" ADD CONSTRAINT "SupplyBatch_suppliesDataSetId_fkey" FOREIGN KEY ("suppliesDataSetId") REFERENCES "SuppliesDataSet"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SuppliesDataSet" ADD CONSTRAINT "SuppliesDataSet_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "Line"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SuppliesDataSet" ADD CONSTRAINT "SuppliesDataSet_inventoryBoxId_fkey" FOREIGN KEY ("inventoryBoxId") REFERENCES "InventoryBox"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SuppliesQuality" ADD CONSTRAINT "SuppliesQuality_suppliesDataSetId_fkey" FOREIGN KEY ("suppliesDataSetId") REFERENCES "SuppliesDataSet"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyPriceTrack" ADD CONSTRAINT "SupplyPriceTrack_suppliesId_fkey" FOREIGN KEY ("suppliesId") REFERENCES "Supplies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyStockTrack" ADD CONSTRAINT "SupplyStockTrack_suppliesId_fkey" FOREIGN KEY ("suppliesId") REFERENCES "Supplies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplieRecieveHistory" ADD CONSTRAINT "SupplieRecieveHistory_suppliesId_fkey" FOREIGN KEY ("suppliesId") REFERENCES "Supplies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SuppliesRecord" ADD CONSTRAINT "SuppliesRecord_suppliesId_fkey" FOREIGN KEY ("suppliesId") REFERENCES "Supplies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Application" ADD CONSTRAINT "Application_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Application" ADD CONSTRAINT "Application_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "Position"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LogRecord" ADD CONSTRAINT "LogRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalaryGradeHistory" ADD CONSTRAINT "SalaryGradeHistory_salaryGradeId_fkey" FOREIGN KEY ("salaryGradeId") REFERENCES "SalaryGrade"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Announcement" ADD CONSTRAINT "Announcement_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Promotion" ADD CONSTRAINT "Promotion_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
