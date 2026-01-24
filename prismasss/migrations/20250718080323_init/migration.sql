/*
  Warnings:

  - You are about to drop the column `availableSlot` on the `Position` table. All the data in the column will be lost.
  - Added the required column `amount` to the `SalaryGradeHistory` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Position" DROP COLUMN "availableSlot";

-- AlterTable
ALTER TABLE "SalaryGradeHistory" ADD COLUMN     "amount" INTEGER NOT NULL;

-- CreateTable
CREATE TABLE "Accomplishment" (
    "id" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT,
    "start" TIMESTAMP(3) NOT NULL,
    "end" TIMESTAMP(3) NOT NULL,
    "task" TEXT NOT NULL,

    CONSTRAINT "Accomplishment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccomplishmentResponse" (
    "id" TEXT NOT NULL,
    "headId" TEXT NOT NULL,
    "accomplishmentId" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccomplishmentResponse_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "Accomplishment" ADD CONSTRAINT "Accomplishment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccomplishmentResponse" ADD CONSTRAINT "AccomplishmentResponse_headId_fkey" FOREIGN KEY ("headId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccomplishmentResponse" ADD CONSTRAINT "AccomplishmentResponse_accomplishmentId_fkey" FOREIGN KEY ("accomplishmentId") REFERENCES "Accomplishment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
