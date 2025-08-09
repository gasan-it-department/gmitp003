-- AlterTable
ALTER TABLE "Department" ADD COLUMN     "idCode" TEXT DEFAULT 'N/A';

-- AlterTable
ALTER TABLE "Position" ADD COLUMN     "availableSlot" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "max" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "plantilla" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "salaryGradeId" TEXT;

-- CreateTable
CREATE TABLE "PositionSlot" (
    "id" TEXT NOT NULL,
    "positionId" TEXT NOT NULL,
    "salaryGradeId" TEXT NOT NULL,
    "userId" TEXT,

    CONSTRAINT "PositionSlot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PositionSlot_userId_key" ON "PositionSlot"("userId");

-- AddForeignKey
ALTER TABLE "Position" ADD CONSTRAINT "Position_salaryGradeId_fkey" FOREIGN KEY ("salaryGradeId") REFERENCES "SalaryGrade"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PositionSlot" ADD CONSTRAINT "PositionSlot_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "Position"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PositionSlot" ADD CONSTRAINT "PositionSlot_salaryGradeId_fkey" FOREIGN KEY ("salaryGradeId") REFERENCES "SalaryGrade"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PositionSlot" ADD CONSTRAINT "PositionSlot_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
