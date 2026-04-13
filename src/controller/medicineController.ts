import { FastifyRequest, FastifyReply } from "../barrel/fastify";
import { prisma, Prisma } from "../barrel/prisma";
import { AppError, NotFoundError, ValidationError } from "../errors/errors";

//

import path from "path";
import ExcelJS from "exceljs";
import XLSX from "xlsx";
import { PagingProps } from "../models/route";

//
import { generateMedRef, generateStorageRef } from "../middleware/handler";
import { getQuarter } from "../utils/date";

export const medicineStorage = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const params = req.query as PagingProps;

  if (!params.id) throw new ValidationError("BAD_REQUEST");

  try {
    const cursor = params.lastCursor ? { id: params.lastCursor } : undefined;
    const limit = params.limit ? parseInt(params.limit.toString()) : 10;

    const response = await prisma.medicineStorage.findMany({
      where: {
        lineId: params.id,
      },
      skip: cursor ? 1 : 0,
      take: limit,
      cursor,
    });

    const newLastCursorId =
      response.length > 0 ? response[response.length - 1].id : null;
    const hasMore = response.length === limit;
    res.code(200).send({
      list: response,
      lastCursor: newLastCursorId,
      hasMore,
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DB_CONNECTION_EROR", 500, "DB_FAILED");
    }
    throw error;
  }
};

export const addMedicineStorage = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const body = req.body as {
    name: string;
    desc: string;
    lineId: string;
    departmentId: string;
    userId: string;
  };

  console.log(body);

  if (!body.name || !body.lineId || !body.departmentId) {
    throw new ValidationError("BAD_REQUEST");
  }
  try {
    const refNumber = await generateStorageRef();
    await prisma.$transaction(async (tx) => {
      const storage = await prisma.medicineStorage.create({
        data: {
          name: body.name,
          desc: body.desc,
          lineId: body.lineId,
          departmentId: body.departmentId,
          refNumber: refNumber,
          timestamp: new Date().toISOString(),
        },
      });
      await tx.medicineLogs.create({
        data: {
          action: 1,
          message: `Added new Storage location: ${storage.name}, Ref. number: ${storage.refNumber}`,
          userId: body.userId,
        },
      });
    });

    res.code(200).send({ message: "OK" });
  } catch (error) {
    console.log(error);

    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DB_CONNECTION_EROR", 500, "DB_FAILED");
    }
    throw error;
  }
};

export const medicineList = async (req: FastifyRequest, res: FastifyReply) => {
  const params = req.query as PagingProps;
  console.log("dasda", { params });

  if (!params.id) throw new ValidationError("BAD_REQUEST");

  try {
    const cursor = params.lastCursor ? { id: params.lastCursor } : undefined;
    const limit = params.limit ? parseInt(params.limit, 10) : 20;

    const filter: any = { lineId: params.id };

    if (params.query) {
      filter.name = {
        contains: params.query,
        mode: "insensitive",
      };
    }

    const response = await prisma.medicine.findMany({
      where: filter,
      skip: cursor ? 1 : 0,
      take: limit,
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
      throw new AppError("DB_CONNECTION_EROR", 500, "DB_FAILED");
    }
    throw error;
  }
};

export const addMedFromExcel = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  try {
    // Check if the request is multipart
    if (!req.isMultipart()) {
      throw new ValidationError("Request is not multipart");
    }

    const data = await req.file();

    if (!data) {
      throw new ValidationError("No file uploaded");
    }
    const workbook = new ExcelJS.Workbook();
    workbook.created = new Date();
    // Check if file is an Excel file
    const allowedMimeTypes = [
      "application/vnd.ms-excel",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/octet-stream",
    ];

    if (!allowedMimeTypes.includes(data.mimetype)) {
      throw new ValidationError("Only Excel files are allowed");
    }

    // Create uploads directory if it doesn't exist
    const uploadsDir = path.join(__dirname, "uploads");
    const workbooks = XLSX.readFile(uploadsDir);
    const sheets = workbooks.SheetNames;

    sheets.forEach(async (item, i) => {
      const workSheet = workbooks.Sheets[item];
      const data: { Medicines: string }[] = XLSX.utils.sheet_to_json(workSheet);

      data.forEach((item: { Medicines: string }) => {});

      // const existedThruName = await prisma.medicine.findMany({
      //   where:{
      //     name: data.map((item)=> item.Medicines)
      //   }
      // })
    });

    return res.status(200).send({
      success: true,
      message: "File uploaded successfully",
    });
  } catch (error) {
    if (error instanceof ValidationError) {
      return res.status(400).send({
        success: false,
        error: error.message,
      });
    }

    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DB_CONNECTION_ERROR", 500, "DB_FAILED");
    }

    console.error("Upload error:", error);
    return res.status(500).send({
      success: false,
      error: "Internal server error",
    });
  }
};

