import { FastifyRequest, FastifyReply } from "../barrel/fastify";
import { Prisma, prisma } from "../barrel/prisma";
import { AppError, NotFoundError, ValidationError } from "../errors/errors";
import { generatePrescriptionRef } from "../middleware/handler";
import {
  PagingProps,
  PrescriptionDispenseProps,
  PrescriptionProps,
} from "../models/route";

export const prescriptions = async (req: FastifyRequest, res: FastifyReply) => {
  const params = req.query as {};

  try {
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
    }
    throw error;
  }
};

export const createPrescriptions = async (
  req: FastifyRequest,
  res: FastifyReply
) => {
  const body = req.body as PrescriptionProps;
  console.log(body);

  try {
    const refNumber = await generatePrescriptionRef();
    const response = await prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({
        where: {
          id: body.userId,
        },
      });

      if (!user) throw new NotFoundError("User not found!");
      const prescription = await tx.prescription.create({
        data: {
          lineId: body.lineId,
          refNumber: refNumber,
          firstname: body.firstname,
          lastname: body.lastname,
          age: body.age,
          barangayId: body.barangayId,
          municipalId: body.municipalId,
          provinceId: body.provinceId,
          userId: user.id,
          street: body.street,
          condtion: body.desc,
          progress: {
            create: {
              step: 0,
            },
          },
          presMed: {
            createMany: {
              data: body.prescribeMed.map((item) => {
                return {
                  medicineId: item.medId,
                  quantity: parseInt(item.quantity, 10),
                  desc: item.quantity,
                };
              }),
            },
          },
        },
      });

      await tx.medicineLogs.create({
        data: {
          action: 1,
          message: `Submitted Prescription Ref. #: ${prescription.refNumber}.`,
          userId: body.userId,
        },
      });
      const notRequired: any = {};
      if (body.unitId) {
        notRequired.departmentId = body.unitId;
      }
      await tx.medicineNotification.create({
        data: {
          userId: body.userId,
          view: 0,
          path: `prescription/${prescription.id}`,
          message: `${user.lastName}, ${user.firstName} - submitted prescripton for ${body.lastname}, ${body.firstname} `,
          title: "New Prescription",
          lineId: body.lineId,
          ...notRequired,
        },
      });
      return prescription;
    });
    return res.code(200).send({ message: "OK", refNumber, response });
  } catch (error) {
    console.log(error);

    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
    }
    throw error;
  }
};

export const prescriptionList = async (
  req: FastifyRequest,
  res: FastifyReply
) => {
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
          { refNumber: { contains: searchTerms[0], mode: "insensitive" } },
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
          { refNumber: { contains: params.query.trim(), mode: "insensitive" } },
        ];
        delete filter.AND;
      }
    }

    const response = await prisma.prescription.findMany({
      where: { ...filter },
      take: limit,
      skip: cursor ? 1 : 0,
      orderBy: {
        timestamp: "desc",
      },
      cursor,
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

export const prescriptionData = async (
  req: FastifyRequest,
  res: FastifyReply
) => {
  const params = req.query as { id: string };

  if (!params.id) throw new ValidationError("BAD_REQUEST");
  try {
    const response = await prisma.prescription.findUnique({
      where: {
        id: params.id,
      },
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
        progress: {
          orderBy: {
            timestamp: "asc",
          },
        },
        processBy: {
          select: {
            firstName: true,
            lastName: true,
          },
        },
      },
    });
    if (!response) {
      throw new NotFoundError("ITEM_NOT_FOUND");
    }

    return res.code(200).send(response);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
    }
    throw error;
  }
};

