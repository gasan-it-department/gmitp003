/**
 * Period reports and their spreadsheet exports.
 *
 * Moved out of supplyController.ts, which had grown to 3,034 lines
 * across twenty unrelated handlers. The code itself is unchanged.
 */
import { FastifyReply, FastifyRequest } from "../../barrel/fastify";
import { Prisma, prisma } from "../../barrel/prisma";
import ExcelJS from "exceljs";
import { PagingProps, TimebaseGroupPrice } from "../../models/route";
import { AppError, ValidationError } from "../../errors/errors";
import { getPriceTotal } from "../../utils/date";


export const timebaseSupplyReport = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const params = req.query as PagingProps;
  if (!params.id) throw new ValidationError("BAD_REQUEST");

  try {
    let period: number = 1;
    if (params.period === "Quarterly") period = 4;
    if (params.period === "Semi-Annual") period = 2;
    if (params.period === "Annually") period = 1;

    const cursor = params.lastCursor ? { id: params.lastCursor } : undefined;

    const currentYear = new Date().getFullYear();
    const startOfYear = new Date(currentYear, 0, 1); // Jan 1, current year
    const endOfYear = new Date(currentYear, 11, 31, 23, 59, 59, 999);

    const response = await prisma.supplyStockTrack.findMany({
      where: {
        supplyBatchId: params.id,
        supply: {
          SupplyOrder: {
            some: {
              status: { not: "Drafted" },
            },
          },
        },
      },
      include: {
        price: {
          where: {
            timestamp: {
              gte: startOfYear,
              lt: endOfYear,
            },
          },
          select: {
            value: true,
            timestamp: true,
          },
        },
        supply: {
          select: {
            id: true,
            item: true,
          },
        },
      },
      cursor,
    });

    const groupedPrice: TimebaseGroupPrice[] = [];

    response.forEach((item) => {
      const existed = groupedPrice.find((stock) => stock.item.id === item.id);
      if (!existed) {
        groupedPrice.push({
          item: item,
          price: {
            first: getPriceTotal(item.price, period, 1),
            second: getPriceTotal(item.price, period, 2),
            third: getPriceTotal(item.price, period, 3),
            fourth: getPriceTotal(item.price, period, 4),
          },
        });
      }
    });

    const newLastCursorId =
      groupedPrice.length > 0
        ? groupedPrice[groupedPrice.length - 1].item.id
        : null;
    const hasMore = groupedPrice.length === parseInt(params.limit, 10);

    return res
      .code(200)
      .send({ list: groupedPrice, lastCursor: newLastCursorId, hasMore });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DB_CONNECTION_ERROR", 500, "DB_ERROR");
    }
    throw error;
  }
};

