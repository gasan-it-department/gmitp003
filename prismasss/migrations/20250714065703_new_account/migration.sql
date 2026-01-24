-- CreateTable
CREATE TABLE "BirthdayNoticeResponse" (
    "id" TEXT NOT NULL,
    "message" TEXT,
    "like" BOOLEAN NOT NULL DEFAULT false,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "senderId" TEXT NOT NULL,
    "recipientId" TEXT,

    CONSTRAINT "BirthdayNoticeResponse_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "BirthdayNoticeResponse" ADD CONSTRAINT "BirthdayNoticeResponse_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BirthdayNoticeResponse" ADD CONSTRAINT "BirthdayNoticeResponse_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
