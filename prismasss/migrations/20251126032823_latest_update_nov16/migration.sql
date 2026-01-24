-- AlterTable
ALTER TABLE "Otp" ADD COLUMN     "dateUsed" TIMESTAMP(3),
ADD COLUMN     "submittedApplicationId" TEXT;

-- AddForeignKey
ALTER TABLE "Otp" ADD CONSTRAINT "Otp_submittedApplicationId_fkey" FOREIGN KEY ("submittedApplicationId") REFERENCES "SubmittedApplication"("id") ON DELETE SET NULL ON UPDATE CASCADE;
