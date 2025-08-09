/*
  Warnings:

  - Added the required column `lineId` to the `Announcement` table without a default value. This is not possible if the table is not empty.
  - Added the required column `lineId` to the `BirthdayNoticeResponse` table without a default value. This is not possible if the table is not empty.
  - Added the required column `lineId` to the `Department` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Account" ADD COLUMN     "lineId" TEXT;

-- AlterTable
ALTER TABLE "Announcement" ADD COLUMN     "lineId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "BirthdayNoticeResponse" ADD COLUMN     "lineId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "Department" ADD COLUMN     "lineId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "Position" ADD COLUMN     "departmentId" TEXT,
ADD COLUMN     "lineId" TEXT;

-- AlterTable
ALTER TABLE "SalaryGrade" ADD COLUMN     "lineId" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "lineId" TEXT;

-- CreateTable
CREATE TABLE "Line" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "barangayId" TEXT NOT NULL,
    "municipalId" TEXT NOT NULL,
    "provinceId" TEXT NOT NULL,
    "regionId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Line_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvitationLink" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "used" BOOLEAN NOT NULL DEFAULT false,
    "url" TEXT NOT NULL,
    "lineId" TEXT NOT NULL,

    CONSTRAINT "InvitationLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Line_name_key" ON "Line"("name");

-- CreateIndex
CREATE UNIQUE INDEX "InvitationLink_code_key" ON "InvitationLink"("code");

-- AddForeignKey
ALTER TABLE "Line" ADD CONSTRAINT "Line_barangayId_fkey" FOREIGN KEY ("barangayId") REFERENCES "Barangay"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Line" ADD CONSTRAINT "Line_municipalId_fkey" FOREIGN KEY ("municipalId") REFERENCES "Municipal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Line" ADD CONSTRAINT "Line_provinceId_fkey" FOREIGN KEY ("provinceId") REFERENCES "Province"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Line" ADD CONSTRAINT "Line_regionId_fkey" FOREIGN KEY ("regionId") REFERENCES "Region"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvitationLink" ADD CONSTRAINT "InvitationLink_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "Line"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Department" ADD CONSTRAINT "Department_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "Line"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "Line"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "Line"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Position" ADD CONSTRAINT "Position_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "Line"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Position" ADD CONSTRAINT "Position_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalaryGrade" ADD CONSTRAINT "SalaryGrade_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "Line"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Announcement" ADD CONSTRAINT "Announcement_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "Line"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BirthdayNoticeResponse" ADD CONSTRAINT "BirthdayNoticeResponse_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "Line"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
