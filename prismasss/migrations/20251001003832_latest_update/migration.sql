-- AlterTable
ALTER TABLE "public"."SupplyBatchOrder" ADD COLUMN     "supplyInchargeId" TEXT;

-- CreateTable
CREATE TABLE "public"."SupplyIncharge" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "departmentId" TEXT NOT NULL,
    "userId" TEXT,

    CONSTRAINT "SupplyIncharge_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "public"."SupplyIncharge" ADD CONSTRAINT "SupplyIncharge_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "public"."Department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SupplyIncharge" ADD CONSTRAINT "SupplyIncharge_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SupplyBatchOrder" ADD CONSTRAINT "SupplyBatchOrder_supplyInchargeId_fkey" FOREIGN KEY ("supplyInchargeId") REFERENCES "public"."SupplyIncharge"("id") ON DELETE SET NULL ON UPDATE CASCADE;
