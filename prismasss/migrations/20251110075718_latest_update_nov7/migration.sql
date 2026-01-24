/*
  Warnings:

  - You are about to drop the column `positionId` on the `Application` table. All the data in the column will be lost.

*/
-- DropForeignKey
ALTER TABLE "Application" DROP CONSTRAINT "Application_positionId_fkey";

-- DropForeignKey
ALTER TABLE "PositionSlot" DROP CONSTRAINT "PositionSlot_positionId_fkey";

-- AlterTable
ALTER TABLE "Application" DROP COLUMN "positionId";

-- AlterTable
ALTER TABLE "PositionSlot" ADD COLUMN     "unitPositionId" TEXT,
ALTER COLUMN "positionId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "UnitPosition" (
    "id" TEXT NOT NULL,
    "departmentId" TEXT NOT NULL,
    "positionId" TEXT NOT NULL,
    "designation" TEXT DEFAULT 'N/A',
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lineId" TEXT NOT NULL,

    CONSTRAINT "UnitPosition_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "UnitPosition" ADD CONSTRAINT "UnitPosition_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnitPosition" ADD CONSTRAINT "UnitPosition_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "Position"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnitPosition" ADD CONSTRAINT "UnitPosition_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "Line"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PositionSlot" ADD CONSTRAINT "PositionSlot_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "Position"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PositionSlot" ADD CONSTRAINT "PositionSlot_unitPositionId_fkey" FOREIGN KEY ("unitPositionId") REFERENCES "UnitPosition"("id") ON DELETE SET NULL ON UPDATE CASCADE;
