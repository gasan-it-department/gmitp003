import { FastifyRequest, FastifyReply } from "../barrel/fastify";
import { Prisma, prisma } from "../barrel/prisma";
import { PagingProps } from "../models/route";
import { AppError, ValidationError } from "../errors/errors";

// Non-plantilla employment categories. A User in any of these is "provisional"
// (temporary/contract) and is surfaced only in the Provisional > Personnel tab,
// NOT in the plantilla Employees list. Regular plantilla staff keep "Regular".
export const PROVISIONAL_STATUSES = [
  "Provisional",
  "Contract",
  "Casual",
  "Job Order",
  "Temporary",
];

// GET /provisional/designations?id=<lineId>&query&lastCursor&limit
// Designations available for provisional hiring = UnitPositions on this line
// flagged non-plantilla (plantilla = false). Mirrors positionList but scoped by
// line + the plantilla filter, with vacant-slot info for the hire flow.
export const provisionalDesignations = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const params = req.query as PagingProps;
  if (!params.id) throw new ValidationError("BAD_REQUEST");

  try {
    const cursor = params.lastCursor ? { id: params.lastCursor } : undefined;
    const limit = params.limit ? parseInt(params.limit, 10) : 10;
    const q = (params.query ?? "").trim();

    const where: Prisma.UnitPositionWhereInput = {
      lineId: params.id,
      plantilla: false,
      ...(q
        ? {
            OR: [
              { designation: { contains: q, mode: "insensitive" } },
              { position: { name: { contains: q, mode: "insensitive" } } },
            ],
          }
        : {}),
    };

    const response = await prisma.unitPosition.findMany({
      where,
      cursor,
      take: limit,
      skip: cursor ? 1 : 0,
      orderBy: { timestamp: "desc" },
      include: {
        unit: { select: { id: true, name: true } },
        position: { select: { id: true, name: true, itemNumber: true } },
        slot: {
          select: {
            id: true,
            occupied: true,
            userId: true,
            salaryGrade: { select: { grade: true } },
            user: {
              select: { id: true, firstName: true, lastName: true },
            },
          },
        },
      },
    });

    const lastCursor =
      response.length > 0 ? response[response.length - 1].id : null;
    const hasMore = response.length === limit;

    return res.code(200).send({ list: response, lastCursor, hasMore });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
    }
    throw error;
  }
};

// GET /provisional/personnel?id=<lineId>&query&lastCursor&limit
// Provisional employees = Users on this line whose status is one of the
// non-plantilla categories. Returns the contract end date (User.term).
export const provisionalPersonnel = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const params = req.query as PagingProps;
  if (!params.id) throw new ValidationError("BAD_REQUEST");

  try {
    const cursor = params.lastCursor ? { id: params.lastCursor } : undefined;
    const limit = params.limit ? parseInt(params.limit, 10) : 20;
    const q = (params.query ?? "").trim();

    const where: Prisma.UserWhereInput = {
      lineId: params.id,
      status: { in: PROVISIONAL_STATUSES },
      ...(q
        ? {
            OR: [
              { firstName: { contains: q, mode: "insensitive" } },
              { lastName: { contains: q, mode: "insensitive" } },
              { middleName: { contains: q, mode: "insensitive" } },
              { username: { contains: q, mode: "insensitive" } },
            ],
          }
        : {}),
    };

    const response = await prisma.user.findMany({
      where,
      cursor,
      take: limit,
      skip: cursor ? 1 : 0,
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        middleName: true,
        username: true,
        status: true,
        term: true,
        createdAt: true,
        accountId: true,
        department: { select: { id: true, name: true } },
        Position: { select: { id: true, name: true } },
        SalaryGrade: { select: { grade: true } },
      },
    });

    const lastCursor =
      response.length > 0 ? response[response.length - 1].id : null;
    const hasMore = response.length === limit;

    return res.code(200).send({ list: response, lastCursor, hasMore });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
    }
    throw error;
  }
};
