-- DropForeignKey
ALTER TABLE "HumanResourcesLogs" DROP CONSTRAINT "HumanResourcesLogs_lineId_fkey";

-- DropForeignKey
ALTER TABLE "PositionSlot" DROP CONSTRAINT "PositionSlot_unitPositionId_fkey";

-- AlterTable
ALTER TABLE "UnitPosition" ADD COLUMN     "plantilla" BOOLEAN NOT NULL DEFAULT false;

-- AddForeignKey
ALTER TABLE "PositionSlot" ADD CONSTRAINT "PositionSlot_unitPositionId_fkey" FOREIGN KEY ("unitPositionId") REFERENCES "UnitPosition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HumanResourcesLogs" ADD CONSTRAINT "HumanResourcesLogs_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "Line"("id") ON DELETE CASCADE ON UPDATE CASCADE;
