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
import { AppError, ValidationError } from "../errors/errors";
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

export const dispenseItem = async (req: FastifyRequest, res: FastifyReply) => {
  const body = req.body as DispenseItemProps;

  // Validate required fields
  if (!body.id || !body.quantity || !body.quantity) {
    throw new ValidationError("Item ID and positive quantity are required");
  }

  try {
    const data: any = {
      supplyStockTrackId: body.id,
      quantity: body.quantity,
      remarks: body.desc,
    };

    if (body.userId) {
      const user = await prisma.user.findUnique({
        where: { id: body.userId },
      });
      if (user) {
        data.userId = user.id;
      }
    }

    if (body.unitId) {
      const unit = await prisma.department.findUnique({
        where: { id: body.unitId },
      });
      if (unit) {
        data.departmentId = unit.id;
      }
    }

    await prisma.$transaction(async (tx) => {
      // 1. First, get the current stock to validate we have enough
      const currentStock = await tx.supplyStockTrack.findUnique({
        where: { id: body.id },
        select: { stock: true },
      });

      if (!currentStock) {
        throw new ValidationError("Supply item not found");
      }

      if (currentStock.stock < parseInt(body.quantity, 10)) {
        throw new ValidationError("Insufficient stock available");
      }

      // 2. Create the dispense record
      await tx.supplyDispenseRecord.create({
        data,
      });

      // 3. Update the stock by deducting the quantity
      await tx.supplyStockTrack.update({
        where: {
          id: body.id,
        },
        data: {
          stock: {
            decrement: parseInt(body.quantity),
          },
        },
      });
    });

    res.code(201).send({ message: "Item dispensed successfully" });
  } catch (error) {
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
        default:
          throw new AppError("DB_ERROR", 500, "Database operation failed");
      }
    }

    if (error instanceof ValidationError) {
      throw error;
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
    console.log(error);

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
