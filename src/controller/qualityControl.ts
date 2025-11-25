import { FastifyReply, FastifyRequest } from "../barrel/fastify";
import { prisma } from "../barrel/prisma";
import { PagingProps } from "../models/route";

export const unitOfMeasures = async (
  req: FastifyRequest,
  res: FastifyReply
) => {
  try {
    const params = req.query as PagingProps;

    const cursor = params.lastCursor ? { id: params.lastCursor } : undefined;
    const response = await prisma.suppliesQuality.findMany({
      cursor,
      take: parseInt(params.limit, 10),
      skip: cursor ? 1 : 0,
    });

    const newLastCursorId =
      response.length > 0 ? response[response.length - 1].id : null;
    const hasMore = response.length === parseInt(params.limit, 10);
    res
      .code(200)
      .send({ list: response, lastCursor: newLastCursorId, hasMore });
  } catch (error) {
    res.code(500).send({ message: "Internal Server Error" });
  }
};
