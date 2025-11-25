/*
  Warnings:

  - Added the required column `lineId` to the `Application` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Application" ADD COLUMN     "jobPostId" TEXT,
ADD COLUMN     "lineId" TEXT NOT NULL;

-- CreateTable
CREATE TABLE "JobPost" (
    "id" TEXT NOT NULL,
    "designation" TEXT NOT NULL,
    "salaryGradeId" TEXT,
    "hideSG" BOOLEAN NOT NULL,
    "slot" INTEGER NOT NULL,
    "showApplicationCount" BOOLEAN NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "positionId" TEXT NOT NULL,
    "location" TEXT NOT NULL,

    CONSTRAINT "JobPost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobPostRequirements" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "desc" TEXT,
    "jobPostId" TEXT,

    CONSTRAINT "JobPostRequirements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobPostAssets" (
    "id" TEXT NOT NULL,
    "fileType" TEXT NOT NULL,
    "fileSize" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "jobPostRequirementsId" TEXT,

    CONSTRAINT "JobPostAssets_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "Application" ADD CONSTRAINT "Application_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "Line"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Application" ADD CONSTRAINT "Application_jobPostId_fkey" FOREIGN KEY ("jobPostId") REFERENCES "JobPost"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobPost" ADD CONSTRAINT "JobPost_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "Position"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobPost" ADD CONSTRAINT "JobPost_salaryGradeId_fkey" FOREIGN KEY ("salaryGradeId") REFERENCES "SalaryGrade"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobPostRequirements" ADD CONSTRAINT "JobPostRequirements_jobPostId_fkey" FOREIGN KEY ("jobPostId") REFERENCES "JobPost"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobPostAssets" ADD CONSTRAINT "JobPostAssets_jobPostRequirementsId_fkey" FOREIGN KEY ("jobPostRequirementsId") REFERENCES "JobPostRequirements"("id") ON DELETE SET NULL ON UPDATE CASCADE;
