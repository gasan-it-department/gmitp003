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

    const filter: any = { lineId: params.id };

    if (params.query) {
      const searchTerms = params.query.trim().split(/\s+/);

      if (searchTerms.length === 1) {
        filter.OR = [
          { lastname: { contains: searchTerms[0], mode: "insensitive" } },
          { firstname: { contains: searchTerms[0], mode: "insensitive" } },
        ];
      } else {
        filter.OR = [
          {
            AND: searchTerms.map((term) => ({
              OR: [
                { firstname: { contains: term, mode: "insensitive" } },
                { lastname: { contains: term, mode: "insensitive" } },
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
        barangay: { select: { name: true } },
        municipal: { select: { name: true } },
        province: { select: { name: true } },
        region: { select: { name: true } },
        _count: { select: { record: true } },
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
        barangay: { select: { name: true } },
        municipal: { select: { name: true } },
        province: { select: { name: true } },
        region: { select: { name: true } },
        _count: { select: { record: true } },
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

  if (!body.firstname || !body.lastname || !body.lineId) {
    throw new ValidationError("BAD_REQUEST");
  }

  try {
    const response = await prisma.patient.create({
      data: {
        firstname: body.firstname,
        lastname: body.lastname,
        middlename: body.middlename,
        email: body.email,
        phoneNumber: body.phoneNumber,
        philHealthNo: body.philHealthNo || undefined,
        barangayId: body.barangayId,
        municipalId: body.municipalId,
        provinceId: body.provinceId,
        regionId: body.regionId,
        birthday: body.birthday ? new Date(body.birthday) : undefined,
        illi: body.illi ?? false,
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
        firstname: body.firstname,
        lastname: body.lastname,
        middlename: body.middlename,
        email: body.email,
        phoneNumber: body.phoneNumber,
        philHealthNo: body.philHealthNo || null,
        barangayId: body.barangayId,
        municipalId: body.municipalId,
        provinceId: body.provinceId,
        regionId: body.regionId,
        birthday: body.birthday ? new Date(body.birthday) : undefined,
        illi: body.illi,
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

export const patientRecordList = async (req: FastifyRequest, res: FastifyReply) => {
  const params = req.query as {
    patientId: string;
    lastCursor?: string;
    limit?: string;
  };

  if (!params.patientId) throw new ValidationError("BAD_REQUEST");

  try {
    const cursor = params.lastCursor ? { id: params.lastCursor } : undefined;
    const limit = params.limit ? parseInt(params.limit, 10) : 10;

    const response = await prisma.patientRecord.findMany({
      where: { patientId: params.patientId },
      take: limit,
      skip: cursor ? 1 : 0,
      orderBy: { timestamp: "desc" },
      cursor,
      include: {
        medicineTransaction: {
          select: { id: true, quantity: true, unit: true, timestamp: true, remark: true },
        },
      },
    });

    const lastCursor = response.length > 0 ? response[response.length - 1].id : null;
    const hasMore = response.length === limit;

    return res.code(200).send({ list: response, hasMore, lastCursor });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
    }
    throw error;
  }
};

export const patientRecordData = async (req: FastifyRequest, res: FastifyReply) => {
  const params = req.query as { id: string };

  if (!params.id) throw new ValidationError("BAD_REQUEST");

  try {
    const record = await prisma.patientRecord.findUnique({
      where: { id: params.id },
      include: {
        patient: {
          include: {
            barangay: { select: { name: true } },
            municipal: { select: { name: true } },
            province: { select: { name: true } },
            region: { select: { name: true } },
          },
        },
        prescription: {
          include: {
            presMed: {
              include: {
                medicine: { select: { id: true, name: true, serialNumber: true } },
              },
            },
            MedicineTransaction: {
              include: {
                user: {
                  select: { id: true, username: true, firstName: true, lastName: true },
                },
                storage: { select: { id: true, name: true } },
                MedicineTransactionItem: {
                  include: {
                    medicine: { select: { id: true, name: true, serialNumber: true } },
                    storage: { select: { id: true, name: true } },
                  },
                },
              },
            },
          },
        },
        medicineTransaction: {
          include: {
            user: {
              select: { id: true, username: true, firstName: true, lastName: true },
            },
            storage: { select: { id: true, name: true } },
            prescription: {
              select: {
                id: true,
                refNumber: true,
                condtion: true,
                street: true,
                timestamp: true,
              },
            },
            MedicineTransactionItem: {
              include: {
                medicine: {
                  select: { id: true, name: true, serialNumber: true },
                },
                storage: { select: { id: true, name: true } },
              },
            },
          },
        },
      },
    });

    if (!record) throw new NotFoundError("RECORD_NOT_FOUND");

    // ── Fallback: resolve prescription for legacy records that pre-date the
    // prescriptionId column. Look up by patientId + nearest prescription.
    let result: any = record;
    if (!record.prescription && record.patientId) {
      let derivedId: string | null = null;

      // Type 2: derive from the linked MedicineTransaction
      if (record.medicineTransaction?.prescription?.id) {
        derivedId = record.medicineTransaction.prescription.id;
      }
      // Type 1: find the prescription created closest in time to this record
      else if (record.type === 1) {
        const candidate = await prisma.prescription.findFirst({
          where: { patientId: record.patientId },
          orderBy: { timestamp: "desc" },
        });
        derivedId = candidate?.id ?? null;
      }

      if (derivedId) {
        const fullPrescription = await prisma.prescription.findUnique({
          where: { id: derivedId },
          include: {
            presMed: {
              include: {
                medicine: { select: { id: true, name: true, serialNumber: true } },
              },
            },
            MedicineTransaction: {
              include: {
                user: {
                  select: { id: true, username: true, firstName: true, lastName: true },
                },
                storage: { select: { id: true, name: true } },
                MedicineTransactionItem: {
                  include: {
                    medicine: { select: { id: true, name: true, serialNumber: true } },
                    storage: { select: { id: true, name: true } },
                  },
                },
              },
            },
          },
        });
        if (fullPrescription) {
          result = { ...record, prescription: fullPrescription };
        }
      }
    }

    return res.code(200).send(result);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
    }
    throw error;
  }
};

export const addPatientRecord = async (req: FastifyRequest, res: FastifyReply) => {
  const body = req.body as { patientId: string; diagnose?: string; type?: number };

  if (!body.patientId) throw new ValidationError("BAD_REQUEST");

  try {
    const patient = await prisma.patient.findUnique({
      where: { id: body.patientId },
    });

    if (!patient) throw new NotFoundError("PATIENT_NOT_FOUND");

    const record = await prisma.patientRecord.create({
      data: {
        patientId: body.patientId,
        diagnose: body.diagnose,
        type: body.type ?? 0, // 0 = Diagnose (default)
      },
    });

    return res.code(200).send({ message: "OK", data: record });
  } catch (error) {
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

    // ── Guard: refuse to delete a patient who still has non-dispensed
    // prescriptions. Otherwise the prescriptions would be orphaned (patientId
    // → null via SetNull) and could still be dispensed to a deleted patient.
    const pendingPrescriptions = await prisma.prescription.count({
      where: {
        patientId: params.id,
        status: { lt: 2 }, // 0 = Pending, 1 = Processing, 2 = Dispensed
      },
    });

    if (pendingPrescriptions > 0) {
      throw new ValidationError(
        `Cannot delete patient: ${pendingPrescriptions} pending prescription${
          pendingPrescriptions === 1 ? "" : "s"
        } must be dispensed or cancelled first.`,
      );
    }

    await prisma.patient.delete({
      where: { id: params.id },
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
