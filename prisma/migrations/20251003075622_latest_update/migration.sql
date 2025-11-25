/*
  Warnings:

  - A unique constraint covering the columns `[code]` on the table `InvitationLink` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "InvitationLink" ADD COLUMN     "status" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "AdminModule" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminModule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminInbox" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "path" TEXT,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "userId" TEXT NOT NULL,

    CONSTRAINT "AdminInbox_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "InvitationLink_code_key" ON "InvitationLink"("code");

-- AddForeignKey
ALTER TABLE "AdminInbox" ADD CONSTRAINT "AdminInbox_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
