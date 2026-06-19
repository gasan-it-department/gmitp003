import { prisma } from "../barrel/prisma";
import { FastifyReply, FastifyRequest } from "../barrel/fastify";
import { PagingProps } from "../models/route";
import { ValidationError } from "../errors/errors";

/**
 * Paginated list of users assigned to a department/unit.
 *
 * Supports an optional `query` to filter by first/last/middle name or
 * email (case-insensitive). The previous version had a `hasMore` bug
 * (compared `response.length === 10` regardless of the requested limit)
 * and ignored search input entirely.
 */
export const personnelList = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const { lastCursor, query, limit, id } = req.query as PagingProps;
  if (!id) throw new ValidationError("INVALID_REQUEST");

  try {
    const cursor = lastCursor ? { id: lastCursor } : undefined;
    const take = limit ? parseInt(limit, 10) : 20;

    const where: any = { departmentId: id };
    if (query && query.trim()) {
      const q = query.trim();
      where.OR = [
        { firstName: { contains: q, mode: "insensitive" } },
        { lastName: { contains: q, mode: "insensitive" } },
        { middleName: { contains: q, mode: "insensitive" } },
        { email: { contains: q, mode: "insensitive" } },
        { username: { contains: q, mode: "insensitive" } },
      ];
    }

    const response = await prisma.user.findMany({
      where,
      cursor,
      take,
      skip: cursor ? 1 : 0,
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
      select: {
        id: true,
        firstName: true,
        lastName: true,
        middleName: true,
        email: true,
        username: true,
        // `status` + `term` let the UI label provisional (non-plantilla) staff
        // with their employment type / contract end instead of "No position".
        status: true,
        term: true,
        Position: { select: { id: true, name: true } },
      },
    });

    const newLastCursorId =
      response.length > 0 ? response[response.length - 1].id : null;
    const hasMore = response.length === take;
    return res
      .code(200)
      .send({ list: response, lastCursor: newLastCursorId, hasMore });
  } catch (error) {
    console.error("[personnelList]", error);
    return res.code(500).send({ message: "Internal Server Error" });
  }
};
