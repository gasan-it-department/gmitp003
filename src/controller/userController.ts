import { prisma, Prisma } from "../barrel/prisma";
import { FastifyReply, FastifyRequest } from "../barrel/fastify";
import { AppError, NotFoundError, ValidationError } from "../errors/errors";
import { PagingProps } from "../models/route";

export const users = async (req: FastifyRequest, res: FastifyReply) => {
  const params = req.query as PagingProps;
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
      take: 20,
      include: {
        department: true,
        SalaryGrade: true,
        Promotions: true,
        Position: true,
      },
      skip: cursor ? 1 : 0,
      orderBy: {
        lastName: "asc",
      },
    });

    const test = await prisma.department.findMany();
    console.log("DEPT", test);

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
