-- DropForeignKey
ALTER TABLE "public"."Prescription" DROP CONSTRAINT "Prescription_respondedByUserId_fkey";

-- AlterTable
ALTER TABLE "Prescription" ADD COLUMN     "age" TEXT NOT NULL DEFAULT 'N/A',
ALTER COLUMN "respondedByUserId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "Prescription" ADD CONSTRAINT "Prescription_respondedByUserId_fkey" FOREIGN KEY ("respondedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
