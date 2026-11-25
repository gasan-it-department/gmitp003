/**
 * Bulk item import from a spreadsheet.
 *
 * Moved out of supplyController.ts, which had grown to 3,034 lines
 * across twenty unrelated handlers. The code itself is unchanged.
 */
import { FastifyReply, FastifyRequest } from "../../barrel/fastify";
import { Prisma, prisma } from "../../barrel/prisma";
import { assertLine, assertOwned } from "../../service/inventoryScope";
import ExcelJS from "exceljs";
import { Readable } from "stream";
import { generatedItemCode } from "../../middleware/handler";
import { AppError, ValidationError, UnauthorizedError } from "../../errors/errors";


export const uploadBulkExcel = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const isMultipart = req.isMultipart();
  if (!isMultipart) {
    throw new ValidationError("INVALID MULTI-PART");
  }

  try {
    const parts = req.parts();
    let fileBuffer: Buffer | null = null;
    const formData: Record<string, string> = {};

    for await (const part of parts) {
      if (part.type === "file") {
        const buffers: Buffer[] = [];
        for await (const chunk of part.file) buffers.push(chunk as Buffer);
        fileBuffer = Buffer.concat(buffers);
      } else {
        formData[part.fieldname] = part.value as string;
      }
    }

    if (!formData.lineId) {
      throw new ValidationError("INVALID REQUIRED FIELD: lineId");
    }
    if (!formData.dataSetId) {
      throw new ValidationError("INVALID REQUIRED FIELD: dataSetId");
    }
    if (!fileBuffer) {
      throw new ValidationError("INVALID FILE");
    }

    /*
      The line and data set named in the form must be the caller's own.
      They arrive as multipart fields, which is how they escaped the
      scoping added to the handlers that read body or query.
    */
    const lineId = await assertLine(req, formData.lineId);
    await assertOwned(req, "dataset", formData.dataSetId);

    const workbook = new ExcelJS.Workbook();
    const stream = Readable.from(fileBuffer);
    await workbook.xlsx.read(stream);

    const itemsToInsert: string[] = [];
    workbook.eachSheet((sheet) => {
      sheet.eachRow((row) => {
        const value = row.getCell(1).value;
        if (value && value.toString().trim()) {
          itemsToInsert.push(value.toString());
        }
      });
    });

    if (itemsToInsert.length === 0) {
      throw new ValidationError("No valid data found in Excel file");
    }

    const BATCH_SIZE = 50;
    const existingItems = new Set<string>();

    for (let i = 0; i < itemsToInsert.length; i += BATCH_SIZE) {
      const batch = itemsToInsert.slice(i, i + BATCH_SIZE);
      const existingBatch = await prisma.supplies.findMany({
        where: {
          item: { in: batch },
          suppliesDataSetId: formData.dataSetId,
          lineId,
        },
        select: { item: true },
      });
      existingBatch.forEach((item) => existingItems.add(item.item));
    }

    const newItems = itemsToInsert.filter((item) => !existingItems.has(item));

    if (newItems.length === 0) {
      return res.status(200).send({
        message: "All items already exist. No new items to insert.",
        totalChecked: itemsToInsert.length,
        existingCount: existingItems.size,
        insertedCount: 0,
      });
    }

    const suppliesData: Array<{
      item: string;
      code: number;
      suppliesDataSetId: string;
      lineId: string;
      consumable: boolean;
      description: string;
    }> = [];
    for (const item of newItems) {
      const code = await generatedItemCode();
      suppliesData.push({
        item,
        code,
        suppliesDataSetId: formData.dataSetId,
        lineId,
        consumable: false,
        description: "",
      });
    }

    let insertedCount = 0;
    for (let i = 0; i < suppliesData.length; i += BATCH_SIZE) {
      const batch = suppliesData.slice(i, i + BATCH_SIZE);
      try {
        const result = await prisma.supplies.createMany({
          data: batch,
          skipDuplicates: true,
        });
        insertedCount += result.count;
      } catch (error) {
        if (error instanceof UnauthorizedError) throw error;
        console.error(`Error inserting batch ${i / BATCH_SIZE + 1}:`, error);
        throw new AppError(
          "BATCH_INSERT_ERROR",
          500,
          `Failed to insert batch ${i / BATCH_SIZE + 1}`,
        );
      }
    }

    return res.status(200).send({
      message: "Bulk upload completed",
      totalChecked: itemsToInsert.length,
      existingCount: existingItems.size,
      insertedCount,
      skippedCount: itemsToInsert.length - insertedCount,
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) throw error;
    if (error instanceof ValidationError) throw error;
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      console.error("Prisma error code:", error.code);
      throw new AppError("DB_CONNECTION_ERROR", 500, "Database error occurred");
    }
    if (error instanceof Error) {
      console.error("Error stack:", error.stack);
    }
    throw new AppError("INTERNAL_ERROR", 500, "An unexpected error occurred");
  }
};
