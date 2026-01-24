-- DropIndex
DROP INDEX "SalaryGrade_grade_key";

-- AlterTable
ALTER TABLE "Account" ADD COLUMN     "active" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "role" TEXT NOT NULL DEFAULT 'user',
ADD COLUMN     "status" INTEGER NOT NULL DEFAULT 1;
