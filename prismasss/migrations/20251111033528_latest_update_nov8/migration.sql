-- AlterTable
ALTER TABLE "Position" ADD COLUMN     "fixToUnit" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "UnitPosition" ADD COLUMN     "fixToUnit" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "itemNumber" TEXT DEFAULT 'N/A';
