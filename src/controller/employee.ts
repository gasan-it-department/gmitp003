import fastify, { FastifyRequest, FastifyReply } from "../barrel/fastify";
import { prisma } from "../barrel/prisma";
import { EmployeesProps } from "../models/Employee";
import { PagingProps } from "../models/route";
import { getYearRange } from "../utils/date";
export const getAllEmpoyees = async (
  req: FastifyRequest,
  res: FastifyReply
) => {
  try {
    const {
      page,
      office,
      sgFrom,
      sgTo,
      year,
      dateApp,
      dateLast,
      lastCursorId,
      query,
    } = req.body as EmployeesProps;
    if (!page) {
      return res.code(400).send({ message: "Bad request" });
    }
    const filter: any = {};

    if (office) {
      filter.departmentId = office;
    }
    if (sgFrom || sgTo) {
      if (sgFrom) {
        filter.SalaryGrade = {
          grade: { equals: sgFrom },
        };
      }

      if (sgTo) {
        filter.SalaryGrade = {
          grade: { equals: sgTo },
        };
      }

      if (sgFrom && sgTo) {
        filter.SalaryGrade = {
          AND: [{ grade: { gte: sgFrom } }, { grade: { lte: sgTo } }],
        };
      }
    }
    const yearFilter =
      year !== "all"
        ? {
            Promotions: {
              some: {
                timestamp: getYearRange(year),
              },
            },
          }
        : {};

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
    const cursor = lastCursorId ? { id: lastCursorId } : undefined;
    const response = await prisma.user.findMany({
      where: {
        ...filter,
        ...yearFilter,
      },
      cursor,
      take: 20,
      include: {
        department: true,
        SalaryGrade: true,
        Promotions: true,
      },
    });

    const newLastCursorId =
      response.length > 0 ? response[response.length - 1].id : null;

    const hasMore = response.length === 20;

    return res
      .code(200)
      .send({ list: response, lastCursorId: newLastCursorId, hasMore });
  } catch (error) {
    console.log(error);

    res.code(500).send({ message: "Internal Server Error" });
  }
};

export const searchUser = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const { query, limit, lastCursor, inUnitOnly, departId } =
      req.query as PagingProps;
    console.log(query, limit, lastCursor, inUnitOnly, departId);

    const filter: any = {};
    if (inUnitOnly && departId) {
      filter.departmentId = departId;
    }
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

    const cursor = lastCursor ? { id: lastCursor } : undefined;

    const response = await prisma.user.findMany({
      where: filter,
      cursor,
      take: parseInt(limit, 10),
      skip: parseInt(limit, 10),
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