export const supplyTimeBaseReport = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const params = req.query as PagingProps;
  console.log({ params });

  if (!params.id) throw new ValidationError("INVALID REQUIRED ID");
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

    const yearStart = years.length > 1 ? years[years.length - 1] : years[0];
    const yearEnd = years[0];

    // If yearStart is still NaN (unlikely with our validation), fallback to current year
    const finalYearStart = !isNaN(yearStart)
      ? yearStart
      : new Date().getFullYear();

    console.log("Selected Year: ", finalYearStart);

    const firstHalfStart = new Date(finalYearStart, 0, 1); // January 1
    const firstHalfEnd = new Date(finalYearStart, 5, 30, 23, 59, 59, 999); // June 30
    const secondHalfStart = new Date(yearEnd, 6, 1); // July 1
    const secondHalfEnd = new Date(yearEnd, 11, 31, 23, 59, 59, 999); // December 31

    console.log({
      firstHalfEnd: firstHalfEnd,
      firstHalfStart: firstHalfStart,
      secondHalfEnd: secondHalfEnd,
      secondHalfStart: secondHalfStart,
    });

    const cursor = params.lastCursor ? { id: params.lastCursor } : undefined;
    const limit = params.limit ? parseInt(params.limit) : 20;

    //console.log(JSON.stringify(supplies, null, 2));

    const response = await prisma.supplies.findMany({
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
      skip: cursor ? 1 : 0,
      take: limit,
      cursor,
    });

    console.log({ response });

    const processedData = response.map((item) => {
      console.log("Entry");

      // Calculate individual supply data
      const firstHalfRecieved = item.SupplieRecieveHistory.reduce(
        (base, acc) => {
          if (
            acc.timestamp >= firstHalfStart &&
            acc.timestamp <= firstHalfEnd
          ) {
            console.log("1 R found");

            return (base += acc.quantity);
          }
          return base;
        },
        0,
      );

      const secondhalfRecieved = item.SupplieRecieveHistory.reduce(
        (base, acc) => {
          if (
            acc.timestamp >= secondHalfStart &&
            acc.timestamp <= secondHalfEnd
          ) {
            console.log("2 R found");
            return (base += acc.quantity);
          }
          return base;
        },
        0,
      );

      const firstHalfCost = item.SupplieRecieveHistory.reduce((base, acc) => {
        if (acc.timestamp >= firstHalfStart && acc.timestamp <= firstHalfEnd) {
          console.log("1 C found");

          return (base += acc.pricePerItem);
        }
        return base;
      }, 0);

      const secondhalfCost = item.SupplieRecieveHistory.reduce((base, acc) => {
        if (
          acc.timestamp >= secondHalfStart &&
          acc.timestamp <= secondHalfEnd
        ) {
          return (base += acc.pricePerItem);
        }
        return base;
      }, 0);

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
        0,
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
        0,
      );
      const totalQuantity = firstHalfRecieved + secondhalfRecieved;
      const totalInsuance = firstHalfdispense + secondHalfDispense;
      const totalBalance = totalQuantity - totalInsuance;

      return {
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
      };
    });

    const newLastCursorId =
      processedData.length > 0
        ? processedData[processedData.length - 1].id
        : null;
    const hasMore = limit === processedData.length;
    console.log({ processedData });

    return res
      .code(200)
      .send({ list: processedData, newLastCursorId, hasMore });
  } catch (error) {
    console.error("Error in supplyTimeBaseReport:", error);

    if (error instanceof ValidationError) {
      throw error;
    }

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

/**
 * Quarterly stock + dispense report.
 *
 * Behaviour:
 * - When `quarter` is a valid number (1-4): each item is returned as a
 *   per-quarter object whose populated field is the requested quarter only;
 *   dispense records are filtered to that quarter's date range.
 * - Otherwise: returns every item with all four quarters (q1..q4) computed,
 *   plus a full list of the dispense records for the year.
 */
/**
 * Inventory issuance report.
 *
 * Returns each stock-track row with up to the first 5 issuance (dispense)
 * records of the chosen year (optionally narrowed to a single quarter) laid
 * out as `first`, `second`, `third`, `fourth`, `fifth`. Records beyond the
 * 5th are still counted into `totalDispensed` so the balance math stays
 * correct.
 *
 * Query params:
 *   - id      (required) supplyBatchId
 *   - year    (optional, defaults to current year) — 4-digit issuance year
 *   - quarter (optional, 1..4) — narrows the issuance pool to that quarter
 *   - lastCursor / limit — standard cursor paging
 */

export const timebaseReport = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const params = req.query as PagingProps & {
    year?: string | number;
    quarter?: string | number;
  };

  if (!params.id) {
    throw new ValidationError("INVALID REQUIRED FIELD");
  }

  try {
    const cursor = params.lastCursor ? { id: params.lastCursor } : undefined;
    const limit = params.limit ? parseInt(params.limit, 10) : 20;

    // ── Year (defaults to current) ─────────────────────────────────────────
    const yearNum =
      typeof params.year === "number"
        ? params.year
        : typeof params.year === "string" && /^\d{4}$/.test(params.year.trim())
          ? parseInt(params.year.trim(), 10)
          : new Date().getFullYear();

    // ── Quarter (optional, 1..4) ───────────────────────────────────────────
    const quarterRaw =
      typeof params.quarter === "number"
        ? params.quarter
        : typeof params.quarter === "string" && params.quarter.trim() !== ""
          ? parseInt(params.quarter, 10)
          : NaN;
    const quarter =
      Number.isFinite(quarterRaw) && quarterRaw >= 1 && quarterRaw <= 4
        ? (quarterRaw as 1 | 2 | 3 | 4)
        : null;

    // ── Date range — full year, or just the requested quarter ─────────────
    const quarterRanges: Record<1 | 2 | 3 | 4, { start: Date; end: Date }> = {
      1: {
        start: new Date(yearNum, 0, 1),
        end: new Date(yearNum, 2, 31, 23, 59, 59, 999),
      },
      2: {
        start: new Date(yearNum, 3, 1),
        end: new Date(yearNum, 5, 30, 23, 59, 59, 999),
      },
      3: {
        start: new Date(yearNum, 6, 1),
        end: new Date(yearNum, 8, 30, 23, 59, 59, 999),
      },
      4: {
        start: new Date(yearNum, 9, 1),
        end: new Date(yearNum, 11, 31, 23, 59, 59, 999),
      },
    };
    const rangeStart = quarter
      ? quarterRanges[quarter].start
      : new Date(yearNum, 0, 1);
    const rangeEnd = quarter
      ? quarterRanges[quarter].end
      : new Date(yearNum, 11, 31, 23, 59, 59, 999);

    const response = await prisma.supplyStockTrack.findMany({
      where: { supplyBatchId: params.id },
      skip: cursor ? 1 : 0,
      take: limit,
      cursor,
      orderBy: { timestamp: "desc" },
      select: {
        SupplyDispenseRecord: {
          where: { timestamp: { gte: rangeStart, lte: rangeEnd } },
          select: { quantity: true, timestamp: true },
          orderBy: { timestamp: "asc" }, // chronological → first = earliest
        },
        supply: {
          select: {
            item: true,
            SupplieRecieveHistory: {
              // Initial QTY scoped to THIS list + the selected year/quarter
              where: {
                supplyBatchId: params.id,
                timestamp: { gte: rangeStart, lte: rangeEnd },
              },
              select: {
                quality: true,
                perQuantity: true,
                pricePerItem: true,
                quantity: true,
                timestamp: true,
              },
              orderBy: { timestamp: "desc" },
            },
          },
        },
        price: {
          // Price fallback also scoped to the selected year/quarter
          where: { timestamp: { gte: rangeStart, lte: rangeEnd } },
          select: { value: true, timestamp: true },
          orderBy: { timestamp: "desc" },
          take: 1,
        },
        stock: true,
        perQuantity: true,
        quantity: true,
        quality: true,
        id: true,
      },
    });

    const parseQty = (q: string | null | undefined) =>
      q ? parseInt(q, 10) || 0 : 0;
    const slot = (records: { quantity: string }[], index: number) =>
      records[index]?.quantity ? parseQty(records[index].quantity) : null;

    const processedData = response.map((item) => {
      const records = item.SupplyDispenseRecord;
      // Scope received qty to THIS batch (segmented by unit/quality + per-qty).
      // Receive history is fetched per supply+list, but a supply can have
      // several batches in one list — without this filter every batch row would
      // show the supply's combined receive total.
      const receiveHistory = (item.supply?.SupplieRecieveHistory ?? []).filter(
        (r) =>
          (r.quality ?? null) === (item.quality ?? null) &&
          (r.perQuantity || 0) === (item.perQuantity || 0),
      );

      // ── Initial QTY = Σ (receive.quantity × receive.perQuantity) ─────────
      const totalStock = receiveHistory.reduce(
        (sum, r) => sum + (r.quantity ?? 0) * (r.perQuantity || 1),
        0,
      );

      // Unit cost: latest pricePerItem from receive history, falling back to
      // SupplyPriceTrack, then 0.
      const latestPrice =
        receiveHistory[0]?.pricePerItem ?? item.price?.[0]?.value ?? 0;

      const totalDispensed = records.reduce(
        (sum, r) => sum + parseQty(r.quantity),
        0,
      );
      const remaining = totalStock - totalDispensed;

      return {
        id: item.id,
        desc: item.supply?.item ?? "N/A",
        unit: receiveHistory[0]?.quality ?? item.quality ?? "N/A",
        first: slot(records, 0),
        second: slot(records, 1),
        third: slot(records, 2),
        fourth: slot(records, 3),
        fifth: slot(records, 4),
        recordedIssuances: records.length,
        totalDispensed,
        qty: totalStock,                       // initial QTY
        unitCost: latestPrice,                 // per-unit price
        totalCost: totalStock * latestPrice,   // qty × unit cost
        balStock: remaining,                   // remaining stock on hand
        balAmount: remaining * latestPrice,    // balance × unit cost
        // legacy aliases (kept so any older consumer doesn't break)
        totalStock,
        price: latestPrice,
      };
    });

    const newLastCursorId =
      processedData.length > 0
        ? processedData[processedData.length - 1].id
        : null;
    const hasMore = processedData.length === limit;

    return res.code(200).send({
      list: processedData,
      lastCursor: newLastCursorId,
      hasMore,
      meta: { year: yearNum, quarter: quarter ?? null },
    });
  } catch (error) {
    console.error("Error in timebaseReport:", error);

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

/**
 * Excel export of the inventory issuance report.
 * Renders the SUPPLIES YYYY workbook layout: letterhead → "As of …" →
 * merged "ISSUANCE YYYY" header spanning 1ST..5TH → data rows → TOTAL →
 * Certified Correct block.
 */

/**
 * Excel export of the inventory issuance report.
 * Renders the SUPPLIES YYYY workbook layout: letterhead → "As of …" →
 * merged "ISSUANCE YYYY" header spanning 1ST..5TH → data rows → TOTAL →
 * Certified Correct block.
 */

export const timebaseReportExport = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const params = req.query as {
    id?: string;
    year?: string | number;
    quarter?: string | number;
    listTitle?: string;
    certifiedBy?: string;
    certifiedTitle?: string;
  };

  if (!params.id) throw new ValidationError("INVALID REQUIRED FIELD");

  try {
    const yearNum =
      typeof params.year === "number"
        ? params.year
        : typeof params.year === "string" && /^\d{4}$/.test(params.year.trim())
          ? parseInt(params.year.trim(), 10)
          : new Date().getFullYear();

    const quarterRaw =
      typeof params.quarter === "number"
        ? params.quarter
        : typeof params.quarter === "string" && params.quarter.trim() !== ""
          ? parseInt(params.quarter, 10)
          : NaN;
    const quarter =
      Number.isFinite(quarterRaw) && quarterRaw >= 1 && quarterRaw <= 4
        ? (quarterRaw as 1 | 2 | 3 | 4)
        : null;

    const quarterRanges: Record<1 | 2 | 3 | 4, { start: Date; end: Date }> = {
      1: {
        start: new Date(yearNum, 0, 1),
        end: new Date(yearNum, 2, 31, 23, 59, 59, 999),
      },
      2: {
        start: new Date(yearNum, 3, 1),
        end: new Date(yearNum, 5, 30, 23, 59, 59, 999),
      },
      3: {
        start: new Date(yearNum, 6, 1),
        end: new Date(yearNum, 8, 30, 23, 59, 59, 999),
      },
      4: {
        start: new Date(yearNum, 9, 1),
        end: new Date(yearNum, 11, 31, 23, 59, 59, 999),
      },
    };
    const rangeStart = quarter
      ? quarterRanges[quarter].start
      : new Date(yearNum, 0, 1);
    const rangeEnd = quarter
      ? quarterRanges[quarter].end
      : new Date(yearNum, 11, 31, 23, 59, 59, 999);

    const rows = await prisma.supplyStockTrack.findMany({
      where: { supplyBatchId: params.id },
      orderBy: { timestamp: "desc" },
      select: {
        SupplyDispenseRecord: {
          where: { timestamp: { gte: rangeStart, lte: rangeEnd } },
          select: { quantity: true, timestamp: true },
          orderBy: { timestamp: "asc" },
        },
        supply: {
          select: {
            item: true,
            SupplieRecieveHistory: {
              // Scoped to THIS list + the selected year/quarter range
              where: {
                supplyBatchId: params.id,
                timestamp: { gte: rangeStart, lte: rangeEnd },
              },
              select: {
                quantity: true,
                perQuantity: true,
                pricePerItem: true,
                quality: true,
                timestamp: true,
              },
              orderBy: { timestamp: "desc" },
            },
          },
        },
        price: {
          // Price fallback also scoped to the selected year/quarter
          where: { timestamp: { gte: rangeStart, lte: rangeEnd } },
          select: { value: true, timestamp: true },
          orderBy: { timestamp: "desc" },
          take: 1,
        },
        stock: true,
        perQuantity: true,
        quantity: true,
        quality: true,
        id: true,
      },
    });

    const parseQty = (q: string | null | undefined) =>
      q ? parseInt(q, 10) || 0 : 0;

    const items = rows.map((item) => {
      const records = item.SupplyDispenseRecord;
      // Scope received qty to THIS batch (unit/quality + per-qty), matching the
      // on-screen report.
      const receiveHistory = (item.supply?.SupplieRecieveHistory ?? []).filter(
        (r) =>
          (r.quality ?? null) === (item.quality ?? null) &&
          (r.perQuantity || 0) === (item.perQuantity || 0),
      );

      // Initial QTY = Σ (receive.quantity × receive.perQuantity)
      const totalStock = receiveHistory.reduce(
        (sum, r) => sum + (r.quantity ?? 0) * (r.perQuantity || 1),
        0,
      );
      // Unit cost: latest pricePerItem from receive history → fallback to
      // SupplyPriceTrack → 0.
      const unitCost =
        receiveHistory[0]?.pricePerItem ?? item.price?.[0]?.value ?? 0;

      const totalDispensed = records.reduce(
        (s, r) => s + parseQty(r.quantity),
        0,
      );
      const balStock = totalStock - totalDispensed;
      return {
        desc: item.supply?.item ?? "N/A",
        unit: receiveHistory[0]?.quality ?? item.quality ?? "",
        first: records[0]?.quantity ? parseQty(records[0].quantity) : null,
        second: records[1]?.quantity ? parseQty(records[1].quantity) : null,
        third: records[2]?.quantity ? parseQty(records[2].quantity) : null,
        fourth: records[3]?.quantity ? parseQty(records[3].quantity) : null,
        fifth: records[4]?.quantity ? parseQty(records[4].quantity) : null,
        qty: totalStock,
        unitCost,
        totalCost: totalStock * unitCost,
        balStock,
        balAmount: balStock * unitCost,
      };
    });

    // Workbook layout matches the supplied SUPPLIES YYYY template exactly:
    //   Columns A..M: Item No. | DESCRIPTION | UNIT | QTY | UNIT COST |
    //   TOTAL COST | 1ST | 2ND | 3RD | 4TH | 5TH | Balance On Stock | Total Amount
    //   Header group "ISSUANCE {YEAR}" spans D9:M9.
    const wb = new ExcelJS.Workbook();
    wb.creator = "GMITP";
    wb.created = new Date();
    const ws = wb.addWorksheet(`Supplies ${yearNum}`, {
      views: [{ state: "frozen", ySplit: 10 }],
    });

    ws.columns = [
      { width: 7 },    // A Item No.
      { width: 41.8 }, // B DESCRIPTION
      { width: 10.5 }, // C UNIT
      { width: 12 },   // D QTY
      { width: 12 },   // E UNIT COST
      { width: 12 },   // F TOTAL COST
      { width: 10 },   // G 1ST
      { width: 10 },   // H 2ND
      { width: 10 },   // I 3RD
      { width: 10 },   // J 4TH
      { width: 10 },   // K 5TH
      { width: 14 },   // L Balance On Stock
      { width: 14 },   // M Total Amount
    ];

    // ── Letterhead (rows 1, 2, 3, blank 4, title 5, blank 6, "As of" 7) ──
    const letterhead: { row: number; text: string; bold: boolean; size: number }[] = [
      { row: 1, text: "Republic of the Philippines",    bold: false, size: 11 },
      { row: 2, text: "Province of Marinduque",         bold: false, size: 11 },
      { row: 3, text: "MUNICIPALITY OF GASAN",          bold: true,  size: 11 },
      { row: 5, text: "SUPPLIES & EQUIPMENT INVENTORY", bold: true,  size: 14 },
    ];
    letterhead.forEach(({ row, text, bold, size }) => {
      const r = ws.getRow(row);
      r.getCell(1).value = text;
      ws.mergeCells(row, 1, row, 13);
      r.alignment = { horizontal: "center", vertical: "middle" };
      r.font = { name: "Arial", bold, size };
    });

    const monthName = new Date(yearNum, new Date().getMonth(), 1)
      .toLocaleString("en-US", { month: "long" })
      .toUpperCase();
    const asOf = quarter
      ? `As of Q${quarter} ${yearNum}`
      : `As of ${monthName} ${yearNum}`;
    ws.getRow(7).getCell(1).value = asOf;
    ws.mergeCells(7, 1, 7, 13);
    ws.getRow(7).alignment = { horizontal: "center" };
    ws.getRow(7).font = { name: "Arial", italic: true, size: 11 };

    // ── Table headers in rows 9-10 ───────────────────────────────────────
    const headerTopRow = 9;
    const headerSubRow = 10;

    // Row 9 top headers (parent labels)
    ws.getRow(headerTopRow).values = [
      "Item No.",          // A
      "DESCRIPTION",       // B
      "UNIT",              // C
      `ISSUANCE ${yearNum}`, // D — merged across D9:M9
      null, null, null, null, null, null, null, null, null,
    ];
    // Row 10 sub-headers
    ws.getRow(headerSubRow).values = [
      null, null, null,
      "QTY",         // D
      "UNIT COST",   // E
      "TOTAL COST",  // F
      "1ST",         // G
      "2ND",         // H
      "3RD",         // I
      "4TH",         // J
      "5TH",         // K
      "Balance On Stock", // L
      "Total Amount",     // M
    ];

    // Merges
    ws.mergeCells(headerTopRow, 1, headerSubRow, 1);  // A9:A10 Item No.
    ws.mergeCells(headerTopRow, 2, headerSubRow, 2);  // B9:B10 DESCRIPTION
    ws.mergeCells(headerTopRow, 3, headerSubRow, 3);  // C9:C10 UNIT
    ws.mergeCells(headerTopRow, 4, headerTopRow, 13); // D9:M9  ISSUANCE YYYY

    const styleHeader = (rowIdx: number) => {
      const row = ws.getRow(rowIdx);
      row.font = { bold: true, size: 10 };
      row.alignment = {
        horizontal: "center",
        vertical: "middle",
        wrapText: true,
      };
      row.height = 22;
      row.eachCell({ includeEmpty: true }, (cell) => {
        cell.border = {
          top: { style: "thin" },
          left: { style: "thin" },
          right: { style: "thin" },
          bottom: { style: "thin" },
        };
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FFF2F2F2" },
        };
      });
    };
    styleHeader(headerTopRow);
    styleHeader(headerSubRow);

    // ── Data rows starting at row 11, columns matching template A..M ─────
    const dataStartRow = headerSubRow + 1;
    items.forEach((it, i) => {
      const rowIdx = dataStartRow + i;
      const r = ws.getRow(rowIdx);
      r.values = [
        i + 1,        // A Item No.
        it.desc,      // B DESCRIPTION
        it.unit,      // C UNIT
        it.qty,       // D QTY
        it.unitCost,  // E UNIT COST
        // F TOTAL COST as a live D*E formula (matches the original template)
        { formula: `D${rowIdx}*E${rowIdx}`, result: it.totalCost },
        it.first  ?? "", // G 1ST
        it.second ?? "", // H 2ND
        it.third  ?? "", // I 3RD
        it.fourth ?? "", // J 4TH
        it.fifth  ?? "", // K 5TH
        it.balStock,     // L Balance On Stock
        it.balAmount,    // M Total Amount
      ];
      r.font = { name: "Arial", size: 10 };
      r.alignment = { vertical: "middle" };
      r.getCell(1).alignment = { horizontal: "center", vertical: "middle" };
      r.getCell(2).alignment = { horizontal: "left",   vertical: "middle", wrapText: true };
      r.getCell(3).alignment = { horizontal: "center", vertical: "middle" };
      r.getCell(4).alignment = { horizontal: "center", vertical: "middle" }; // QTY
      // Currency cells: E UNIT COST, F TOTAL COST, M Total Amount
      [5, 6, 13].forEach((c) => {
        r.getCell(c).numFmt = '"₱"#,##0.00';
        r.getCell(c).alignment = { horizontal: "right", vertical: "middle" };
      });
      // Issuance slots G..K — centered
      for (let c = 7; c <= 11; c++) {
        r.getCell(c).alignment = { horizontal: "center", vertical: "middle" };
      }
      r.getCell(12).alignment = { horizontal: "center", vertical: "middle" };
      r.eachCell({ includeEmpty: true }, (cell) => {
        cell.border = {
          top: { style: "thin" },
          left: { style: "thin" },
          right: { style: "thin" },
          bottom: { style: "thin" },
        };
      });
    });

    // ── TOTAL row ────────────────────────────────────────────────────────
    const totalRowIdx = dataStartRow + items.length;
    const totalRow = ws.getRow(totalRowIdx);
    const totalQty    = items.reduce((s, x) => s + x.qty, 0);
    const totalCost   = items.reduce((s, x) => s + x.totalCost, 0);
    const totalAmount = items.reduce((s, x) => s + x.balAmount, 0);
    totalRow.values = [
      null,        // A
      "TOTAL",     // B (merged label across A:C)
      null,        // C
      totalQty,    // D
      null,        // E
      totalCost,   // F
      null, null, null, null, null, // G..K issuance slots
      null,        // L Balance On Stock (blank — sum doesn't make sense across mixed units)
      totalAmount, // M Total Amount
    ];
    ws.mergeCells(totalRowIdx, 1, totalRowIdx, 3); // "TOTAL" label spans A:C

    totalRow.font = { name: "Arial", bold: true, size: 10 };
    totalRow.getCell(2).alignment = { horizontal: "right",  vertical: "middle" };
    totalRow.getCell(4).alignment = { horizontal: "center", vertical: "middle" };
    [5, 6, 13].forEach((c) => {
      totalRow.getCell(c).numFmt = '"₱"#,##0.00';
      totalRow.getCell(c).alignment = { horizontal: "right", vertical: "middle" };
    });
    totalRow.eachCell({ includeEmpty: true }, (cell) => {
      cell.border = {
        top:    { style: "double" }, left:   { style: "thin" },
        right:  { style: "thin"   }, bottom: { style: "double" },
      };
      cell.fill = {
        type: "pattern", pattern: "solid",
        fgColor: { argb: "FFFAFAFA" },
      };
    });

    const certByRow = totalRowIdx + 3;
    ws.getRow(certByRow).getCell(2).value = "Certified Correct:";
    ws.getRow(certByRow).getCell(2).font = { italic: true, size: 10 };

    const signerRow = certByRow + 3;
    ws.getRow(signerRow).getCell(2).value =
      params.certifiedBy ?? "MICHELLE CHRISTINE Z. ILAO";
    ws.getRow(signerRow).getCell(2).font = { bold: true, size: 10 };

    const titleRow = signerRow + 1;
    ws.getRow(titleRow).getCell(2).value =
      params.certifiedTitle ?? "Administrative Officer I (SO I)";
    ws.getRow(titleRow).getCell(2).font = { italic: true, size: 9 };

    const buffer = (await wb.xlsx.writeBuffer()) as ArrayBuffer;
    const nodeBuffer = Buffer.from(new Uint8Array(buffer));

    const filenameSafe = (
      params.listTitle ?? `SUPPLIES_${yearNum}${quarter ? `_Q${quarter}` : ""}`
    ).replace(/[^a-z0-9_\-]+/gi, "_");

    return res
      .code(200)
      .header(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      )
      .header(
        "Content-Disposition",
        `attachment; filename="${filenameSafe}.xlsx"`,
      )
      .send(nodeBuffer);
  } catch (error) {
    console.error("Error in timebaseReportExport:", error);
    if (error instanceof ValidationError) throw error;
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DB_CONNECTION_ERROR", 500, "Database error occurred");
    }
    throw new AppError("INTERNAL_ERROR", 500, "An unexpected error occurred");
  }
};
