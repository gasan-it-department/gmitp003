-- AlterTable
ALTER TABLE "JobPost" ADD COLUMN     "lineId" TEXT;

-- AddForeignKey
ALTER TABLE "JobPost" ADD CONSTRAINT "JobPost_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "Line"("id") ON DELETE CASCADE ON UPDATE CASCADE;
