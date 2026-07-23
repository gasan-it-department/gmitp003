import { Prisma, prisma } from "../barrel/prisma";
import { FastifyReply, FastifyRequest } from "../barrel/fastify";
import { PagingProps } from "../models/route";

import { ValidationError, AppError, dbError } from "../errors/errors";

export const getSuppliers = async (req: FastifyRequest, res: FastifyReply) => {
  const params = req.query as PagingProps;

  if (!params.id) throw new ValidationError("BAD_REQUEST");
  if (!params.query)
    return res.code(200).send({ list: [], lastCursor: null, hasMore: false });

  try {
    const cursor = params.lastCursor ? { id: params.lastCursor } : undefined;
    const limit = params.limit
      ? parseInt(params.limit as unknown as string)
      : 10;

    const response = await prisma.supplier.findMany({
      take: limit,
      skip: cursor ? 1 : 0,
      cursor: cursor,
      orderBy: { name: "asc" },
      where: {
        lineId: params.id,
        name: {
          contains: params.query,
          mode: "insensitive",
        },
      },
    });

    const newLastCursorId =
      response.length > 0 ? response[response.length - 1].id : null;
    const hasMore = response.length === limit;
    return res
      .status(200)
      .send({ list: response, lastCursor: newLastCursorId, hasMore });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DATABASE_CONNECTION_ERROR", 500, "DB_FAILED");
    }
    throw error;
  }
};

export const addSupplier = async (name: string, lineId: string) => {
  if (!name) throw new ValidationError("BAD_REQUEST");

  try {
    const data = await prisma.supplier.create({
      data: {
        name: name,
        lineId: lineId,
      },
    });
    return data;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      // Surface the real cause (e.g. "That name already exists") instead
      // of masking every constraint error as a fake connection failure.
      throw dbError(error);
    }
    throw error;
  }
};