export const multiAddMed = async (req: FastifyRequest, res: FastifyReply) => {
  const body = req.body as { ids: string[]; storageId: string };

  if (body.ids.length === 0 || !body.storageId)
    throw new ValidationError("BAD_REQUEST");

  try {
    let processed = 0;
    const chunkSize = 50;
    const chunks = [];

    // Create chunks of 50 IDs each
    for (let i = 0; i < body.ids.length; i += chunkSize) {
      const chunk = body.ids.slice(i, i + chunkSize);
      chunks.push(chunk);
    }

    console.log(`Processing ${body.ids.length} IDs in ${chunks.length} chunks`);

    // Process each chunk
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      console.log(
        `Processing chunk ${i + 1}/${chunks.length} with ${chunk.length} IDs`,
      );

      // Process the chunk (replace with your actual logic)
    }

    return res.status(200).send({
      success: true,
      message: `Successfully processed ${body.ids.length} IDs in ${chunks.length} batches`,
      totalProcessed: body.ids.length,
      batches: chunks.length,
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DB_CONNECTION_ERROR", 500, "DB_FAILED");
    }
    throw error;
  }
};

// const processChunk = async (chunk: string[], storageId: string) => {

//   await prisma.medicineStock.create({
//     data: {
//       stock: {
//         create: {
//           quantity: 0,
//         },

//       },
//       medicineStorageId: storageId,
//       medicineId:
//     }
//   })
// };

