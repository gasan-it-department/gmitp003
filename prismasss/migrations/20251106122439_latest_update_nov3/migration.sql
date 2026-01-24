-- DropForeignKey
ALTER TABLE "public"."Position" DROP CONSTRAINT "Position_departmentId_fkey";

-- DropForeignKey
ALTER TABLE "public"."Position" DROP CONSTRAINT "Position_lineId_fkey";

-- DropForeignKey
ALTER TABLE "public"."Position" DROP CONSTRAINT "Position_salaryGradeId_fkey";

-- DropForeignKey
ALTER TABLE "public"."PositionSlot" DROP CONSTRAINT "PositionSlot_salaryGradeId_fkey";

-- DropIndex
DROP INDEX "public"."User_email_key";

-- AlterTable
ALTER TABLE "Department" ADD COLUMN     "email" TEXT;

-- AlterTable
ALTER TABLE "PositionSlot" ALTER COLUMN "salaryGradeId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "PrescriptionProgress" ADD COLUMN     "comment" TEXT;

-- AddForeignKey
ALTER TABLE "Position" ADD CONSTRAINT "Position_salaryGradeId_fkey" FOREIGN KEY ("salaryGradeId") REFERENCES "SalaryGrade"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Position" ADD CONSTRAINT "Position_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "Line"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Position" ADD CONSTRAINT "Position_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PositionSlot" ADD CONSTRAINT "PositionSlot_salaryGradeId_fkey" FOREIGN KEY ("salaryGradeId") REFERENCES "SalaryGrade"("id") ON DELETE CASCADE ON UPDATE CASCADE;
