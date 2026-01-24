-- CreateTable
CREATE TABLE "public"."SupplyDispenseRecord" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "departmentId" TEXT,
    "quantity" TEXT NOT NULL DEFAULT '0',
    "supplyStockTrackId" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "remarks" TEXT NOT NULL DEFAULT 'N/A',

    CONSTRAINT "SupplyDispenseRecord_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "public"."SupplyDispenseRecord" ADD CONSTRAINT "SupplyDispenseRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SupplyDispenseRecord" ADD CONSTRAINT "SupplyDispenseRecord_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "public"."Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SupplyDispenseRecord" ADD CONSTRAINT "SupplyDispenseRecord_supplyStockTrackId_fkey" FOREIGN KEY ("supplyStockTrackId") REFERENCES "public"."SupplyStockTrack"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
