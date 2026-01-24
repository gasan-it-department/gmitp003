/*
  Warnings:

  - A unique constraint covering the columns `[name]` on the table `Supplier` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `lineId` to the `Supplier` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "public"."Supplier" ADD COLUMN     "lineId" TEXT NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Supplier_name_key" ON "public"."Supplier"("name");

-- AddForeignKey
ALTER TABLE "public"."Supplier" ADD CONSTRAINT "Supplier_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "public"."Line"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
