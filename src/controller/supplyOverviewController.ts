import { FastifyReply, FastifyRequest } from "../barrel/fastify";
import { prisma, Prisma } from "../barrel/prisma";
import { AppError, ValidationError } from "../errors/errors";
import { PagingProps, SupplyListOverviewProps } from "../models/route";

export const supplyOverview = async (
  req: FastifyRequest,
  res: FastifyReply
) => {
  const params = req.query as PagingProps;

  if (!params.id) {
    throw new ValidationError("BAD_REQUEST");
  }
  try {
    const { lastCursor, limit, query, id } = params;

    const filter: any = {};

    if (query) {
      const searchTerms = query.trim().split(/\s+/); // Split on any whitespace

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
          { refNumber: { contains: query.trim(), mode: "insensitive" } },
        ];
        delete filter.AND; // Remove the AND since we've incorporated it into OR
      }
    }
    const cursor = lastCursor ? { id: lastCursor } : undefined;
    const items = await prisma.supplyStockTrack.findMany({
      where: {
        supply: filter,
        supplyBatchId: id,
      },
      take: parseInt(limit),
      skip: cursor ? 1 : 0,
      cursor: cursor,
      orderBy: {
        timestamp: "desc",
      },
      include: {
        brand: {
          select: {
            brand: true,
          },
          orderBy: {
            timestamp: "desc",
          },
          take: 1,
        },
        price: {
          select: {
            value: true,
          },
          orderBy: {
            timestamp: "desc",
          },
          take: 1,
        },
        supply: {
          select: {
            item: true,
            id: true,
            refNumber: true,
          },
        },
      },
    });
    const newLastCursorId =
      items.length > 0 ? items[items.length - 1].id : null;
    const hasMore = items.length === parseInt(limit);

    return res.code(200).send({
      list: items,
      lastCursor: newLastCursorId,
      hasMore,
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("Database operation failed");
    }
    throw error;
  }
};

export const supplyOverviewStatus = async (
  req: FastifyRequest,
  res: FastifyReply
) => {
  const params = req.query as { listId: string };
  if (!params) throw new ValidationError("INVALID REQUIRED ID");
  try {
    const response = await prisma.$transaction(async (tx) => {
      const total = await tx.supplyStockTrack.count({
        where: {
          supplyBatchId: params.listId,
        },
      });
      const lowStock = await tx.supplyStockTrack.count({
        where: {
          supplyBatchId: params.listId,
          stock: {
            lt: 10,
          },
        },
      });
      const order = await tx.supplyBatchOrder.count({
        where: {
          supplyBatchId: params.listId,
          status: 0,
        },
      });

      return { total, lowStock, order };
    });

    if (!response) throw new ValidationError("DATA FAILED TO PARSED");

    return res.code(200).send(response);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DB_CONNECTION_ERROR", 500, "DB_ERROR");
    }
  }
};
