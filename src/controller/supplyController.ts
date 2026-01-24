import { FastifyReply, FastifyRequest } from "../barrel/fastify";
import { Prisma, prisma } from "../barrel/prisma";
//
import {
  AddNewSupplyProps,
  DispenseItemProps,
  PagingProps,
  TimebaseGroupPrice,
  UpdateSupplyProps,
} from "../models/route";
import { generatedItemCode, generateOrderRef } from "../middleware/handler";
import { AppError, NotFoundError, ValidationError } from "../errors/errors";
import { getPriceTotal } from "../utils/date";
export const addSupply = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const body = req.body as AddNewSupplyProps;

    if (!body.item || !body.suppliesDataSetId || !body.lineId) {
      return res.code(400).send({ message: "Bad Request" });
    }
    const code = await generatedItemCode();
    await prisma.$transaction([
      prisma.supplies.create({
        data: {
          item: body.item,
          suppliesDataSetId: body.suppliesDataSetId,
          lineId: body.lineId,
          description: body.description,

          consumable: body.consumable,
          code,
        },
      }),
      prisma.inventoryAccessLogs.create({
        data: {
          userId: body.userId,
          inventoryBoxId: body.inventoryBoxId,
          action: `Added Supply: ${body.item}`,
          timestamp: new Date(),
        },
      }),
    ]);

    return res.code(200).send({ message: "OK" });
  } catch (error) {
    console.log(error);
    res.code(500).send({ message: "Internal Server Error" });
  }
};

export const deleteSupply = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const body = req.query as {
      id: string;
      userId: string;
      inventoryBoxId: string;
    };
    if (!body.id || !body.userId || !body.inventoryBoxId) {
      return res.code(400).send({ message: "Bad Request!" });
    }
    await prisma.$transaction([
      prisma.supplies.delete({
        where: {
          id: body.id,
        },
      }),
      prisma.inventoryAccessLogs.create({
        data: {
          action: "Deleted an item.",
          inventoryBoxId: body.inventoryBoxId,
          userId: body.userId,
          timestamp: new Date(),
        },
      }),
    ]);
  } catch (error) {
    console.log(error);
    res.code(500).send({ message: "Internal Server Error" });
  }
};

export const updateSupply = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const body = req.body as UpdateSupplyProps;

    if (!body.id) {
      return res.code(400).send({ message: "Bad Request" });
    }
    const toUpdate: any = {
      consumable: body.consumable,
    };

    if (body.item) {
      toUpdate.item = body.item;
    }
    if (body.description) {
      toUpdate.description = body.description;
    }

    await prisma.$transaction([
      prisma.supplies.update({
        where: {
          id: body.id,
        },
        data: toUpdate,
      }),
      // prisma.inventoryAccessLogs.create({
      //   data:{

      //   }
      // })
    ]);
  } catch (error) {
    console.log(error);
    res.code(500).send({ message: "Internal Server Error" });
  }
};

export const newOrder = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const params = req.body as { title: string; id: string; lineId: string };
    console.log("New ORder:", params);

    const refNumber = await generateOrderRef();
    const response = await prisma.supplyBatchOrder.create({
      data: {
        title: params.title,
        refNumber,
        supplyBatchId: params.id,
        status: 0,
        lineId: params.lineId,
      },
    });

    res.code(200).send({ message: "OK", data: response });
  } catch (error) {
    console.log(error);
    res.code(500).send({ message: "Internal Server Error" });
  }
};

