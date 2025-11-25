/*
  Warnings:

  - Added the required column `status` to the `JobPost` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "JobPost" ADD COLUMN     "desc" TEXT DEFAULT 'N/A',
ADD COLUMN     "status" INTEGER NOT NULL,
ADD COLUMN     "updateAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateTable
CREATE TABLE "LineGeneralAssets" (
    "id" TEXT NOT NULL,
    "file_url" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "file_size" TEXT NOT NULL,
    "file_type" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lineId" TEXT NOT NULL,

    CONSTRAINT "LineGeneralAssets_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "LineGeneralAssets" ADD CONSTRAINT "LineGeneralAssets_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "Line"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
