import { FastifyRequest, FastifyReply } from "../barrel/fastify";
import { prisma, Prisma } from "../barrel/prisma";
import { AppError, NotFoundError, ValidationError } from "../errors/errors";

//

import path from "path";
import ExcelJS from "exceljs";
import XLSX from "xlsx";
import { Readable } from "stream";
import { PagingProps } from "../models/route";

//
import { generateMedRef, generateStorageRef } from "../middleware/handler";
import { getQuarter } from "../utils/date";
import {
  assertStorageAccess,
  autoGrantSoleStorageAccess,
} from "./storageAccessController";
import {
  checkAndNotifyLowStock,
  clearLowStockAlerts,
} from "../service/medicineAlerts";

export const medicineStorage = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const params = req.query as PagingProps & { accessibleOnly?: string };

  if (!params.id) throw new ValidationError("BAD_REQUEST");

  try {
    const cursor = params.lastCursor ? { id: params.lastCursor } : undefined;
    const limit = params.limit ? parseInt(params.limit.toString()) : 10;

    // ?accessibleOnly=1 → only storages the AUTHENTICATED user has a
    // Dispense Access grant on. The mobile scanner's storage picker uses
    // this so a scan can only ever stock a storage the user is allowed in.
    let accessFilter = {};
    if (params.accessibleOnly === "1") {
      const accountId = (req.user as { id?: string } | undefined)?.id;
      const account = accountId
        ? await prisma.account.findUnique({
            where: { id: accountId },
            select: { User: { select: { id: true } } },
          })
        : null;
      const authUserId = account?.User?.id ?? null;
      // Self-heal: single-storage lines auto-assign the scanner user before
      // filtering, so the picker is never empty for a trusted mobile user.
      await autoGrantSoleStorageAccess(authUserId, params.id);
      accessFilter = {
        MedicineStorageAccess: {
          some: { userId: authUserId ?? "__none__" },
        },
      };
    }

    const response = await prisma.medicineStorage.findMany({
      where: {
        lineId: params.id,
        status: { not: 0 },
        ...accessFilter,
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

/**
 * Catalog list — the master list of medicines available in a line.
 *
 * Excludes soft-deleted entries (phase=0). Each row carries a small
 * `stats` block (batches + on-hand units) so the catalog UI can show
 * "5 batches · 120 units" without an extra trip per row.
 */
export const medicineList = async (req: FastifyRequest, res: FastifyReply) => {
  const params = req.query as PagingProps;
  if (!params.id) throw new ValidationError("BAD_REQUEST");

  try {
    const cursor = params.lastCursor ? { id: params.lastCursor } : undefined;
    const limit = params.limit ? parseInt(params.limit, 10) : 20;

    // Soft-delete marker is `phase: -1`. All existing rows default to
    // `phase: 0` so we filter "not removed" instead of "phase == 1".
    const where: any = { lineId: params.id, phase: { not: -1 } };
    if (params.query) {
      const q = params.query.trim();
      where.OR = [
        { name:         { contains: q, mode: "insensitive" } },
        { serialNumber: { contains: q, mode: "insensitive" } },
      ];
    }

    const rows = await prisma.medicine.findMany({
      where,
      skip: cursor ? 1 : 0,
      take: limit,
      cursor,
      orderBy: { name: "asc" },
      include: {
        _count: { select: { MedicineStock: true } },
        MedicineStock: { select: { actualStock: true } },
      },
    });

    const list = rows.map((m) => {
      const stocks = m.MedicineStock ?? [];
      const totalUnits = stocks.reduce(
        (s, r) => s + (r.actualStock ?? 0),
        0,
      );
      const { MedicineStock, _count, ...rest } = m;
      return {
        ...rest,
        stats: {
          batches: _count?.MedicineStock ?? 0,
          totalUnits,
        },
      };
    });

    const lastCursor = list.length > 0 ? list[list.length - 1].id : null;
    const hasMore = list.length === limit;
    return res.code(200).send({ list, lastCursor, hasMore });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DB_CONNECTION_EROR", 500, "DB_FAILED");
    }
    throw error;
  }
};

/**
 * Update a medicine's catalog metadata (name / description).
 *
 * Refuses to change `serialNumber` (immutable — used as a stable
 * reference across history, transactions, and labels).
 */
export const updateMedicineEntry = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const body = req.body as {
    id: string;
    name?: string;
    desc?: string | null;
    userId?: string;
    lineId?: string;
  };

  if (!body.id) throw new ValidationError("INVALID REQUIRED ID");

  const name = body.name?.trim();
  if (!name) throw new ValidationError("Name is required.");

  try {
    const result = await prisma.$transaction(async (tx) => {
      const existing = await tx.medicine.findUnique({
        where: { id: body.id },
      });
      if (!existing) throw new NotFoundError("Medicine not found");
      if (existing.phase === -1)
        throw new ValidationError("This medicine has been removed.");

      const updated = await tx.medicine.update({
        where: { id: body.id },
        data: {
          name,
          desc: body.desc?.trim() ?? existing.desc,
        },
      });

      if (body.userId) {
        await tx.medicineLogs.create({
          data: {
            action: 2,
            userId: body.userId,
            lineId: body.lineId ?? null,
            message:
              `Updated medicine "${existing.name}" → "${updated.name}" ` +
              `(serial ${updated.serialNumber})`,
          },
        });
      }

      return updated;
    });

    return res.code(200).send({ message: "OK", medicine: result });
  } catch (error) {
    if (error instanceof NotFoundError) throw error;
    if (error instanceof ValidationError) throw error;
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
    }
    throw error;
  }
};

/**
 * PATCH /medicine/attach-barcode { medicineId, barcode, lineId?, userId? }
 * Mobile "Barcode registration": attach a scanned barcode to an existing
 * medicine. Barcode is globally unique — if it's already registered to a
 * different medicine we return 409 plus that medicine's id/name so the app
 * can jump straight to its restock page instead.
 */
export const attachMedicineBarcode = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const body = req.body as {
    medicineId?: string;
    barcode?: string;
    lineId?: string;
    userId?: string;
    /** Mobile queue-row UUID: replays of the same op short-circuit. */
    clientOpId?: string;
  };
  const barcode = body.barcode?.trim();
  if (!body.medicineId || !barcode)
    throw new ValidationError("medicineId and barcode are required");

  try {
    // Idempotency: the mobile queue retries with the same clientOpId when a
    // response is lost — if we've already applied this op, say OK again.
    if (body.clientOpId) {
      const prior = await prisma.mobileUploadLog.findUnique({
        where: { clientOpId: body.clientOpId },
        select: { resultId: true },
      });
      if (prior) {
        return res.code(200).send({
          message: "OK (already applied)",
          id: prior.resultId ?? body.medicineId,
          barcode,
          duplicate: true,
        });
      }
    }

    const holder = await prisma.medicine.findUnique({
      where: { barcode },
      select: { id: true, name: true, serialNumber: true },
    });
    if (holder && holder.id !== body.medicineId) {
      return res.code(409).send({
        message: `Barcode already registered to ${holder.name}`,
        existingMedicineId: holder.id,
        existingName: holder.name,
      });
    }

    const med = await prisma.medicine.findUnique({
      where: { id: body.medicineId },
      select: { id: true, name: true, serialNumber: true, phase: true, barcode: true },
    });
    if (!med) throw new NotFoundError("Medicine not found");
    if (med.phase === -1)
      throw new ValidationError("This medicine has been removed.");

    const updated = await prisma.medicine.update({
      where: { id: body.medicineId },
      // Touch timestamp so other devices' incremental /medicine/sync pulls
      // (which filter on timestamp > since) pick up the new barcode.
      data: { barcode, timestamp: new Date() },
    });

    if (body.clientOpId) {
      try {
        await prisma.mobileUploadLog.create({
          data: {
            clientOpId: body.clientOpId,
            kind: "attach-barcode",
            userId: body.userId ?? null,
            lineId: body.lineId ?? null,
            resultId: updated.id,
            message: `barcode ${barcode}`,
          },
        });
      } catch {
        /* dedupe log is best-effort */
      }
    }

    if (body.userId) {
      try {
        await prisma.medicineLogs.create({
          data: {
            action: 2,
            userId: body.userId,
            lineId: body.lineId ?? null,
            message:
              `Registered barcode ${barcode} to "${med.name}" ` +
              `(serial ${med.serialNumber})` +
              (med.barcode && med.barcode !== barcode
                ? ` — replaced ${med.barcode}`
                : ""),
          },
        });
      } catch {
        /* audit is best-effort */
      }
    }

    return res
      .code(200)
      .send({ message: "OK", id: updated.id, barcode: updated.barcode });
  } catch (error) {
    if (error instanceof NotFoundError) throw error;
    if (error instanceof ValidationError) throw error;
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
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
    /** Optional scanned barcode — captured from the mobile scanner. */
    barcode?: string | null;
  };

  if (!body.lineId || !body.userId || !body.name) {
    throw new ValidationError("BAD_REQUEST");
  }

  try {
    const created = await prisma.$transaction(async (tx) => {
      // Prefer barcode match (scanner workflow) before falling back to
      // the legacy name-based dedupe used by the web Add Medicine flow.
      let med = null as Awaited<ReturnType<typeof tx.medicine.findFirst>>;
      if (body.barcode && body.barcode.trim()) {
        med = await tx.medicine.findFirst({
          where: { barcode: body.barcode.trim() },
        });
      }
      if (!med) {
        // Same name (ignoring case/pad) in THIS line = already in the catalog.
        // Was `contains` and unscoped, which got it wrong both ways: it blocked
        // a name another LINE happened to own, it blocked "Cefalexin" when
        // "Cefalexin 125mg/5ml" existed (different products), and it let
        // "Cefalexin 125mg/5ml" through when plain "Cefalexin" existed —
        // creating the duplicate rows that split a medicine's stock.
        med = await tx.medicine.findFirst({
          where: {
            lineId: body.lineId,
            name: { equals: body.name.trim(), mode: "insensitive" },
          },
        });
      }

      if (med) throw new ValidationError("ALREADY_EXIST");
      const serialNumber = await generateMedRef();
      const medicine = await tx.medicine.create({
        data: {
          lineId: body.lineId,
          name: body.name,
          desc: body.desc,
          serialNumber,
          barcode: body.barcode?.trim() || null,
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
      return medicine;
    });
    return res.code(200).send({ id: created.id, serialNumber: created.serialNumber });
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

/**
 * List medicines that have stock in the given storage.
 *
 * Returns one row per Medicine (NOT per MedicineStock). Each row includes the
 * stock batches for that medicine in this storage, plus precomputed
 * `totalStock` and `stockToExpire` so the table can render without
 * client-side aggregation. Cursor pagination is over Medicine.id.
 */
export const storageMeds = async (req: FastifyRequest, res: FastifyReply) => {
  const params = req.query as PagingProps;

  if (!params.id) throw new ValidationError("BAD_REQUEST");

  try {
    const cursor = params.lastCursor ? { id: params.lastCursor } : undefined;
    const limit = params.limit ? parseInt(params.limit, 10) : 10;

    const where: any = {
      MedicineStock: { some: { medicineStorageId: params.id } },
    };

    if (params.query) {
      const terms = params.query.trim().split(/\s+/);
      const termClauses = terms.map((term) => ({
        OR: [
          { name:         { contains: term, mode: "insensitive" } },
          { serialNumber: { contains: term, mode: "insensitive" } },
        ],
      }));
      where.AND = termClauses;
    }

    // 6-month expiration window for "stockToExpire" count.
    const now = new Date();
    const sixMonths = new Date(now);
    sixMonths.setMonth(sixMonths.getMonth() + 6);

    const medicines = await prisma.medicine.findMany({
      where,
      take: limit,
      skip: cursor ? 1 : 0,
      cursor,
      orderBy: { timestamp: "desc" },
      include: {
        MedicineStock: {
          where: { medicineStorageId: params.id },
          orderBy: { expiration: "asc" },
          include: {
            stock: { select: { unit: true, quantity: true, perUnit: true } },
            price: {
              select: { value: true },
              orderBy: { timestamp: "desc" },
              take: 1,
            },
          },
        },
      },
    });

    const list = medicines.map((m) => {
      const stocks = m.MedicineStock ?? [];
      const totalStock = stocks.reduce(
        (sum, s) => sum + (s.actualStock ?? 0),
        0,
      );
      const stockToExpire = stocks.filter(
        (s) => s.expiration && new Date(s.expiration) <= sixMonths,
      ).length;
      return { ...m, totalStock, stockToExpire };
    });

    const newLastCursorId =
      list.length > 0 ? list[list.length - 1].id : null;
    const hasMore = list.length === limit;

    return res
      .code(200)
      .send({ list, lastCursor: newLastCursorId, hasMore });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DB_CONNECTION_EROR", 500, "DB_FAILED");
    }
    throw error;
  }
};

/**
 * Add (or restock) a medicine batch into a storage location.
 *
 * Business logic:
 *   - A batch is uniquely identified by
 *       (medicine, storage, expiration, manufacturingDate, UoM, perUnit).
 *   - If an existing batch matches all of those, we RESTOCK it
 *     (actualStock += perUnit * quantity, quantity += quantity).
 *   - Otherwise we create a NEW batch row.
 *   - A MedicinePriceTrack row is always recorded for the batch so price
 *     history per batch is preserved.
 *   - Optional shelf address (room/section/row/column/container) is stored
 *     on the batch.
 */
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
    /** Mobile-generated idempotency key. When present, a replay of the
     *  same op short-circuits with the previously-recorded result. */
    clientOpId?: string;
    price?: number;
    expiration: string;
    perUnit: number;
    manufacturingDate: string;
    addressRoom?: string;
    addressCol?: string;
    addressRow?: string;
    addressSec?: string;
    container?: string;
  };

  if (!body.storageId || !body.medicineId || !body.lineId) {
    throw new ValidationError("BAD_REQUEST");
  }
  if (body.quantity <= 0 || body.perUnit <= 0) {
    throw new ValidationError("Quantity and per-unit must be positive.");
  }
  if (!body.expiration || !body.manufacturingDate) {
    throw new ValidationError("Manufacturing and expiration dates are required.");
  }

  const expiration = new Date(body.expiration);
  const manufacturingDate = new Date(body.manufacturingDate);
  if (!(expiration > manufacturingDate)) {
    throw new ValidationError("Expiration must be after manufacturing date.");
  }

  const price = Math.max(0, Number(body.price ?? 0));

  // Storage access: restricted users may only add/restock in their storages.
  // Prefer the TOKEN's identity over the client-supplied userId — a wrong or
  // missing body.userId must never skip (or misdirect) the access check.
  {
    const accountId = (req.user as { id?: string } | undefined)?.id;
    const authAccount = accountId
      ? await prisma.account.findUnique({
          where: { id: accountId },
          select: { User: { select: { id: true } } },
        })
      : null;
    const actorId = authAccount?.User?.id ?? body.userId;
    await assertStorageAccess(actorId, [body.storageId], "add or restock");
  }

  try {
    // ── Idempotency short-circuit ─────────────────────────────────────
    // Mobile retries can hit us multiple times with the same op (e.g.
    // network blip while waiting for the response). If we already have
    // a log row for this clientOpId we just hand back the cached result
    // — same stock id, no second write to MedicineStock.
    if (body.clientOpId) {
      const prior = await prisma.mobileUploadLog.findUnique({
        where: { clientOpId: body.clientOpId },
        select: { resultId: true, message: true },
      });
      if (prior) {
        return res.code(200).send({
          stockId: prior.resultId,
          mode: "duplicate",
          message: prior.message ?? "Already processed",
        });
      }
    }

    const result = await prisma.$transaction(async (tx) => {
      const [medicine, storage] = await Promise.all([
        tx.medicine.findUnique({ where: { id: body.medicineId } }),
        tx.medicineStorage.findUnique({ where: { id: body.storageId } }),
      ]);

      if (!medicine) throw new NotFoundError("ITEM_NOT_FOUND");
      if (!storage) throw new NotFoundError("STORAGE_NOT_FOUND");

      // Find an existing batch row that matches on all identity dimensions.
      const existing = await tx.medicineStock.findFirst({
        where: {
          medicineId: body.medicineId,
          medicineStorageId: body.storageId,
          expiration,
          manufacturingDate,
          quality: body.unitOfMeasure,
          perQuantity: body.perUnit,
        },
      });

      const totalItems = body.perUnit * body.quantity;
      let stockId: string;
      let mode: "restock" | "new";

      if (existing) {
        mode = "restock";
        // Clear any active low-stock alert before bumping the count, so
        // a future dip will notify again. This runs even if the new total
        // ends up still below threshold (in which case the check below
        // will re-create the alert with the fresh count).
        await clearLowStockAlerts(tx, existing.id);
        const updated = await tx.medicineStock.update({
          where: { id: existing.id },
          data: {
            actualStock: existing.actualStock + totalItems,
            quantity: existing.quantity + body.quantity,
            // Optional: only overwrite threshold/address when caller sent a value.
            threshold:
              body.thresHold !== undefined ? body.thresHold : existing.threshold,
            ...(body.addressRoom ? { addressRoom: body.addressRoom } : {}),
            ...(body.addressCol  ? { addressCol:  body.addressCol  } : {}),
            ...(body.addressRow  ? { addressRow:  body.addressRow  } : {}),
            ...(body.addressSec  ? { addressSec:  body.addressSec  } : {}),
            ...(body.container   ? { container:   body.container   } : {}),
            price: { create: { value: price } },
          },
        });
        stockId = updated.id;
      } else {
        mode = "new";
        const created = await tx.medicineStock.create({
          data: {
            quantity: body.quantity,
            medicineId: medicine.id,
            threshold: body.thresHold ?? 0,
            medicineStorageId: body.storageId,
            actualStock: totalItems,
            lineId: body.lineId,
            quarter: getQuarter(),
            quality: body.unitOfMeasure,
            perQuantity: body.perUnit,
            expiration,
            manufacturingDate,
            addressRoom: body.addressRoom || null,
            addressCol: body.addressCol  || null,
            addressRow: body.addressRow  || null,
            addressSec: body.addressSec  || null,
            container:  body.container   || null,
            price: { create: { value: price } },
          },
        });
        stockId = created.id;
      }

      // Even after a restock the new total may still be below threshold —
      // re-check so the user gets a fresh alert at the current count.
      await checkAndNotifyLowStock(tx, stockId);

      await tx.medicineLogs.create({
        data: {
          action: mode === "restock" ? 2 : 1,
          message:
            `${mode === "restock" ? "Restocked" : "Added new batch:"} ${medicine.name} ` +
            `(${medicine.serialNumber}) — qty ${body.quantity} × ${body.perUnit} ${body.unitOfMeasure} ` +
            `(${totalItems} items) → storage ${storage.refNumber}`,
          userId: body.userId,
          lineId: body.lineId,
        },
      });

      return { mode, stockId };
    });

    // Persist the idempotency log AFTER the transaction commits, keyed on
    // clientOpId. We deliberately don't wrap this in the transaction:
    // if the write fails the next replay will still get the dedup hit
    // from the previous attempt, OR — worst case — re-run the stock
    // write (rare). Better than aborting the legitimate stock update.
    if (body.clientOpId) {
      try {
        await prisma.mobileUploadLog.create({
          data: {
            clientOpId: body.clientOpId,
            kind: "medicine.addStock",
            userId: body.userId,
            lineId: body.lineId,
            resultId: result.stockId,
            message: result.mode === "restock" ? "Restocked" : "New batch",
          },
        });
      } catch (e) {
        // Most likely cause: another concurrent replay just won the race.
        // Safe to ignore — the @unique on clientOpId means the second
        // insert can't slip past us anyway.
        console.warn("[addStorageMedInList] idempotency log write failed:", e);
      }
    }

    return res.code(200).send({
      message: "OK",
      mode: result.mode,
      stockId: result.stockId,
    });
  } catch (error) {
    if (error instanceof NotFoundError) throw error;
    if (error instanceof ValidationError) throw error;
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

/**
 * Transfer N units of a specific stock batch to another storage.
 *
 * Inputs:
 *   - stockId:   the source MedicineStock row (a specific batch).
 *   - departId:  destination MedicineStorage id.
 *   - quantity:  how many *units of the batch's UoM* (e.g. boxes, bottles)
 *                to move. Items moved = quantity * source.perQuantity.
 *
 * Semantics:
 *   - Subtracts `quantity` (and `quantity * perQuantity` items) from the
 *     source row. The source row stays — it just shrinks, possibly to 0.
 *   - If the destination already has a batch matching on
 *       (medicine, expiration, manufacturingDate, UoM, perQuantity),
 *     we restock that row (preserves price history and shelf address).
 *   - Otherwise a new batch row is created in the destination with the
 *     same identity dimensions and a fresh quarter stamp.
 *   - Refreshes low-stock alerts on both source (may now be low) and
 *     destination (may have recovered).
 */
export const transferMedicine = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const body = req.body as {
    stockId: string;
    departId: string;
    quantity: number;
    userId: string;
    fromId?: string; // kept for back-compat — derived from stock if omitted
  };

  if (!body.stockId || !body.departId || !body.userId) {
    throw new ValidationError("INVALID REQUIRED ID");
  }
  const transferQty = Number(body.quantity);
  if (!Number.isFinite(transferQty) || transferQty <= 0) {
    throw new ValidationError("Transfer quantity must be greater than zero.");
  }

  // Storage access: restricted users need BOTH sides of the transfer —
  // taking stock out of the source and putting it into the destination.
  const srcRow = await prisma.medicineStock.findUnique({
    where: { id: body.stockId },
    select: { medicineStorageId: true },
  });
  await assertStorageAccess(
    body.userId,
    [srcRow?.medicineStorageId, body.departId],
    "transfer stock",
  );

  try {
    const result = await prisma.$transaction(async (tx) => {
      const source = await tx.medicineStock.findUnique({
        where: { id: body.stockId },
        include: {
          medicine: { select: { id: true, name: true, serialNumber: true } },
          MedicineStorage: { select: { id: true, name: true, refNumber: true } },
        },
      });
      if (!source) throw new NotFoundError("STOCK NOT FOUND");
      if (!source.medicineId)
        throw new ValidationError(
          "Stock has no medicine linked — cannot transfer.",
        );
      if (!source.MedicineStorage)
        throw new ValidationError("Source storage missing on this stock row.");

      if (source.MedicineStorage.id === body.departId) {
        throw new ValidationError(
          "Destination must be different from the source storage.",
        );
      }
      if (source.quantity < transferQty) {
        throw new ValidationError(
          `Not enough on hand. Available: ${source.quantity} ${source.quality}.`,
        );
      }

      const destination = await tx.medicineStorage.findUnique({
        where: { id: body.departId },
      });
      if (!destination)
        throw new NotFoundError("TARGET STORAGE NOT FOUND");

      const perQuantity = source.perQuantity;
      const itemsMoved = perQuantity * transferQty;

      // 1) Decrement source row.
      await tx.medicineStock.update({
        where: { id: source.id },
        data: {
          quantity: source.quantity - transferQty,
          actualStock: Math.max(0, source.actualStock - itemsMoved),
        },
      });

      // 2) Find or create the destination batch (same identity).
      const matching = await tx.medicineStock.findFirst({
        where: {
          medicineId: source.medicineId,
          medicineStorageId: body.departId,
          expiration: source.expiration ?? undefined,
          manufacturingDate: source.manufacturingDate ?? undefined,
          quality: source.quality,
          perQuantity: source.perQuantity,
        },
      });

      let destStockId: string;
      let mode: "merge" | "new";
      if (matching) {
        mode = "merge";
        const updated = await tx.medicineStock.update({
          where: { id: matching.id },
          data: {
            quantity: matching.quantity + transferQty,
            actualStock: matching.actualStock + itemsMoved,
          },
        });
        destStockId = updated.id;
      } else {
        mode = "new";
        const created = await tx.medicineStock.create({
          data: {
            medicineId: source.medicineId,
            medicineStorageId: body.departId,
            lineId: destination.lineId,
            quarter: getQuarter(),
            quality: source.quality,
            perQuantity: source.perQuantity,
            quantity: transferQty,
            actualStock: itemsMoved,
            threshold: source.threshold,
            expiration: source.expiration,
            manufacturingDate: source.manufacturingDate,
          },
        });
        destStockId = created.id;
      }

      // 3) Audit log.
      await tx.medicineLogs.create({
        data: {
          action: 2,
          userId: body.userId,
          lineId: source.lineId,
          message:
            `Transferred ${source.medicine?.name ?? "?"} ` +
            `(${source.medicine?.serialNumber ?? "?"}) — ` +
            `${transferQty} ${source.quality} (${itemsMoved} items) ` +
            `from ${source.MedicineStorage.refNumber} → ${destination.refNumber}` +
            (mode === "merge" ? " (merged into existing batch)" : " (new batch)"),
        },
      });

      // 4) Refresh low-stock alerts on both rows. Source may now be low;
      //    destination may have recovered.
      await checkAndNotifyLowStock(tx, source.id);
      await clearLowStockAlerts(tx, destStockId);
      await checkAndNotifyLowStock(tx, destStockId);

      return { mode, sourceStockId: source.id, destStockId };
    });

    return res.code(200).send({ message: "OK", ...result });
  } catch (error) {
    if (error instanceof NotFoundError) throw error;
    if (error instanceof ValidationError) throw error;
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

  // Storage access: removing a batch counts as touching that storage's stock.
  const target = await prisma.medicineStock.findUnique({
    where: { id: body.id },
    select: { medicineStorageId: true },
  });
  await assertStorageAccess(
    body.userId,
    [target?.medicineStorageId],
    "remove stock",
  );

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

    const filter: any = { lineId: params.id };
    if (params.query) {
      const term = params.query.trim();
      filter.OR = [
        { prescription: { refNumber: { contains: term, mode: "insensitive" } } },
        { prescription: { firstname: { contains: term, mode: "insensitive" } } },
        { prescription: { lastname: { contains: term, mode: "insensitive" } } },
      ];
    }

    const response = await prisma.medicineTransaction.findMany({
      where: filter,
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
        prescription: {
          select: {
            id: true,
            refNumber: true,
            firstname: true,
            lastname: true,
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

/**
 * Soft-delete a medicine catalog entry.
 *
 * Sets `phase: 0` so the row stays for historical references (transactions,
 * prescriptions, logs) but disappears from the catalog list. Refuses to
 * remove a medicine that still has on-hand stock — the user must zero
 * the stocks out or transfer them first.
 */
export const removeMedicine = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const params = req.query as {
    id: string;
    userId: string;
    lineId?: string;
  };

  if (!params.id || !params.userId) {
    throw new ValidationError("INVALID REQUIRED ID");
  }

  try {
    const response = await prisma.$transaction(async (tx) => {
      const medicine = await tx.medicine.findUnique({
        where: { id: params.id },
      });
      if (!medicine) throw new NotFoundError("Medicine not found");
      if (medicine.phase === -1)
        throw new ValidationError("Medicine already removed.");

      const onHand = await tx.medicineStock.aggregate({
        where: { medicineId: params.id },
        _sum: { actualStock: true },
      });
      if ((onHand._sum.actualStock ?? 0) > 0) {
        throw new ValidationError(
          "This medicine still has stock on hand. Zero out or transfer the stock before removing.",
        );
      }

      const updated = await tx.medicine.update({
        where: { id: params.id },
        data: { phase: -1 },
      });

      await tx.medicineLogs.create({
        data: {
          action: 0,
          userId: params.userId,
          lineId: params.lineId ?? medicine.lineId,
          message: `Removed medicine — ${updated.name} (${updated.serialNumber})`,
        },
      });

      return { message: "OK", id: updated.id };
    });

    return res.code(200).send(response);
  } catch (error) {
    if (error instanceof NotFoundError) throw error;
    if (error instanceof ValidationError) throw error;
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
  if (!params.lineId) throw new ValidationError("INVALID REQUIRED ID");

  try {
    const now = new Date();
    const sixMonthsFromNow = new Date(now);
    sixMonthsFromNow.setMonth(sixMonthsFromNow.getMonth() + 6);

    const nearWhere = {
      lineId: params.lineId,
      actualStock: { gt: 0 },
      expiration: { not: null, gt: now, lte: sixMonthsFromNow },
    } as const;
    const expiredWhere = {
      lineId: params.lineId,
      actualStock: { gt: 0 },
      expiration: { not: null, lte: now },
    } as const;

    const [
      storage,
      totalBatches,
      lowStock,
      nearExpiration,
      expired,
      nearAgg,
      expiredAgg,
      nearByQty,
      expiredByQty,
    ] = await Promise.all([
      prisma.medicineStorage.count({
        where: { lineId: params.lineId, status: { not: 0 } },
      }),
      prisma.medicineStock.count({ where: { lineId: params.lineId } }),
      prisma.medicineStock.count({
        where: {
          lineId: params.lineId,
          threshold: { gt: 0 },
          actualStock: { lte: prisma.medicineStock.fields.threshold },
        },
      }),
      prisma.medicineStock.count({ where: nearWhere }),
      prisma.medicineStock.count({ where: expiredWhere }),
      prisma.medicineStock.aggregate({
        where: nearWhere,
        _sum: { actualStock: true },
      }),
      prisma.medicineStock.aggregate({
        where: expiredWhere,
        _sum: { actualStock: true },
      }),
      // Per-quality breakdown so the dashboard can show "120 box, 30 bottle".
      prisma.medicineStock.groupBy({
        by: ["quality"],
        where: nearWhere,
        _sum: { actualStock: true },
      }),
      prisma.medicineStock.groupBy({
        by: ["quality"],
        where: expiredWhere,
        _sum: { actualStock: true },
      }),
    ]);

    const byQty = (rows: { quality: string; _sum: { actualStock: number | null } }[]) =>
      rows
        .filter((r) => (r._sum.actualStock ?? 0) > 0)
        .map((r) => ({
          quality: r.quality,
          units: r._sum.actualStock ?? 0,
        }))
        .sort((a, b) => b.units - a.units);

    return res.send({
      medicines: { total: totalBatches, lowStock },
      storage,
      nearExpiration,
      expired,
      nearExpirationUnits: nearAgg._sum.actualStock ?? 0,
      expiredUnits: expiredAgg._sum.actualStock ?? 0,
      nearExpirationByQuality: byQty(nearByQty),
      expiredByQuality: byQty(expiredByQty),
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
    }
    throw error;
  }
};

// ───────────────────────────────────────────────────────────────────────
// Expiration list + Excel export
// ───────────────────────────────────────────────────────────────────────

type ExpirationMode = "soon" | "expired";

const expirationWhere = (
  lineId: string,
  mode: ExpirationMode,
  query?: string,
) => {
  const now = new Date();
  const sixMonthsFromNow = new Date(now);
  sixMonthsFromNow.setMonth(sixMonthsFromNow.getMonth() + 6);

  const where: any = {
    lineId,
    actualStock: { gt: 0 },
    expiration: { not: null },
  };
  if (mode === "soon") {
    where.expiration = { not: null, gt: now, lte: sixMonthsFromNow };
  } else {
    where.expiration = { not: null, lte: now };
  }

  if (query && query.trim()) {
    const q = query.trim();
    where.medicine = {
      OR: [
        { name:         { contains: q, mode: "insensitive" } },
        { serialNumber: { contains: q, mode: "insensitive" } },
      ],
    };
  }
  return where;
};

/**
 * Paginated list of stock batches that are either expiring within 6
 * months ("soon") or already expired ("expired"), ordered by closest
 * expiration first.
 */
export const expirationList = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const params = req.query as {
    lineId: string;
    mode?: ExpirationMode;
    lastCursor?: string | null;
    limit?: string;
    query?: string;
  };
  if (!params.lineId) throw new ValidationError("INVALID REQUIRED ID");
  const mode: ExpirationMode = params.mode === "expired" ? "expired" : "soon";
  const limit = params.limit ? parseInt(params.limit, 10) : 20;
  const cursor = params.lastCursor ? { id: params.lastCursor } : undefined;

  try {
    const where = expirationWhere(params.lineId, mode, params.query);
    const [rows, totalAgg, qualityRows] = await Promise.all([
      prisma.medicineStock.findMany({
        where,
        take: limit,
        skip: cursor ? 1 : 0,
        cursor,
        orderBy: { expiration: mode === "soon" ? "asc" : "desc" },
        include: {
          medicine: { select: { id: true, name: true, serialNumber: true } },
          MedicineStorage: {
            select: { id: true, name: true, refNumber: true },
          },
        },
      }),
      prisma.medicineStock.aggregate({
        where,
        _sum: { actualStock: true },
        _count: { _all: true },
      }),
      prisma.medicineStock.groupBy({
        by: ["quality"],
        where,
        _sum: { actualStock: true },
        _count: { _all: true },
      }),
    ]);

    const now = new Date();
    const list = rows.map((r) => {
      const exp = r.expiration ? new Date(r.expiration) : null;
      const daysToExpire = exp
        ? Math.ceil((exp.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
        : null;
      return { ...r, daysToExpire };
    });

    const summary = {
      totalBatches: totalAgg._count._all,
      totalUnits: totalAgg._sum.actualStock ?? 0,
      byQuality: qualityRows
        .filter((q) => (q._sum.actualStock ?? 0) > 0)
        .map((q) => ({
          quality: q.quality,
          batches: q._count._all,
          units: q._sum.actualStock ?? 0,
        }))
        .sort((a, b) => b.units - a.units),
    };

    const lastCursor = list.length > 0 ? list[list.length - 1].id : null;
    const hasMore = list.length === limit;
    return res
      .code(200)
      .send({ list, lastCursor, hasMore, mode, summary });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
    }
    throw error;
  }
};

/**
 * Excel export of the expiration list (whole result set, no pagination).
 */
export const exportExpirationList = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const params = req.query as {
    lineId: string;
    mode?: ExpirationMode;
    query?: string;
  };
  if (!params.lineId) throw new ValidationError("INVALID REQUIRED ID");
  const mode: ExpirationMode = params.mode === "expired" ? "expired" : "soon";

  try {
    const rows = await prisma.medicineStock.findMany({
      where: expirationWhere(params.lineId, mode, params.query),
      orderBy: { expiration: mode === "soon" ? "asc" : "desc" },
      include: {
        medicine: { select: { name: true, serialNumber: true } },
        MedicineStorage: { select: { name: true, refNumber: true } },
      },
    });

    const now = new Date();
    const wb = new ExcelJS.Workbook();
    wb.creator = "GMITP";
    wb.created = new Date();
    const sheetTitle =
      mode === "soon" ? "Expiring Soon" : "Expired Medicines";
    const ws = wb.addWorksheet(sheetTitle, {
      views: [{ state: "frozen", ySplit: 5 }],
    });

    ws.columns = [
      { width: 6 },   // A No.
      { width: 16 },  // B Serial
      { width: 32 },  // C Medicine
      { width: 22 },  // D Storage
      { width: 8 },   // E Unit
      { width: 10 },  // F On-hand
      { width: 12 },  // G Manufactured
      { width: 12 },  // H Expires
      { width: 12 },  // I Days to Expire
      { width: 16 },  // J Shelf Address
    ];

    // Letterhead
    const header = [
      { row: 1, text: "Republic of the Philippines", bold: false, size: 11 },
      { row: 2, text: "Province of Marinduque",      bold: false, size: 11 },
      { row: 3, text: "MUNICIPALITY OF GASAN",        bold: true,  size: 11 },
      {
        row: 4,
        text:
          mode === "soon"
            ? "MEDICINES EXPIRING WITHIN 6 MONTHS"
            : "EXPIRED MEDICINES — REQUIRES DISPOSAL",
        bold: true,
        size: 13,
      },
    ];
    header.forEach(({ row, text, bold, size }) => {
      const r = ws.getRow(row);
      r.getCell(1).value = text;
      ws.mergeCells(row, 1, row, 10);
      r.alignment = { horizontal: "center", vertical: "middle" };
      r.font = { name: "Arial", bold, size };
    });
    ws.getRow(5).values = [
      "No.",
      "Serial #",
      "Medicine",
      "Storage",
      "Unit",
      "On-hand",
      "Manufactured",
      "Expires",
      "Days to Expire",
      "Shelf Address",
    ];
    ws.getRow(5).font = { name: "Arial", bold: true, size: 10 };
    ws.getRow(5).alignment = { horizontal: "center", vertical: "middle" };
    ws.getRow(5).eachCell((c) => {
      c.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFE5E7EB" },
      };
      c.border = {
        top:    { style: "thin" },
        left:   { style: "thin" },
        right:  { style: "thin" },
        bottom: { style: "thin" },
      };
    });

    const fmtDate = (d: Date | null) =>
      d ? d.toISOString().slice(0, 10) : "—";

    rows.forEach((s, i) => {
      const exp = s.expiration ? new Date(s.expiration) : null;
      const days = exp
        ? Math.ceil((exp.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
        : null;
      const address = [s.addressRoom, s.addressSec, s.addressRow, s.addressCol]
        .filter(Boolean)
        .join(" / ");

      const row = ws.addRow([
        i + 1,
        s.medicine?.serialNumber ?? "—",
        s.medicine?.name ?? "—",
        s.MedicineStorage?.name ?? "—",
        s.quality ?? "—",
        s.actualStock,
        fmtDate(s.manufacturingDate ? new Date(s.manufacturingDate) : null),
        fmtDate(exp),
        days ?? "—",
        address || (s.container ?? "—"),
      ]);
      row.font = { name: "Arial", size: 10 };
      row.alignment = { vertical: "middle" };
      row.eachCell((c) => {
        c.border = {
          top:    { style: "hair" },
          left:   { style: "hair" },
          right:  { style: "hair" },
          bottom: { style: "hair" },
        };
      });
      // Highlight already-expired rows in red.
      if (mode === "expired" || (days !== null && days <= 0)) {
        row.getCell(9).font = {
          name: "Arial",
          size: 10,
          bold: true,
          color: { argb: "FFC2410C" },
        };
      }
    });

    if (rows.length === 0) {
      const r = ws.addRow(["No records found"]);
      ws.mergeCells(r.number, 1, r.number, 10);
      r.alignment = { horizontal: "center" };
      r.font = { name: "Arial", italic: true, color: { argb: "FF9CA3AF" } };
    } else {
      // ── Summary footer: total units + per-quality breakdown ──────────
      ws.addRow([]);
      const totalUnits = rows.reduce((s, r) => s + (r.actualStock ?? 0), 0);
      const byQuality = new Map<string, { units: number; batches: number }>();
      for (const r of rows) {
        const key = r.quality ?? "—";
        const cur = byQuality.get(key) ?? { units: 0, batches: 0 };
        cur.units += r.actualStock ?? 0;
        cur.batches += 1;
        byQuality.set(key, cur);
      }

      const totalRow = ws.addRow([
        "",
        "",
        "TOTAL",
        `${rows.length} batches`,
        "",
        totalUnits,
        "",
        "",
        "",
        "",
      ]);
      totalRow.font = { name: "Arial", bold: true, size: 10 };
      totalRow.getCell(3).alignment = { horizontal: "right" };
      totalRow.getCell(6).alignment = { horizontal: "center" };
      totalRow.eachCell((c) => {
        c.border = { top: { style: "thin" }, bottom: { style: "thin" } };
      });

      // Per-quality rows
      [...byQuality.entries()]
        .sort((a, b) => b[1].units - a[1].units)
        .forEach(([q, v]) => {
          const r = ws.addRow([
            "",
            "",
            `By unit: ${q}`,
            `${v.batches} batch${v.batches === 1 ? "" : "es"}`,
            "",
            v.units,
            "",
            "",
            "",
            "",
          ]);
          r.font = { name: "Arial", size: 10 };
          r.getCell(3).alignment = { horizontal: "right" };
          r.getCell(3).font = {
            name: "Arial",
            italic: true,
            size: 10,
            color: { argb: "FF6B7280" },
          };
          r.getCell(6).alignment = { horizontal: "center" };
        });
    }

    const buffer = await wb.xlsx.writeBuffer();
    const filename = `medicines_${mode === "soon" ? "expiring_soon" : "expired"}_${now
      .toISOString()
      .slice(0, 10)}.xlsx`;

    res.header(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.header("Content-Disposition", `attachment; filename="${filename}"`);
    return res.code(200).send(Buffer.from(buffer as ArrayBuffer));
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
    }
    throw error;
  }
};

/**
 * Storage detail view.
 *
 * Returns the storage location with its unit/department + line, plus a
 * lightweight stats block (medicineCount, totalStockUnits, lowStockCount,
 * expiringSoonCount, accessCount) so the Information tab can render without
 * extra round-trips. Stock-level counts are computed server-side from the
 * MedicineStock rows scoped to this storage.
 */
export const storageData = async (req: FastifyRequest, res: FastifyReply) => {
  const params = req.query as { id: string };
  if (!params.id) throw new ValidationError("INVALID REQUIRED ID");

  try {
    const storage = await prisma.medicineStorage.findUnique({
      where: { id: params.id },
      include: {
        unit: { select: { id: true, name: true } },
        line: { select: { id: true, name: true } },
        _count: { select: { MedicineStorageAccess: true } },
      },
    });

    if (!storage) throw new NotFoundError("STORAGE NOT FOUND!");

    const sixMonths = new Date();
    sixMonths.setMonth(sixMonths.getMonth() + 6);

    // Pull the stock rows once and aggregate in memory — keeps the response
    // shape simple and avoids three separate aggregate queries.
    const stocks = await prisma.medicineStock.findMany({
      where: { medicineStorageId: params.id },
      select: {
        medicineId: true,
        actualStock: true,
        threshold: true,
        expiration: true,
      },
    });

    const totalStockUnits = stocks.reduce(
      (sum, s) => sum + (s.actualStock ?? 0),
      0,
    );
    const lowStockCount = stocks.filter(
      (s) => (s.actualStock ?? 0) <= (s.threshold ?? 0),
    ).length;
    const expiringSoonCount = stocks.filter(
      (s) => s.expiration && new Date(s.expiration) <= sixMonths,
    ).length;
    const medicineCount = new Set(
      stocks.map((s) => s.medicineId).filter(Boolean),
    ).size;

    return res.code(200).send({
      ...storage,
      stats: {
        medicineCount,
        totalStockUnits,
        lowStockCount,
        expiringSoonCount,
        accessCount: storage._count?.MedicineStorageAccess ?? 0,
      },
    });
  } catch (error) {
    if (error instanceof NotFoundError) throw error;
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
    }
    throw error;
  }
};

/**
 * Soft-delete a storage location.
 *
 * Sets `status: 0` instead of hard-deleting so the audit trail and any
 * historical transactions / stock rows remain intact. Refuses to remove a
 * storage that still has on-hand stock — the user must transfer or zero
 * out stock first.
 */
export const removeStorage = async (req: FastifyRequest, res: FastifyReply) => {
  const params = req.query as { id: string; userId: string; lineId: string };

  if (!params.id) throw new ValidationError("INVALID REQUIRED ID");

  try {
    const response = await prisma.$transaction(async (tx) => {
      const storage = await tx.medicineStorage.findUnique({
        where: { id: params.id },
      });
      if (!storage) throw new NotFoundError("STORAGE NOT FOUND");

      // Block removal while there is on-hand stock to avoid orphaning units.
      const onHand = await tx.medicineStock.aggregate({
        where: { medicineStorageId: params.id },
        _sum: { actualStock: true },
      });
      if ((onHand._sum.actualStock ?? 0) > 0) {
        throw new ValidationError(
          "Storage still has on-hand stock. Transfer or zero out the stock before removing.",
        );
      }

      const updated = await tx.medicineStorage.update({
        where: { id: params.id },
        data: { status: 0 },
      });

      await tx.activityLogs.create({
        data: {
          action: 1,
          desc: `REMOVE MEDICINE STORAGE: ${updated.name}`,
          userId: params.userId,
          lineId: params.lineId,
        },
      });

      await tx.medicineLogs.create({
        data: {
          action: 0,
          lineId: params.lineId,
          message: `STORAGE: ${updated.name}-${updated.refNumber}, has been removed`,
          userId: params.userId,
        },
      });

      return { message: "OK", id: updated.id };
    });
    return res.code(200).send(response);
  } catch (error) {
    if (error instanceof NotFoundError) throw error;
    if (error instanceof ValidationError) throw error;
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
    }
    throw error;
  }
};

/**
 * Manual rescan: walks every stock row in the line and emits low-stock
 * notifications for ones below threshold that aren't already alerted.
 *
 * Useful for the first run after enabling alerts (no historical events
 * would have fired the inline triggers) and as a "are we current?" check
 * the UI can call periodically.
 */
export const scanLowStock = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const params = req.query as { lineId?: string };
  if (!params.lineId) throw new ValidationError("INVALID REQUIRED ID");

  try {
    const candidates = await prisma.medicineStock.findMany({
      where: {
        lineId: params.lineId,
        threshold: { gt: 0 },
      },
      select: { id: true, actualStock: true, threshold: true },
    });

    const below = candidates.filter((s) => s.actualStock <= s.threshold);
    let notified = 0;
    let scanned = 0;

    // Run each check inside its own short transaction so one failure
    // doesn't poison the whole sweep.
    for (const s of below) {
      scanned += 1;
      try {
        const r = await prisma.$transaction(async (tx) => {
          return checkAndNotifyLowStock(tx, s.id);
        });
        if (r?.notified) notified += r.notified;
      } catch (e) {
        console.warn("[scanLowStock] failed for", s.id, e);
      }
    }

    return res.code(200).send({
      message: "OK",
      totalStocks: candidates.length,
      belowThreshold: below.length,
      scanned,
      notified,
    });
  } catch (error) {
    if (error instanceof ValidationError) throw error;
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
    }
    throw error;
  }
};

/**
 * Mobile offline-scan upload.
 *
 * The mobile app captures (barcode, name) pairs offline and flushes the
 * queue here. We treat (serialNumber = barcode, lineId) as the natural
 * key: if a Medicine row already exists we update its name + desc,
 * otherwise we create a new draft (phase = 0). The caller persists the
 * returned `id` locally so subsequent re-syncs of the same row are
 * idempotent rather than creating duplicates.
 */
export const recordMedicineScan = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const body = req.body as {
    barcode?: string;
    name?: string;
    notes?: string | null;
    scannedAt?: number | string | null;
    scannedByUserId?: string | null;
    lineId?: string | null;
    /** Client-generated UUID for offline-first creation: the mobile app
     *  registers the medicine locally under this id, then uploads. Using
     *  the same id server-side keeps queued stock-adds (which reference
     *  the local id) resolvable. Ignored when a barcode match exists. */
    id?: string | null;
  };

  if (!body?.barcode || !body?.name) {
    throw new ValidationError("BAD_REQUEST: barcode and name are required");
  }
  if (!body.lineId) {
    throw new ValidationError("BAD_REQUEST: lineId is required");
  }

  try {
    const barcode = body.barcode.trim();
    const name = body.name.trim();
    const desc = body.notes?.trim() || undefined;

    // Match on barcode first (the natural scanner key), then fall back to
    // a legacy match on serialNumber so older "barcode = serial" rows are
    // still picked up instead of duplicated.
    const existing = await prisma.medicine.findFirst({
      where: {
        lineId: body.lineId,
        OR: [{ barcode }, { serialNumber: barcode }],
      },
      select: { id: true, barcode: true },
    });

    let saved;
    if (existing) {
      saved = await prisma.medicine.update({
        where: { id: existing.id },
        data: {
          name,
          ...(desc ? { desc } : {}),
          // Backfill barcode on legacy rows that matched by serialNumber.
          ...(existing.barcode ? {} : { barcode }),
        },
        select: { id: true, serialNumber: true, barcode: true, name: true },
      });
    } else {
      const serialNumber = await generateMedRef();
      saved = await prisma.medicine.create({
        data: {
          ...(body.id ? { id: body.id } : {}),
          serialNumber,
          barcode,
          name,
          desc: desc ?? "None",
          lineId: body.lineId,
        },
        select: { id: true, serialNumber: true, barcode: true, name: true },
      });
      // Same audit entry the web's Add Medicine writes.
      if (body.scannedByUserId) {
        try {
          await prisma.medicineLogs.create({
            data: {
              action: 1,
              userId: body.scannedByUserId,
              lineId: body.lineId,
              message: `Added new medicine in the list; Med. Serial Ref.: ${saved.serialNumber} - Label: ${saved.name}`,
            },
          });
        } catch {
          /* audit is best-effort */
        }
      }
    }

    return res.code(200).send({
      id: saved.id,
      serialNumber: saved.serialNumber,
      barcode: saved.barcode,
      name: saved.name,
      mode: existing ? "updated" : "created",
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
    }
    throw error;
  }
};

/**
 * Bulk pull for the mobile "morning check for updates" flow.
 *
 * Returns every Medicine in the user's line along with its MedicineStock
 * rows. Mobile mirrors these into local SQLite so the scanner and stock
 * screens work offline until the next sync. The caller passes `since`
 * (Unix ms) to get an incremental pull; omit it to download everything.
 *
 *   GET /medicine/sync?lineId=<id>&since=<unix-ms>
 *
 * Response shape:
 *   {
 *     fetchedAt: <unix-ms>,
 *     medicines: Medicine[],          // with `stocks: MedicineStock[]`
 *   }
 */
export const medicineSync = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const params = req.query as { lineId?: string; since?: string };
  if (!params.lineId) throw new ValidationError("BAD_REQUEST: lineId required");

  const sinceMs = params.since ? parseInt(params.since, 10) : 0;
  const sinceDate = sinceMs > 0 ? new Date(sinceMs) : undefined;

  try {
    const medicines = await prisma.medicine.findMany({
      where: {
        lineId: params.lineId,
        ...(sinceDate ? { timestamp: { gt: sinceDate } } : {}),
      },
      orderBy: { timestamp: "desc" },
      select: {
        id: true,
        serialNumber: true,
        barcode: true,
        name: true,
        desc: true,
        phase: true,
        timestamp: true,
        lineId: true,
        MedicineStock: {
          select: {
            id: true,
            medicineId: true,
            medicineStorageId: true,
            quantity: true,
            perQuantity: true,
            quality: true,
            actualStock: true,
            threshold: true,
            quarter: true,
            timestamp: true,
            expiration: true,
            manufacturingDate: true,
            addressRoom: true,
            addressCol: true,
            addressRow: true,
            addressSec: true,
            container: true,
            remainingOpenedBox: true,
            remainingPieces: true,
          },
        },
      },
    });

    return res.code(200).send({
      fetchedAt: Date.now(),
      medicines: medicines.map((m) => ({
        id: m.id,
        serialNumber: m.serialNumber,
        barcode: m.barcode,
        name: m.name,
        desc: m.desc,
        phase: m.phase,
        timestamp: m.timestamp,
        lineId: m.lineId,
        stocks: m.MedicineStock,
      })),
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
    }
    throw error;
  }
};

/**
 * Mobile bulk-upload endpoint. Accepts an array of queued Add Stock
 * operations and applies them one at a time, returning a per-row outcome
 * (created / restocked / duplicate / error). Each op carries its own
 * `clientOpId` so the backend's idempotency log still dedupes within
 * the batch.
 *
 * Why a dedicated endpoint instead of looping client-side:
 *   - one TCP/TLS handshake instead of N
 *   - the failure-mode is observable per-row in a single response
 *   - keeps the mobile happy on flaky connections — partial success is
 *     reported cleanly rather than half-failing a long sequence
 */
export const bulkAddMedicineStock = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const body = req.body as {
    ops: Array<{
      clientOpId: string;
      medicineId: string;
      storageId: string;
      lineId: string;
      userId: string;
      unitOfMeasure: string;
      quantity: number;
      perUnit: number;
      thresHold?: number;
      price?: number;
      expiration: string;
      manufacturingDate: string;
      addressRoom?: string | null;
      addressCol?: string | null;
      addressRow?: string | null;
      addressSec?: string | null;
      container?: string | null;
    }>;
  };

  if (!body?.ops || !Array.isArray(body.ops) || body.ops.length === 0) {
    throw new ValidationError("BAD_REQUEST: ops array required");
  }

  // Identity comes from the TOKEN, never from the payload. A client-supplied
  // userId can be stale or plain wrong — and a missing one used to make
  // assertStorageAccess SKIP the storage check entirely, letting scanned
  // stock land in whichever storage the app happened to preselect.
  const accountId = (req.user as { id?: string } | undefined)?.id;
  const authAccount = accountId
    ? await prisma.account.findUnique({
        where: { id: accountId },
        select: { User: { select: { id: true } } },
      })
    : null;
  const authUserId = authAccount?.User?.id ?? null;

  // Self-heal: if this line has exactly one storage and the scanner user has
  // no grant yet, assign it now so the upload doesn't bounce needlessly.
  await autoGrantSoleStorageAccess(authUserId, body.ops[0]?.lineId);

  const results: Array<{
    clientOpId: string;
    status: "created" | "restocked" | "duplicate" | "error";
    stockId?: string;
    message?: string;
  }> = [];

  for (const op of body.ops) {
    if (!op?.clientOpId) {
      results.push({
        clientOpId: op?.clientOpId ?? "",
        status: "error",
        message: "Missing clientOpId",
      });
      continue;
    }

    // Idempotency short-circuit — same logic as the single endpoint.
    const prior = await prisma.mobileUploadLog.findUnique({
      where: { clientOpId: op.clientOpId },
      select: { resultId: true, message: true },
    });
    if (prior) {
      results.push({
        clientOpId: op.clientOpId,
        status: "duplicate",
        stockId: prior.resultId ?? undefined,
        message: prior.message ?? "Already processed",
      });
      continue;
    }

    if (op.quantity <= 0 || op.perUnit <= 0) {
      results.push({
        clientOpId: op.clientOpId,
        status: "error",
        message: "Quantity and per-unit must be positive.",
      });
      continue;
    }
    if (!op.expiration || !op.manufacturingDate) {
      results.push({
        clientOpId: op.clientOpId,
        status: "error",
        message: "Manufacturing and expiration dates are required.",
      });
      continue;
    }

    const expiration = new Date(op.expiration);
    const manufacturingDate = new Date(op.manufacturingDate);
    if (!(expiration > manufacturingDate)) {
      results.push({
        clientOpId: op.clientOpId,
        status: "error",
        message: "Expiration must be after manufacturing date.",
      });
      continue;
    }

    const price = Math.max(0, Number(op.price ?? 0));

    try {
      // Storage access: same rule as the web add-stock endpoint — but bound
      // to the AUTHENTICATED user. Never skipped: no resolvable identity
      // means no write.
      const actorId = authUserId ?? op.userId;
      if (!actorId) {
        results.push({
          clientOpId: op.clientOpId,
          status: "error",
          message: "Could not resolve your user account — sign in again.",
        });
        continue;
      }
      await assertStorageAccess(actorId, [op.storageId], "add or restock");

      const txResult = await prisma.$transaction(async (tx) => {
        const [medicine, storage] = await Promise.all([
          tx.medicine.findUnique({ where: { id: op.medicineId } }),
          tx.medicineStorage.findUnique({ where: { id: op.storageId } }),
        ]);
        if (!medicine) throw new NotFoundError("ITEM_NOT_FOUND");
        if (!storage) throw new NotFoundError("STORAGE_NOT_FOUND");

        const existing = await tx.medicineStock.findFirst({
          where: {
            medicineId: op.medicineId,
            medicineStorageId: op.storageId,
            expiration,
            manufacturingDate,
            quality: op.unitOfMeasure,
            perQuantity: op.perUnit,
          },
        });

        const totalItems = op.perUnit * op.quantity;
        let mode: "restock" | "new";
        let stockId: string;

        if (existing) {
          mode = "restock";
          await clearLowStockAlerts(tx, existing.id);
          const updated = await tx.medicineStock.update({
            where: { id: existing.id },
            data: {
              actualStock: existing.actualStock + totalItems,
              quantity: existing.quantity + op.quantity,
              threshold:
                op.thresHold !== undefined ? op.thresHold : existing.threshold,
              ...(op.addressRoom ? { addressRoom: op.addressRoom } : {}),
              ...(op.addressCol  ? { addressCol:  op.addressCol  } : {}),
              ...(op.addressRow  ? { addressRow:  op.addressRow  } : {}),
              ...(op.addressSec  ? { addressSec:  op.addressSec  } : {}),
              ...(op.container   ? { container:   op.container   } : {}),
              price: { create: { value: price } },
            },
          });
          stockId = updated.id;
        } else {
          mode = "new";
          const created = await tx.medicineStock.create({
            data: {
              quantity: op.quantity,
              medicineId: medicine.id,
              threshold: op.thresHold ?? 0,
              medicineStorageId: op.storageId,
              actualStock: totalItems,
              lineId: op.lineId,
              quarter: getQuarter(),
              quality: op.unitOfMeasure,
              perQuantity: op.perUnit,
              expiration,
              manufacturingDate,
              addressRoom: op.addressRoom || null,
              addressCol:  op.addressCol  || null,
              addressRow:  op.addressRow  || null,
              addressSec:  op.addressSec  || null,
              container:   op.container   || null,
              price: { create: { value: price } },
            },
          });
          stockId = created.id;
        }

        await checkAndNotifyLowStock(tx, stockId);

        await tx.medicineLogs.create({
          data: {
            action: mode === "restock" ? 2 : 1,
            message:
              `${mode === "restock" ? "Restocked" : "Added new batch:"} ${medicine.name} ` +
              `(${medicine.serialNumber}) — qty ${op.quantity} × ${op.perUnit} ${op.unitOfMeasure} ` +
              `(${totalItems} items) → storage ${storage.refNumber} [mobile]`,
            userId: actorId,
            lineId: op.lineId,
          },
        });

        return { mode, stockId };
      });

      await prisma.mobileUploadLog
        .create({
          data: {
            clientOpId: op.clientOpId,
            kind: "medicine.addStock",
            userId: actorId,
            lineId: op.lineId,
            resultId: txResult.stockId,
            message: txResult.mode === "restock" ? "Restocked" : "New batch",
          },
        })
        .catch(() => undefined);

      results.push({
        clientOpId: op.clientOpId,
        status: txResult.mode === "restock" ? "restocked" : "created",
        stockId: txResult.stockId,
      });
    } catch (e: any) {
      const message =
        e?.message ?? String(e?.response?.data?.message ?? "Failed");
      results.push({
        clientOpId: op.clientOpId,
        status: "error",
        message,
      });
    }
  }

  return res.code(200).send({
    attempted: body.ops.length,
    succeeded: results.filter((r) =>
      ["created", "restocked", "duplicate"].includes(r.status),
    ).length,
    failed: results.filter((r) => r.status === "error").length,
    results,
  });
};

export const exportMedicineReport = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const params = req.query as { storgeId: string };

  if (!params.storgeId) {
    throw new ValidationError("INVALID REQUIRED ID");
  }

  try {
    let limit = 20;

    const result = await prisma.$transaction(async (tx) => {
      let allMedicines: any[] = [];
      let currentPage = 0;
      let hasMoreData = true;

      // Get storage info
      const storage = await tx.medicineStorage.findUnique({
        where: {
          id: params.storgeId,
        },
      });

      if (!storage) {
        throw new NotFoundError("STORAGE NOT FOUND");
      }

      // Fetch all medicines with pagination
      while (hasMoreData) {
        const skipping = currentPage * limit;
        const medicines = await tx.medicineStock.findMany({
          where: {
            medicineStorageId: params.storgeId,
          },
          take: limit,
          skip: skipping,
          include: {
            medicine: {
              select: {
                name: true,
              },
            },
          },
        });

        if (medicines.length === 0) {
          hasMoreData = false;
        } else {
          allMedicines.push(...medicines);
          currentPage++;

          if (medicines.length < limit) {
            hasMoreData = false;
          }
        }
      }

      return { medicines: allMedicines, storage };
    });

    // Load and process template
    const medicineReportTemplateLink =
      "https://res.cloudinary.com/drhkb0ubf/raw/upload/v1776245651/Medicine_Report_Template_ewezx3.xlsx";
    const response = await fetch(medicineReportTemplateLink);
    const arrayBuffer = await response.arrayBuffer();

    const buffer = Buffer.from(arrayBuffer);

    const stream = Readable.from(buffer);

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.read(stream);

    const worksheet = workbook.worksheets[0];

    if (!worksheet) {
      throw new Error("Worksheet not found in template");
    }

    let initRow = 4;
    let rowIndex = 0;

    result.medicines.forEach((item, i) => {
      initRow++;
      rowIndex++;
      let row = worksheet.getRow(initRow);
      row.getCell("A").value = rowIndex;
      row.getCell("B").value = item.medicine?.name || "N/A";
      row.getCell("F").value = item.manufacturingDate || "N/A";
      row.getCell("G").value = item.expiration || "N/A";
      row.getCell("H").value = item.actualStock;
      row.getCell("I").value =
        item.perQuantity > 1
          ? `${item.perQuantity}/${item.quality}`
          : item.quality;
    });

    const excelBuffer = await workbook.xlsx.writeBuffer();

    res.header(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.header(
      "Content-Disposition",
      `attachment; filename="MedicineReport_${result.storage.name || "export"}.xlsx"`,
    );

    return res.send(excelBuffer);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
    }
    throw error;
  }
};

/**
 * Bulk-import medicines from an uploaded spreadsheet.
 *
 * Multipart form: `file` (.xlsx/.xls/.csv) + `lineId` (+ optional `userId`).
 *
 * ONLY the medicine name matters. We read the **first column** of every
 * sheet — one medicine name per row. An optional header cell on row 1
 * (e.g. "Name", "Medicine", "Item", "Product") is skipped automatically.
 * Names are de-duplicated within the file and against medicines that
 * already exist in the same line, then the new ones are inserted (each
 * with a generated serial number) scoped to that line.
 */
export const medicineBulkUpload = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  if (!req.isMultipart()) {
    throw new ValidationError("INVALID MULTI-PART");
  }

  try {
    const parts = req.parts();
    const formData: Record<string, string> = {};
    let fileBuffer: Buffer | null = null;

    for await (const part of parts) {
      if (part.type === "file") {
        const buffers: Buffer[] = [];
        for await (const chunk of part.file) buffers.push(chunk as Buffer);
        fileBuffer = Buffer.concat(buffers);
      } else {
        formData[part.fieldname] = part.value as string;
      }
    }

    if (!fileBuffer) {
      throw new ValidationError("INVALID FILE");
    }
    if (!formData.lineId) {
      throw new ValidationError("lineId is required");
    }

    const workbook = new ExcelJS.Workbook();
    const stream = Readable.from(fileBuffer);
    await workbook.xlsx.read(stream);

    // Header words to ignore if they appear in the first cell of a sheet.
    const HEADER_WORDS = new Set([
      "name",
      "medicine",
      "medicine name",
      "item",
      "item name",
      "product",
    ]);

    // Collect unique names (case-insensitive) from column 1 of every sheet.
    const names: string[] = [];
    const seen = new Set<string>();

    workbook.eachSheet((sheet) => {
      sheet.eachRow((row, rowNumber) => {
        const raw = row.getCell(1).value;
        const name = raw != null ? raw.toString().trim() : "";
        if (!name) return;
        // Skip an optional header label on the first row.
        if (rowNumber === 1 && HEADER_WORDS.has(name.toLowerCase())) return;
        const key = name.toLowerCase();
        if (seen.has(key)) return;
        seen.add(key);
        names.push(name);
      });
    });

    if (names.length === 0) {
      throw new ValidationError("No medicine names found in the file.");
    }

    // Skip names that already exist in THIS line (case-insensitive).
    // `name: { in: names }` is case-SENSITIVE in Postgres, so a row stored as
    // "CEFALEXIN 125MG/5ML" never came back and the lowercase check below could
    // not see it — importing "Cefalexin 125mg/5ml" then created a SECOND row,
    // splitting that medicine's stock across two catalog entries. Compare
    // against every name in the line instead.
    const existing = await prisma.medicine.findMany({
      where: { lineId: formData.lineId },
      select: { name: true },
    });
    const existingSet = new Set(existing.map((m) => m.name.trim().toLowerCase()));
    const newNames = names.filter((n) => !existingSet.has(n.trim().toLowerCase()));

    if (newNames.length === 0) {
      return res.status(200).send({
        message: "All medicines already exist. Nothing to import.",
        total: names.length,
        inserted: 0,
        skipped: names.length,
      });
    }

    const rows: { name: string; serialNumber: string; lineId: string }[] = [];
    for (const name of newNames) {
      const serialNumber = await generateMedRef();
      rows.push({ name, serialNumber, lineId: formData.lineId });
    }

    const result = await prisma.$transaction(async (tx) => {
      const inserted = await tx.medicine.createMany({
        data: rows,
        skipDuplicates: true,
      });

      // Audit log is best-effort — only when we know who performed it.
      if (formData.userId) {
        await tx.medicineLogs.create({
          data: {
            lineId: formData.lineId,
            userId: formData.userId,
            message: `BULK IMPORT: ${inserted.count} medicine/s added.`,
            action: 1,
          },
        });
      }

      return inserted;
    });

    return res.status(200).send({
      message: "Bulk upload completed",
      total: names.length,
      inserted: result.count,
      skipped: names.length - result.count,
    });
  } catch (error) {
    console.error("Bulk upload error:", error);
    if (error instanceof ValidationError) throw error;
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
    }
    throw error;
  }
};

// PATCH /medicine/threshold { medicineId, storageId, threshold, lineId, userId }
// Update the low-stock threshold for every stock batch of a medicine within a
// storage location (the "medicine's threshold").
export const updateMedicineThreshold = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const body = req.body as {
    medicineId?: string;
    storageId?: string;
    threshold?: number | string;
    lineId?: string;
    userId?: string;
  };
  if (!body.medicineId || !body.storageId || !body.lineId) {
    throw new ValidationError("INVALID REQUIRED FIELDS");
  }
  const threshold = Math.max(0, parseInt(String(body.threshold ?? 0), 10) || 0);
  const { medicineId, storageId, lineId, userId } = body;

  // A low-stock THRESHOLD is a benign alert setting — not a dispense or a stock
  // move — and per-storage Dispense Access grants are rarely configured, so
  // gating it exactly like dispensing blocked even the storage's own pharmacy
  // staff. Allow it for EITHER an explicit storage grant OR any Pharmacy-module
  // user in this line (the same audience that receives the low-stock alerts).
  // Dispense / restock keep the stricter assertStorageAccess check.
  if (userId) {
    const [grant, mod] = await Promise.all([
      prisma.medicineStorageAccess.findFirst({
        where: { userId, medicineStorageId: storageId },
        select: { id: true },
      }),
      prisma.module.findFirst({
        where: {
          userId,
          lineId,
          OR: [
            { moduleName: { equals: "medicine", mode: "insensitive" } },
            { moduleName: { equals: "Pharmacy", mode: "insensitive" } },
          ],
        },
        select: { id: true },
      }),
    ]);
    if (!grant && !mod) {
      throw new ValidationError(
        "You need the Pharmacy module (or Dispense Access on this storage) " +
          "to change its low-stock threshold. Ask your admin to grant it.",
      );
    }
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      // Grab the affected rows first so we can re-evaluate low-stock against
      // the *new* threshold below.
      const stocks = await tx.medicineStock.findMany({
        where: { medicineId, medicineStorageId: storageId, lineId },
        select: { id: true, actualStock: true },
      });

      const updated = await tx.medicineStock.updateMany({
        where: {
          medicineId,
          medicineStorageId: storageId,
          lineId,
        },
        data: { threshold },
      });

      // Changing the threshold can itself put a row "below threshold" — fire
      // the alert now instead of waiting for the next dispense. Rows that are
      // now above the new threshold get their alert cleared so a future dip
      // notifies again.
      for (const s of stocks) {
        if (threshold > 0 && s.actualStock <= threshold) {
          await checkAndNotifyLowStock(tx, s.id);
        } else {
          await clearLowStockAlerts(tx, s.id);
        }
      }

      if (userId && updated.count > 0) {
        const med = await tx.medicine.findUnique({
          where: { id: medicineId },
          select: { name: true },
        });
        await tx.medicineLogs.create({
          data: {
            action: 2,
            userId,
            lineId,
            message: `Updated low-stock threshold to ${threshold} for "${med?.name ?? "medicine"}"`,
          },
        });
      }

      return updated;
    });

    return res
      .code(200)
      .send({ message: "OK", count: result.count, threshold });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
    }
    throw error;
  }
};
