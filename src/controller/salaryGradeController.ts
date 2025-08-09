import { FastifyReply, FastifyRequest } from "../barrel/fastify";
import { prisma } from "../barrel/prisma";
import { PagingProps } from "../models/route";
export const salaryGradeList = async (
  req: FastifyRequest,
  res: FastifyReply
) => {
  try {
    const { lastCursor, limit } = req.query as PagingProps;

    const cursor = lastCursor ? { id: lastCursor } : undefined;
    const response = await prisma.salaryGrade.findMany({
      cursor,
      take: limit ?? 10,
    });
    const newLastCursor =
      response.length > 0 ? response[response.length - 1].id : null;
    const hasMore = response.length === 10;
    return res
      .code(200)
      .send({ list: response, lastCursor: newLastCursor, hasMore });
  } catch (error) {
    console.log(error);
    res.code(500).send({ message: "Internal Server Error" });
  }
};
