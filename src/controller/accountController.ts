import { FastifyReply, FastifyRequest } from "../barrel/fastify";
import { prisma } from "../barrel/prisma";
import { PagingProps } from "../models/route";
export const accountList = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const params = req.query as PagingProps;
    console.log(params);
    const filter: any = {};
    if (params.query) {
      const searchTerms = params.query.trim().split(/\s+/); // Split on any whitespace

      if (searchTerms.length === 1) {
        filter.OR = [
          { lastName: { contains: searchTerms[0], mode: "insensitive" } },
          { firstName: { contains: searchTerms[0], mode: "insensitive" } },
          { middleName: { contains: searchTerms[0], mode: "insensitive" } },
          { email: { contains: searchTerms[0], mode: "insensitive" } },
        ];
      } else {
        filter.AND = searchTerms.map((term) => ({
          OR: [
            { firstName: { contains: term, mode: "insensitive" } },
            { lastName: { contains: term, mode: "insensitive" } },
            { middleName: { contains: term, mode: "insensitive" } },
            { email: { contains: term, mode: "insensitive" } },
          ],
        }));

        filter.OR = [
          { AND: filter.AND },
          {
            username: { contains: params.query.trim(), mode: "insensitive" },
          },
        ];
        delete filter.AND; // Remove the AND since we've incorporated it into OR
      }
    }

    const cursor = params.lastCursor ? { id: params.lastCursor } : undefined;
    const accounts = await prisma.account.findMany({
      where: {
        User: { ...filter },
      },
      cursor,
      take: parseInt(params.limit, 10),
      select: {
        User: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
          },
        },
        id: true,
        username: true,
      },
      skip: cursor ? 1 : 0,
    });
    const nextLastCursorId =
      accounts.length > 0 ? accounts[accounts.length - 1].id : null;
    const hasMore = accounts.length === 20;

    res
      .code(200)
      .send({ list: accounts, lastCursor: nextLastCursorId, hasMore });
  } catch (error) {
    console.log(error);
    res.code(500).send({ message: "Internal Server Error" });
  }
};
