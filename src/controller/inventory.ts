import { FastifyReply, FastifyRequest } from "../barrel/fastify";
import { prisma, Prisma } from "../barrel/prisma";
import { PagingProps } from "../models/route";
import { generatedBoxCode } from "../middleware/handler";
import {
  AppError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from "../errors/errors";
export const inventories = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const params = req.query as PagingProps;
    const { lastCursor, limit, query, departId, userId } = params;
    const filter: any = {};
    const cursor = lastCursor ? { id: lastCursor } : undefined;
    if (query) {
      const searchTerms = query.trim().split(/\s+/); // Split on any whitespace

      if (searchTerms.length === 1) {
        filter.OR = [
          { name: { contains: searchTerms[0], mode: "insensitive" } },
          { code: { contains: searchTerms[0], mode: "insensitive" } },
        ];
      } else {
        filter.AND = searchTerms.map((term) => ({
          OR: [
            { name: { contains: term, mode: "insensitive" } },
            { code: { contains: term, mode: "insensitive" } },
          ],
        }));
      }
    }

    if (userId) {
      filter.userId = userId;
    }

    if (departId) {
      filter.departmentId = departId;
    }

    const response = await prisma.inventoryBox.findMany({
      where: {
        ...filter,
      },
      cursor,
      take: parseInt(limit, 10),
      skip: cursor ? 1 : 0,
    });

    const nextLastCursorId =
      response.length > 0 ? response[response.length - 1].id : null;
    const hasMore = response.length === 20;

    res
      .code(200)
      .send({ list: response, lastCursor: nextLastCursorId, hasMore });
  } catch (error) {
    console.log(error);

    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DB_CONNECTION_ERROR", 500, "DB_ERROR");
    }
    throw error;
  }
};

export const createInventory = async (
  req: FastifyRequest,
  res: FastifyReply
) => {
  try {
    const body = req.body as {
      name: string;
      lineId: string;
      departmentId: string;
      userId: string;
    };

    console.log({ body });

    if (!body.name) {
      return res.code(400).send({ message: "Bad Request 12" });
    }
    const check = await prisma.inventoryBox.findUnique({
      where: {
        name: body.name,
      },
    });
    if (check) {
      return res
        .code(400)
        .send({ message: "This Inventory Container already exist!" });
    }
    const code = await generatedBoxCode();

    const response = await prisma.inventoryBox.create({
      data: {
        name: body.name,
        code: code,
        lineId: body.lineId,
        userId: body.userId,
        departmentId: body.departmentId || null,
        createdAt: new Date(),
      },
    });

    if (!response) throw new ValidationError("TRANSACTION FAILED");
    await prisma.containerAllowedUser.create({
      data: {
        inventoryBoxId: response.id,
        userId: response.userId,
        grantByUserId: response.userId,
      },
    });
    res.code(200).send({ message: "OK", data: response });
  } catch (error) {
    console.log(error);
    res.code(500).send({ message: "Internal Server Error" });
  }
};

export const viewContainerAuth = async (
  req: FastifyRequest,
  res: FastifyReply
) => {
  const params = req.query as { id: string; userId: string };
  console.log("Containers: ", { params });

  if (!params.id || !params.userId) {
    throw new ValidationError("INVALID REQUIRED FIELDS");
  }
  try {
    const response = await prisma.$transaction(async (tx) => {
      const checkPrev = await tx.module.findFirst({
        where: {
          userId: params.userId,
          moduleName: "container",
        },
      });

      if (!checkPrev) {
        throw new UnauthorizedError("INVALID ACCESS");
      }

      const data = await tx.inventoryBox.findUnique({
        where: {
          id: params.id,
        },
        select: {
          batch: true,
          id: true,
          name: true,
          code: true,
          createdBy: {
            select: {
              username: true,
            },
          },
          createdAt: true,
        },
      });
      return data;
    });

    if (!response) {
      throw new NotFoundError("DATA NOT FOUND!");
    }

    return res.code(200).send({ message: "OK", data: response });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DB_CONNECTION_ERROR", 500, "DB_FAILED");
    }
    throw error;
  }
};

