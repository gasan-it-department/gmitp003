/*
  Warnings:

  - The `condition` column on the `TransferredSupplies` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - Added the required column `file_url_Iv` to the `ApplicationAttachedFile` table without a default value. This is not possible if the table is not empty.
  - Added the required column `messageIv` to the `ApplicationConversation` table without a default value. This is not possible if the table is not empty.
  - Added the required column `subjectIv` to the `MessageTemplate` table without a default value. This is not possible if the table is not empty.
  - Added the required column `firsntameIv` to the `SubmittedApplication` table without a default value. This is not possible if the table is not empty.
  - Added the required column `ivMobileNo` to the `SubmittedApplication` table without a default value. This is not possible if the table is not empty.
  - Added the required column `lastnameIv` to the `SubmittedApplication` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "ApplicationAttachedFile" ADD COLUMN     "file_url_Iv" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "ApplicationConversation" ADD COLUMN     "messageIv" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "ApplicationProfilePic" ADD COLUMN     "file_url_Iv" TEXT;

-- AlterTable
ALTER TABLE "ApplicationResponse" ADD COLUMN     "messageIv" TEXT,
ADD COLUMN     "titleIv" TEXT;

-- AlterTable
ALTER TABLE "MessageTemplate" ADD COLUMN     "messageIv" TEXT,
ADD COLUMN     "subjectIv" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "SubmittedApplication" ADD COLUMN     "agencyNoIv" TEXT,
ADD COLUMN     "bdayIv" TEXT,
ADD COLUMN     "cvilStatusIv" TEXT,
ADD COLUMN     "emailIv" TEXT,
ADD COLUMN     "fatherFirstnameIv" TEXT,
ADD COLUMN     "fatherMiddlenameIv" TEXT,
ADD COLUMN     "fatherOccupationIv" TEXT,
ADD COLUMN     "fatherSurnameIv" TEXT,
ADD COLUMN     "firsntameIv" TEXT NOT NULL,
ADD COLUMN     "govIdIv" TEXT,
ADD COLUMN     "ivMobileNo" TEXT NOT NULL,
ADD COLUMN     "lastnameIv" TEXT NOT NULL,
ADD COLUMN     "middleNameIv" TEXT,
ADD COLUMN     "motherFirstnameIv" TEXT,
ADD COLUMN     "motherMiddlenameIv" TEXT,
ADD COLUMN     "motherSurnameIv" TEXT,
ADD COLUMN     "pagIbigNoIv" TEXT,
ADD COLUMN     "permaBarangayIv" TEXT,
ADD COLUMN     "permaCityIv" TEXT,
ADD COLUMN     "permaProvinceIv" TEXT,
ADD COLUMN     "permaStreetIv" TEXT,
ADD COLUMN     "permaSubIv" TEXT,
ADD COLUMN     "permaZipCodeIv" TEXT,
ADD COLUMN     "permahouseBlockIv" TEXT,
ADD COLUMN     "philHealthNoIv" TEXT,
ADD COLUMN     "philSysIv" TEXT,
ADD COLUMN     "resBarangayIv" TEXT,
ADD COLUMN     "resCityIv" TEXT,
ADD COLUMN     "resProvinceIv" TEXT,
ADD COLUMN     "resStreetIv" TEXT,
ADD COLUMN     "resZipCodeIv" TEXT,
ADD COLUMN     "reshouseBlockIv" TEXT,
ADD COLUMN     "tinNoIv" TEXT,
ADD COLUMN     "umidNoIv" TEXT,
ALTER COLUMN "birthDate" SET DATA TYPE TEXT;

-- AlterTable
ALTER TABLE "SupplyStockTrack" ADD COLUMN     "expiration" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "TransferredSupplies" DROP COLUMN "condition",
ADD COLUMN     "condition" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "emailIv" TEXT,
ADD COLUMN     "phoneNumber" TEXT,
ADD COLUMN     "phoneNumberIv" TEXT,
ADD COLUMN     "statusIV" TEXT,
ADD COLUMN     "usernameIv" TEXT;

-- CreateTable
CREATE TABLE "SalaryTransactionRecord" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "periodIv" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "value" TEXT NOT NULL,
    "valueIv" TEXT NOT NULL,

    CONSTRAINT "SalaryTransactionRecord_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "SalaryTransactionRecord" ADD CONSTRAINT "SalaryTransactionRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
