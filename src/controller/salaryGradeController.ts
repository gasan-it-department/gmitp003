import { FastifyReply, FastifyRequest } from "../barrel/fastify";
import { prisma, Prisma } from "../barrel/prisma";
import { PagingProps } from "../models/route";

//
import { AppError, ValidationError } from "../errors/errors";
export const salaryGradeList = async (
  req: FastifyRequest,
  res: FastifyReply
) => {
  const { lastCursor, limit, id } = req.query as PagingProps;
  console.log({ lastCursor, limit, id });

  if (!id) throw new ValidationError("BAD_REQUEST");
  try {
    const cursor = lastCursor ? { id: lastCursor } : undefined;
    const take = limit ? parseInt(limit, 10) : 10;
    const response = await prisma.salaryGrade.findMany({
      where: {
        lineId: id,
      },
      cursor,
      take: take,
      skip: cursor ? 1 : 0,
      orderBy: {
        grade: "asc",
      },
    });
    const newLastCursor =
      response.length > 0 ? response[response.length - 1].id : null;
    const hasMore = response.length === take;
    return res
      .code(200)
      .send({ list: response, lastCursor: newLastCursor, hasMore });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
    }
    throw error;
  }
};

export const saveNewSalaryGrade = async (
  req: FastifyRequest,
  res: FastifyReply
) => {
  try {
    const response = await prisma.salaryGrade.createMany({
      data: Array.from({ length: 33 }).map((_, i) => ({
        grade: i + 1,
        amount: 2.1,
        lineId: "c039c8fd-8058-4e07-820e-7a3f36dc108d",
      })),
      skipDuplicates: true,
    });

    return res.code(200).send({ message: "OK" });
  } catch (error) {
    console.log(error);

    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
    }
    throw error;
  }
};
