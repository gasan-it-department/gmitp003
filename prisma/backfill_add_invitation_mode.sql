-- Adds the quick/full invite flavor to FillPositionInvitation.
-- Safe + non-destructive: existing rows fall back to 'full'.
--
-- This is normally applied automatically by `prisma db push` on the next
-- deploy (see the `start` script). This file is provided only in case you
-- prefer to run the change by hand against the production database first.
ALTER TABLE "FillPositionInvitation"
  ADD COLUMN IF NOT EXISTS "mode" TEXT NOT NULL DEFAULT 'full';
