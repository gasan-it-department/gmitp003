import { FastifyReply, FastifyRequest } from "../barrel/fastify";
import { prisma, Prisma } from "../barrel/prisma";
import { AppError, ValidationError } from "../errors/errors";
import { PagingProps, SupplyListOverviewProps } from "../models/route";

export const supplyOverview = async (
  req: FastifyRequest,
  res: FastifyReply,
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
    const take = limit ? parseInt(limit, 10) : 20;
    const supplies = await prisma.supplies.findMany({
      where: {
        SupplyStockTrack: {
          some: {
            supplyBatchId: params.id,
          },
        },
        ...filter,
      },
      select: {
        id: true,
        item: true,
        refNumber: true,
        SupplyStockTrack: {
          select: {
            stock: true,
            perQuantity: true,
            quantity: true,
            quality: true,
            id: true,
          },
        },
      },
      skip: cursor ? 1 : 0,
      cursor,
      take,
    });

    const processed = supplies.map((supply) => {
      const total = supply.SupplyStockTrack
        ? supply.SupplyStockTrack.reduce((acc, base) => {
            if (!base.stock) return acc;

            return (acc += base.stock);
          }, 0)
        : 0;
      return { totalStock: total, ...supply };
    });

    const newLastCursorId =
      processed.length > 0 ? processed[processed.length - 1].id : null;
    const hasMore = processed.length === parseInt(limit);

    return res.code(200).send({
      list: processed,
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
  res: FastifyReply,
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
      const lowStock = await tx.supplies.count({
        where: {
          SupplyStockTrack: {
            some: {
              supplyBatchId: params.listId,
              stock: {
                lte: 10,
              },
            },
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
    console.log({ response });

    if (!response) throw new ValidationError("DATA FAILED TO PARSED");

    return res.code(200).send(response);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DB_CONNECTION_ERROR", 500, "DB_ERROR");
    }
  }
};