export const addStorageMed = async (req: FastifyRequest, res: FastifyReply) => {
  const body = req.body as {
    name: string;
    desc: string;
    userId: string;
    lineId: string;
  };

  if (!body.lineId || !body.userId || !body.name) {
    throw new ValidationError("BAD_REQUEST");
  }

  try {
    await prisma.$transaction(async (tx) => {
      const med = await tx.medicine.findFirst({
        where: {
          name: {
            contains: body.name,
            mode: "insensitive",
          },
        },
      });

      if (med) throw new ValidationError("ALREADY_EXIST");
      const serialNumber = await generateMedRef();
      const medicine = await tx.medicine.create({
        data: {
          lineId: body.lineId,
          name: body.name,
          desc: body.desc,
          serialNumber,
        },
      });

      await tx.medicineLogs.create({
        data: {
          action: 1,
          message: `Added new medicine in the list; Med. Serial Ref.: ${medicine.serialNumber} - Label: ${medicine.name}`,
          userId: body.userId,
          lineId: body.lineId,
        },
      });
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DB_CONNECTION_EROR", 500, "DB_FAILED");
    }
    throw error;
  }
};

export const medicineLogList = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const params = req.query as PagingProps;

  if (!params.id) throw new ValidationError("BAD_REQUEST");

  try {
    const cursor = params.lastCursor ? { id: params.lastCursor } : undefined;
    const limit = params.limit ? parseInt(params.limit, 10) : 20;
    const response = await prisma.medicineLogs.findMany({
      where: {
        lineId: params.id,
      },
      skip: cursor ? 1 : 0,
      take: limit,
      cursor,
      orderBy: {
        timestamp: "desc",
      },
      include: {
        user: {
          select: {
            id: true,
            profilePicture: true,
            username: true,
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
      throw new AppError("DB_CONNECTION_EROR", 500, "DB_FAILED");
    }
    throw error;
  }
};

export const storageMeds = async (req: FastifyRequest, res: FastifyReply) => {
  const params = req.query as PagingProps;
  console.log(params);

  if (!params.id) throw new ValidationError("BAD_REQUEST");

  try {
    const cursor = params.lastCursor ? { id: params.lastCursor } : undefined;
    const limit = params.limit ? parseInt(params.limit, 10) : 10;
    const filter: any = { medicineStorageId: params.id };

    if (params.query) {
      const searchTerms = params.query.trim().split(/\s+/);

      if (searchTerms.length === 1) {
        filter.OR = [
          {
            name: {
              contains: searchTerms[0],
              mode: "insensitive",
            },
          },
          {
            serialNumber: {
              contains: searchTerms[0],
              mode: "insensitive",
            },
          },
        ];
      } else {
        filter.AND = searchTerms.map((term) => ({
          OR: [
            {
              name: {
                contains: term,
                mode: "insensitive",
              },
            },
            {
              serialNumber: {
                contains: term,
                mode: "insensitive",
              },
            },
          ],
        }));
      }
    }

    const response = await prisma.medicineStock.findMany({
      where: filter,
      take: limit,
      skip: cursor ? 1 : 0,
      cursor,
      include: {
        stock: {
          select: {
            unit: true,
            quantity: true,
            perUnit: true,
          },
        },
        price: {
          select: {
            value: true,
          },
        },
        medicine: {
          select: {
            name: true,
            serialNumber: true,
            id: true,
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
      throw new AppError("DB_CONNECTION_EROR", 500, "DB_FAILED");
    }
    throw error;
  }
};

export const addStorageMedInList = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const body = req.body as {
    medicineId: string;
    lineId: string;
    unitOfMeasure: string;
    thresHold: number;
    quantity: number;
    userId: string;
    storageId: string;
    price: number;
    expiration: string;
    perUnit: number;
    manufacturingDate: string;
  };
  console.log({ body });

  if (!body.storageId) throw new ValidationError("BAD_REQUEST");

  try {
    const response = await prisma.$transaction(async (tx) => {
      const medicine = await tx.medicine.findUnique({
        where: {
          id: body.medicineId,
        },
      });

      // FIXED: Add storageId to the where clause to find stock in the SPECIFIC storage
      const stock = await tx.medicineStock.findFirst({
        where: {
          medicineId: body.medicineId,
          medicineStorageId: body.storageId, // This is the key fix
          expiration: new Date(body.expiration),
          manufacturingDate: new Date(body.manufacturingDate),
          quality: body.unitOfMeasure,
          perQuantity: body.perUnit,
        },
        include: {
          price: {
            take: 1,
            orderBy: {
              timestamp: "desc",
            },
          },
        },
      });

      const storage = await tx.medicineStorage.findUnique({
        where: {
          id: body.storageId,
        },
      });

      if (!medicine) throw new NotFoundError("ITEM_NOT_FOUND");
      if (!storage) throw new NotFoundError("STORAGE_NOT_FOUND");

      const total = body.perUnit * body.quantity;

      // Debug logging
      console.log("Stock expiration:", stock?.expiration);
      console.log("Body expiration:", new Date(body.expiration));

      if (stock) {
        console.log(
          "Found existing stock in the same storage with matching criteria",
        );
        const stockExpirationISO = stock.expiration
          ?.toISOString()
          .split("T")[0];
        const bodyExpirationISO = new Date(body.expiration)
          .toISOString()
          .split("T")[0];
        const sameDate = stockExpirationISO === bodyExpirationISO;

        console.log("Quantity total: ", body.quantity);
        console.log("Stock unit of measure:", stock?.quality);
        console.log("Body unit of measure:", body.unitOfMeasure);
        console.log("Units equal?", body.unitOfMeasure === stock?.quality);
        console.log("Stock per quantity:", stock?.perQuantity);
        console.log("Body per unit:", body.perUnit);
        console.log("Per unit equal?", body.perUnit === stock?.perQuantity);
        console.log(
          "Same storage?",
          stock.medicineStorageId === body.storageId,
        );
      } else {
        console.log("No matching stock found in this storage, creating new");
      }

      if (
        stock &&
        stock.medicineStorageId === body.storageId // Check if it's the same storage
      ) {
        // FIXED: Already filtered by all criteria in the findFirst query
        // So we can be confident this is a matching stock
        const currStock = stock.actualStock;
        const currQuantity = stock.quantity;
        const newActualStock = currStock + total;

        await tx.medicineStock.update({
          where: {
            id: stock.id,
          },
          data: {
            actualStock: newActualStock,
            quantity: currQuantity + body.quantity,
            price: {
              create: {
                value: body.price,
              },
            },
          },
        });
      } else {
        await tx.medicineStock.create({
          data: {
            quantity: body.quantity,
            medicineId: medicine.id,
            threshold: body.thresHold,
            medicineStorageId: body.storageId,
            actualStock: total,
            lineId: body.lineId,
            quarter: getQuarter(),
            quality: body.unitOfMeasure,
            perQuantity: body.perUnit,
            price: {
              create: {
                value: body.price,
              },
            },
            expiration: new Date(body.expiration),
          },
        });
      }

      await tx.medicineLogs.create({
        data: {
          action: 1,
          message: `Added Item: ${medicine.name} - Serial Ref.: ${medicine.serialNumber}; Quantity: ${body.quantity}; Per Unit: ${body.perUnit}; UoM: ${body.unitOfMeasure} to storage: ${storage.refNumber}`,
          userId: body.userId,
          lineId: body.lineId,
        },
      });
      return "OK";
    });

    if (!response) throw new ValidationError("TRANSACTION FAILED");
    return res.code(200).send({ message: "OK" });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DB_CONNECTION_ERROR", 500, "DB_FAILED");
    }
    throw error;
  }
};
export const storageMedList = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const params = req.query as PagingProps;

  try {
    const cursor = params.lastCursor ? { id: params.lastCursor } : undefined;
    const limit = params.limit ? parseInt(params.limit) : 20;
    const filter: any = {};

    if (params.query) {
      filter.medicine = {
        name: {
          contains: params.query,
          mode: "insensitive",
        },
      };
    }
    if (params.lineId) {
      filter.lineId = params.lineId;
    }

    const response = await prisma.medicine.findMany({
      where: {
        MedicineStock: {
          some: {
            lineId: params.lineId as string,
          },
        },
        ...filter,
      },
      skip: cursor ? 1 : 0,
      take: limit,
      orderBy: {
        name: "asc",
      },
      include: {
        MedicineStock: {
          select: {
            id: true,
            actualStock: true,
            MedicineStorage: {
              select: {
                name: true,
                id: true,
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
      throw new AppError("DB_CONNECTION_ERROR", 500, "DB_FAILED");
    }
    throw error;
  }
};

export const newPrescriptionCount = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const params = req.query as { id: string };
  if (!params.id) throw new ValidationError("BAD_REQUEST");
  try {
    const response = await prisma.medicineNotification.count({
      where: {
        view: 0,
        lineId: params.id,
      },
    });

    return res.code(200).send({ message: "OK", count: response });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DB_CONNECTION_ERROR", 500, "DB_FAILED");
    }
    throw error;
  }
};

export const medicineNotification = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const params = req.query as PagingProps;

  if (!params.id) throw new ValidationError("BAD_REQUEST");

  try {
    const cursor = params.lastCursor ? { id: params.lastCursor } : undefined;
    const limit = params.limit ? parseInt(params.limit) : 20;

    const response = await prisma.medicineNotification.findMany({
      where: {
        lineId: params.id,
      },
      skip: cursor ? 1 : 0,
      take: limit,
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
      .send({ list: response, hasMore, lastCursor: newLastCursorId });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DB_CONNECTION_ERROR", 500, "DB_FAILED");
    }
    throw error;
  }
};

export const viewNotification = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const params = req.body as { id: string };

  try {
    await prisma.$transaction(async (tx) => {
      const notification = await tx.medicineNotification.findUnique({
        where: { id: params.id },
      });
      if (!notification) throw new NotFoundError("ITEM_NOT_FOUND");
      const prescriptionId = notification.path?.split("/")[1];
      console.log(prescriptionId);

      await tx.prescriptionProgress.create({
        data: {
          step: 1,
        },
      });
      await tx.medicineNotification.update({
        where: {
          id: notification.id,
        },
        data: {
          view: 1,
        },
      });
    });

    return res.code(200).send({ message: "OK" });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DB_CONNECTION_ERROR", 500, "DB_FAILED");
    }
    throw error;
  }
};

export const transferMedicine = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const body = req.body as {
    quantity: number;
    userId: string;
    departId: string;
    fromId: string;
    to: string;
    stockId: string;
  };
  console.log({ body });

  if (!body.departId || !body.quantity || !body.fromId || !body.userId) {
    throw new ValidationError("INVALID REQUIRED ID");
  }
  try {
    const response = await prisma.$transaction(async (tx) => {
      const stock = await tx.medicineStock.findUnique({
        where: {
          id: body.stockId,
        },
        include: {
          medicine: {
            select: {
              name: true,
              serialNumber: true,
            },
          },
        },
      });
      const to = await tx.medicineStorage.findUnique({
        where: {
          id: body.departId,
        },
      });

      const from = await tx.medicineStorage.findUnique({
        where: {
          id: body.fromId,
        },
      });

      if (!stock) throw new NotFoundError("STOCK NOT FOUND");
      if (!to) throw new NotFoundError("TARGET STORAGE NOT FOUND");
      if (!from) throw new NotFoundError("ORIGIN STORAGE NOT FOUND");

      const perQuantity = stock.perQuantity;
      const currStock = stock.quantity * stock.perQuantity;
      const toTransfer = body.quantity;
      const actualStockTransfered = perQuantity * toTransfer;

      if (currStock < actualStockTransfered)
        throw new ValidationError("INVALID QUANTITY");
      await tx.medicineStock.update({
        where: {
          id: stock.id,
        },
        data: {
          medicineStorageId: to.id,
          actualStock: actualStockTransfered,
          quality: stock.quality,
          quantity: toTransfer,
          perQuantity: perQuantity,
        },
      });

      await tx.medicineLogs.create({
        data: {
          action: 2,
          message: `Trasnfered ${stock.medicine?.name || "Unknown Medicine"} (${stock.medicine?.serialNumber || "Unknown Medicine"}) ${body.quantity} stock/s from ${from.name} to ${to.name}`,
          userId: body.userId,
        },
      });

      return "OK";
    });

    if (!response) {
      throw new ValidationError("TRANSACTION FAILED");
    }
    return res.code(200).send({ message: "OK" });
  } catch (error) {
    console.log(error);

    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DB_CONNECTION_ERROR", 500, "DB_FAILED");
    }
    throw error;
  }
};

export const updateStock = async (req: FastifyRequest, res: FastifyReply) => {
  const body = req.body as { userId: string };
  try {
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DB_CONNECTION_ERROR", 500, "DB_FAILED");
    }
    throw error;
  }
};

export const removeStock = async (req: FastifyRequest, res: FastifyReply) => {
  const body = req.query as { id: string; userId: string };
  if (!body.id || !body.userId) {
    throw new ValidationError("INVALID REQUIRED ID");
  }
  try {
    const response = await prisma.$transaction(async (tx) => {
      const stock = await tx.medicineStock.delete({
        where: {
          id: body.id,
        },
        include: {
          medicine: {
            select: {
              name: true,
              serialNumber: true,
            },
          },
          MedicineStorage: {
            select: {
              name: true,
              refNumber: true,
            },
          },
        },
      });

      await tx.medicineLogs.create({
        data: {
          action: 0,
          userId: body.userId,
          message: `REMOVE: medicine - ${stock.medicine?.name || "Unknown Medicine"} (${stock.medicine?.serialNumber || "Unknown Serial Number"}) from storage - ${stock.MedicineStorage?.name || "Unknown Storage"} (${stock.MedicineStorage?.refNumber || "Unknown Reference Number"})`,
        },
      });

      return "OK";
    });

    if (!response) throw new ValidationError("TRANSACTION FAILED");
    return res.code(200).send({ message: "OK" });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
    }
    throw error;
  }
};

export const updateMedicineStock = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const params = req.body as { id: string; quantity: number; userId: string };

  if (!params.id) {
    throw new ValidationError("INVALID REQUIRED ID");
  }
  try {
    const response = await prisma.$transaction(async (tx) => {
      const quantity = params.quantity;
      const stock = await tx.medicineStock.update({
        where: {
          id: params.id,
        },
        data: {},
        select: {
          medicine: {
            select: {
              name: true,
            },
          },
          id: true,
        },
      });

      await tx.medicineLogs.create({
        data: {
          userId: params.userId,
          message: `UPDAED: Added stock to medicine: ${stock.medicine?.name} | Quantity: ${quantity}`,
          action: 3,
        },
      });

      return "OK";
    });
    if (!response) {
      throw new ValidationError("TRANSACTION FAILED");
    }
    return res.code(200).send({ message: "OK" });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
    }
    throw error;
  }
};

export const medicineTransactions = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const params = req.query as PagingProps;

  if (!params.id) throw new ValidationError("INVALID REQUIRED ID");
  try {
    const cursor = params.lastCursor ? { id: params.lastCursor } : undefined;
    const limit = params.limit ? parseInt(params.limit, 10) : 20;

    const response = await prisma.medicineTransaction.findMany({
      where: {
        lineId: params.id,
      },
      include: {
        user: {
          select: {
            username: true,
            id: true,
            firstName: true,
            lastName: true,
          },
        },
        storage: {
          select: {
            name: true,
            id: true,
          },
        },
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
    const hasMore = response.length === limit;

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

export const removeMedicine = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const params = req.query as { id: string; userId: string };

  if (!params.id || !params.userId) {
    throw new ValidationError("INVALID REQUIRED ID");
  }

  try {
    const response = await prisma.$transaction(async (tx) => {
      const medicine = await tx.medicine.findUnique({
        where: {
          id: params.id,
        },
      });

      if (!medicine) throw new NotFoundError("Medicine not found!");

      await tx.medicine.delete({
        where: {
          id: params.id,
        },
      });

      await tx.medicineLogs.create({
        data: {
          action: 0,
          userId: params.userId,
          message: `REMOVED MEDICINE - ${medicine.name}`,
        },
      });

      return true;
    });

    if (!response) {
      throw new ValidationError("TRANSACTION FAILED");
    }
    return res.code(200).send({ message: "OK" });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
    }
    throw error;
  }
};

export const medicineOverview = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const params = req.query as { lineId: string };
  if (!params.lineId) {
    throw new ValidationError("INVALID REQUIRED ID");
  }
  try {
    const response = await prisma.$transaction(async (tx) => {
      // Total medicines count
      const medicines = await tx.medicineStock.count({
        where: {
          lineId: params.lineId,
        },
      });

      // Low stock: where actualStock is less than or equal to threshold
      const lowStock = await tx.medicineStock.count({
        where: {
          lineId: params.lineId,
          actualStock: {
            lte: tx.medicineStock.fields.threshold, // actualStock <= threshold
          },
        },
      });

      // Storage count
      const storage = await tx.medicineStorage.count({
        where: {
          lineId: params.lineId,
        },
      });

      // Near expiration: medicines expiring within 6 months from now
      const sixMonthsFromNow = new Date();
      sixMonthsFromNow.setMonth(sixMonthsFromNow.getMonth() + 6);

      const nearExpiration = await tx.medicineStock.count({
        where: {
          lineId: params.lineId,
          expiration: {
            not: null,
            lte: sixMonthsFromNow, // expiration date <= 6 months from now
            gte: new Date(), // optional: only future expirations (not already expired)
          },
        },
      });

      // Optional: Get the actual near-expiration medicine details

      return {
        medicines: {
          total: medicines,
          lowStock,
        },
        storage,
        nearExpiration,
      };
    });

    return res.send(response);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
    }
    throw error;
  }
};

export const storageData = async (req: FastifyRequest, res: FastifyReply) => {
  const params = req.query as { id: string };
  if (!params.id) throw new ValidationError("INVALID REQUIRED ID");

  try {
    const response = await prisma.medicineStorage.findUnique({
      where: {
        id: params.id,
      },
    });

    if (!response) {
      throw new NotFoundError("STORAGE NOT FOUND!");
    }
    return res.code(200).send(response);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
    }
    throw error;
  }
};

export const removeStorage = async (req: FastifyRequest, res: FastifyReply) => {
  const params = req.query as { id: string; userId: string; lineId: string };

  if (!params.id) {
    throw new ValidationError("INVALID REQUIRED ID");
  }

  try {
    const response = await prisma.$transaction(async (tx) => {
      const storage = await tx.medicineStorage.delete({
        where: {
          id: params.id,
        },
      });

      await tx.activityLogs.create({
        data: {
          action: 1,
          desc: `REMOVE MEDICINE STORAGE: ${storage.name}`,
          userId: params.userId,
          lineId: params.lineId,
        },
      });

      await tx.medicineLogs.create({
        data: {
          action: 3,
          lineId: params.lineId,
          message: `STORAGE: ${storage.name}-${storage.refNumber}, has been removed`,
          userId: params.userId,
        },
      });

      return "OK";
    });
    return res.code(200).send(response);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
    }
    throw error;
  }
};
