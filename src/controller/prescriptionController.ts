import { FastifyRequest, FastifyReply } from "../barrel/fastify";
import { Prisma, prisma } from "../barrel/prisma";
import { AppError, NotFoundError, ValidationError, dbError } from "../errors/errors";
import { generatePrescriptionRef } from "../middleware/handler";
import { checkAndNotifyLowStock } from "../service/medicineAlerts";
import { createUserNotification } from "../service/notificationEvents";
import { assertStorageAccess } from "./storageAccessController";
import { createDispenseRecord } from "./medicineController";
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
      throw dbError(error);
    }
    throw error;
  }
};

const computeAgeFromBirthday = (birthday: string): string => {
  const birth = new Date(birthday);
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const m = today.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
  return String(age);
};

export const createPrescriptions = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const body = req.body as PrescriptionProps;
  console.log(body);

  try {
    const refNumber = await generatePrescriptionRef();
    const age = body.birthday
      ? computeAgeFromBirthday(body.birthday)
      : body.age ?? "N/A";

    const response = await prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({
        where: { id: body.userId },
      });

      if (!user) throw new NotFoundError("User not found!");

      // ── Resolve patient ──────────────────────────────────────────────────
      // Search mode: patientId supplied → use existing patient
      // Manual mode: no patientId → auto-create a new Patient record
      let resolvedPatientId: string = body.patientId ?? "";

      if (!resolvedPatientId) {
        const newPatient = await tx.patient.create({
          data: {
            firstname: body.firstname ?? "",
            lastname: body.lastname ?? "",
            birthday: body.birthday ? new Date(body.birthday) : undefined,
            phoneNumber: body.phoneNumber || undefined,
            philHealthNo: body.philHealthNo || undefined,
            email: body.email || undefined,
            barangayId: body.barangayId || undefined,
            municipalId: body.municipalId || undefined,
            provinceId: body.provinceId || undefined,
            lineId: body.lineId,
          },
        });
        resolvedPatientId = newPatient.id;
      }

      // ── Create prescription ──────────────────────────────────────────────
      const prescription = await tx.prescription.create({
        data: {
          lineId: body.lineId,
          refNumber: refNumber,
          firstname: body.firstname,
          lastname: body.lastname,
          age,
          barangayId: body.barangayId || undefined,
          municipalId: body.municipalId || undefined,
          provinceId: body.provinceId || undefined,
          userId: user.id,
          street: body.street,
          condtion: body.desc,
          patientId: resolvedPatientId,
          external: !!body.external,
          externalSource: body.external
            ? body.externalSource?.trim() || null
            : null,
          progress: {
            create: { step: 0 },
          },
          presMed: {
            createMany: {
              data: body.prescribeMed.map((item) => ({
                medicineId: item.medId,
                quantity: parseInt(item.quantity, 10),
                desc: item.comment || "",
              })),
            },
          },
        },
      });

      // ── Record prescription as a patient visit ───────────────────────────
      await tx.patientRecord.create({
        data: {
          patientId: resolvedPatientId,
          diagnose: body.desc || undefined,
          type: 1, // Prescribed
          prescriptionId: prescription.id,
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
      const medNotif = await tx.medicineNotification.create({
        data: {
          userId: body.userId,
          view: 0,
          path: `prescription/${prescription.id}`,
          message: `${user.lastName}, ${user.firstName} - submitted prescription for ${body.lastname}, ${body.firstname}`,
          title: "New Prescription",
          lineId: body.lineId,
          ...notRequired,
        },
        select: {
          id: true,
          userId: true,
          title: true,
          message: true,
          lineId: true,
          path: true,
          timestamp: true,
          type: true,
          view: true,
        },
      });

      // Real-time push so anyone on this line sees the new prescription
      // notification without a refresh.
      try {
        const { notificationSocket } = await import("..");
        notificationSocket.emitMedicineNotification(medNotif.lineId, {
          id: medNotif.id,
          userId: medNotif.userId,
          title: medNotif.title,
          message: medNotif.message,
          lineId: medNotif.lineId,
          path: medNotif.path ?? undefined,
          timestamp:
            typeof medNotif.timestamp === "string"
              ? medNotif.timestamp
              : medNotif.timestamp.toISOString(),
          type: medNotif.type,
          view: medNotif.view,
        });
      } catch (e) {
        console.warn("[prescription] medicine notif emit failed:", e);
      }

      // Notify the line's pharmacy (medicine-module) users in their MAIN
      // notification bell so they know a new prescription is waiting to be
      // dispensed. The prescriber themselves is skipped.
      const pharmacyUsers = await tx.module.findMany({
        where: {
          lineId: body.lineId,
          OR: [
            { moduleName: { equals: "medicine", mode: "insensitive" } },
            { moduleName: { equals: "Pharmacy", mode: "insensitive" } },
          ],
        },
        select: { userId: true },
      });
      const pharmacyIds = [
        ...new Set(pharmacyUsers.map((m) => m.userId)),
      ].filter((id) => id && id !== body.userId);

      for (const recipientId of pharmacyIds) {
        await createUserNotification(tx, {
          recipientId,
          title: "New Prescription",
          content: `${user.lastName}, ${user.firstName} submitted prescription #${prescription.refNumber} for ${body.lastname}, ${body.firstname}.`,
          path: `/${body.lineId}/medicine/prescription/${prescription.id}`,
          senderId: body.userId,
        });
      }

      return prescription;
    });

    return res.code(200).send({ message: "OK", refNumber, response });
  } catch (error) {
    console.log(error);
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw dbError(error);
    }
    throw error;
  }
};