export const dispenseSupply = async (
  req: FastifyRequest,
  res: FastifyReply
) => {
  const body = req.body as DispenseItemProps;

  if (!body.id || !body.quantity || parseInt(body.quantity, 10) <= 0) {
    throw new ValidationError("Item ID and positive quantity are required");
  }

  try {
    const stock = await prisma.supplyStockTrack.findUnique({
      where: {
        id: body.id,
      },
      select: {
        quantity: true,
        perQuantity: true,
        id: true,
        stock: true,
        suppliesId: true,
        desc: true,
      },
    });

    if (!stock) {
      throw new NotFoundError("ITEM NOT FOUND");
    }

    const currentBoxes = stock.quantity;
    const perBox = stock.perQuantity;
    const currentStockPieces = stock.stock;
    const toDispense = parseInt(body.quantity, 10);

    console.log("Stock data:", {
      stock,
    });

    // Check if database consistency issue
    if (currentStockPieces !== currentBoxes * perBox) {
      console.warn(`Database inconsistency:
        stock.stock = ${currentStockPieces},
        but quantity * perQuantity = ${currentBoxes * perBox}`);
      // You might want to fix this or use stock.stock as source of truth
    }

    // Check if enough stock
    if (toDispense > currentStockPieces) {
      throw new ValidationError(
        `Insufficient stock. Available: ${currentStockPieces}, Requested: ${toDispense}`
      );
    }

    // Calculate dispensing details - FIXED LOGIC
    const fullBoxesToGive = Math.floor(toDispense / perBox);
    const loosePieces = toDispense % perBox;

    console.log("Dispensing calculation:", {
      fullBoxesToGive,
      loosePieces,
    });

    // Calculate remaining inventory - SIMPLIFIED CORRECT LOGIC
    let remainingFullBoxes = currentBoxes - fullBoxesToGive;
    let openedBoxRemainingPieces = 0;

    if (loosePieces > 0) {
      // We need to open a box for loose pieces
      remainingFullBoxes -= 1; // Remove the box we're opening
      openedBoxRemainingPieces = perBox - loosePieces; // What's left in that opened box
    }

    // Total pieces calculation
    const remainingPieces =
      remainingFullBoxes * perBox + openedBoxRemainingPieces;

    // Also calculate expected remaining pieces
    const expectedRemainingPieces = currentStockPieces - toDispense;

    console.log("Remaining calculation:", {
      remainingFullBoxes,
      openedBoxRemainingPieces,
      remainingPieces,
      expectedRemainingPieces,
      check: remainingPieces === expectedRemainingPieces,
    });

    // Verify calculation matches
    if (remainingPieces !== expectedRemainingPieces) {
      console.error("Calculation mismatch details:", {
        currentStockPieces,
        toDispense,
        remainingPieces,
        expectedRemainingPieces,
        difference: remainingPieces - expectedRemainingPieces,
      });
      throw new Error(`Inventory calculation mismatch:
        Got ${remainingPieces}, Expected ${expectedRemainingPieces}`);
    }

    // Prepare update data
    // The quantity field should represent total boxes (full + partial)
    const totalBoxesAfter =
      remainingFullBoxes + (openedBoxRemainingPieces > 0 ? 1 : 0);

    const updateData: any = {
      quantity: totalBoxesAfter,
      stock: remainingPieces,
    };

    console.log("Update data:", updateData);

    // Prepare data for dispense record - Using ALL fields from your schema
    const dispenseRecordData: any = {
      quantity: toDispense.toString(),
      suppliesId: stock.suppliesId,
      supplyStockTrackId: stock.id,
      remarks: body.remark || `Dispensed ${toDispense} pieces`,
      inventoryBoxId: body.inventoryBoxId,
      supplyBatchId: body.listId,
      desc: stock.desc,
    };

    // Add optional fields based on request body
    if (body.unitId) {
      dispenseRecordData.departmentId = body.unitId;
    }

    // Add user info - userId might be the recipient
    if (body.userId && body.userId.trim() !== "") {
      dispenseRecordData.userId = body.userId;
    }

    // Add dispensary info - currUserId might be the person dispensing
    if (body.currUserId) {
      dispenseRecordData.dispensaryId = body.currUserId;
    }

    console.log("Dispense record data:", dispenseRecordData);

    // Use transaction to ensure both operations succeed or fail together
    const response = await prisma.$transaction(async (tx) => {
      // Update stock
      await tx.supplyStockTrack.update({
        where: { id: body.id },
        data: updateData,
      });

      // Create dispense record - Now with all valid fields
      await tx.supplyDispenseRecord.create({
        data: dispenseRecordData,
      });

      return "OK";
    });

    if (!response) throw new ValidationError("FAILED TO DISPENSE");

    // Return success response with details
    return res.code(200).send({
      success: true,
      message: `Successfully dispensed ${toDispense} pieces`,
      data: {
        dispensedQuantity: toDispense,
        dispensingDetails: {
          fullBoxesGiven: fullBoxesToGive,
          loosePiecesGiven: loosePieces,
        },
        newStockLevels: {
          totalBoxes: totalBoxesAfter,
          totalPieces: remainingPieces,
          fullBoxes: remainingFullBoxes,
          loosePiecesInOpenedBox: openedBoxRemainingPieces,
        },
        previousStockLevels: {
          totalBoxes: currentBoxes,
          totalPieces: currentStockPieces,
        },
        dispenseRecord: {
          departmentId: body.unitId,
          userId: body.userId,
          dispensaryId: body.currUserId,
          remarks: body.remark,
        },
      },
    });
  } catch (error) {
    console.error("Error in dispenseItem:", error);

    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      switch (error.code) {
        case "P2002":
          throw new AppError("DUPLICATE_ENTRY", 409, "Duplicate record");
        case "P2003":
          throw new AppError(
            "FOREIGN_KEY_CONSTRAINT",
            400,
            "Invalid reference"
          );
        case "P2025":
          throw new AppError("RECORD_NOT_FOUND", 404, "Record not found");
        default:
          console.error("Prisma error code:", error.code);
          throw new AppError("DB_ERROR", 500, "Database operation failed");
      }
    }

    if (error instanceof ValidationError) {
      throw error;
    }

    if (error instanceof NotFoundError) {
      throw error;
    }

    if (error instanceof Error) {
      console.error("Error stack:", error.stack);
      if (
        error.message.includes("Insufficient stock") ||
        error.message.includes("Inventory calculation")
      ) {
        throw new ValidationError(error.message);
      }
    }

    throw new AppError("INTERNAL_ERROR", 500, "An unexpected error occurred");
  }
};

