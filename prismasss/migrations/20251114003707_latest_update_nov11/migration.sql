/*
  Warnings:

  - Added the required column `filePublicId` to the `JobPostAssets` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "JobPostAssets" ADD COLUMN     "filePublicId" TEXT NOT NULL,
ALTER COLUMN "fileUrl" DROP NOT NULL;
