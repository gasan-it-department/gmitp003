import { FastifyReply, FastifyRequest } from "../barrel/fastify";
import { prisma, Prisma } from "../barrel/prisma";
import { PagingProps } from "../models/route";

//
import { AppError, ValidationError, dbError } from "../errors/errors";
export const salaryGradeList = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const { lastCursor, limit, id } = req.query as PagingProps;

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
      include: {
        _count: {
          select: {
            SalaryGradeHistory: true,
            users: true,
          },
        },
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
      throw dbError(error);
    }
    throw error;
  }
};

export const saveNewSalaryGrade = async (
  req: FastifyRequest,
  res: FastifyReply,
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
      throw dbError(error);
    }
    throw error;
  }
};

export const updateSalaryGrade = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const body = req.body as {
    id: string;
    amount: number;
    userId: string;
    lineId: string;
  };
  if (!body.id || !body.amount || !body.lineId || !body.userId) {
    throw new ValidationError("BAD_REQUEST");
  }

  try {
    const response = await prisma.$transaction(async (tx) => {
      const updatedSalaryGrade = await tx.salaryGrade.update({
        data: {
          amount: body.amount,
        },
        where: {
          id: body.id,
        },
      });

      await tx.salaryGradeHistory.create({
        data: {
          salaryGradeId: body.id,
          amount: body.amount,
          // Record *who* changed the value so the history tab can attribute
          // each adjustment (previously stored an empty string).
          userId: body.userId,
          effectiveDate: new Date(),
        },
      });
      await tx.humanResourcesLogs.create({
        data: {
          action: `Updated Salary Grade ${updatedSalaryGrade.grade} to ${updatedSalaryGrade.amount}`,
          lineId: updatedSalaryGrade.lineId as string,
          desc: `Salary Grade ${updatedSalaryGrade.grade} amount updated to ${updatedSalaryGrade.amount}`,
          userId: body.userId,
        },
      });

      return true;
    });

    if (!response) {
      throw new ValidationError("TRANSACTION FAILED");
    }

    return res.code(200).send({
      message: "OK",
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw dbError(error);
    }
    throw error;
  }
};

/**
 * Summary for a single salary grade — powers the detail page header
 * (grade, current amount, when it was created, and how many users /
 * history entries it has).
 */
export const salaryGradeInfo = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const { id } = req.query as { id?: string };
  if (!id) throw new ValidationError("BAD_REQUEST");

  try {
    const sg = await prisma.salaryGrade.findUnique({
      where: { id },
      select: {
        id: true,
        grade: true,
        amount: true,
        createdAt: true,
        lineId: true,
        _count: { select: { users: true, SalaryGradeHistory: true } },
      },
    });

    if (!sg) throw new ValidationError("Salary grade not found");

    return res.code(200).send(sg);
  } catch (error) {
    if (error instanceof ValidationError) throw error;
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw dbError(error);
    }
    throw error;
  }
};

/**
 * Paginated value-change history for a salary grade (newest first).
 * Each row is attributed to the HR user who made the change.
 */
export const salaryGradeHistory = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const { id, lastCursor, limit } = req.query as PagingProps;
  if (!id) throw new ValidationError("BAD_REQUEST");

  try {
    const cursor = lastCursor ? { id: lastCursor } : undefined;
    const take = limit ? parseInt(limit, 10) : 20;

    const rows = await prisma.salaryGradeHistory.findMany({
      where: { salaryGradeId: id },
      cursor,
      take,
      skip: cursor ? 1 : 0,
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        amount: true,
        effectiveDate: true,
        createdAt: true,
        userId: true,
      },
    });

    // Attach the name of whoever made each change (no FK relation exists on
    // SalaryGradeHistory.userId, so resolve them in a single batched query).
    const userIds = [...new Set(rows.map((r) => r.userId).filter(Boolean))];
    const users = userIds.length
      ? await prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, firstName: true, lastName: true, username: true },
        })
      : [];
    const byId = new Map(users.map((u) => [u.id, u]));

    const list = rows.map((r) => ({
      ...r,
      changedBy: byId.get(r.userId) ?? null,
    }));

    const newLastCursor = rows.length ? rows[rows.length - 1].id : null;
    const hasMore = rows.length === take;

    return res
      .code(200)
      .send({ list, lastCursor: newLastCursor, hasMore });
  } catch (error) {
    if (error instanceof ValidationError) throw error;
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw dbError(error);
    }
    throw error;
  }
};

/**
 * Paginated list of users currently assigned to a salary grade, with an
 * optional name/username search.
 */
export const salaryGradeUsers = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const { id, lastCursor, limit, query } = req.query as PagingProps;
  if (!id) throw new ValidationError("BAD_REQUEST");

  try {
    const cursor = lastCursor ? { id: lastCursor } : undefined;
    const take = limit ? parseInt(limit, 10) : 20;

    const where: Prisma.UserWhereInput = {
      salaryGradeId: id,
      ...(query && query.trim()
        ? {
            OR: [
              { firstName: { contains: query, mode: "insensitive" } },
              { lastName: { contains: query, mode: "insensitive" } },
              { username: { contains: query, mode: "insensitive" } },
            ],
          }
        : {}),
    };

    const rows = await prisma.user.findMany({
      where,
      cursor,
      take,
      skip: cursor ? 1 : 0,
      orderBy: { firstName: "asc" },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        username: true,
        profilePicture: true,
        Position: { select: { name: true } },
        department: { select: { name: true } },
      },
    });

    const newLastCursor = rows.length ? rows[rows.length - 1].id : null;
    const hasMore = rows.length === take;

    return res
      .code(200)
      .send({ list: rows, lastCursor: newLastCursor, hasMore });
  } catch (error) {
    if (error instanceof ValidationError) throw error;
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw dbError(error);
    }
    throw error;
  }
};
