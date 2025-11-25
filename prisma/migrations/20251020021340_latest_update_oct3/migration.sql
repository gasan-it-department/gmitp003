-- AlterTable
ALTER TABLE "SupplyBatchOrder" ADD COLUMN     "comments" TEXT NOT NULL DEFAULT 'N/A',
ADD COLUMN     "remark" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "InventoryInbox" (
    "id" TEXT NOT NULL,

    CONSTRAINT "InventoryInbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryInboxItems" (
    "id" TEXT NOT NULL,
    "view" BOOLEAN NOT NULL DEFAULT false,
    "type" INTEGER NOT NULL DEFAULT 0,
    "message" TEXT,
    "subject" TEXT,
    "path" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lineId" TEXT NOT NULL,

    CONSTRAINT "InventoryInboxItems_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplyOrderStatus" (
    "id" TEXT NOT NULL,
    "phase" INTEGER NOT NULL DEFAULT 0,
    "supplyOrderId" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT NOT NULL,
    "desc" TEXT,

    CONSTRAINT "SupplyOrderStatus_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MedicineStorage" (
    "id" TEXT NOT NULL,
    "refNumber" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "desc" TEXT NOT NULL,
    "timestamp" TEXT NOT NULL,
    "lineId" TEXT NOT NULL,
    "departmentId" TEXT NOT NULL,

    CONSTRAINT "MedicineStorage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MedicineNotification" (
    "id" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT NOT NULL,
    "departmentId" TEXT,

    CONSTRAINT "MedicineNotification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MedicineStorageAccess" (
    "id" TEXT NOT NULL,
    "medicineStorageId" TEXT NOT NULL,
    "previlege" INTEGER NOT NULL DEFAULT 0,
    "userId" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MedicineStorageAccess_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MedicineLogs" (
    "id" TEXT NOT NULL,
    "action" INTEGER NOT NULL DEFAULT 0,
    "message" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT NOT NULL,

    CONSTRAINT "MedicineLogs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Medicine" (
    "id" TEXT NOT NULL,
    "serialNumber" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "desc" TEXT DEFAULT 'None',
    "phase" INTEGER NOT NULL DEFAULT 0,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Medicine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MedicineTransaction" (
    "id" TEXT NOT NULL,
    "prescriptionId" TEXT,
    "quantity" INTEGER NOT NULL,
    "unit" TEXT NOT NULL,
    "remark" INTEGER NOT NULL DEFAULT 0,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT NOT NULL,
    "medicineStorageId" TEXT NOT NULL,

    CONSTRAINT "MedicineTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MedicineQuality" (
    "id" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unit" TEXT NOT NULL DEFAULT 'pcs',
    "perUnit" INTEGER NOT NULL DEFAULT 1,
    "medicineStockId" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MedicineQuality_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MedicineStock" (
    "id" TEXT NOT NULL,
    "medicineId" TEXT NOT NULL,
    "quarter" INTEGER NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiration" TIMESTAMP(3),
    "medicinePriceTrackId" TEXT NOT NULL,
    "medicineStorageId" TEXT,

    CONSTRAINT "MedicineStock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MedicineTrack" (
    "id" TEXT NOT NULL,
    "medicineId" TEXT NOT NULL,
    "stock" INTEGER NOT NULL DEFAULT 0,
    "quarter" INTEGER NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MedicineTrack_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MedicineHistory" (
    "id" TEXT NOT NULL,
    "medicineId" TEXT NOT NULL,
    "action" INTEGER NOT NULL DEFAULT 0,
    "stock" INTEGER NOT NULL DEFAULT 0,
    "message" TEXT NOT NULL DEFAULT 'N/A',
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MedicineHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MedicinePriceTrack" (
    "id" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MedicinePriceTrack_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Prescription" (
    "id" TEXT NOT NULL,
    "refNumber" TEXT NOT NULL,
    "condtion" TEXT,
    "firstname" TEXT,
    "lastname" TEXT,
    "street" TEXT,
    "barangayId" TEXT NOT NULL,
    "municipalId" TEXT NOT NULL,
    "provinceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "respondedByUserId" TEXT NOT NULL,
    "status" INTEGER NOT NULL DEFAULT 0,
    "remark" INTEGER NOT NULL DEFAULT 0,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Prescription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrescriptionAsset" (
    "id" TEXT NOT NULL,
    "refNumber" TEXT,
    "remark" INTEGER NOT NULL DEFAULT 0,
    "prescriptionId" TEXT NOT NULL,
    "file_url" TEXT,
    "file_size" TEXT,
    "file_type" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PrescriptionAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrescriptionProgress" (
    "id" TEXT NOT NULL,
    "step" INTEGER NOT NULL DEFAULT 0,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "prescriptionId" TEXT,

    CONSTRAINT "PrescriptionProgress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrescriptionComment" (
    "id" TEXT NOT NULL,
    "status" INTEGER NOT NULL DEFAULT 0,
    "prescriberId" TEXT NOT NULL,
    "message" TEXT,
    "prescriptionId" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT NOT NULL,

    CONSTRAINT "PrescriptionComment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrescriptionCommentAssets" (
    "id" TEXT NOT NULL,
    "file_url" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "file_type" INTEGER NOT NULL,
    "file_size" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "prescriptionCommentId" TEXT,

    CONSTRAINT "PrescriptionCommentAssets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrecribeMedicine" (
    "id" TEXT NOT NULL,
    "medicineId" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "desc" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "prescriptionId" TEXT,
    "remark" TEXT NOT NULL DEFAULT 'Pending',

    CONSTRAINT "PrecribeMedicine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrescriptionMedicine" (
    "id" TEXT NOT NULL,

    CONSTRAINT "PrescriptionMedicine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MedicineStorage_refNumber_key" ON "MedicineStorage"("refNumber");

-- CreateIndex
CREATE UNIQUE INDEX "MedicineQuality_medicineStockId_key" ON "MedicineQuality"("medicineStockId");

-- AddForeignKey
ALTER TABLE "InventoryInboxItems" ADD CONSTRAINT "InventoryInboxItems_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "Line"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyOrderStatus" ADD CONSTRAINT "SupplyOrderStatus_supplyOrderId_fkey" FOREIGN KEY ("supplyOrderId") REFERENCES "SupplyOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyOrderStatus" ADD CONSTRAINT "SupplyOrderStatus_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MedicineStorage" ADD CONSTRAINT "MedicineStorage_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MedicineStorage" ADD CONSTRAINT "MedicineStorage_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "Line"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MedicineNotification" ADD CONSTRAINT "MedicineNotification_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MedicineNotification" ADD CONSTRAINT "MedicineNotification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MedicineStorageAccess" ADD CONSTRAINT "MedicineStorageAccess_medicineStorageId_fkey" FOREIGN KEY ("medicineStorageId") REFERENCES "MedicineStorage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MedicineStorageAccess" ADD CONSTRAINT "MedicineStorageAccess_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MedicineLogs" ADD CONSTRAINT "MedicineLogs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MedicineTransaction" ADD CONSTRAINT "MedicineTransaction_prescriptionId_fkey" FOREIGN KEY ("prescriptionId") REFERENCES "Prescription"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MedicineTransaction" ADD CONSTRAINT "MedicineTransaction_medicineStorageId_fkey" FOREIGN KEY ("medicineStorageId") REFERENCES "MedicineStorage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MedicineTransaction" ADD CONSTRAINT "MedicineTransaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MedicineQuality" ADD CONSTRAINT "MedicineQuality_medicineStockId_fkey" FOREIGN KEY ("medicineStockId") REFERENCES "MedicineStock"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MedicineStock" ADD CONSTRAINT "MedicineStock_medicineId_fkey" FOREIGN KEY ("medicineId") REFERENCES "Medicine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MedicineStock" ADD CONSTRAINT "MedicineStock_medicinePriceTrackId_fkey" FOREIGN KEY ("medicinePriceTrackId") REFERENCES "MedicinePriceTrack"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MedicineStock" ADD CONSTRAINT "MedicineStock_medicineStorageId_fkey" FOREIGN KEY ("medicineStorageId") REFERENCES "MedicineStorage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MedicineTrack" ADD CONSTRAINT "MedicineTrack_medicineId_fkey" FOREIGN KEY ("medicineId") REFERENCES "Medicine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MedicineHistory" ADD CONSTRAINT "MedicineHistory_medicineId_fkey" FOREIGN KEY ("medicineId") REFERENCES "Medicine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Prescription" ADD CONSTRAINT "Prescription_barangayId_fkey" FOREIGN KEY ("barangayId") REFERENCES "Barangay"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Prescription" ADD CONSTRAINT "Prescription_municipalId_fkey" FOREIGN KEY ("municipalId") REFERENCES "Municipal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Prescription" ADD CONSTRAINT "Prescription_provinceId_fkey" FOREIGN KEY ("provinceId") REFERENCES "Province"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Prescription" ADD CONSTRAINT "Prescription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Prescription" ADD CONSTRAINT "Prescription_respondedByUserId_fkey" FOREIGN KEY ("respondedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrescriptionAsset" ADD CONSTRAINT "PrescriptionAsset_prescriptionId_fkey" FOREIGN KEY ("prescriptionId") REFERENCES "Prescription"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrescriptionProgress" ADD CONSTRAINT "PrescriptionProgress_prescriptionId_fkey" FOREIGN KEY ("prescriptionId") REFERENCES "Prescription"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrescriptionComment" ADD CONSTRAINT "PrescriptionComment_prescriberId_fkey" FOREIGN KEY ("prescriberId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrescriptionComment" ADD CONSTRAINT "PrescriptionComment_prescriptionId_fkey" FOREIGN KEY ("prescriptionId") REFERENCES "Prescription"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrescriptionComment" ADD CONSTRAINT "PrescriptionComment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrescriptionCommentAssets" ADD CONSTRAINT "PrescriptionCommentAssets_prescriptionCommentId_fkey" FOREIGN KEY ("prescriptionCommentId") REFERENCES "PrescriptionComment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrecribeMedicine" ADD CONSTRAINT "PrecribeMedicine_medicineId_fkey" FOREIGN KEY ("medicineId") REFERENCES "Medicine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrecribeMedicine" ADD CONSTRAINT "PrecribeMedicine_prescriptionId_fkey" FOREIGN KEY ("prescriptionId") REFERENCES "Prescription"("id") ON DELETE SET NULL ON UPDATE CASCADE;
