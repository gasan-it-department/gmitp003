import { prisma } from "../barrel/prisma";
import { FastifyReply, FastifyRequest } from "../barrel/fastify";

//
interface Props {
  lastCursor: string | null;
}

export const regionController = async (
  req: FastifyRequest,
  res: FastifyReply
) => {
  try {
    const param = req.query as Props;
    console.log();

    const cursor = param.lastCursor ? { id: param.lastCursor } : undefined;
    console.log({ param, cursor });

    const data = await prisma.region.findMany({
      take: 5,
      cursor,
      skip: cursor ? 1 : 0,
    });
    console.log(data);

    const newLastCursorId = data.length > 0 ? data[data.length - 1].id : null;

    const hasMore = data.length === 20;
    return res
      .code(200)
      .send({ list: data, lastCursor: newLastCursorId, hasMore });
  } catch (error) {
    console.log(error);

    res.code(500).send({ message: "Internal Server Error" });
  }
};
