import { FastifyRequest, FastifyReply } from "../barrel/fastify";
import { Prisma, prisma } from "../barrel/prisma";
import { AppError, NotFoundError, ValidationError } from "../errors/errors";
import { PagingProps, PatientProps, UpdatePatientProps } from "../models/route";

export const patientList = async (req: FastifyRequest, res: FastifyReply) => {
  const params = req.query as PagingProps;

  if (!params.id) throw new ValidationError("BAD_REQUEST");

  try {
    const cursor = params.lastCursor ? { id: params.lastCursor } : undefined;
    const limit = params.limit ? parseInt(params.limit, 10) : 20;

    const filter: any = { lineId: params.id, status: 1 };

    if (params.query) {
      const searchTerms = params.query.trim().split(/\s+/);

      if (searchTerms.length === 1) {
        filter.OR = [
          { lastName: { contains: searchTerms[0], mode: "insensitive" } },
          { firstName: { contains: searchTerms[0], mode: "insensitive" } },
        ];
      } else {
        filter.OR = [
          {
            AND: searchTerms.map((term) => ({
              OR: [
                { firstName: { contains: term, mode: "insensitive" } },
                { lastName: { contains: term, mode: "insensitive" } },
              ],
            })),
          },
        ];
      }
    }

    const response = await prisma.patient.findMany({
      where: { ...filter },
      take: limit,
      skip: cursor ? 1 : 0,
      orderBy: {
        timestamp: "desc",
      },
      cursor,
      include: {
        barangay: {
          select: { name: true },
        },
        municipal: {
          select: { name: true },
        },
        province: {
          select: { name: true },
        },
      },
    });

    const newLastCursorId =
      response.length > 0 ? response[response.length - 1].id : null;
    const hasMore = response.length === limit;

    return res
      .code(200)
      .send({ list: response, hasMore, lastCursor: newLastCursorId });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
    }
    throw error;
  }
};

export const patientData = async (req: FastifyRequest, res: FastifyReply) => {
  const params = req.query as { id: string };

  if (!params.id) throw new ValidationError("BAD_REQUEST");

  try {
    const response = await prisma.patient.findUnique({
      where: { id: params.id },
      include: {
        barangay: {
          select: { name: true },
        },
        municipal: {
          select: { name: true },
        },
        province: {
          select: { name: true },
        },
      },
    });

    if (!response) throw new NotFoundError("PATIENT_NOT_FOUND");

    return res.code(200).send(response);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
    }
    throw error;
  }
};

export const addPatient = async (req: FastifyRequest, res: FastifyReply) => {
  const body = req.body as PatientProps;
  console.log(body);

  if (!body.firstName || !body.lastName || !body.lineId) {
    throw new ValidationError("BAD_REQUEST");
  }

  try {
    const response = await prisma.patient.create({
      data: {
        firstName: body.firstName,
        lastName: body.lastName,
        middleName: body.middleName,
        age: body.age,
        gender: body.gender,
        street: body.street,
        barangayId: body.barangayId,
        municipalId: body.municipalId,
        provinceId: body.provinceId,
        contact: body.contact,
        lineId: body.lineId,
      },
    });

    return res.code(200).send({ message: "OK", data: response });
  } catch (error) {
    console.log(error);

    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
    }
    throw error;
  }
};

export const updatePatient = async (req: FastifyRequest, res: FastifyReply) => {
  const body = req.body as UpdatePatientProps;
  console.log(body);

  if (!body.id) throw new ValidationError("BAD_REQUEST");

  try {
    const patient = await prisma.patient.findUnique({
      where: { id: body.id },
    });

    if (!patient) throw new NotFoundError("PATIENT_NOT_FOUND");

    const response = await prisma.patient.update({
      where: { id: body.id },
      data: {
        firstName: body.firstName,
        lastName: body.lastName,
        middleName: body.middleName,
        age: body.age,
        gender: body.gender,
        street: body.street,
        barangayId: body.barangayId,
        municipalId: body.municipalId,
        provinceId: body.provinceId,
        contact: body.contact,
      },
    });

    return res.code(200).send({ message: "OK", data: response });
  } catch (error) {
    console.log(error);

    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
    }
    throw error;
  }
};

export const deletePatient = async (req: FastifyRequest, res: FastifyReply) => {
  const params = req.query as { id: string };

  if (!params.id) throw new ValidationError("BAD_REQUEST");

  try {
    const patient = await prisma.patient.findUnique({
      where: { id: params.id },
    });

    if (!patient) throw new NotFoundError("PATIENT_NOT_FOUND");

    await prisma.patient.update({
      where: { id: params.id },
      data: { status: 0 },
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