export const prescriptionList = async (
  req: FastifyRequest,
  res: FastifyReply,
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
      throw dbError(error);
    }
    throw error;
  }
};

export const prescriptionData = async (
  req: FastifyRequest,
  res: FastifyReply,
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
      throw dbError(error);
    }
    throw error;
  }
};

export const prescriptionPrescribeMed = async (
  req: FastifyRequest,
  res: FastifyReply,
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
      throw dbError(error);
    }
    throw error;
  }
};

export const prescriptionProgres = async (
  req: FastifyRequest,
  res: FastifyReply,
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
      throw dbError(error);
    }
    throw error;
  }
};

export const prescriptionDispense = async (
  req: FastifyRequest,
  res: FastifyReply,
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

    // Per-storage dispense access: a user with storage assignments may only
    // dispense stock held in the storages assigned to them (Storage >
    // Dispense Access). Users with no assignments are unrestricted.
    const stockStorages = await prisma.medicineStock.findMany({
      where: { id: { in: stockIds } },
      select: { medicineStorageId: true },
    });
    await assertStorageAccess(
      body.userId,
      stockStorages.map((s) => s.medicineStorageId),
      "dispense",
    );

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
        include: {
          MedicineStorage: {
            select: {
              id: true,
            },
          },
        },
      });
      console.log("Log 3 - Medicine stocks found:", medicineStocks);

      if (!prescription) throw new NotFoundError("Prescription not found!");
      if (prescription.status === 2)
        throw new ValidationError("Prescripton already processed");
      // Safety: refuse to dispense if the patient record has been deleted.
      // patientId is required on every newly-created prescription, so a null
      // value here means the linked Patient was deleted (SetNull cascade).
      if (!prescription.patientId)
        throw new ValidationError(
          "Cannot dispense: patient record no longer exists.",
        );
      // Record, per prescribed medicine, how much of IT was released — the sum
      // of the amounts typed against that medicine's own stock lots.
      // (This used to store the grand total across every medicine on the
      // prescription, so a 2-medicine order recorded both items with the
      // combined figure.)
      console.log("Log 3.5 - Updating prescribeMedicine records");
      await Promise.all(
        body.prescribeMed.map((item) => {
          const released = item.stocks.reduce((sum, s) => {
            const n = parseInt(String(s.toRelease), 10);
            return sum + (Number.isFinite(n) ? n : 0);
          }, 0);
          return tx.precribeMedicine.update({
            where: {
              id: item.id,
            },
            data: {
              releaseQuantity: released,
              remark: item.remark,
            },
          });
        }),
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

      for (let i = 0; i < medicineStocks.length; i++) {
        const item = medicineStocks[i];

        try {
          const toDispense = body.prescribeMed.find(
            (med) => med.medId === item.medicineId,
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
            currentStockPieces,
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

          // Auto low-stock alert (no-op when stock is above threshold or
          // when an active alert already exists for this row).
          await checkAndNotifyLowStock(tx, item.id);

          await tx.medicineTransactionItem.create({
            data: {
              medicineTransactionId: transaction.id,
              prescribeQuantity: toDispense.prescribeQuantity,
              releasedQuantity: toDispense.quantity,
              medicineStorageId: item.MedicineStorage?.id,
              medicineId: toDispense.medId,
            },
          });
        } catch (innerError) {
          throw innerError; // Re-throw to fail the transaction
        }
      }

      await tx.prescription.update({
        data: {
          status: 2,
          progress: {
            create: {
              step: 4,
            },
          },
        },
        where: {
          id: prescription.id,
        },
      });

      // ── Record dispensing in patient's history ───────────────────────────
      // patientId is set on the prescription (either from search or auto-created
      // when the prescription was originally submitted)
      if (prescription.patientId) {
        await tx.patientRecord.create({
          data: {
            patientId: prescription.patientId,
            diagnose: prescription.condtion || undefined,
            medicineTransactionId: transaction.id,
            prescriptionId: prescription.id,
            type: 2, // Medicine Dispensed
          },
        });
      }

      await tx.medicineLogs.create({
        data: {
          userId: body.userId,
          action: 4,
          message:
            `Dispensed Medicine: Ref. #: ${prescription.refNumber}` +
            ((prescription as { external?: boolean }).external
              ? ` — EXTERNAL prescription${(prescription as { externalSource?: string | null }).externalSource ? ` (${(prescription as { externalSource?: string | null }).externalSource})` : ""}`
              : ""),
          lineId: prescription.lineId,
        },
      });

      await createUserNotification(tx, {
        recipientId: prescription.userId,
        title: "New Notification",
        content: `The prescription #${prescription.refNumber} you prescribed has been dispensed to the patient.`,
        path: `prescribe-medicine/transaction/${prescription.id}`,
        senderId: body.userId,
      });

      // Realtime "dispensed" alert on the medicine-notification channel — the
      // same one the prescribe alert uses — so the whole line, INCLUDING the
      // prescriber on the Pharmacy Desktop, is notified live (this is what wakes
      // the desktop long-poll; the createUserNotification above only reaches the
      // web bell). The dispenser is skipped by the per-user rule.
      const dispenser = await tx.user.findUnique({
        where: { id: body.userId },
        select: { firstName: true, lastName: true },
      });
      const dispWho = dispenser
        ? `${dispenser.lastName}, ${dispenser.firstName}`
        : "Pharmacy";
      const dispPatient = await tx.patient.findUnique({
        where: { id: prescription.patientId },
        select: { firstname: true, lastname: true },
      });
      const dispFor =
        [dispPatient?.lastname, dispPatient?.firstname]
          .filter((x) => x && String(x).trim())
          .join(", ") || "a patient";
      if (prescription.lineId) {
        const dispNotif = await tx.medicineNotification.create({
          data: {
            userId: body.userId,
            view: 0,
            path: `prescription/${prescription.id}`,
            message: `${dispWho} - dispensed prescription for ${dispFor}`,
            title: "Prescription Dispensed",
            lineId: prescription.lineId,
          },
          select: {
            id: true, userId: true, title: true, message: true, lineId: true,
            path: true, timestamp: true, type: true, view: true,
          },
        });
        try {
          const { notificationSocket } = await import("..");
          notificationSocket.emitMedicineNotification(dispNotif.lineId, {
            id: dispNotif.id,
            userId: dispNotif.userId,
            title: dispNotif.title,
            message: dispNotif.message,
            lineId: dispNotif.lineId,
            path: dispNotif.path ?? undefined,
            timestamp:
              typeof dispNotif.timestamp === "string"
                ? dispNotif.timestamp
                : dispNotif.timestamp.toISOString(),
            type: dispNotif.type,
            view: dispNotif.view,
          });
        } catch (e) {
          console.warn("[prescription] dispensed notif emit failed:", e);
        }
      }

      // Dispense-history record (kind = prescription) so the Dispense
      // History tab shows Rx dispenses alongside direct ones. Best-effort:
      // wrapped so a history-write hiccup can never fail the dispense.
      try {
        const releasedItems = await tx.precribeMedicine.findMany({
          where: { prescriptionId: prescription.id },
          select: {
            releaseQuantity: true,
            quantity: true,
            medicine: {
              select: { id: true, name: true, serialNumber: true, barcode: true },
            },
          },
        });
        const items = releasedItems
          .filter((m) => m.medicine)
          .map((m) => ({
            medicineId: m.medicine!.id,
            medicineName: m.medicine!.name,
            serialNumber: m.medicine!.serialNumber,
            barcode: m.medicine!.barcode,
            quantity: m.releaseQuantity ?? m.quantity ?? 0,
          }));
        if (items.length > 0 && prescription.lineId) {
          await createDispenseRecord(tx, {
            lineId: prescription.lineId,
            kind: 1,
            dispenser: {
              id: body.userId,
              username: null,
              name: dispenser
                ? `${dispenser.firstName ?? ""} ${dispenser.lastName ?? ""}`.trim()
                : null,
            },
            patientName: dispFor,
            patientId: prescription.patientId,
            note: (prescription as { condtion?: string | null }).condtion ?? null,
            external: !!(prescription as { external?: boolean }).external,
            externalSource:
              (prescription as { externalSource?: string | null })
                .externalSource ?? null,
            prescriptionId: prescription.id,
            refNumber: prescription.refNumber,
            items,
          });
        }
      } catch (e) {
        console.warn("[prescription] dispense-history write skipped:", e);
      }
    });

    return res.code(200).send({ message: "OK" });
  } catch (error) {
    console.log({ error });

    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw dbError(error);
    }

    if (error instanceof Error) {
      console.error("Error stack:", error.stack);
    }

    throw error;
  }
};

export const prescriptionProgress = async (
  req: FastifyRequest,
  res: FastifyReply,
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
      throw dbError(error);
    }

    throw error;
  }
};

export const prescriptionProgressUpdate = async (
  req: FastifyRequest,
  res: FastifyReply,
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
      throw dbError(error);
    }

    throw error;
  }
};

export const prescribeTransaction = async (
  req: FastifyRequest,
  res: FastifyReply,
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
      include: {
        patient: {
          select: {
            id: true,
            firstname: true,
            lastname: true,
            birthday: true,
            phoneNumber: true,
          },
        },
        barangay: { select: { name: true } },
        municipal: { select: { name: true } },
        _count: { select: { presMed: true } },
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
      throw dbError(error);
    }
    throw error;
  }
};
