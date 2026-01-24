/*
  Warnings:

  - You are about to drop the `Otp` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "Otp" DROP CONSTRAINT "Otp_submittedApplicationId_fkey";

-- DropTable
DROP TABLE "Otp";

-- CreateTable
CREATE TABLE "OtpVerification" (
    "code" INTEGER NOT NULL,
    "status" INTEGER NOT NULL DEFAULT 0,
    "dateUsed" TIMESTAMP(3),
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submittedApplicationId" TEXT,

    CONSTRAINT "OtpVerification_pkey" PRIMARY KEY ("code")
);

-- CreateIndex
CREATE UNIQUE INDEX "OtpVerification_code_key" ON "OtpVerification"("code");

-- AddForeignKey
ALTER TABLE "OtpVerification" ADD CONSTRAINT "OtpVerification_submittedApplicationId_fkey" FOREIGN KEY ("submittedApplicationId") REFERENCES "SubmittedApplication"("id") ON DELETE SET NULL ON UPDATE CASCADE;
