import { prisma } from "../barrel/prisma";
import { FastifyReply, FastifyRequest } from "../barrel/fastify";
import { PagingProps } from "../models/route";
import { AppError, NotFoundError, ValidationError } from "../errors/errors";

export const personnelList = async (req: FastifyRequest, res: FastifyReply) => {
  const { lastCursor, query, limit, id } = req.query as PagingProps;
  if (!id) throw new ValidationError("INVALID_REQUEST");
  try {
    const cursor = lastCursor ? { id: lastCursor } : undefined;
    const take = limit ? parseInt(limit) : 20;
    const response = await prisma.user.findMany({
      where: {
        departmentId: id,
      },
      cursor,
      take,
      skip: cursor ? 1 : 0,
      orderBy: {
        lastName: "asc",
      },
    });

    const newLastCursorId =
      response.length > 0 ? response[response.length - 1].id : null;
    const hasMore = response.length === 10;
    return res
      .code(200)
      .send({ list: response, lastCursor: newLastCursorId, hasMore: hasMore });
  } catch (error) {
    console.log(error);

    res.code(500).send({ message: "Internel Server Error" });
  }
};
