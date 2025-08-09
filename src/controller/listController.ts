import { FastifyReply, FastifyRequest } from "../barrel/fastify";
import { prisma, Prisma } from "../barrel/prisma";
import { PagingProps } from "../models/route";

export const createList = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const body = req.body as {
      title: string;
      inventoryBoxId: string;
      lineId: string;
    };
    console.log(body);

    if (!body.inventoryBoxId || !body.lineId || !body.title) {
      return res.code(400).send({ message: "Bad Request" });
    }
    await prisma.supplyBatch.create({
      data: {
        title: body.title,
        inventoryBoxId: body.inventoryBoxId,
      },
    });
    return res.code(200).send({ message: "Ok" });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      // Handle unique constraint violation
      if (error.code === "P2002") {
        return res.status(409).send({
          error: "Duplicate title",
          fields: error.meta?.target, // Will show ['title']
        });
      }
    }

    // Handle other errors
    return res.status(500).send({
      error: "Internal Server Error",
      message: "Something went wrong",
    });
  }
};

export const list = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const { id, lastCursor, limit, query } = req.query as PagingProps;
    console.log("123", id, lastCursor, limit, query);

    const filter: any = {
      inventoryBoxId: id,
    };

    if (query) {
      filter.title = { contains: query, mode: "insensitive" };
    }
    const cursor = lastCursor ? { id: lastCursor } : undefined;
    const response = await prisma.supplyBatch.findMany({
      where: filter,
      take: parseInt(limit, 10),
      skip: cursor ? 1 : 0,
      cursor,
      orderBy: {
        timestamp: "asc",
      },
    });

    const newLastCursorId =
      response.length > 0 ? response[response.length - 1].id : null;
    const hasMore = response.length === parseInt(limit, 10);

    return res
      .code(200)
      .send({ list: response, lastCursor: newLastCursorId, hasMore });
  } catch (error) {
    console.log(error);
    res.code(500).send({ message: "Internal Server Error" });
  }
};
