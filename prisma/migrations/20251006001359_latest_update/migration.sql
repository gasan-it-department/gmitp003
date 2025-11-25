-- CreateTable
CREATE TABLE "HumanResourcesLogs" (
    "id" TEXT NOT NULL,
    "lineId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "desc" TEXT NOT NULL DEFAULT 'N/A',
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HumanResourcesLogs_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "HumanResourcesLogs" ADD CONSTRAINT "HumanResourcesLogs_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "Line"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HumanResourcesLogs" ADD CONSTRAINT "HumanResourcesLogs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