export const prescriptionPrescribeMed = async (
  req: FastifyRequest,
  res: FastifyReply
) => {
  const params = req.query as PagingProps;
  if (!params.id) throw new ValidationError("BAD_REQUEST");
  try {
    const cursor = params.lastCursor ? { id: params.lastCursor } : undefined;
    const limit = params.limit ? parseInt(params.limit, 10) : 10;

    const response = await prisma.precribeMedicine.findMany({
      where: {
        prescriptionId: params.id,
      },
      skip: cursor ? 1 : 0,
      take: limit,
      cursor,
      include: {
        medicine: {
          select: {
            id: true,
            name: true,
            MedicineStock: {
              select: {
                stock: {
                  select: {
                    perUnit: true,
                    id: true,
                    quantity: true,
                  },
                },
              },
            },
          },
        },
      },
    });
    console.log(JSON.stringify(response, null, 2));

    const newLastCursorId =
      response.length > 0 ? response[response.length - 1].id : null;
    const hasMore = limit === response.length;

    return res
      .code(200)
      .send({ list: response, lastCursor: newLastCursorId, hasMore });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
    }
    throw error;
  }
};

export const prescriptionProgres = async (
  req: FastifyRequest,
  res: FastifyReply
) => {
  const params = req.query as PagingProps;
  if (!params.id) throw new ValidationError("BAD_REQUEST");

  try {
    const cursor = params.lastCursor ? { id: params.lastCursor } : undefined;
    const limit = params.limit ? parseInt(params.limit) : 20;

    const response = await prisma.prescriptionProgress.findMany({
      where: {
        prescriptionId: params.id,
      },
      take: limit,
      skip: cursor ? 1 : 0,
      orderBy: {
        timestamp: "desc",
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
      throw new AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
    }
    throw error;
  }
};

export const prescriptionDispense = async (
  req: FastifyRequest,
  res: FastifyReply
) => {
  const body = req.body as PrescriptionDispenseProps;
  console.log("Request body:", body);

  if (!body.id) throw new ValidationError("BAD_REQUEST");

  try {
    console.log("Log 1 - Starting transaction");

    await prisma.$transaction(async (tx) => {
      const prescription = await tx.prescription.findUnique({
        where: {
          id: body.id,
        },
        include: {
          presMed: {
            select: {
              id: true,
              quantity: true,
            },
          },
        },
      });
      console.log("Log 2 - Prescription found:", prescription?.id);

      const medicineStocks = await tx.medicineStock.findMany({
        where: {
          medicineId: {
            in: body.prescribeMed.map((item) => item.medId),
          },
        },
        include: {
          stock: {
            select: {
              quantity: true,
              perUnit: true,
              id: true,
            },
          },
        },
      });
      console.log("Log 3 - Medicine stocks found:", medicineStocks.length);

      if (!prescription) throw new NotFoundError("Prescription not found!");
      if (prescription.status === 2)
        throw new ValidationError("Prescripton already processed");
      // Update each prescribeMedicine with its specific quantity
      console.log("Log 3.5 - Updating prescribeMedicine records");
      await Promise.all(
        body.prescribeMed.map((item) =>
          tx.precribeMedicine.update({
            where: {
              id: item.id,
            },
            data: {
              releaseQuantity: item.quantity,
            },
          })
        )
      );
      console.log("Log 4 - PrescribeMedicine updated");

      const transaction = await tx.medicineTransaction.create({
        data: {
          prescriptionId: prescription.id,
          quantity: prescription.presMed.length,
          userId: body.userId,
          remark: 1,
          lineId: prescription.lineId,
          unit: "",
        },
      });
      console.log("Log 5 - Transaction created:", transaction.id);

      // Process medicine stocks sequentially for better debugging
      console.log("Log 5.5 - Starting medicine stock processing");

      for (let i = 0; i < medicineStocks.length; i++) {
        const item = medicineStocks[i];
        console.log(
          `Processing stock ${i + 1}/${medicineStocks.length}:`,
          item.id
        );

        try {
          const toDispense = body.prescribeMed.find(
            (med) => med.medId === item.medicineId
          );
          console.log("Log 6 - To dispense:", toDispense);

          if (!toDispense) {
            console.log("No dispense found for stock:", item.id);
            continue;
          }

          const quantity = item.stock?.quantity || 0;
          const perUnit = item.stock?.perUnit || 0;
          const toRelease = Number(toDispense.quantity);
          console.log(
            "Log 7 - Quantity:",
            quantity,
            "PerUnit:",
            perUnit,
            "ToRelease:",
            toRelease
          );

          // Validate inputs
          if (isNaN(toRelease)) {
            throw new Error(`Invalid release quantity: ${toDispense.quantity}`);
          }

          const updatedData: any = {};
          let perUnitReal: number =
            toRelease > perUnit ? Math.floor(toRelease / perUnit) : toRelease;
          let perUnitRamainder: number =
            toRelease >= perUnit ? toRelease % perUnit : perUnit;

          console.log(
            "Log 8 - perUnitReal:",
            perUnitReal,
            "perUnitRamainder:",
            perUnitRamainder
          );

          const newQuantity = quantity - perUnitReal;
          const newPerUnit = perUnit - perUnitRamainder;

          console.log(
            "Log 9 - newQuantity:",
            newQuantity,
            "newPerUnit:",
            newPerUnit
          );

          if (toRelease > perUnit) {
            updatedData.quantity = newQuantity;
          }

          console.log("Log 9.5 - Updating medicine quality");
          // FIXED: Added await for each database operation
          await tx.medicineQuality.update({
            where: {
              medicineStockId: item.id,
            },
            data: {
              ...updatedData,
            },
          });

          console.log("Log 9.6 - Updating medicine stock");
          await tx.medicineStock.update({
            where: {
              id: item.id,
            },
            data: {
              actualStock: newQuantity * newPerUnit,
            },
          });

          await tx.medicineTransactionItem.create({
            data: {
              medicineTransactionId: transaction.id,
              prescribeQuantity: toDispense.prescribeQuantity,
              releasedQuantity: toDispense.quantity,
              precribeMedicineId: toDispense.id,
            },
          });
        } catch (innerError) {
          throw innerError; // Re-throw to fail the transaction
        }
      }
      await tx.prescription.update({
        data: {
          status: 2,
        },
        where: {
          id: prescription.id,
        },
      });
      await tx.medicineLogs.create({
        data: {
          userId: body.userId,
          action: 2,
          message: `Dispensed Medicine: Ref. #: ${prescription.refNumber}`,
          lineId: prescription.lineId,
        },
      });
    });

    return res.code(200).send({ message: "OK" });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
    }

    if (error instanceof Error) {
      console.error("Error stack:", error.stack);
    }

    throw error;
  }
};

export const prescriptionProgress = async (
  req: FastifyRequest,
  res: FastifyReply
) => {
  const params = req.query as PagingProps;
  console.log(params);

  if (!params.id) throw new ValidationError("BAD_REQUEST");
  try {
    const cursor = params.lastCursor ? { id: params.lastCursor } : undefined;
    const limit = params.limit ? parseInt(params.limit, 10) : 10;

    const response = await prisma.prescriptionProgress.findMany({
      where: {
        prescriptionId: params.id,
      },
      skip: cursor ? 1 : 0,
      take: limit,
      cursor,
      orderBy: {
        timestamp: "desc",
      },
    });

    const newLastCursorId =
      response.length > 0 ? response[response.length - 1].id : null;
    const hasMore = limit === response.length;

    return res
      .code(200)
      .send({ list: response, lastCursor: newLastCursorId, hasMore });
  } catch (error) {
    // More detailed error logging
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
    }

    throw error;
  }
};

export const prescriptionProgressUpdate = async (
  req: FastifyRequest,
  res: FastifyReply
) => {
  const body = req.body as { id: string; userId: string; progress: number };

  try {
    await prisma.$transaction(async (tx) => {
      const prescription = await tx.prescription.findUnique({
        where: {
          id: body.userId,
        },
      });
      if (!prescription) throw new NotFoundError("Prescription not found!");
      await tx.prescriptionProgress.create({
        data: {
          prescriptionId: prescription.id,
          step: body.progress,
        },
      });
    });
    return res.code(200).send({ message: "OK" });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
    }

    throw error;
  }
};
