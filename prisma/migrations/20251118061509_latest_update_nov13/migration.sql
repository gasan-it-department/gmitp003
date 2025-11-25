/*
  Warnings:

  - Added the required column `dualCitizenHalf` to the `SubmittedApplication` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "SubmittedApplication" ADD COLUMN     "childrenIv" TEXT,
ADD COLUMN     "dualCitizenHalf" TEXT NOT NULL,
ADD COLUMN     "spouseFirstnameIv" TEXT,
ADD COLUMN     "spouseMiddleIv" TEXT,
ADD COLUMN     "spouseSurnameIv" TEXT,
ALTER COLUMN "children" SET NOT NULL,
ALTER COLUMN "children" SET DATA TYPE TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "firstNameIv" TEXT,
ADD COLUMN     "lastNameIv" TEXT;
