import { FastifyReply, FastifyRequest } from "../barrel/fastify";
import { prisma, Line, Prisma } from "../barrel/prisma";
import { AppError } from "../errors/errors";
import { PagingProps } from "../models/route";

export const createLine = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const body = req.body as Line;
    if (!body || !body.name) {
      return res.code(400).send({ message: "Invalid request" });
    }
    const existingLine = await prisma.line.findUnique({
      where: { name: body.name },
    });
    if (existingLine) {
      return res
        .code(400)
        .send({ message: "Line with this name already exists" });
    }
    const newLine = await prisma.line.create({
      data: {
        name: body.name,
        barangayId: body.barangayId,
        municipalId: body.municipalId,
        provinceId: body.provinceId,
        regionId: body.regionId,
      },
    });
    return res.code(200).send({
      message: "Line created successfully",
      line: newLine,
      error: 0,
    });
  } catch (error) {
    console.log(error);
    res.code(500).send({ message: "Internal server error" });
    return;
  }
};

export const getLines = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const response = await prisma.line.findMany();
    await prisma.account.updateMany({
      data: {
        lineId: "c039c8fd-8058-4e07-820e-7a3f36dc108d",
      },
    });
    return response;
  } catch (error) {
    console.log(error);

    res.code(500).send({ message: "Internal Server Error" });
  }
};

export const getAllLine = async (req: FastifyRequest, res: FastifyReply) => {
  const params = req.query as PagingProps;
  console.log({ params });

  try {
    const cursor = params.lastCursor ? { id: params.id } : undefined;
    const limit = params.limit ? parseInt(params.limit, 10) : 20;
    const filter: any = {};

    if (params.query) {
      filter.name = {
        contains: params.query,
        mode: "insensitive",
      };
    }
    const response = await prisma.line.findMany({
      where: filter,
      skip: cursor ? 1 : 0,
      take: limit,
      orderBy: {
        createdAt: "desc",
      },
      cursor,
      include: {
        _count: {
          select: {
            User: true,
          },
        },
      },
    });
    console.log(response);

    const newLastCursor =
      response.length > 0 ? response[response.length - 1].id : null;
    const hasMore = limit === response.length;

    return res
      .code(200)
      .send({ list: response, hasMore, lastCursor: newLastCursor });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
    }
    throw error;
  }
};
