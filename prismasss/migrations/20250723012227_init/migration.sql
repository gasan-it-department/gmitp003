/*
  Warnings:

  - A unique constraint covering the columns `[suppliesQualityId]` on the table `Supplies` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "InvitationLink" ALTER COLUMN "expiresAt" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Line" ADD COLUMN     "status" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "Supplies" ADD COLUMN     "price" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
ADD COLUMN     "suppliesCategoryId" TEXT,
ADD COLUMN     "suppliesQualityId" TEXT,
ALTER COLUMN "quantity" SET DEFAULT 1;

-- AlterTable
ALTER TABLE "SuppliesRecord" ADD COLUMN     "status" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "gender" TEXT DEFAULT '--/--',
ADD COLUMN     "profilePicture" TEXT;

-- CreateTable
CREATE TABLE "ProfilePicture" (
    "id" TEXT NOT NULL,
    "assetsId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProfilePicture_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SuppliesQuality" (
    "id" TEXT NOT NULL,
    "quality" TEXT NOT NULL,
    "perQuality" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "SuppliesQuality_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SuppliesCategory" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SuppliesCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplieRecieveHistory" (
    "id" TEXT NOT NULL,
    "suppliesId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "condition" TEXT DEFAULT 'New',

    CONSTRAINT "SupplieRecieveHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProfilePicture_userId_key" ON "ProfilePicture"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "SuppliesQuality_quality_key" ON "SuppliesQuality"("quality");

-- CreateIndex
CREATE UNIQUE INDEX "SuppliesCategory_name_key" ON "SuppliesCategory"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Supplies_suppliesQualityId_key" ON "Supplies"("suppliesQualityId");

-- AddForeignKey
ALTER TABLE "ProfilePicture" ADD CONSTRAINT "ProfilePicture_assetsId_fkey" FOREIGN KEY ("assetsId") REFERENCES "Assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfilePicture" ADD CONSTRAINT "ProfilePicture_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Supplies" ADD CONSTRAINT "Supplies_suppliesCategoryId_fkey" FOREIGN KEY ("suppliesCategoryId") REFERENCES "SuppliesCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Supplies" ADD CONSTRAINT "Supplies_suppliesQualityId_fkey" FOREIGN KEY ("suppliesQualityId") REFERENCES "SuppliesQuality"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplieRecieveHistory" ADD CONSTRAINT "SupplieRecieveHistory_suppliesId_fkey" FOREIGN KEY ("suppliesId") REFERENCES "Supplies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