export const dispenseItem = async (req: FastifyRequest, res: FastifyReply) => {
  const body = req.body as DispenseItemProps;
  console.log("Request body:", body);

  if (!body.id || !body.quantity) {
    throw new ValidationError("Item ID and positive quantity are required");
  }

  try {
    console.log("Log 1 - Starting transaction");

    await prisma.$transaction(async (tx) => {
      // 1. Get the current stock item with all necessary details
      const stockItem = await tx.supplyStockTrack.findUnique({
        where: {
          id: body.id,
        },
        select: {
          id: true,
          stock: true,
          quality: true,
          quantity: true,
          perQuantity: true,
          suppliesId: true,
        },
      });
      console.log("Log 2 - Stock item found:", stockItem?.id);

      if (!stockItem) {
        throw new ValidationError("Supply item not found");
      }

      const currentStock = stockItem.stock || 0;
      const currentQuantity = stockItem.quantity || 0;
      const currentPerQuantity = stockItem.perQuantity || 0;
      const toDispense = parseInt(body.quantity, 10);

      console.log("Log 3 - Current values:", {
        currentStock,
        currentQuantity,
        currentPerQuantity,
        toDispense,
      });

      // Validate we have enough stock
      if (currentStock < toDispense) {
        throw new ValidationError("Insufficient stock available");
      }

      // Calculate the dispensing logic (same algorithm as prescriptionDispense)
      console.log("Log 4 - Starting stock calculation");

      let perQuantityReal: number;
      let perQuantityRemainder: number;

      if (currentPerQuantity > 0) {
        // If we have a perQuantity value, use the same logic as prescriptionDispense
        perQuantityReal =
          toDispense > currentPerQuantity
            ? Math.floor(toDispense / currentPerQuantity)
            : toDispense;

        perQuantityRemainder =
          toDispense >= currentPerQuantity
            ? toDispense % currentPerQuantity
            : currentPerQuantity;
      } else {
        // If perQuantity is 0, we just deduct from quantity directly
        perQuantityReal = toDispense;
        perQuantityRemainder = 0;
      }

      console.log("Log 5 - Calculation results:", {
        perQuantityReal,
        perQuantityRemainder,
      });

      const newQuantity = currentQuantity - perQuantityReal;
      const newPerQuantity = currentPerQuantity - perQuantityRemainder;

      // Ensure no negative values
      const finalQuantity = Math.max(0, newQuantity);
      const finalPerQuantity = Math.max(0, newPerQuantity);

      // Calculate new total stock
      const newTotalStock = finalQuantity * finalPerQuantity;

      console.log("Log 6 - Updated values:", {
        newQuantity: finalQuantity,
        newPerQuantity: finalPerQuantity,
        newTotalStock,
      });

      // 2. Create the dispense record
      console.log("Log 7 - Creating dispense record");
      await tx.supplyDispenseRecord.create({
        data: {
          supplyStockTrackId: body.id,
          quantity: toDispense.toString(),
          remarks: body.desc || "",
          userId: body.userId || null,
          departmentId: body.unitId || null,
        },
      });

      // 3. Update the stock by deducting the quantity
      console.log("Log 8 - Updating stock track");
      await tx.supplyStockTrack.update({
        where: {
          id: body.id,
        },
        data: {
          stock: newTotalStock,
          quantity: finalQuantity,
          perQuantity: finalPerQuantity,
        },
      });

      // 4. Create a log entry for tracking
      console.log("Log 9 - Creating system log");
      // await tx.systemLogs.create({
      //   data: {
      //     userId: body.userId || null,
      //     action: "DISPENSE_ITEM",
      //     message: `Dispensed ${toDispense} units of supply item ${stockItem.supplyId}`,
      //     details: JSON.stringify({
      //       stockItemId: body.id,
      //       quantityDispensed: toDispense,
      //       previousStock: currentStock,
      //       newStock: newTotalStock,
      //       remarks: body.desc
      //     }),
      //   },
      // });

      console.log("Log 10 - Transaction completed successfully");
    });

    res.code(200).send({
      success: true,
      message: "Item dispensed successfully",
    });
  } catch (error) {
    console.error("Error in dispenseItem:", error);

    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      // Handle specific Prisma errors
      switch (error.code) {
        case "P2002":
          throw new AppError("DUPLICATE_ENTRY", 409, "Duplicate record");
        case "P2003":
          throw new AppError(
            "FOREIGN_KEY_CONSTRAINT",
            400,
            "Invalid reference"
          );
        case "P2025":
          throw new AppError("RECORD_NOT_FOUND", 404, "Record not found");
        default:
          console.error("Prisma error code:", error.code);
          throw new AppError("DB_ERROR", 500, "Database operation failed");
      }
    }

    if (error instanceof ValidationError) {
      throw error;
    }

    if (error instanceof Error) {
      console.error("Error stack:", error.stack);
    }

    throw new AppError("INTERNAL_ERROR", 500, "An unexpected error occurred");
  }
};

