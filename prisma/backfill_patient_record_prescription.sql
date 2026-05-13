-- Backfill PatientRecord.prescriptionId for legacy data
-- Run with: npx prisma db execute --file prisma/backfill_patient_record_prescription.sql

-- Type 2 (Medicine Dispensed): derive from the linked MedicineTransaction
UPDATE "PatientRecord" pr
SET "prescriptionId" = mt."prescriptionId"
FROM "MedicineTransaction" mt
WHERE pr."medicineTransactionId" = mt.id
  AND pr."prescriptionId" IS NULL
  AND mt."prescriptionId" IS NOT NULL;

-- Type 1 (Prescribed): match by patientId + timestamps within 5 seconds
-- (both rows are created in the same DB transaction so timestamps are very close)
UPDATE "PatientRecord" pr
SET "prescriptionId" = p.id
FROM "Prescription" p
WHERE pr."type" = 1
  AND pr."prescriptionId" IS NULL
  AND pr."patientId" IS NOT NULL
  AND pr."patientId" = p."patientId"
  AND ABS(EXTRACT(EPOCH FROM (pr."timestamp" - p."timestamp"))) < 5;
