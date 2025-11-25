import { FastifyReply, FastifyRequest } from "../barrel/fastify";
import { prisma, Prisma } from "../barrel/prisma";
import { AppError, NotFoundError, ValidationError } from "../errors/errors";
import {
  AddListAccess,
  DataProps,
  DeleteListProps,
  PagingProps,
} from "../models/route";

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

export const listData = async (req: FastifyRequest, res: FastifyReply) => {
  const params = req.query as DataProps;

  if (!params.id) throw new ValidationError();

  try {
    const data = await prisma.supplyBatch.findUnique({
      where: {
        id: params.id,
      },
    });

    if (!data) throw new NotFoundError();
    return res.code(200).send({ message: "OK", data });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
    }
    throw error;
  }
};

export const addListAccess = async (req: FastifyRequest, res: FastifyReply) => {
  const params = req.query as AddListAccess;

  if (!params.containerId || !params.listId || !params.userId)
    throw new ValidationError();

  try {
    const [user, list] = await prisma.$transaction([
      prisma.user.findUnique({
        where: {
          id: params.userId,
        },
      }),
      prisma.supplyBatch.findUnique({
        where: {
          id: params.listId,
        },
      }),
    ]);

    if (!user || !list) throw new NotFoundError();

    await prisma.$transaction([
      prisma.inventoryAccessLogs.create({
        data: {
          inventoryBoxId: params.containerId,
          userId: params.userId,
          action: `Allowed ${user.username} to access list: ${list.title}`,
        },
      }),
      prisma.supplyBatchAccess.create({
        data: {
          userId: params.userId,
          supplyBatchId: params.listId,
        },
      }),
    ]);
    res.code(200).send({ message: "OK" });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
    }
    throw error;
  }
};

export const listAccessUsers = async (
  req: FastifyRequest,
  res: FastifyReply
) => {
  const params = req.query as PagingProps;

  if (!params.id) throw new ValidationError();
  try {
    const cursor = params.lastCursor ? { id: params.lastCursor } : undefined;
    const filter: any = {};
    if (params.query) {
      filter.user = {
        firstName: { contains: params.query, mode: "insensitive" },
        lastName: { contains: params.query, mode: "insensitive" },
        username: { contains: params.query, mode: "insensitive" },
      };
    }
    const response = await prisma.supplyBatchAccess.findMany({
      where: {
        user: filter,
      },
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            username: true,
          },
        },
      },
      skip: cursor ? 1 : 0,
      take: parseInt(params.limit, 10),
      cursor,
    });

    const newLastCursorId =
      response.length > 0 ? response[response.length - 1].id : null;
    const hasMore = response.length === parseInt(params.limit, 10);

    return res
      .code(200)
      .send({ list: response, lastCursor: newLastCursorId, hasMore });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
    }
    throw error;
  }
};

export const deleteList = async (req: FastifyRequest, res: FastifyReply) => {
  const params = req.query as DeleteListProps;
  if (!params.id || !params.containerId || !params.userId)
    throw new ValidationError();
  try {
    const [list] = await prisma.$transaction([
      prisma.supplyBatch.findUnique({
        where: {
          id: params.id,
        },
      }),
    ]);
    if (!list) throw new NotFoundError();
    await prisma.$transaction([
      prisma.inventoryAccessLogs.create({
        data: {
          inventoryBoxId: params.containerId,
          userId: params.userId,
          action: `DELETED List: ${list.title}`,
        },
      }),
      prisma.supplyBatchAccess.delete({
        where: {
          id: params.id,
        },
      }),
    ]);
    return res.code(200).send({ message: "OK" });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
    }
    throw error;
  }
};