export const supplyList = async (req: FastifyRequest, res: FastifyReply) => {
  const params = req.query as PagingProps;

  if (!params.id) throw new ValidationError("BAD_REQUEST");

  try {
    const filter: any = {};
    const cursor = params.lastCursor ? { id: params.lastCursor } : undefined;
    if (params.query) {
      const searchTerms = params.query.trim().split(/\s+/); // Split on any whitespace

      if (searchTerms.length === 1) {
        filter.OR = [
          { item: { contains: searchTerms[0], mode: "insensitive" } },
          { refNumber: { contains: searchTerms[0], mode: "insensitive" } },
        ];
      } else {
        filter.AND = searchTerms.map((term) => ({
          OR: [
            { item: { contains: term, mode: "insensitive" } },
            { refNumber: { contains: term, mode: "insensitive" } },
          ],
        }));

        filter.OR = [
          { item: filter.AND },
          { refNumber: { contains: params.query.trim(), mode: "insensitive" } },
        ];
        delete filter.AND; // Remove the AND since we've incorporated it into OR
      }
    }
    const trend: any = {};
    if (params.trend === "Quarterly") {
    }

    const response = await prisma.supplyStockTrack.findMany({
      where: {
        supplyBatchId: params.id,
        supply: filter,
      },
      skip: cursor ? 1 : 0,
      take: parseInt(params.limit, 10),
      cursor,
      include: {
        supply: {
          select: {
            id: true,
            refNumber: true,
            item: true,
          },
        },
        brand: {
          select: {
            brand: true,
          },
          orderBy: {
            timestamp: "desc",
          },
          take: 2,
        },
        price: {
          select: {
            value: true,
            timestamp: true,
          },
          orderBy: {
            timestamp: "desc",
          },
          take: 2,
        },
      },
    });

    const newLastCursorId =
      response.length > 0 ? response[response.length - 1].id : null;

    const hasMore = response.length === parseInt(params.limit, 10);

    return res
      .code(200)
      .send({ list: response, lastCursor: newLastCursorId, hasMore });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DB_CONNECTION_FAILED", 500, "BD_ERROR");
    }
    throw error;
  }
};

