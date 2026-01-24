import { FastifyReply, FastifyRequest } from "../barrel/fastify";
import { Prisma, prisma } from "../barrel/prisma";

import fs from "fs";
import path from "path";
import { pipeline } from "stream";
import * as fsConstants from "fs";
import XLXS from "xlsx";
import ExcelJs from "exceljs";
import cloudinary from "../class/Cloundinary";
import { formatDate } from "../utils/date";
import { AppError, NotFoundError, ValidationError } from "../errors/errors";
import { promisify } from "util";
import { PagingProps } from "../models/route";

export const itemExcelFile = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    if (!req.isMultipart()) {
      return res.status(400).send({ error: "Request must be multipart" });
    }

    const file = await req.file();
    if (!file) {
      return res.code(400).send({ messge: "Bad request" });
    }

    const uploadDir = path.join(__dirname, "uploads");
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);
    const filename = `${Date.now()}-${file.fieldname}`;
    const filepath = path.join(uploadDir, filename);
    console.log(filepath);

    const workbook = XLXS.readFile(filepath);
    const worksheet = workbook.SheetNames;

    for (let sheetName of worksheet) {
      const sheet = workbook.Sheets[sheetName];
    }
  } catch (error) {
    console.log(error);
  }
};

export const dataSetSupplies = async (
  req: FastifyRequest,
  res: FastifyReply
) => {
  try {
    const body = req.body as { id: string };

    if (!body.id) {
      return res.code(400).send({ message: "Bad Request" });
    }

    const response = await prisma.supplies.findMany({
      where: {
        suppliesDataSetId: body.id,
      },
    });

    if (response.length === 0) {
      return res.code(404).send({ message: "No data found" });
    }

    const workbook = new ExcelJs.Workbook();
    workbook.created = new Date();

    const worksheet = workbook.addWorksheet("Items", {
      pageSetup: {
        paperSize: 9,
        orientation: "landscape",
        fitToPage: true,
        showGridLines: true,
      },
      // headerFooter: {
      //   oddHeader: `&L&B$Items`,
      //   oddFooter: `&RGenerated on: ${formatDate(
      //     new Date().toLocaleDateString()
      //   )}`,
      // },
    });

    worksheet.columns = [
      { header: "No", key: "no", width: 5 },
      { header: "Item", key: "item", width: 10 },
      { header: "Ref. Number", key: "ref", width: 14 },
      { header: "Date Added", key: "date", width: 26 },
    ];

    worksheet.getRow(1).eachCell((cell) => {
      cell.font = { bold: true };
      cell.alignment = { horizontal: "center", vertical: "middle" };
      cell.border = {
        top: { style: "thin" },
        left: { style: "thin" },
        bottom: { style: "thin" },
        right: { style: "thin" },
      };
    });

    const rows = response.map((item, i) => ({
      no: i + 1,
      item: item.item ?? "N/A",
      ref: item.code,
      date: formatDate(item.createdAt.toISOString()),
    }));

    worksheet.addRows(rows);

    // Set proper headers
    res.header(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.header(
      "Content-Disposition",
      "attachment; filename=SupporterReport.xlsx"
    );
    res.header("Access-Control-Expose-Headers", "Content-Disposition");

    // Get the buffer and send it
    const buffer = await workbook.xlsx.writeBuffer();
    return res.send(buffer);
  } catch (error) {
    console.error(error);
    return res.code(500).send({ message: "Internal server error" });
  }
};

// export const updateLoadProfile = async (
//   req: FastifyRequest,
//   res: FastifyReply
// ) => {
//   try {
//     const data = await req.file();
//     if (!data) {
//       res.code(400).send({ error: 'No file uploaded' });
//       return;
//     }

//     // Ensure directory exists
//     const uploadDir = 'D:/portal/profile';
//     try {
//       await fs.access(uploadDir, fsConstants.constants.W_OK);
//     } catch {
//       await fs.mkdir(uploadDir, { recursive: true });
//     }

//     // Create safe filename and path
//     const originalFilename = data.filename;
//     const ext = path.extname(originalFilename);
//     const basename = path.basename(originalFilename, ext);
//     const filename = `${basename}-${Date.now()}${ext}`;
//     const filePath = path.join(uploadDir, filename);

//     // Write file using stream to handle large files efficiently
//     await pipeline(data.file, fs.createWriteStream(filePath));

//     return {
//       success: true,
//       message: 'File uploaded successfully',
//       path: filePath,
//       filename: filename
//     };
//   } catch (error) {
//     if (error instanceof Error) {
//       req.log.error(error);
//       res.code(500).send({
//         error: 'File upload failed',
//         details: error.message
//       });
//     } else {
//       res.code(500).send({
//         error: 'Unknown error occurred'
//       });
//     }
//   }
// };

export const exportSupplyExcel = async (
  req: FastifyRequest,
  res: FastifyReply
) => {
  const params = req.query as {
    id: string;
    yearRange: string;
    category?: boolean;
    lineId: string;
  };

  console.log(params);

  if (!params.id || !params.yearRange)
    throw new ValidationError("INVALID REQUIRED ID");
  try {
    const currentYear = params.yearRange;
    let years: any[] = [];

    if (typeof currentYear === "string") {
      const trimmed = currentYear.trim();

      if (trimmed.includes("-")) {
        // Handle "2025-2026" format - get the last year (2026)
        const parts = trimmed.split("-");
        // Parse all parts and filter out invalid numbers
        const parsedYears = parts
          .map((part) => parseInt(part.trim(), 10))
          .filter((num) => !isNaN(num));

        if (parsedYears.length > 0) {
          years = parsedYears;
        }
      } else {
        // Handle "2025" format - get that year
        const yearNum = parseInt(trimmed, 10);
        if (!isNaN(yearNum)) {
          years = [yearNum];
        }
      }
    }

    console.log("Range: ", { years });

    // Get yearStart: for "2025-2026" get 2026, for "2025" get 2025
    const yearStart = years.length > 1 ? years[years.length - 1] : years[0];

    // If yearStart is still NaN (unlikely with our validation), fallback to current year
    const finalYearStart = !isNaN(yearStart)
      ? yearStart
      : new Date().getFullYear();

    console.log("Selected Year: ", finalYearStart);

    // Calculate first half (Jan-Jun) and second half (Jul-Dec)
    const firstHalfStart = new Date(finalYearStart, 0, 1); // January 1
    const firstHalfEnd = new Date(finalYearStart, 5, 30, 23, 59, 59, 999); // June 30
    const secondHalfStart = new Date(finalYearStart, 6, 1); // July 1
    const secondHalfEnd = new Date(finalYearStart, 11, 31, 23, 59, 59, 999); // December 31

    const [file, data] = await prisma.$transaction([
      prisma.supplytExcelExport.findUnique({
        where: {
          id: params.id,
        },
      }),
      prisma.supplies.findMany({
        where: {
          SupplieRecieveHistory: {
            some: {
              supplyBatchId: params.id,
            },
          },
        },
        select: {
          id: true,
          item: true,
          SupplieRecieveHistory: {
            where: {
              supplyBatchId: params.id,
            },
            select: {
              id: true,
              perQuantity: true,
              suppliesId: true,
              pricePerItem: true,
              quantity: true,
              quality: true,
              timestamp: true,
              supplyOrder: {
                select: {
                  id: true,
                  desc: true,
                },
              },
            },
            orderBy: {
              timestamp: "asc",
            },
          },
          supplyDispenseRecords: {
            select: {
              suppliesId: true,
              quantity: true,
              timestamp: true,
            },
          },
          SuppliesDataSet: {
            select: {
              id: true,
              title: true,
            },
          },
          suppliesDataSetId: true,
        },
      }),
    ]);

    console.log(JSON.stringify(data, null, 2));

    const groupedData = data.reduce<
      Record<
        string,
        {
          dataSetTitle: string;
          dataSetId: string | null;
          items: any[];
          totals: {
            firstHalfRecieved: number;
            secondhalfRecieved: number;
            firstHalfCost: number;
            secondhalfCost: number;
            firstHalfdispense: number;
            secondHalfDispense: number;
            totalQuantity: number;
            totalInsuance: number;
            totalBalanceQuantity: number;
            totalBalanceAmount: number;
          };
        }
      >
    >(
      (groups, item) => {
        // Calculate individual supply data for this item
        const firstHalfRecieved = item.SupplieRecieveHistory.reduce(
          (base, acc) => {
            if (
              acc.timestamp >= firstHalfStart &&
              acc.timestamp <= firstHalfEnd
            ) {
              return (base += acc.quantity);
            }
            return base;
          },
          0
        );

        const secondhalfRecieved = item.SupplieRecieveHistory.reduce(
          (base, acc) => {
            if (
              acc.timestamp >= secondHalfStart &&
              acc.timestamp <= secondHalfEnd
            ) {
              return (base += acc.quantity);
            }
            return base;
          },
          0
        );

        const firstHalfCost = item.SupplieRecieveHistory.reduce((base, acc) => {
          if (
            acc.timestamp >= firstHalfStart &&
            acc.timestamp <= firstHalfEnd
          ) {
            return (base += acc.pricePerItem);
          }
          return base;
        }, 0);

        const secondhalfCost = item.SupplieRecieveHistory.reduce(
          (base, acc) => {
            if (
              acc.timestamp >= secondHalfStart &&
              acc.timestamp <= secondHalfEnd
            ) {
              return (base += acc.pricePerItem);
            }
            return base;
          },
          0
        );

        const firstHalfdispense = item.supplyDispenseRecords.reduce(
          (base, acc) => {
            if (
              acc.timestamp >= firstHalfStart &&
              acc.timestamp <= firstHalfEnd
            ) {
              const quantity = parseInt(acc.quantity);
              return (base += quantity);
            }
            return base;
          },
          0
        );

        const secondHalfDispense = item.supplyDispenseRecords.reduce(
          (base, acc) => {
            if (
              acc.timestamp >= secondHalfStart &&
              acc.timestamp <= secondHalfEnd
            ) {
              const quantity = parseInt(acc.quantity);
              return (base += quantity);
            }
            return base;
          },
          0
        );
        const totalQuantity = firstHalfRecieved + secondhalfRecieved;
        const totalInsuance = firstHalfdispense + secondHalfDispense;
        const totalBalance = totalQuantity - totalInsuance;
        const totalAmount = firstHalfCost * totalQuantity;

        const processedItem = {
          id: item.id,
          name: item.item,
          firstHalfRecieved,
          secondhalfRecieved,
          firstHalfCost,
          secondhalfCost,
          firstHalfdispense,
          secondHalfDispense,
          totalQuantity,
          totalInsuance,
          totalBalanceQuantity: totalBalance,
          supplyDataSetId: item.suppliesDataSetId,
          desc: item.SupplieRecieveHistory[0].supplyOrder?.desc || "N/A",
          dataSet: item.SuppliesDataSet?.title,
        };

        // Group by suppliesDataSetId
        const groupKey = item.suppliesDataSetId || "ungrouped";
        if (!groups[groupKey]) {
          groups[groupKey] = {
            dataSetTitle: item.SuppliesDataSet?.title || "Ungrouped",
            dataSetId: item.suppliesDataSetId,
            items: [],
            totals: {
              firstHalfRecieved: 0,
              secondhalfRecieved: 0,
              firstHalfCost: 0,
              secondhalfCost: 0,
              firstHalfdispense: 0,
              secondHalfDispense: 0,
              totalQuantity: 0,
              totalInsuance: 0,
              totalBalanceQuantity: 0,
              totalBalanceAmount: 0,
            },
          };
        }

        // Add item to group
        groups[groupKey].items.push(processedItem);

        // Update group totals
        groups[groupKey].totals.firstHalfRecieved += firstHalfRecieved;
        groups[groupKey].totals.secondhalfRecieved += secondhalfRecieved;
        groups[groupKey].totals.firstHalfCost += firstHalfCost;
        groups[groupKey].totals.secondhalfCost += secondhalfCost;
        groups[groupKey].totals.firstHalfdispense += firstHalfdispense;
        groups[groupKey].totals.secondHalfDispense += secondHalfDispense;
        groups[groupKey].totals.totalQuantity += totalQuantity;
        groups[groupKey].totals.totalInsuance += totalInsuance;
        groups[groupKey].totals.totalBalanceQuantity += totalBalance;
        groups[groupKey].totals.totalBalanceAmount += totalAmount;

        return groups;
      },
      {} as Record<
        string,
        {
          dataSetTitle: string;
          dataSetId: string | null;
          items: any[];
          totals: {
            firstHalfRecieved: number;
            secondhalfRecieved: number;
            firstHalfCost: number;
            secondhalfCost: number;
            firstHalfdispense: number;
            secondHalfDispense: number;
            totalQuantity: number;
            totalInsuance: number;
            totalBalanceQuantity: number;
            totalBalanceAmount: number;
          };
        }
      >
    );

    const groupedDataArray = Object.values(groupedData);

    console.log({ groupedDataArray });

    const sampleTemplateUrl =
      "https://res.cloudinary.com/drhkb0ubf/raw/upload/v1765101238/SupplyReportTemplate_yoqkas.xlsx";

    const response = await fetch(sampleTemplateUrl);
    const arrayBuffer = await response.arrayBuffer();

    const buffer = Buffer.from(arrayBuffer);

    const { Readable } = require("stream");
    const stream = Readable.from(buffer);

    const workbook = new ExcelJs.Workbook();
    await workbook.xlsx.read(stream);

    const worksheet = workbook.worksheets[0];

    worksheet.getCell("A1").font = {
      name: "Arial",
      size: 16,
      bold: true,
    };

    // INSERT PROCESSED DATA STARTING AT ROW 11
    // No need to insert rows first, just write to existing rows or create new ones

    // Method 1: Write directly to existing rows (if template has empty rows 11+)
    // OR Method 2: Use spliceRows to insert if needed
    // worksheet.getRow(10).getCell("C").value = `PO-${
    //   years.length > 1
    //     ? years[1].toString().slice(-2)
    //     : years[0].toString().slice(-2)
    // }`;

    // worksheet.getRow(10).getCell("E").value = `PO-${
    //   years.length > 1
    //     ? years[0].toString().slice(-2)
    //     : years[1].toString().slice(-2)
    // }`;
    let currentRowNumber = 11; // Start from row 11
    let overallIndex = 0; // For serial numbers across all items

    groupedDataArray.forEach((group, groupIndex) => {
      // Add group header row
      worksheet.mergeCells(`A${currentRowNumber}:N${currentRowNumber}`);
      const mergedCell = worksheet.getCell(`A${currentRowNumber}`);
      mergedCell.value = `${group.dataSetTitle}`;
      mergedCell.font = { bold: true };
      mergedCell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "F0F0F0" }, // Light gray background
      };
      mergedCell.border = {
        top: { style: "thin" },
        left: { style: "thin" },
        bottom: { style: "thin" },
        right: { style: "thin" },
      };
      mergedCell.alignment = { horizontal: "left", vertical: "middle" };

      currentRowNumber++; // Move to next row for items

      // Add items for this group
      group.items.forEach((item, itemIndex) => {
        overallIndex++; // Increment overall serial number

        let row = worksheet.getRow(currentRowNumber);

        // Map your data to columns
        row.getCell("A").value = overallIndex; // Serial number across all items
        row.getCell("B").value = `${item.name} - ${item.desc}`;
        row.getCell("C").value =
          years.length > 1 ? item.secondhalfRecieved : item.firstHalfRecieved;
        row.getCell("D").value =
          years.length > 1 ? item.secondhalfCost : item.firstHalfCost;
        row.getCell("E").value =
          years.length > 1 ? item.firstHalfRecieved : item.secondhalfRecieved;
        row.getCell("F").value =
          years.length > 1 ? item.firstHalfCost : item.secondhalfCost;
        row.getCell("G").value = item.firstHalfRecieved;
        row.getCell("H").value = item.firstHalfCost;
        row.getCell("I").value = item.totalQuantity;
        row.getCell("J").value = item.totalInsuance;
        row.getCell("K").value = item.secondHalfDispense;
        row.getCell("L").value = item.firstHalfdispense;
        row.getCell("M").value = item.totalInsuance;
        row.getCell("N").value = item.totalBalanceQuantity;
        row.getCell("O").value = item.totalBalanceQuantity; // Empty cell for future use

        // Add number formatting for numeric cells
        row.getCell("C").numFmt = "#,##0";
        row.getCell("D").numFmt = "#,##0.00";
        row.getCell("E").numFmt = "#,##0";
        row.getCell("F").numFmt = "#,##0";
        row.getCell("G").numFmt = "#,##0.00";
        row.getCell("H").numFmt = "#,##0";
        row.getCell("I").numFmt = "#,##0";
        row.getCell("J").numFmt = "#,##0";
        row.getCell("K").numFmt = "#,##0";

        // Add borders
        [
          "A",
          "B",
          "C",
          "D",
          "E",
          "F",
          "G",
          "H",
          "I",
          "J",
          "K",
          "L",
          "M",
          "N",
        ].forEach((col) => {
          const cell = row.getCell(col);
          cell.border = {
            top: { style: "thin" },
            left: { style: "thin" },
            bottom: { style: "thin" },
            right: { style: "thin" },
          };
        });
        row.commit();

        currentRowNumber++; // Move to next row
      });

      // Add a blank row between groups (optional)
      currentRowNumber++;
    });

    // Now calculate totals based on all processed data
    const totalsRowNumber = currentRowNumber;
    const totalsRow = worksheet.getRow(totalsRowNumber);

    totalsRow.getCell("B").value = "TOTALS";
    totalsRow.getCell("B").font = { bold: true };

    // Calculate totals from all groups
    let grandTotals = {
      firstHalfRecieved: 0,
      secondhalfRecieved: 0,
      firstHalfCost: 0,
      secondhalfCost: 0,
      totalQuantity: 0,
      totalInsuance: 0,
      totalBalanceQuantity: 0,
    };

    groupedDataArray.forEach((group) => {
      grandTotals.firstHalfRecieved += group.totals.firstHalfRecieved;
      grandTotals.secondhalfRecieved += group.totals.secondhalfRecieved;
      grandTotals.firstHalfCost += group.totals.firstHalfCost;
      grandTotals.secondhalfCost += group.totals.secondhalfCost;
      grandTotals.totalQuantity += group.totals.totalQuantity;
      grandTotals.totalInsuance += group.totals.totalInsuance;
      grandTotals.totalBalanceQuantity += group.totals.totalBalanceQuantity;
    });

    // Apply totals to row (adjust columns as needed)
    totalsRow.getCell("C").value = grandTotals.secondhalfRecieved;
    totalsRow.getCell("D").value = grandTotals.secondhalfCost;
    totalsRow.getCell("E").value = grandTotals.firstHalfRecieved;
    totalsRow.getCell("F").value = grandTotals.firstHalfCost;
    totalsRow.getCell("I").value = grandTotals.totalQuantity;
    totalsRow.getCell("J").value = grandTotals.totalInsuance;
    totalsRow.getCell("M").value = grandTotals.totalInsuance;
    totalsRow.getCell("N").value = grandTotals.totalBalanceQuantity;

    // Apply number formatting
    ["C", "D", "E", "F", "I", "J", "M", "N"].forEach((col) => {
      totalsRow.getCell(col).numFmt = "#,##0";
      if (col === "D") {
        totalsRow.getCell(col).numFmt = "#,##0.00";
      }
    });

    // Style totals row
    totalsRow.font = { bold: true };
    totalsRow.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFE0E0E0" },
    };

    // Add borders to totals row
    [
      "A",
      "B",
      "C",
      "D",
      "E",
      "F",
      "G",
      "H",
      "I",
      "J",
      "K",
      "L",
      "M",
      "N",
      "O",
    ].forEach((col) => {
      const cell = totalsRow.getCell(col);
      cell.border = {
        top: { style: "thin" },
        left: { style: "thin" },
        bottom: { style: "thin" },
        right: { style: "thin" },
      };
    });
    // processedData.forEach((item, index) => {
    //   console.log("CAT: ", item.dataSet);

    //   const rowNumber = 11 + index;
    //   if (params.category === true && item.dataSet) {
    //     worksheet.mergeCells(`A${rowNumber}:N${rowNumber}`);
    //     const mergedCell = worksheet.getCell(`A${rowNumber}`);
    //     mergedCell.value = `${item.dataSet}`;
    //     mergedCell.font = { bold: true };
    //     mergedCell.border = {
    //       top: { style: "thin" },
    //       bottom: { style: "thin" },
    //     };
    //   }
    //   // If row doesn't exist, create it
    //   let row = worksheet.getRow(
    //     rowNumber + (params.category === true ? 1 : 0)
    //   );
    //   if (!row) {
    //     // Create row by setting a cell value
    //     worksheet.getCell(`A${rowNumber}`).value = index + 1;
    //     row = worksheet.getRow(rowNumber);
    //   }

    //   // Map your data to columns
    //   row.getCell("A").value = index + 1; // Serial number
    //   row.getCell("B").value = `${item.name} - ${item.desc}`;
    //   row.getCell("C").value =
    //     years.length > 1 ? item.secondhalfRecieved : item.firstHalfRecieved;
    //   row.getCell("D").value =
    //     years.length > 1 ? item.secondhalfCost : item.firstHalfCost;
    //   row.getCell("E").value =
    //     years.length > 1 ? item.firstHalfRecieved : item.secondhalfRecieved;
    //   row.getCell("F").value =
    //     years.length > 1 ? item.firstHalfCost : item.secondhalfCost;
    //   row.getCell("G").value = item.firstHalfRecieved;
    //   row.getCell("H").value = item.firstHalfCost;
    //   row.getCell("I").value = item.totalQuantity;
    //   row.getCell("J").value = item.totalInsuance;
    //   row.getCell("K").value = item.secondHalfDispense;
    //   row.getCell("L").value = item.firstHalfdispense;
    //   row.getCell("M").value = item.totalInsuance;
    //   row.getCell("N").value = item.totalBalanceQuantity;

    //   // Add number formatting for numeric cells
    //   row.getCell("C").numFmt = "#,##0";
    //   row.getCell("D").numFmt = "#,##0.00";
    //   row.getCell("E").numFmt = "#,##0";
    //   row.getCell("F").numFmt = "#,##0";
    //   row.getCell("G").numFmt = "#,##0.00";
    //   row.getCell("H").numFmt = "#,##0";
    //   row.getCell("I").numFmt = "#,##0";
    //   row.getCell("J").numFmt = "#,##0";
    //   row.getCell("K").numFmt = "#,##0";

    //   // Add borders
    //   ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K"].forEach((col) => {
    //     const cell = row.getCell(col);
    //     cell.border = {
    //       top: { style: "thin" },
    //       left: { style: "thin" },
    //       bottom: { style: "thin" },
    //       right: { style: "thin" },
    //     };
    //   });

    //   row.commit();
    // });

    // Add totals row at the end

    totalsRow.getCell("B").value = "TOTALS";
    totalsRow.getCell("B").font = { bold: true };

    // Apply same formatting to totals row
    ["C", "D", "E", "F", "G", "H", "I", "J", "K"].forEach((col) => {
      totalsRow.getCell(col).numFmt = "#,##0";
      if (col === "D" || col === "G") {
        totalsRow.getCell(col).numFmt = "#,##0.00";
      }
    });

    // Style totals row
    totalsRow.font = { bold: true };

    // Add borders to totals row
    ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K"].forEach((col) => {
      const cell = totalsRow.getCell(col);
      cell.border = {
        top: { style: "thin" },
        left: { style: "thin" },
        bottom: { style: "thin" },
        right: { style: "thin" },
      };
    });

    // Generate the modified Excel file
    const excelBuffer = await workbook.xlsx.writeBuffer();

    // Send back to user
    res.header(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.header(
      "Content-Disposition",
      `attachment; filename="SupplyReport_${file?.file_name || "export"}.xlsx"`
    );

    return res.send(excelBuffer);
  } catch (error) {
    console.error("Excel error:", error);
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DB_CONNECTION_ERROR", 500, "DB_ERROR");
    }
    throw error;
  }
};

