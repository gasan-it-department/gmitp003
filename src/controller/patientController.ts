import { FastifyReply, FastifyRequest } from "../barrel/fastify";
import { prisma, Prisma } from "../barrel/prisma";
import { ValidationError, NotFoundError, AppError } from "../errors/errors";
import { Patient } from "../class/Patient";
//
import { NewPatientProps, PagingProps } from "../models/route";

export const patientList = async (req: FastifyRequest, res: FastifyReply) => {
  const params = req.query as PagingProps;
  if (!params.id) {
    throw new ValidationError("INVALID REQUIRED FIELD");
  }

  try {
    const cursor = params.lastCursor ? { id: params.lastCursor } : undefined;
    const limit = params.limit ? parseInt(params.limit, 10) : 20;
    const filter: any = { lineId: params.id };

    if (params.barangayId && typeof params.barangayId === "string") {
      filter.barangayId = params.barangayId;
    }
    if (params.municipalId && typeof params.municipalId === "string") {
      filter.municipalId = params.municipalId;
    }
    if (params.provinceId && typeof params.provinceId === "string") {
      filter.provinceIdId = params.provinceId;
    }

    if (params.regionId && typeof params.regionId === "string") {
      filter.regionIdId = params.regionId;
    }

    if (params.query) {
      const searchTerms = params.query.trim().split(/\s+/); // Split on any whitespace

      if (searchTerms.length === 1) {
        filter.OR = [
          { lastname: { contains: searchTerms[0], mode: "insensitive" } },
          { firstname: { contains: searchTerms[0], mode: "insensitive" } },
          { middlename: { contains: searchTerms[0], mode: "insensitive" } },
          { phoneNumber: { contains: searchTerms[0], mode: "insensitive" } },
          { email: { contains: searchTerms[0], mode: "insensitive" } },
        ];
      } else {
        filter.AND = searchTerms.map((term) => ({
          OR: [
            { firstname: { contains: term, mode: "insensitive" } },
            { lastname: { contains: term, mode: "insensitive" } },
            { middlename: { contains: term, mode: "insensitive" } },
            { phoneNumber: { contains: term, mode: "insensitive" } },
            { email: { contains: term, mode: "insensitive" } },
          ],
        }));

        filter.OR = [
          { AND: filter.AND },
          {
            middlename: { contains: params.query.trim(), mode: "insensitive" },
          },
        ];
        delete filter.AND;
      }
    }

    const response = await prisma.patient.findMany({
      where: filter,
      include: {
        barangay: {
          select: {
            name: true,
          },
        },
        municipal: {
          select: {
            name: true,
          },
        },
        province: {
          select: {
            name: true,
          },
        },
        region: {
          select: {
            name: true,
          },
        },
      },
      skip: cursor ? 1 : 0,
      take: limit,
      orderBy: {
        lastname: "desc",
      },
      cursor,
    });

    const newLastCursorId =
      response.length > 0 ? response[response.length - 1].id : null;
    const hasMore = limit === response.length;

    return res
      .code(200)
      .send({ list: response, lastCursor: newLastCursorId, hasMore });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DATABASE_CONNECTION_ERROR", 500, "DB_FAILED");
    }
    throw error;
  }
};

export const createPatient = async (req: FastifyRequest, res: FastifyReply) => {
  const body = req.body as NewPatientProps;

  if (
    !body.firstname ||
    !body.lastname ||
    !body.barangayId ||
    !body.municipalId ||
    !body.provinceId ||
    !body.regionId
  ) {
    throw new ValidationError("INVALID REQUIRED FIELD");
  }

  try {
    const patient = new Patient(
      body.lastname,
      body.firstname,
      body.lineId,
      body.email,
      body.phoneNumber,
    );

    await patient.create();
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DATABASE_CONNECTION_ERROR", 500, "DB_FAILED");
    }
    throw error;
  }
};
