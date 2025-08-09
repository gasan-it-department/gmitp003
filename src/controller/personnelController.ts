import { prisma } from "../barrel/prisma";
import { FastifyReply, FastifyRequest } from "../barrel/fastify";

interface Props {
  lastCursor: string;
}
export const personnelList = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const { lastCursor } = req.body as Props;
    const cursor = lastCursor ? { id: lastCursor } : undefined;
    const response = await prisma.user.findMany({
      cursor,
      take: 10,
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
