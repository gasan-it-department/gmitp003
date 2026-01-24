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
          select: {
            id: true,
            timestamp: true,
            step: true,
          },
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
        presMed: {
          select: {
            medicine: {
              select: {
                name: true,
                id: true,
              },
            },
            quantity: true,
            releaseQuantity: true,
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

    await prisma.$transaction(async (tx) => {
      const prescribeMeds = await tx.precribeMedicine.findMany({
        where: {
          prescriptionId: params.id,
        },
      });

      if (prescribeMeds.length === 0) return; // or throw an error

      // Filter out null values and cast to string[]
      const medIds = prescribeMeds
        .map((item) => item.medicineId)
        .filter((id): id is string => id !== null); // Type guard to ensure string[]

      const stocks = await tx.medicineStock.groupBy({
        by: [
          "medicineId",
          "expiration",
          "perQuantity",
          "actualStock",
          "quantity",
        ],
        where: {
          medicineId: {
            in: medIds, // This is now string[]
          },
        },
      });

      console.log(stocks);
    });
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
                id: true,
                perQuantity: true,
                quality: true,
                actualStock: true,
                quantity: true,
                expiration: true,
              },
            },
          },
        },
      },
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
    const stocks = new Map();
    for (let i = 0; i < body.prescribeMed.length; i++) {
      const item = body.prescribeMed[i];
      for (let j = 0; j < item.stocks.length; j++) {
        const stock = item.stocks[j];
        stocks.set(stock.id, stock.toRelease);
      }
    }
    const stockIds = Array.from(stocks.keys());
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
          id: {
            in: stockIds,
          },
        },
      });
      console.log("Log 3 - Medicine stocks found:", medicineStocks);

      if (!prescription) throw new NotFoundError("Prescription not found!");
      if (prescription.status === 2)
        throw new ValidationError("Prescripton already processed");
      // Update each prescribeMedicine with its specific quantity
      console.log("Log 3.5 - Updating prescribeMedicine records");
      const totalStocks = Array.from(stocks.values()).reduce(
        (sum, value) => sum + parseInt(value, 10),
        0
      );
      await Promise.all(
        body.prescribeMed.map((item) =>
          tx.precribeMedicine.update({
            where: {
              id: item.id,
            },
            data: {
              releaseQuantity: totalStocks,
              remark: item.remark,
            },
          })
        )
      );

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

      for (let i = 0; i < medicineStocks.length; i++) {
        const item = medicineStocks[i];

        try {
          const toDispense = body.prescribeMed.find(
            (med) => med.medId === item.medicineId
          );
          console.log("Log 6 - To dispense:", toDispense);

          if (!toDispense) {
            console.log("No dispense found for stock:", item.id);
            continue;
          }

          const currentBoxes = item.quantity;
          const perBox = item.perQuantity;
          const currentStockPieces = item.actualStock;
          const toRelease = stocks.get(item.id);
          console.log(
            "Log 7 - Quantity:",
            currentBoxes,
            "PerUnit:",
            perBox,
            "ToRelease:",
            toRelease,
            "Loose: ",
            currentStockPieces
          );

          if (toRelease > currentStockPieces) {
            continue;
          }

          // Validate inputs
          if (isNaN(toRelease)) {
            throw new Error(`Invalid release quantity: ${toDispense.quantity}`);
          }

          // Replace lines 140-163 with this corrected logic:

          const fullBoxesToGive = Math.floor(toRelease / perBox);
          const loosePieces = toRelease % perBox;

          console.log("Dispensing calculation:", {
            fullBoxesToGive,
            loosePieces,
          });

          // Calculate remaining inventory - CORRECTED LOGIC
          let remainingFullBoxes = currentBoxes - fullBoxesToGive;
          let openedBoxRemainingPieces = 0;
          let totalBoxesAfter = remainingFullBoxes;

          if (loosePieces > 0) {
            if (remainingFullBoxes > 0) {
              openedBoxRemainingPieces = perBox - loosePieces;
              // We opened one of the remaining boxes, so it's no longer a full box
              remainingFullBoxes -= 1;
              totalBoxesAfter = remainingFullBoxes + 1; // +1 for the opened box
            } else {
              // This shouldn't happen if toRelease <= currentStockPieces
              throw new Error("Insufficient boxes for loose pieces");
            }
          }

          // Total pieces calculation
          const remainingPieces =
            remainingFullBoxes * perBox + openedBoxRemainingPieces;

          // Also calculate expected remaining pieces
          const expectedRemainingPieces = currentStockPieces - toRelease;

          console.log("Remaining calculation:", {
            remainingFullBoxes,
            openedBoxRemainingPieces,
            remainingPieces,
            expectedRemainingPieces,
            check: remainingPieces === expectedRemainingPieces,
          });

          // For the update, we need to handle boxes correctly
          // If we have an opened box with remaining pieces, it counts as 1 box
          totalBoxesAfter =
            remainingFullBoxes + (openedBoxRemainingPieces > 0 ? 1 : 0);

          console.log({
            currentBoxes,
            currentStockPieces,
            perBox,
            totalBoxesAfter,
            remainingPieces,
          });

          await tx.medicineStock.update({
            where: {
              id: item.id,
            },
            data: {
              actualStock: expectedRemainingPieces,
              quantity: totalBoxesAfter,
            },
          });

          // await tx.medicineTransactionItem.create({
          //   data: {
          //     medicineTransactionId: transaction.id,
          //     prescribeQuantity: toDispense.prescribeQuantity,
          //     releasedQuantity: toDispense.quantity,
          //     precribeMedicineId: toDispense.medId,
          //   },
          // });
        } catch (innerError) {
          throw innerError; // Re-throw to fail the transaction
        }
      }

      await tx.prescription.update({
        data: {
          status: 2,
          progress: {
            create: {
              step: 1,
            },
          },
        },
        where: {
          id: prescription.id,
        },
      });

      await tx.medicineLogs.create({
        data: {
          userId: body.userId,
          action: 4,
          message: `Dispensed Medicine: Ref. #: ${prescription.refNumber}`,
          lineId: prescription.lineId,
        },
      });
      await tx.notification.create({
        data: {
          recipientId: prescription.userId,
          title: "New Notification",
          content: `The prescription #${prescription.refNumber} you prescribed has been dispensed to the patient.`,
          path: `prescribe-medicine/transaction/${prescription.id}`,
          senderId: body.userId,
        },
      });

      // if (body.userId !== prescription.userId) {

      // }
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

export const prescribeTransaction = async (
  req: FastifyRequest,
  res: FastifyReply
) => {
  const params = req.query as PagingProps;
  if (!params.id) throw new ValidationError("INVALID REQUIRED ID");
  try {
    const cursor = params.lastCursor ? { id: params.lastCursor } : undefined;
    const limit = params.limit ? parseInt(params.limit, 10) : 20;

    const filter: any = {};
    if (params.query) {
      const searchTerms = params.query.trim().split(/\s+/); // Split on any whitespace

      if (searchTerms.length === 1) {
        filter.OR = [
          { lastname: { contains: searchTerms[0], mode: "insensitive" } },
          { firstname: { contains: searchTerms[0], mode: "insensitive" } },
        ];
      } else {
        filter.AND = searchTerms.map((term) => ({
          OR: [
            { firstname: { contains: term, mode: "insensitive" } },
            { lastname: { contains: term, mode: "insensitive" } },
          ],
        }));
      }
    }
    const response = await prisma.prescription.findMany({
      where: {
        lineId: params.id,
        ...filter,
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
