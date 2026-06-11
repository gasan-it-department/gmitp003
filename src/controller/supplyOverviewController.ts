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
    const take = limit ? parseInt(limit, 10) : 20;
    const cursor = lastCursor ? { id: lastCursor } : undefined;

    // Build search filter on Supplies (item name / refNumber)
    const searchFilter: any = {};
    if (query) {
      const terms = query.trim().split(/\s+/);
      if (terms.length === 1) {
        searchFilter.OR = [
          { item: { contains: terms[0], mode: "insensitive" } },
          { refNumber: { contains: terms[0], mode: "insensitive" } },
        ];
      } else {
        searchFilter.AND = terms.map((term) => ({
          OR: [
            { item: { contains: term, mode: "insensitive" } },
            { refNumber: { contains: term, mode: "insensitive" } },
          ],
        }));
      }
    }

    // Pull Supplies that have any SupplyStockTrack in this batch/list,
    // including just those stock-track rows + their latest brand & price.
    const supplies = await prisma.supplies.findMany({
      where: {
        ...searchFilter,
        SupplyStockTrack: {
          some: { supplyBatchId: id },
        },
      },
      take,
      skip: cursor ? 1 : 0,
      cursor,
      orderBy: { item: "asc" },
      include: {
        SupplyStockTrack: {
          where: { supplyBatchId: id },
          orderBy: { timestamp: "desc" },
          include: {
            brand: {
              select: { brand: true, model: true },
              orderBy: { timestamp: "desc" },
              take: 1,
            },
            supplier: {
              select: { id: true, name: true },
            },
          },
        },
        SupplyPriceTrack: {
          select: { value: true, timestamp: true },
          orderBy: { timestamp: "desc" },
          take: 1,
        },
      },
    });

    // Attach a computed `totalStock` per supply
    const list = supplies.map((s) => {
      const tracks = s.SupplyStockTrack ?? [];
      const totalStock = tracks.reduce(
        (sum, t) => sum + (t.quantity ?? 0) * (t.perQuantity || 1),
        0,
      );
      return { ...s, totalStock };
    });

    const newLastCursorId = list.length > 0 ? list[list.length - 1].id : null;
    const hasMore = list.length === take;

    return res.code(200).send({
      list,
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
