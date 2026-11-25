/**
 * Reading back what was dispensed, by transaction, user or unit.
 *
 * Moved out of supplyController.ts, which had grown to 3,034 lines
 * across twenty unrelated handlers. The code itself is unchanged.
 */
import { FastifyReply, FastifyRequest } from "../../barrel/fastify";
import { assertOwned } from "../../service/inventoryScope";
import { Prisma, prisma } from "../../barrel/prisma";
import { PagingProps } from "../../models/route";
import { AppError, ValidationError, dbError } from "../../errors/errors";


export const supplyDispenseTransaction = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const params = req.query as PagingProps & {
    dateFrom?: string;
    dateTo?: string;
  };
  if (!params.id) throw new ValidationError("INVALID REQUIRED ID");
  try {
    const cursor = params.lastCursor ? { id: params.lastCursor } : undefined;
    const limit = params.limit ? parseInt(params.limit, 10) : 20;

    const filter: any = {
      supplyBatchId: params.id,
    };

    // Date range filter on timestamp.
    // dateFrom = inclusive start of day, dateTo = inclusive end of day.
    if (params.dateFrom || params.dateTo) {
      filter.timestamp = {};
      if (params.dateFrom) {
        const start = new Date(params.dateFrom);
        start.setHours(0, 0, 0, 0);
        filter.timestamp.gte = start;
      }
      if (params.dateTo) {
        const end = new Date(params.dateTo);
        end.setHours(23, 59, 59, 999);
        filter.timestamp.lte = end;
      }
    }

    if (params.query) {
      const searchTerms = params.query.trim().split(/\s+/);

      // Create OR conditions for each search term
      filter.OR = searchTerms.map((term) => ({
        OR: [
          // Search in user/dispensary names
          {
            user: {
              OR: [
                {
                  firstName: {
                    contains: term,
                    mode: "insensitive",
                  },
                },
                {
                  lastName: {
                    contains: term,
                    mode: "insensitive",
                  },
                },
              ],
            },
          },
          {
            dispensary: {
              OR: [
                {
                  firstName: {
                    contains: term,
                    mode: "insensitive",
                  },
                },
                {
                  lastName: {
                    contains: term,
                    mode: "insensitive",
                  },
                },
              ],
            },
          },
          // Search in department name
          {
            unit: {
              name: {
                contains: term,
                mode: "insensitive",
              },
            },
          },
          // Search in remarks
          {
            remarks: {
              contains: term,
              mode: "insensitive",
            },
          },
          // Search in quantity (exact match for numbers)
          {
            quantity: {
              equals: term,
            },
          },
          // Search in ID fields (partial match)
          {
            id: {
              contains: term,
              mode: "insensitive",
            },
          },
          // Search in supplyStockTrackId
          {
            supplyStockTrackId: {
              contains: term,
              mode: "insensitive",
            },
          },
          // Search in suppliesId
          {
            suppliesId: {
              contains: term,
              mode: "insensitive",
            },
          },
          // Search in userId
          {
            userId: {
              contains: term,
              mode: "insensitive",
            },
          },
          // Search in departmentId
          {
            departmentId: {
              contains: term,
              mode: "insensitive",
            },
          },
          // Search in inventoryBoxId
          {
            inventoryBoxId: {
              contains: term,
              mode: "insensitive",
            },
          },
        ],
      }));
    }

    const response = await prisma.supplyDispenseRecord.findMany({
      where: filter,
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
          },
        },
        unit: {
          select: {
            name: true,
          },
        },
        dispensary: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
          },
        },
      },
      skip: cursor ? 1 : 0,
      orderBy: {
        timestamp: "desc",
      },
      cursor,
      take: limit,
    });

    const newLastCursorId =
      response.length > 0 ? response[response.length - 1].id : null;
    const hasMore = limit === response.length;

    return res
      .code(200)
      .send({ list: response, hasMore, lastCursor: newLastCursorId });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw dbError(error);
    }
    throw error;
  }
};

export const supplyTransactionInfo = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const query = req.query as { id: string };
  console.log({ query });

  if (!query.id) {
    throw new ValidationError("INVALID_ID");
  }

  // Named "transaction", but the row it reads is a dispense record.
  await assertOwned(req, "dispense", query.id);

  try {
    const transaction = await prisma.supplyDispenseRecord.findUnique({
      where: {
        id: query.id,
      },
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            userProfilePictures: {
              select: {
                file_name: true,
                file_size: true,
                file_url: true,
              },
            },
          },
        },
        unit: {
          select: {
            id: true,
            name: true,
          },
        },
        supply: {
          select: {
            supply: {
              select: {
                item: true,
                refNumber: true,
                code: true,
              },
            },
            stock: true,
          },
        },
        supplyItem: {
          select: {
            item: true,
            id: true,
            code: true,
          },
        },
      },
    });

    if (!transaction) {
      throw new ValidationError("TRANSACTION_NOT_FOUND");
    }

    return res.code(200).send(transaction);
  } catch (error) {
    console.error("Error in supplyTransactionInfo:", error);

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

export const userSupplyDispenseRecords = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const query = req.query as PagingProps;
  console.log({ query });

  if (!query.id) {
    throw new ValidationError("INVALID_USER_ID");
  }

  try {
    const cursor = query.lastCursor ? { id: query.lastCursor } : undefined;
    const limit = query.limit ? parseInt(query.limit, 10) : 20;

    const records = await prisma.supplyDispenseRecord.findMany({
      where: {
        userId: query.id,
      },
      include: {
        supply: {
          select: {
            supply: {
              select: {
                item: true,
                refNumber: true,
                code: true,
              },
            },
            stock: true,
          },
        },
        dispensary: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
          },
        },
      },
      skip: cursor ? 1 : 0,
      take: limit,
      cursor,
    });
    console.log({ records });
    const newLastCursorId =
      records.length > 0 ? records[records.length - 1].id : null;
    const hasMore = records.length === limit;

    return res
      .code(200)
      .send({ list: records, lastCursor: newLastCursorId, hasMore });
  } catch (error) {
    console.error("Error in userSupplyDispenseRecords:", error);

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

export const unitSupplyDispenseRecords = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const query = req.query as PagingProps;
  console.log("Unit: ", { query });
  if (!query.id) {
    throw new ValidationError("INVALID_UNIT_ID");
  }
  try {
    const cursor = query.lastCursor ? { id: query.lastCursor } : undefined;
    const limit = query.limit ? parseInt(query.limit, 10) : 20;
    const records = await prisma.supplyDispenseRecord.findMany({
      where: {
        departmentId: query.id,
      },
      include: {
        dispensary: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
          },
        },
        supply: {
          select: {
            supply: {
              select: {
                item: true,
                refNumber: true,
                code: true,
              },
            },
            stock: true,
          },
        },
        supplyItem: {
          select: {
            item: true,
            id: true,
          },
        },
      },
      skip: cursor ? 1 : 0,
      take: limit,
      cursor,
    });
    const newLastCursorId =
      records.length > 0 ? records[records.length - 1].id : null;
    const hasMore = records.length === limit;
    return res
      .code(200)
      .send({ list: records, lastCursor: newLastCursorId, hasMore });
  } catch (error) {
    console.error("Error in unitSupplyDispenseRecords:", error);

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