export const inventoryLogsAccessList = async (
  req: FastifyRequest,
  res: FastifyReply
) => {
  try {
    const { id, lastCursor, limit, query } = req.query as PagingProps;
    if (!id) {
      return res.code(400).send({ message: "Bad Request" });
    }
    const filter: any = {};
    const cursor = lastCursor ? { id: lastCursor } : undefined;

    if (query) {
      const searchTerms = query.trim().split(/\s+/); // Split on any whitespace

      if (searchTerms.length === 1) {
        filter.OR = [
          { lastName: { contains: searchTerms[0], mode: "insensitive" } },
          { firstName: { contains: searchTerms[0], mode: "insensitive" } },
          { middleName: { contains: searchTerms[0], mode: "insensitive" } },
        ];
      } else {
        filter.AND = searchTerms.map((term) => ({
          OR: [
            { firstname: { contains: term, mode: "insensitive" } },
            { lastname: { contains: term, mode: "insensitive" } },
          ],
        }));

        filter.OR = [
          { AND: filter.AND },
          { middleName: { contains: query.trim(), mode: "insensitive" } },
        ];
        delete filter.AND; // Remove the AND since we've incorporated it into OR
      }
    }

    const response = await prisma.containerAllowedUser.findMany({
      where: {
        user: filter,
        inventoryBoxId: id,
      },
      cursor,
      take: parseInt(limit, 10),
      skip: cursor ? 1 : 0,
      select: {
        id: true,
        timestamp: true,
        grantBy: {
          select: {
            lastName: true,
            firstName: true,
            middleName: true,
            id: true,
          },
        },
        user: {
          select: {
            lastName: true,
            firstName: true,
            middleName: true,
            id: true,
            email: true,
          },
        },
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

export const inventoryLogs = async (req: FastifyRequest, res: FastifyReply) => {
  const params = req.query as PagingProps;

  if (!params.id) throw new ValidationError("INVALID REQUIRED ID");
  try {
    const cursor = params.lastCursor ? { id: params.id } : undefined;
    const limit = params.limit ? parseInt(params.limit, 10) : 20;

    const response = await prisma.supplyTransaction.findMany({
      where: {
        inventoryBoxId: params.id,
      },
      skip: cursor ? 1 : 0,
      take: limit,
      orderBy: {
        timestamp: "desc",
      },
      cursor,
    });

    const newLastCursorId =
      response.length > 0 ? response[response.length - 1].id : null;
    const hasMore = limit === response.length;

    return res
      .code(200)
      .send({ list: response, lastCursor: newLastCursorId, hasMore });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DB_CONNECTION_ERROR", 500, "DB_FAILED");
    }
    throw error;
  }
};

export const removeContainer = async (
  req: FastifyRequest,
  res: FastifyReply
) => {
  try {
    const { id, userId } = req.query as { id: string; userId: string };
    console.log({ id, userId });

    if (!id || !userId) {
      return res.code(400).send({ message: "Bad Request" });
    }
    const response = await prisma.$transaction(async (tx) => {
      const items = await tx.supplies.count({
        where: {
          inventoryBoxId: id,
        },
      });
      const stocks = await tx.supplyStockTrack.count({
        where: {
          inventoryBoxId: id,
        },
      });

      const dispensedLogs = await tx.supplyDispenseRecord.count({
        where: {
          inventoryBoxId: id,
        },
      });

      const recievedItems = await tx.supplieRecieveHistory.count({
        where: {
          inventoryBoxId: id,
        },
      });

      if (items > 0 || stocks > 0 || dispensedLogs > 0 || recievedItems > 0) {
        throw new ValidationError(
          "CANNOT DELETE CONTAINER WITH EXISTING RECORDS"
        );
      }
      // const lists = await tx.
      const container = await tx.inventoryBox.delete({
        where: {
          id,
        },
      });
      await tx.inventoryLogs.create({
        data: {
          userId,
          action: 4,
          lineId: container.lineId,
          desc: `Container Removed - ${container.name} (${container.code}) | Remaining Items: ${items} | Remaining Stocks: ${stocks} | `,
        },
      });
      await tx.inventoryAccessLogs.create({
        data: {
          userId,
          action: "REMOVED CONTAINER",
        },
      });

      return true;
    });

    if (!response) {
      throw new ValidationError("TRANSACTION FAILED");
    }

    return res.code(200).send({ message: "Container removed successfully" });
  } catch (error) {
    console.log(error);
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DB_CONNECTION_ERROR", 500, "DB_FAILED");
    }
    throw error;
  }
};