export const importUserSupplyRsiExcel = async (
  req: FastifyRequest,
  res: FastifyReply
) => {
  const params = req.body as { id: string; itemIds: string[] };

  if (!params.id) throw new ValidationError("INVALID REQUIRED ID");
  if (!params.itemIds || params.itemIds.length === 0)
    throw new ValidationError("INVALID REQUIRED ITEM IDS");

  try {
    const [user, items] = await prisma.$transaction([
      prisma.user.findUnique({
        where: {
          id: params.id,
        },
        select: {
          line: {
            select: {
              province: {
                select: {
                  name: true,
                },
              },
              municipal: {
                select: {
                  name: true,
                },
              },
            },
          },
          firstName: true,
          lastName: true,
          id: true,
          department: {
            select: {
              name: true,
            },
          },
        },
      }),
      prisma.supplyDispenseRecord.findMany({
        where: {
          id: {
            in: params.itemIds,
          },
        },
        select: {
          id: true,
          quantity: true,
          supplyItem: {
            select: {
              item: true,
              id: true,
            },
          },
          desc: true,
          supply: {
            select: {
              quality: true,
            },
          },
        },
      }),
    ]);

    if (!user) throw new NotFoundError("USER NOT FOUND");
    if (items.length === 0) throw new NotFoundError("ITEMS NOT FOUND");

    // Use the NEW .xlsx URL
    const sampleTemplateUrl =
      "https://res.cloudinary.com/drhkb0ubf/raw/upload/v1766728188/RIS_2_ombjjk_1_zovq3y.xlsx";

    const response = await fetch(sampleTemplateUrl);

    if (!response.ok) {
      throw new AppError(
        "FAILED_TO_FETCH_TEMPLATE",
        500,
        `Failed to fetch Excel template: ${response.status} ${response.statusText}`
      );
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const { Readable } = require("stream");
    const stream = Readable.from(buffer);

    const workbook = new ExcelJs.Workbook();

    // Load the .xlsx template - this preserves ALL formatting
    await workbook.xlsx.read(stream);

    const worksheet = workbook.worksheets[0];

    // Verify we have the worksheet
    if (!worksheet) {
      throw new AppError("INVALID_TEMPLATE", 500, "Worksheet not found");
    }

    console.log(
      `Template loaded: ${worksheet.name}, Rows: ${worksheet.rowCount}`
    );

    // Modify ONLY cells C, G, H starting from row 9
    const startRow = 9;
    worksheet.getRow(6).getCell("A").value = "Recipient:";
    worksheet
      .getRow(6)
      .getCell("B").value = `${user.firstName} ${user.lastName}`;
    worksheet.getRow(6).getCell("A").value = "Recipient:";
    worksheet.getRow(5).getCell("B").value = `${
      user.department?.name || "N/A"
    }`;
    items.forEach((item, index) => {
      const rowNumber = startRow + index;

      // Get the existing row - it should exist in the template
      const row = worksheet.getRow(rowNumber);

      row.getCell("A").value = index + 1; // Serial number
      row.getCell("B").value = item.supply.quality || "N/A";
      // Column C: Item description
      const cellC = row.getCell("C");
      cellC.value = `${item.supplyItem?.item || "N/A"} - ${item.desc || "N/A"}`;

      // Column G: Quantity requested
      const cellG = row.getCell("G");
      cellG.value = item.quantity;

      // Column H: Quantity issued
      const cellH = row.getCell("H");
      cellH.value = item.quantity;

      // Commit the changes
      row.commit();
    });

    // Write to buffer
    const excelBuffer = await workbook.xlsx.writeBuffer();

    // Send the file
    res.header(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.header(
      "Content-Disposition",
      `attachment; filename="RIS_2_${user.firstName}_${user.lastName}.xlsx"`
    );

    return res.send(excelBuffer);
  } catch (error) {
    console.error("Error in importUserSupplyRsiExcel:", error);

    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DB_CONNECTION_ERROR", 500, "DB_ERROR");
    }

    if (error instanceof AppError) {
      throw error;
    }

    throw new AppError(
      "UNKNOWN_ERROR",
      500,
      error instanceof Error ? error.message : "An unknown error occurred"
    );
  }
};

export const importUnitSupplyRsiExcel = async (
  req: FastifyRequest,
  res: FastifyReply
) => {
  const params = req.body as { id: string; itemIds: string[] };

  if (!params.id) throw new ValidationError("INVALID REQUIRED ID");
  if (!params.itemIds || params.itemIds.length === 0)
    throw new ValidationError("INVALID REQUIRED ITEM IDS");

  try {
    const [unit, items] = await prisma.$transaction([
      prisma.department.findUnique({
        where: {
          id: params.id,
        },
        select: {
          line: {
            select: {
              province: {
                select: {
                  name: true,
                },
              },
              municipal: {
                select: {
                  name: true,
                },
              },
            },
          },
          name: true,
          id: true,
        },
      }),
      prisma.supplyDispenseRecord.findMany({
        where: {
          id: {
            in: params.itemIds,
          },
        },
        select: {
          id: true,
          quantity: true,
          supplyItem: {
            select: {
              item: true,
              id: true,
            },
          },
          desc: true,
          supply: {
            select: {
              quality: true,
            },
          },
        },
      }),
    ]);

    if (!unit) throw new NotFoundError("UNIT NOT FOUND");
    if (items.length === 0) throw new NotFoundError("ITEMS NOT FOUND");

    // Use the NEW .xlsx URL
    const sampleTemplateUrl =
      "https://res.cloudinary.com/drhkb0ubf/raw/upload/v1766728188/RIS_2_ombjjk_1_zovq3y.xlsx";

    const response = await fetch(sampleTemplateUrl);

    if (!response.ok) {
      throw new AppError(
        "FAILED_TO_FETCH_TEMPLATE",
        500,
        `Failed to fetch Excel template: ${response.status} ${response.statusText}`
      );
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const { Readable } = require("stream");
    const stream = Readable.from(buffer);

    const workbook = new ExcelJs.Workbook();

    // Load the .xlsx template - this preserves ALL formatting
    await workbook.xlsx.read(stream);

    const worksheet = workbook.worksheets[0];

    // Verify we have the worksheet
    if (!worksheet) {
      throw new AppError("INVALID_TEMPLATE", 500, "Worksheet not found");
    }

    console.log(
      `Template loaded: ${worksheet.name}, Rows: ${worksheet.rowCount}`
    );

    // Modify ONLY cells C, G, H starting from row 9
    const startRow = 9;
    worksheet.getRow(6).getCell("B").value = `${unit.name}`;
    items.forEach((item, index) => {
      const rowNumber = startRow + index;

      // Get the existing row - it should exist in the template
      const row = worksheet.getRow(rowNumber);

      row.getCell("A").value = index + 1; // Serial number
      row.getCell("B").value = item.supply.quality || "N/A";
      // Column C: Item description
      const cellC = row.getCell("C");
      cellC.value = `${item.supplyItem?.item || "N/A"} - ${item.desc || "N/A"}`;

      // Column G: Quantity requested
      const cellG = row.getCell("G");
      cellG.value = item.quantity;

      // Column H: Quantity issued
      const cellH = row.getCell("H");
      cellH.value = item.quantity;

      // Commit the changes
      row.commit();
    });

    // Write to buffer
    const excelBuffer = await workbook.xlsx.writeBuffer();

    // Send the file
    res.header(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.header(
      "Content-Disposition",
      `attachment; filename="RIS_2_${unit.name}.xlsx"`
    );

    return res.send(excelBuffer);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DB_CONNECTION_ERROR", 500, "DB_ERROR");
    }

    if (error instanceof AppError) {
      throw error;
    }

    throw new AppError(
      "UNKNOWN_ERROR",
      500,
      error instanceof Error ? error.message : "An unknown error occurred"
    );
  }
};