export const timebaseSupplyReport = async (
  req: FastifyRequest,
  res: FastifyReply
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

export const categories = async (req: FastifyRequest, res: FastifyReply) => {
  const params = req.query as PagingProps;

  if (!params.id) throw new ValidationError("INVALID REQUIRED ID");
  if (!params.query)
    return res.code(200).send({ list: [], lastCursor: null, hasMore: false });
  try {
    const cursor = params.lastCursor ? { id: params.lastCursor } : undefined;
    const limit = params.limit ? parseInt(params.limit, 10) : 10;

    const response = await prisma.supplyCategory.findMany({
      where: {
        label: {
          contains: params.query,
          mode: "insensitive",
        },
      },
      take: limit,
      skip: cursor ? 1 : 0,
      cursor,
    });

    const newLastCursorId =
      response.length > 0 ? response[response.length - 1].id : null;
    const hasMore = limit === response.length;

    return res
      .code(200)
      .send({ list: response, hasMore, lastCursor: newLastCursorId });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
    }
    throw error;
  }
};

export const supplyDispenseTransaction = async (
  req: FastifyRequest,
  res: FastifyReply
) => {
  const params = req.query as PagingProps;
  if (!params.id) throw new ValidationError("INVALID REQUIRED ID");
  try {
    const cursor = params.lastCursor ? { id: params.lastCursor } : undefined;
    const limit = params.limit ? parseInt(params.limit, 10) : 20;

    const filter: any = {
      supplyBatchId: params.id,
    };

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
      throw new AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
    }
    throw error;
  }
};

