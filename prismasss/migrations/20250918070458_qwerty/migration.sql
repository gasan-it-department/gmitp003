/*
  Warnings:

  - A unique constraint covering the columns `[supplyOrderId]` on the table `SupplyOrderItemReturn` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "public"."SupplyBatchOrder" ADD COLUMN     "approvedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "public"."SupplyOrderItemReturn" ADD COLUMN     "supplyOrderId" TEXT;

-- AlterTable
ALTER TABLE "public"."SupplyOrderReturn" ADD COLUMN     "message" TEXT DEFAULT 'N/A';

-- AlterTable
ALTER TABLE "public"."SupplyPriceTrack" ADD COLUMN     "period" TEXT NOT NULL DEFAULT '0:0';

-- CreateTable
CREATE TABLE "public"."UserKeyPair" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "publicKey" TEXT NOT NULL,
    "privateKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserKeyPair_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Signature" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "defalt" BOOLEAN NOT NULL DEFAULT false,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT NOT NULL,

    CONSTRAINT "Signature_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."SignatureAudit" (
    "id" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "auditedId" TEXT DEFAULT '',
    "signatureQueueRoomId" TEXT NOT NULL,

    CONSTRAINT "SignatureAudit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."SignatureQueueRoom" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "departmentId" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SignatureQueueRoom_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."SignatureQueueRoomApprover" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "timestamp" TEXT NOT NULL,
    "signatureQueueRoomId" TEXT,

    CONSTRAINT "SignatureQueueRoomApprover_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."SignatureCoor" (
    "id" TEXT NOT NULL,
    "xAxis" INTEGER NOT NULL,
    "yAxis" INTEGER NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "signatureRequestId" TEXT,

    CONSTRAINT "SignatureCoor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."SignatureRecord" (
    "id" TEXT NOT NULL,
    "signatureRequestId" TEXT NOT NULL,
    "lineId" TEXT NOT NULL,
    "signature" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SignatureRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."SignatureRequest" (
    "id" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "desc" TEXT DEFAULT 'N/A',
    "size" TEXT NOT NULL DEFAULT 'A4',
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fromUserId" TEXT,
    "toUserId" TEXT,
    "status" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "SignatureRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."SignatureFile" (
    "id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileSize" TEXT NOT NULL,
    "fileType" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "signatureRequestId" TEXT NOT NULL,

    CONSTRAINT "SignatureFile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UserKeyPair_userId_key" ON "public"."UserKeyPair"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "SupplyOrderItemReturn_supplyOrderId_key" ON "public"."SupplyOrderItemReturn"("supplyOrderId");

-- AddForeignKey
ALTER TABLE "public"."SupplyOrderItemReturn" ADD CONSTRAINT "SupplyOrderItemReturn_supplyOrderId_fkey" FOREIGN KEY ("supplyOrderId") REFERENCES "public"."SupplyOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."UserKeyPair" ADD CONSTRAINT "UserKeyPair_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Signature" ADD CONSTRAINT "Signature_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SignatureAudit" ADD CONSTRAINT "SignatureAudit_signatureQueueRoomId_fkey" FOREIGN KEY ("signatureQueueRoomId") REFERENCES "public"."SignatureQueueRoom"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SignatureQueueRoom" ADD CONSTRAINT "SignatureQueueRoom_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SignatureQueueRoom" ADD CONSTRAINT "SignatureQueueRoom_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "public"."Department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SignatureQueueRoomApprover" ADD CONSTRAINT "SignatureQueueRoomApprover_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SignatureQueueRoomApprover" ADD CONSTRAINT "SignatureQueueRoomApprover_signatureQueueRoomId_fkey" FOREIGN KEY ("signatureQueueRoomId") REFERENCES "public"."SignatureQueueRoom"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SignatureCoor" ADD CONSTRAINT "SignatureCoor_signatureRequestId_fkey" FOREIGN KEY ("signatureRequestId") REFERENCES "public"."SignatureRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SignatureRecord" ADD CONSTRAINT "SignatureRecord_signatureRequestId_fkey" FOREIGN KEY ("signatureRequestId") REFERENCES "public"."SignatureRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SignatureRequest" ADD CONSTRAINT "SignatureRequest_fromUserId_fkey" FOREIGN KEY ("fromUserId") REFERENCES "public"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SignatureRequest" ADD CONSTRAINT "SignatureRequest_toUserId_fkey" FOREIGN KEY ("toUserId") REFERENCES "public"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SignatureFile" ADD CONSTRAINT "SignatureFile_signatureRequestId_fkey" FOREIGN KEY ("signatureRequestId") REFERENCES "public"."SignatureRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
