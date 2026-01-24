import { FastifyReply, FastifyRequest } from "../barrel/fastify";
import { prisma, Prisma } from "../barrel/prisma";
import { AppError, ValidationError } from "../errors/errors";
import { PagingProps } from "../models/route";

export const addUnit = async () => {};

export const searchUnit = async (req: FastifyRequest, res: FastifyReply) => {
  const params = req.query as PagingProps;
  if (!params.id) throw new ValidationError("INVALID REQUIRED ID");
  if (!params.query)
    return res.code(200).send({ list: [], hasMore: false, lastCursor: null });
  try {
    const cursor = params.lastCursor ? { id: params.lastCursor } : undefined;
    const limit = params.limit ? parseInt(params.limit, 10) : 20;

    const filter: any = {};
    if (params.query) {
      filter.name = {
        contains: params.query,
        mode: "insensitive",
      };
    }

    const response = await prisma.department.findMany({
      where: {
        lineId: params.id,
        ...filter,
      },
      select: {
        idCode: true,
        id: true,
        name: true,
      },
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
