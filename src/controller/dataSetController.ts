import { FastifyReply, FastifyRequest } from "../barrel/fastify";
import { Prisma, prisma } from "../barrel/prisma";
import { AppError, ValidationError } from "../errors/errors";
import { DeleteDataSetProps, NewDataSetProps } from "../models/route";
import { PagingProps } from "../models/route";

export const createDateSet = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const body = req.body as NewDataSetProps;

    if (!body.title || !body.lineId || !body.inventoryBoxId || !body.userId) {
      return res.code(400).send({ message: "Bad request!" });
    }
    await prisma.$transaction([
      prisma.suppliesDataSet.create({
        data: {
          title: body.title,
          lineId: body.lineId,
          inventoryBoxId: body.inventoryBoxId,
        },
      }),
      prisma.inventoryAccessLogs.create({
        data: {
          userId: body.userId,
          inventoryBoxId: body.inventoryBoxId,
          action: "Add Data Set",
          timestamp: new Date(),
        },
      }),
    ]);

    return res.code(200).send({ message: "OK" });
  } catch (error) {
    console.log(error);

    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === "P2002") {
        return res.status(409).send({
          error: "Duplicate title",
          fields: error.meta?.target, // Will show ['title']
        });
      }
    }
    return res.status(500).send({
      error: "Internal Server Error",
      message: "Something went wrong",
    });
  }
};

export const dataSetList = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const body = req.query as PagingProps;
    console.log("params", body);
    if (!body.id) {
      return res.code(400).send({ message: "Bad request!" });
    }

    const cursor = body.lastCursor ? { id: body.lastCursor } : undefined;

    const response = await prisma.suppliesDataSet.findMany({
      where: {
        inventoryBoxId: body.id,
      },
      select: {
        _count: {
          select: {
            list: true,
          },
        },
        id: true,
        title: true,
        timestamp: true,
      },
      cursor,
      take: parseInt(body.limit, 10),
      skip: cursor ? 1 : 0,
    });

    const newLastCursorId =
      response.length > 0 ? response[response.length - 1].id : null;
    const hasMore = response.length === parseInt(body.limit, 10);
    return res.code(200).send({
      message: "OK",
      list: response,
      lastCursor: newLastCursorId,
      hasMore,
    });
  } catch (error) {
    return res.status(500).send({
      error: "Internal Server Error",
      message: "Something went wrong",
    });
  }
};

export const dateSetData = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const params = req.query as PagingProps;
    console.log("Params: ", { params });

    if (!params.id) {
      return res.code(400).send({ messag: "Bad Request" });
    }
    const data = await prisma.suppliesDataSet.findUnique({
      where: {
        id: params.id,
      },
    });

    if (!data) {
      return res.code(404).send({ message: "Data not found" });
    }
    return res.code(200).send({ data });
  } catch (error) {
    console.log(error);
    res.code(500).send({ message: "Internal Server Error" });
  }
};

export const dataSetSupplies = async (
  req: FastifyRequest,
  res: FastifyReply
) => {
  try {
    const params = req.query as PagingProps;
    const filter: any = {
      suppliesDataSetId: params.id,
    };
    console.log("Data Set Item: ", { params });

    if (!params.id) {
      return res.code(400).send({ message: "Bad request!" });
    }

    if (params.query) {
      const searchTerms = params.query.trim().split(/\s+/); // Split on any whitespace

      if (searchTerms.length === 1) {
        filter.OR = [
          { item: { contains: searchTerms[0], mode: "insensitive" } },
          {
            code: {
              equals: isNaN(parseInt(searchTerms[0], 10))
                ? undefined
                : parseInt(searchTerms[0], 10),
            },
          },
        ].filter((condition) => {
          // Filter out invalid conditions (where code equals undefined)
          if ("code" in condition) {
            return condition?.code?.equals !== undefined;
          }
          return true;
        });
      } else {
        filter.AND = searchTerms.map((term) => ({
          OR: [
            { item: { contains: term, mode: "insensitive" } },
            {
              code: {
                equals: isNaN(parseInt(term, 10))
                  ? undefined
                  : parseInt(term, 10),
              },
            },
          ].filter((condition) => {
            if ("code" in condition) {
              return condition?.code?.equals !== undefined;
            }
            return true;
          }),
        }));
      }
    }

    const cursor = params.lastCursor ? { id: params.lastCursor } : undefined;
    const response = await prisma.supplies.findMany({
      where: filter,
      cursor,
      take: parseInt(params.limit, 10) || 20,
      skip: cursor ? 1 : 0,
      orderBy: {
        createdAt: "asc",
      },
    });

    const nextLastCursorId =
      response.length > 0 ? response[response.length - 1].id : null;
    const hasMore = response.length === (parseInt(params.limit, 10) || 20);

    return res
      .code(200)
      .send({ list: response, lastCursor: nextLastCursorId, hasMore });
  } catch (error) {
    console.log(error);
    return res.code(500).send({ message: "Internal server error" });
  }
};

export const dataSetSelection = async (
  req: FastifyRequest,
  res: FastifyReply
) => {
  try {
    const body = req.query as { id: string };
  } catch (error) {
    console.log(error);
  }
};

export const deleteDataSet = async (req: FastifyRequest, res: FastifyReply) => {
  const params = req.query as DeleteDataSetProps;

  if (!params.id || !params.userId || !params.inventoryBoxId)
    throw new ValidationError();

  try {
    await prisma.suppliesDataSet.delete({
      where: {
        id: params.id,
      },
    });
    return res.code(200).send({ message: "OK" });
  } catch (error) {
    console.log("Delete Error: ", error);

    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DB_CONNECTION_ERROR", 500, "DB_ERROR");
    }
    throw error;
  }
};
