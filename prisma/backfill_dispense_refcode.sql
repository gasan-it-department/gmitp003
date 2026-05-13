-- Backfill SupplyDispenseRecord.refCode for legacy rows
-- Uses the row's UUID id (uppercased, first 8 chars) prefixed with DSP-
UPDATE "SupplyDispenseRecord"
SET "refCode" = 'DSP-' || UPPER(SUBSTRING(REPLACE(id::text, '-', ''), 1, 8))
WHERE "refCode" IS NULL;