export const supplyTimeBaseReport = async (
  req: FastifyRequest,
  res: FastifyReply
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

    // Get yearStart: for "2025-2026" get 2026, for "2025" get 2025
    const yearStart = years.length > 1 ? years[years.length - 1] : years[0];
    const yearEnd = years.length > 1 ? years[years.length - 1] : years[0];

    // If yearStart is still NaN (unlikely with our validation), fallback to current year
    const finalYearStart = !isNaN(yearStart)
      ? yearStart
      : new Date().getFullYear();

    console.log("Selected Year: ", finalYearStart);

    const firstHalfStart = new Date(finalYearStart, 0, 1); // January 1
    const firstHalfEnd = new Date(finalYearStart, 5, 30, 23, 59, 59, 999); // June 30
    const secondHalfStart = new Date(finalYearStart, 6, 1); // July 1
    const secondHalfEnd = new Date(finalYearStart, 11, 31, 23, 59, 59, 999); // December 31

    console.log({
      firstHalfEnd: firstHalfEnd.toISOString(),
      firstHalfStart: firstHalfStart.toISOString(),
      secondHalfEnd: secondHalfEnd.toISOString(),
      secondHalfStart: secondHalfStart.toISOString(),
      yearStart: finalYearStart,
    });

    const cursor = params.lastCursor ? { id: params.lastCursor } : undefined;
    const limit = params.limit ? parseInt(params.limit) : 20;

    const supplies = await prisma.supplyStockTrack.findMany({
      where: {
        supplyBatchId: params.id,
      },
      include: {
        supply: {
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
          },
        },
      },
    });

    console.log(JSON.stringify(supplies, null, 2));

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

    // Group by suppliesDataSetId

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
        0
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
        0
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

export const removeStockInList = async (
  req: FastifyRequest,
  res: FastifyReply
) => {
  const body = req.query as {
    id: string;
    userId: string;
    listId: string;
    inventoryId: string;
    lineId: string;
  };

  console.log({ body });

  if (
    !body.id ||
    !body.inventoryId ||
    !body.lineId ||
    !body.listId ||
    !body.userId
  ) {
    throw new ValidationError("INVALID REQUIRED ID");
  }

  try {
    // First, fetch the stock record outside of transaction
    // to minimize transaction time
    const stock = await prisma.supplyStockTrack.findUnique({
      where: {
        id: body.id,
      },
      select: {
        id: true,
        suppliesId: true,
        quantity: true,
        perQuantity: true,
        quality: true,
      },
    });

    if (!stock) {
      throw new ValidationError("STOCK_NOT_FOUND");
    }

    // Execute transaction with timeout and optimized operations
    const response = await prisma.$transaction(
      async (tx) => {
        // Delete the stock record
        await tx.supplyStockTrack.delete({
          where: {
            id: body.id,
          },
        });

        // Create the transaction record
        const transaction = await tx.supplyTransaction.create({
          data: {
            lineId: body.lineId,
            supplyBatchId: body.listId,
            userId: body.userId,
            suppliesId: stock.suppliesId,
            action: 3,
            quantity: stock.quantity,
            perQuantity: stock.perQuantity,
            quality: stock.quality || "N/A",
            inventoryBoxId: body.inventoryId,
          },
          select: { id: true }, // Only select what you need
        });

        return { success: true, transactionId: transaction.id };
      },
      {
        maxWait: 10000, // Maximum time to wait for transaction
        timeout: 15000, // Increase timeout to 15 seconds
      }
    );

    if (!response.success) {
      throw new ValidationError("TRANSACTION_FAILED");
    }

    return res.code(200).send({
      message: "OK",
      transactionId: response.transactionId,
    });
  } catch (error) {
    console.error("Error in Remove Item:", error);

    // Handle specific transaction timeout
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === "P2028") {
        // Transaction timeout error code
        console.error("Transaction timeout occurred");
        throw new AppError(
          "TRANSACTION_TIMEOUT",
          408, // Request Timeout
          "Transaction took too long to complete. Please try again with fewer operations."
        );
      }

      console.error("Prisma error code:", error.code);
      throw new AppError("DB_CONNECTION_ERROR", 500, "Database error occurred");
    }

    if (error instanceof ValidationError) {
      throw error;
    }

    if (error instanceof Error) {
      console.error("Error stack:", error.stack);
    }

    throw new AppError("INTERNAL_ERROR", 500, "An unexpected error occurred");
  }
};

export const supplyTransactionInfo = async (
  req: FastifyRequest,
  res: FastifyReply
) => {
  const query = req.query as { id: string };
  console.log({ query });

  if (!query.id) {
    throw new ValidationError("INVALID_ID");
  }

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
  res: FastifyReply
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
  res: FastifyReply
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
