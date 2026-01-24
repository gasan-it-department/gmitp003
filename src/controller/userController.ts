import { prisma, Prisma } from "../barrel/prisma";
import { FastifyReply, FastifyRequest } from "../barrel/fastify";
import { AppError, NotFoundError, ValidationError } from "../errors/errors";
import { PagingProps } from "../models/route";

export const users = async (req: FastifyRequest, res: FastifyReply) => {
  const params = req.query as PagingProps;
  console.log({ params });

  if (!params.id) throw new ValidationError("BAD_REQUEST");

  try {
    const cursor = params.lastCursor ? { id: params.lastCursor } : undefined;
    const filter: any = {};
    const limit = params.limit ? parseInt(params.limit, 10) : 20;
    const query = params.query;
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
        delete filter.AND;
      }
    }
    const response = await prisma.user.findMany({
      where: {
        lineId: params.id,
        ...filter,
      },
      cursor,
      take: limit,
      select: {
        department: {
          select: {
            name: true,
            id: true,
          },
        },
        SalaryGrade: true,
        Promotions: true,
        Position: true,
        id: true,
        lastName: true,
        firstName: true,
      },
      skip: cursor ? 1 : 0,
      orderBy: {
        lastName: "asc",
      },
    });

    const newLastCursorId =
      response.length > 0 ? response[response.length - 1].id : null;

    const hasMore = response.length === limit;
    return res
      .code(200)
      .send({ list: response, lastCursorId: newLastCursorId, hasMore });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
    }
    throw error;
  }
};

export const searchUsers = async (req: FastifyRequest, res: FastifyReply) => {
  const params = req.query as PagingProps;
  console.log("User: ", { params });
  console.log("0");

  if (!params.id) throw new ValidationError("BAD_REQUEST");
  console.log("1");

  if (!params.query)
    return res.code(200).send({ list: [], hasMore: false, lastCursor: null });
  console.log("check");

  try {
    const cursor = params.lastCursor ? { id: params.lastCursor } : undefined;
    const filter: any = {};
    const limit = params.limit ? parseInt(params.limit, 10) : 20;
    const query = params.query;
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
        delete filter.AND;
      }
    }

    console.log({ filter });

    const response = await prisma.user.findMany({
      where: {
        lineId: params.id,
        ...filter,
      },
      cursor,
      take: limit,
      select: {
        department: {
          select: {
            name: true,
            id: true,
          },
        },
        SalaryGrade: true,
        Promotions: true,
        Position: true,
        id: true,
        lastName: true,
        firstName: true,
        userProfilePictures: {
          select: {
            file_url: true,
            file_name: true,
          },
        },
        username: true,
      },
      skip: cursor ? 1 : 0,
      orderBy: {
        lastName: "asc",
      },
    });

    console.log({ response });

    const newLastCursorId =
      response.length > 0 ? response[response.length - 1].id : null;

    const hasMore = response.length === limit;
    return res
      .code(200)
      .send({ list: response, lastCursorId: newLastCursorId, hasMore });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
    }
    throw error;
  }
};

export const getUserInfo = async (req: FastifyRequest, res: FastifyReply) => {
  const params = req.query as { id: string };
  console.log("user: ", { params });

  if (!params.id) throw new ValidationError("BAD_REQUEST");
  try {
    const user = await prisma.user.findUnique({
      where: {
        id: params.id,
      },
      include: {
        department: {
          select: {
            name: true,
            id: true,
          },
        },
        userProfilePictures: {
          select: {
            file_name: true,
            file_url: true,
          },
        },
      },
    });
    if (!user) throw new NotFoundError("USER_NOT_FOUND");
    return res.code(200).send(user);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
    }
    throw error;
  }
};
