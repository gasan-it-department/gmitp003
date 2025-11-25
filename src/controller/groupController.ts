import { FastifyReply, FastifyRequest } from "../barrel/fastify";
import { prisma, Department, Prisma } from "../barrel/prisma";

import { AppError, NotFoundError, ValidationError } from "../errors/errors";
import { PagingProps } from "../models/route";

export const groupList = async (req: FastifyRequest, res: FastifyReply) => {
  const params = req.query as PagingProps;
  console.log("Params", params);

  if (!params.id) throw new ValidationError("INVALID_REQUEST");
  try {
    const cursor = params.lastCursor ? { id: params.lastCursor } : undefined;
    const limit = params.limit ? parseInt(params.limit) : 20;

    const filter: any = {
      lineId: params.id,
    };

    if (params.query) {
      filter.name = {
        contains: params.query,
        mode: "insensitive",
      };
    }
    const groups = await prisma.department.findMany({
      where: {
        ...filter,
      },
      take: limit,
      cursor: cursor,
      skip: cursor ? 1 : 0,
    });

    const newLastCursorId =
      groups.length > 0 ? groups[groups.length - 1].id : null;
    const hasMore = groups.length === limit;
    return res
      .code(200)
      .send({ list: groups, lastCursor: newLastCursorId, hasMore: hasMore });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DB_CONNECTION_EROR", 500, "DB_FAILED");
    }
    throw error;
  }
};

export const createGroup = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const body = req.body as {
      title: string;
      description?: string;
      lineId: string;
      userId: string;
    };
    console.log(body);

    if (!body || !body.title) {
      throw new ValidationError("INVALID_REQUEST");
    }

    const existingGroup = await prisma.department.findUnique({
      where: { name: body.title, lineId: body.lineId },
    });

    if (existingGroup) {
      throw new ValidationError("UNIT_ALREADY_EXISTS");
    }

    await prisma.$transaction(async (tx) => {
      const newGroup = await tx.department.create({
        data: {
          name: body.title,
          description: body.description,
          lineId: body.lineId,
        },
      });
      console.log({ newGroup });

      await tx.humanResourcesLogs.create({
        data: {
          action: "CREATED UNIT",
          lineId: body.lineId,
          userId: body.userId,
          desc: `Created new unit: ${newGroup.name}`,
        },
      });
    });

    return res.code(200).send({ message: "OK" });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DB_CONNECTION_EROR", 500, "DB_FAILED");
    }
    throw error;
  }
};

export const unitInfo = async (req: FastifyRequest, res: FastifyReply) => {
  const params = req.query as { id: string };
  console.log("Params: ", params);

  if (!params.id) throw new ValidationError("INVALID_REQUEST");
  try {
    const unit = await prisma.department.findUnique({
      where: {
        id: params.id,
      },
    });

    if (!unit) {
      throw new NotFoundError("UNIT_NOT_FOUND");
    }
    return res.code(200).send(unit);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DB_CONNECTION_EROR", 500, "DB_FAILED");
    }
    throw error;
  }
};
