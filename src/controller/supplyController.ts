import { FastifyReply, FastifyRequest } from "../barrel/fastify";
import { Prisma, prisma } from "../barrel/prisma";
import ExcelJS from "exceljs";
import { Readable } from "stream";
//
import {
  AddNewSupplyProps,
  DispenseItemProps,
  PagingProps,
  TimebaseGroupPrice,
  UpdateSupplyProps,
} from "../models/route";
import {
  generatedItemCode,
  generateOrderRef,
  generateDispenseRef,
} from "../middleware/handler";
import { AppError, NotFoundError, ValidationError } from "../errors/errors";
import { getPriceTotal } from "../utils/date";
export const addSupply = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const body = req.body as AddNewSupplyProps;

    if (!body.item || !body.suppliesDataSetId || !body.lineId) {
      return res.code(400).send({ message: "Bad Request" });
    }
    const code = await generatedItemCode();
    await prisma.$transaction([
      prisma.supplies.create({
        data: {
          item: body.item,
          suppliesDataSetId: body.suppliesDataSetId,
          lineId: body.lineId,
          description: body.description,

          consumable: body.consumable,
          code,
        },
      }),
      prisma.inventoryAccessLogs.create({
        data: {
          userId: body.userId,
          inventoryBoxId: body.inventoryBoxId,
          action: `Added Supply: ${body.item}`,
          timestamp: new Date(),
        },
      }),
    ]);

    return res.code(200).send({ message: "OK" });
  } catch (error) {
    console.log(error);
    res.code(500).send({ message: "Internal Server Error" });
  }
};

export const deleteSupply = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const body = req.query as {
      id: string;
      userId: string;
      inventoryBoxId: string;
    };
    if (!body.id || !body.userId || !body.inventoryBoxId) {
      return res.code(400).send({ message: "Bad Request!" });
    }
    await prisma.$transaction([
      prisma.supplies.delete({
        where: {
          id: body.id,
        },
      }),
      prisma.inventoryAccessLogs.create({
        data: {
          action: "Deleted an item.",
          inventoryBoxId: body.inventoryBoxId,
          userId: body.userId,
          timestamp: new Date(),
        },
      }),
    ]);
  } catch (error) {
    console.log(error);
    res.code(500).send({ message: "Internal Server Error" });
  }
};

export const updateSupply = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const body = req.body as UpdateSupplyProps;

    if (!body.id) {
      return res.code(400).send({ message: "Bad Request" });
    }
    const toUpdate: any = {
      consumable: body.consumable,
    };

    if (body.item) {
      toUpdate.item = body.item;
    }
    if (body.description) {
      toUpdate.description = body.description;
    }

    await prisma.$transaction([
      prisma.supplies.update({
        where: {
          id: body.id,
        },
        data: toUpdate,
      }),
      // prisma.inventoryAccessLogs.create({
      //   data:{

      //   }
      // })
    ]);
  } catch (error) {
    console.log(error);
    res.code(500).send({ message: "Internal Server Error" });
  }
};

export const newOrder = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const params = req.body as { title: string; id: string; lineId: string };
    console.log("New ORder:", params);

    const refNumber = await generateOrderRef();
    const response = await prisma.supplyBatchOrder.create({
      data: {
        title: params.title,
        refNumber,
        supplyBatchId: params.id,
        status: 0,
        lineId: params.lineId,
      },
    });

    res.code(200).send({ message: "OK", data: response });
  } catch (error) {
    console.log(error);
    res.code(500).send({ message: "Internal Server Error" });
  }
};

export const dispenseSupply = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const body = req.body as DispenseItemProps;

  if (!body.id || !body.quantity || parseInt(body.quantity, 10) <= 0) {
    throw new ValidationError("Item ID and positive quantity are required");
  }

  // Offline desktop dispenses carry a stable clientOpId so a retried push is
  // idempotent — if we've already recorded this op, return OK without
  // deducting stock again.
  const clientOpId = (req.body as any).clientOpId as string | undefined;

  try {
    if (clientOpId) {
      const existing = await prisma.supplyDispenseRecord.findUnique({
        where: { clientOpId },
        select: { id: true },
      });
      if (existing) {
        return res.code(200).send({
          success: true,
          duplicate: true,
          message: "Already dispensed (idempotent replay).",
        });
      }
    }

    const stock = await prisma.supplyStockTrack.findUnique({
      where: {
        id: body.id,
      },
      select: {
        quantity: true,
        perQuantity: true,
        id: true,
        stock: true,
        suppliesId: true,
        desc: true,
      },
    });

    if (!stock) {
      throw new NotFoundError("ITEM NOT FOUND");
    }

    const currentBoxes = stock.quantity;
    const perBox = stock.perQuantity;
    const currentStockPieces = stock.stock;
    const toDispense = parseInt(body.quantity, 10);

    // Check if database consistency issue
    if (currentStockPieces !== currentBoxes * perBox) {
      console.warn(`Database inconsistency:
        stock.stock = ${currentStockPieces},
        but quantity * perQuantity = ${currentBoxes * perBox}`);
      // You might want to fix this or use stock.stock as source of truth
    }

    // Check if enough stock
    if (toDispense > currentStockPieces) {
      throw new ValidationError(
        `Insufficient stock. Available: ${currentStockPieces}, Requested: ${toDispense}`,
      );
    }

    // Calculate dispensing details - FIXED LOGIC
    const fullBoxesToGive = Math.floor(toDispense / perBox);
    const loosePieces = toDispense % perBox;

    console.log("Dispensing calculation:", {
      fullBoxesToGive,
      loosePieces,
    });

    // Calculate remaining inventory - SIMPLIFIED CORRECT LOGIC
    let remainingFullBoxes = currentBoxes - fullBoxesToGive;
    let openedBoxRemainingPieces = 0;

    if (loosePieces > 0) {
      // We need to open a box for loose pieces
      remainingFullBoxes -= 1; // Remove the box we're opening
      openedBoxRemainingPieces = perBox - loosePieces; // What's left in that opened box
    }

    // Total pieces calculation
    const remainingPieces =
      remainingFullBoxes * perBox + openedBoxRemainingPieces;

    // Also calculate expected remaining pieces
    const expectedRemainingPieces = currentStockPieces - toDispense;

    console.log("Remaining calculation:", {
      remainingFullBoxes,
      openedBoxRemainingPieces,
      remainingPieces,
      expectedRemainingPieces,
      check: remainingPieces === expectedRemainingPieces,
    });

    // Verify calculation matches
    if (remainingPieces !== expectedRemainingPieces) {
      console.error("Calculation mismatch details:", {
        currentStockPieces,
        toDispense,
        remainingPieces,
        expectedRemainingPieces,
        difference: remainingPieces - expectedRemainingPieces,
      });
      throw new Error(`Inventory calculation mismatch:
        Got ${remainingPieces}, Expected ${expectedRemainingPieces}`);
    }

    // Prepare update data
    // The quantity field should represent total boxes (full + partial)
    const totalBoxesAfter =
      remainingFullBoxes + (openedBoxRemainingPieces > 0 ? 1 : 0);

    const updateData: any = {
      quantity: totalBoxesAfter,
      stock: remainingPieces,
    };

    console.log("Update data:", updateData);

    // Prepare data for dispense record - Using ALL fields from your schema
    const dispenseRecordData: any = {
      refCode: await generateDispenseRef(),
      clientOpId: clientOpId || undefined,
      quantity: toDispense.toString(),
      suppliesId: stock.suppliesId,
      supplyStockTrackId: stock.id,
      remarks: body.remark || `Dispensed ${toDispense} pieces`,
      inventoryBoxId: body.inventoryBoxId,
      supplyBatchId: body.listId,
      desc: stock.desc,
    };

    // Add optional fields based on request body
    if (body.unitId) {
      dispenseRecordData.departmentId = body.unitId;
    }

    // Add user info - userId might be the recipient
    if (body.userId && body.userId.trim() !== "") {
      dispenseRecordData.userId = body.userId;
    }

    // Add dispensary info - currUserId might be the person dispensing
    if (body.currUserId) {
      dispenseRecordData.dispensaryId = body.currUserId;
    }

    console.log("Dispense record data:", dispenseRecordData);

    // Use transaction to ensure both operations succeed or fail together
    const response = await prisma.$transaction(async (tx) => {
      // Update stock
      await tx.supplyStockTrack.update({
        where: { id: body.id },
        data: updateData,
      });

      // Create dispense record - Now with all valid fields
      await tx.supplyDispenseRecord.create({
        data: dispenseRecordData,
      });

      return "OK";
    });

    if (!response) throw new ValidationError("FAILED TO DISPENSE");

    // Return success response with details
    return res.code(200).send({
      success: true,
      message: `Successfully dispensed ${toDispense} pieces`,
      data: {
        dispensedQuantity: toDispense,
        dispensingDetails: {
          fullBoxesGiven: fullBoxesToGive,
          loosePiecesGiven: loosePieces,
        },
        newStockLevels: {
          totalBoxes: totalBoxesAfter,
          totalPieces: remainingPieces,
          fullBoxes: remainingFullBoxes,
          loosePiecesInOpenedBox: openedBoxRemainingPieces,
        },
        previousStockLevels: {
          totalBoxes: currentBoxes,
          totalPieces: currentStockPieces,
        },
        dispenseRecord: {
          departmentId: body.unitId,
          userId: body.userId,
          dispensaryId: body.currUserId,
          remarks: body.remark,
        },
      },
    });
  } catch (error) {
    console.error("Error in dispenseItem:", error);

    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      switch (error.code) {
        case "P2002":
          throw new AppError("DUPLICATE_ENTRY", 409, "Duplicate record");
        case "P2003":
          throw new AppError(
            "FOREIGN_KEY_CONSTRAINT",
            400,
            "Invalid reference",
          );
        case "P2025":
          throw new AppError("RECORD_NOT_FOUND", 404, "Record not found");
        default:
          console.error("Prisma error code:", error.code);
          throw new AppError("DB_ERROR", 500, "Database operation failed");
      }
    }

    if (error instanceof ValidationError) {
      throw error;
    }

    if (error instanceof NotFoundError) {
      throw error;
    }

    if (error instanceof Error) {
      console.error("Error stack:", error.stack);
      if (
        error.message.includes("Insufficient stock") ||
        error.message.includes("Inventory calculation")
      ) {
        throw new ValidationError(error.message);
      }
    }

    throw new AppError("INTERNAL_ERROR", 500, "An unexpected error occurred");
  }
};

/**
 * "Update" a dispense transaction by creating a compensating audit record.
 * The original record is left untouched (sacred history). A new
 * SupplyDispenseRecord is created that captures the delta:
 *   - quantity is signed (e.g. "-20" = return to stock, "+15" = extra deduct)
 *   - recipient = new recipient (or same as original if unchanged)
 *   - desc links back to the original via "ADJ:<originalId>"
 *   - stock is adjusted by the delta (return increases stock, extra decreases)
 */
export const updateSupplyDispense = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const body = req.body as {
    id: string;
    // ── ADJUST mode ──────────────────────────────────────────────────
    // Change the original transaction's quantity (delta hits stock).
    // Optionally also reassign the recipient on the same record.
    quantity?: string;
    userId?: string | null;
    unitId?: string | null;

    // ── TRANSFER mode ────────────────────────────────────────────────
    // Move N units from the original recipient to a new recipient.
    // Splits into TWO compensating records, no stock movement.
    mode?: "adjust" | "transfer";
    transferQuantity?: string;
    toUserId?: string | null;
    toUnitId?: string | null;

    remarks?: string;
    currUserId?: string;
  };

  if (!body.id) throw new ValidationError("Transaction ID is required");

  try {
    const result = await prisma.$transaction(async (tx) => {
      const original = await tx.supplyDispenseRecord.findUnique({
        where: { id: body.id },
        include: {
          supply: {
            select: {
              id: true,
              stock: true,
              quantity: true,
              perQuantity: true,
            },
          },
          user:       { select: { id: true, firstName: true, lastName: true, username: true } },
          unit:       { select: { id: true, name: true } },
        },
      });

      if (!original) throw new NotFoundError("Dispense record not found");
      if (!original.supply || !original.supplyStockTrackId)
        throw new ValidationError(
          "Dispense record has no linked stock — cannot adjust quantity.",
        );
      // Adjustment records (created by previous edits) cannot be re-edited.
      if (original.desc && original.desc.startsWith("ADJ:"))
        throw new ValidationError(
          "This is an adjustment record and cannot be edited.",
        );

      const stock = original.supply;
      const perQ = stock.perQuantity || 1;
      const currentStockPieces = stock.stock;
      const oldQty = parseInt(original.quantity, 10) || 0;
      const parentRef = original.refCode ?? original.id.slice(0, 8);

      // Human-readable label for the original recipient
      const labelRecipient = (
        userId: string | null | undefined,
        unitId: string | null | undefined,
        user?: { firstName?: string | null; lastName?: string | null; username?: string | null } | null,
        unit?: { name?: string | null } | null,
      ): string => {
        if (unitId && unit?.name) return `Unit: ${unit.name}`;
        if (userId && user) {
          const nm = [user.firstName, user.lastName].filter(Boolean).join(" ");
          return nm ? `User: ${nm}` : `User: @${user.username ?? userId}`;
        }
        return "Unassigned";
      };

      const originalRecipientLabel = labelRecipient(
        original.userId,
        original.departmentId,
        original.user,
        original.unit,
      );

      // ────────────────────────────────────────────────────────────────
      // TRANSFER MODE — split N units to a new recipient
      // ────────────────────────────────────────────────────────────────
      if (body.mode === "transfer") {
        const transferQty = parseInt(body.transferQuantity ?? "", 10);
        if (Number.isNaN(transferQty) || transferQty <= 0)
          throw new ValidationError(
            "Transfer quantity must be a positive number.",
          );
        if (transferQty > oldQty)
          throw new ValidationError(
            `Cannot transfer ${transferQty} units — original transaction only has ${oldQty} units.`,
          );

        const newToUserId = body.toUserId || null;
        const newToUnitId = body.toUnitId || null;
        if (!newToUserId && !newToUnitId)
          throw new ValidationError(
            "Specify a destination user or unit for the transfer.",
          );
        if (newToUserId && newToUnitId)
          throw new ValidationError(
            "Pick exactly one destination — either a user OR a unit.",
          );

        // Look up the destination's label for nicer remarks
        let destinationLabel = "";
        if (newToUserId) {
          const u = await tx.user.findUnique({
            where: { id: newToUserId },
            select: { firstName: true, lastName: true, username: true },
          });
          const nm = u ? [u.firstName, u.lastName].filter(Boolean).join(" ") : "";
          destinationLabel = nm
            ? `User: ${nm}`
            : `User: @${u?.username ?? newToUserId}`;
        } else if (newToUnitId) {
          const d = await tx.department.findUnique({
            where: { id: newToUnitId },
            select: { name: true },
          });
          destinationLabel = `Unit: ${d?.name ?? newToUnitId}`;
        }

        // Allocate two ref codes
        const deductRef  = await generateDispenseRef();
        const transferRef = await generateDispenseRef();

        // 1) Deduction from original recipient
        const remarksDeduct =
          `Transferred ${transferQty} units to ${destinationLabel}. ` +
          `Original txn ${parentRef} reduced from ${oldQty} → ${oldQty - transferQty}. ` +
          `See ${transferRef} for the receiving side.`;

        const deduction = await tx.supplyDispenseRecord.create({
          data: {
            refCode: deductRef,
            quantity: `-${transferQty}`,
            suppliesId: original.suppliesId,
            supplyStockTrackId: original.supplyStockTrackId,
            inventoryBoxId: original.inventoryBoxId,
            supplyBatchId: original.supplyBatchId,
            userId: original.userId,            // keep original recipient
            departmentId: original.departmentId,
            dispensaryId: body.currUserId || original.dispensaryId,
            desc: `ADJ:${original.id}`,
            remarks: body.remarks
              ? `${remarksDeduct} | ${body.remarks}`
              : remarksDeduct,
          },
        });

        // 2) Receipt by the new recipient
        const remarksTransfer =
          `Received ${transferQty} units transferred from ${originalRecipientLabel}. ` +
          `Source txn ${parentRef}. See ${deductRef} for the deduction side.`;

        const transferIn = await tx.supplyDispenseRecord.create({
          data: {
            refCode: transferRef,
            quantity: `+${transferQty}`,
            suppliesId: original.suppliesId,
            supplyStockTrackId: original.supplyStockTrackId,
            inventoryBoxId: original.inventoryBoxId,
            supplyBatchId: original.supplyBatchId,
            userId: newToUserId,
            departmentId: newToUnitId,
            dispensaryId: body.currUserId || original.dispensaryId,
            desc: `ADJ:${original.id}`,
            remarks: body.remarks
              ? `${remarksTransfer} | ${body.remarks}`
              : remarksTransfer,
          },
        });

        // NO stock change — items physically just moved between recipients.
        return { mode: "transfer" as const, deduction, transferIn };
      }

      // ────────────────────────────────────────────────────────────────
      // ADJUST MODE (default) — quantity delta and/or recipient reassign
      // ────────────────────────────────────────────────────────────────

      // ── Compute the quantity delta (if quantity was sent) ─────────────
      let delta = 0;
      let quantityChanged = false;

      if (body.quantity !== undefined && body.quantity !== null) {
        const newQty = parseInt(body.quantity, 10);
        if (isNaN(newQty) || newQty < 0)
          throw new ValidationError(
            "Quantity must be a non-negative number",
          );
        delta = newQty - oldQty;
        if (delta !== 0) quantityChanged = true;
      }

      // ── Resolve the new recipient (or keep original) ──────────────────
      let recipientChanged = false;
      let newUserId: string | null = original.userId ?? null;
      let newDepartmentId: string | null = original.departmentId ?? null;

      if (body.userId !== undefined) {
        const v = body.userId || null;
        if (v !== original.userId) {
          newUserId = v;
          newDepartmentId = v ? null : newDepartmentId; // mutually exclusive
          recipientChanged = true;
        }
      }
      if (body.unitId !== undefined) {
        const v = body.unitId || null;
        if (v !== original.departmentId) {
          newDepartmentId = v;
          newUserId = v ? null : newUserId; // mutually exclusive
          recipientChanged = true;
        }
      }

      if (!quantityChanged && !recipientChanged)
        throw new ValidationError("Nothing to update.");

      // ── Apply stock delta (only if quantity changed) ────────────────────
      if (quantityChanged) {
        // delta > 0 → need more pieces from stock
        // delta < 0 → return abs(delta) pieces back to stock
        const newStockPieces = currentStockPieces - delta;

        if (newStockPieces < 0) {
          throw new ValidationError(
            `Insufficient stock to increase dispense. Available: ${currentStockPieces}, additional needed: ${delta}`,
          );
        }

        const newBoxes =
          newStockPieces === 0 ? 0 : Math.ceil(newStockPieces / perQ);

        await tx.supplyStockTrack.update({
          where: { id: stock.id },
          data: { stock: newStockPieces, quantity: newBoxes },
        });
      }

      // ── Build clear, human-readable remarks ────────────────────────────
      const parts: string[] = [];
      if (quantityChanged) {
        if (delta > 0) {
          parts.push(
            `Additional ${delta} unit${delta === 1 ? "" : "s"} dispensed (was ${oldQty}, now ${oldQty + delta}); deducted from stock.`,
          );
        } else {
          parts.push(
            `${Math.abs(delta)} unit${Math.abs(delta) === 1 ? "" : "s"} returned to stock (was ${oldQty}, now ${oldQty + delta}).`,
          );
        }
      }
      if (recipientChanged) {
        // Best-effort label for the new recipient
        let newRecipientLabel = "Unassigned";
        if (newDepartmentId) {
          const d = await tx.department.findUnique({
            where: { id: newDepartmentId },
            select: { name: true },
          });
          newRecipientLabel = `Unit: ${d?.name ?? newDepartmentId}`;
        } else if (newUserId) {
          const u = await tx.user.findUnique({
            where: { id: newUserId },
            select: { firstName: true, lastName: true, username: true },
          });
          const nm = u ? [u.firstName, u.lastName].filter(Boolean).join(" ") : "";
          newRecipientLabel = nm
            ? `User: ${nm}`
            : `User: @${u?.username ?? newUserId}`;
        }
        parts.push(
          `Recipient reassigned: ${originalRecipientLabel} → ${newRecipientLabel}.`,
        );
      }

      const autoRemarks = `Adjustment of txn ${parentRef}: ${parts.join(" ")}`;
      const finalRemarks = body.remarks
        ? `${autoRemarks} | ${body.remarks}`
        : autoRemarks;

      const refCode = await generateDispenseRef();
      const signedQty = quantityChanged
        ? delta > 0
          ? `+${delta}`
          : `${delta}`
        : "0";

      const adjustment = await tx.supplyDispenseRecord.create({
        data: {
          refCode,
          quantity: signedQty,
          suppliesId: original.suppliesId,
          supplyStockTrackId: original.supplyStockTrackId,
          inventoryBoxId: original.inventoryBoxId,
          supplyBatchId: original.supplyBatchId,
          userId: newUserId,
          departmentId: newDepartmentId,
          dispensaryId: body.currUserId || original.dispensaryId,
          desc: `ADJ:${original.id}`,
          remarks: finalRemarks,
        },
      });

      return { mode: "adjust" as const, adjustment };
    });

    return res.code(200).send({ message: "OK", data: result });
  } catch (error) {
    console.error("Error in updateSupplyDispense:", error);
    if (error instanceof ValidationError) throw error;
    if (error instanceof NotFoundError) throw error;
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
    }
    throw error;
  }
};

export const dispenseItem = async (req: FastifyRequest, res: FastifyReply) => {
  const body = req.body as DispenseItemProps;
  console.log("Request body:", body);

  if (!body.id || !body.quantity) {
    throw new ValidationError("Item ID and positive quantity are required");
  }

  try {
    console.log("Log 1 - Starting transaction");

    await prisma.$transaction(async (tx) => {
      // 1. Get the current stock item with all necessary details
      const stockItem = await tx.supplyStockTrack.findUnique({
        where: {
          id: body.id,
        },
        select: {
          id: true,
          stock: true,
          quality: true,
          quantity: true,
          perQuantity: true,
          suppliesId: true,
        },
      });
      console.log("Log 2 - Stock item found:", stockItem?.id);

      if (!stockItem) {
        throw new ValidationError("Supply item not found");
      }

      const currentStock = stockItem.stock || 0;
      const currentQuantity = stockItem.quantity || 0;
      const currentPerQuantity = stockItem.perQuantity || 0;
      const toDispense = parseInt(body.quantity, 10);

      console.log("Log 3 - Current values:", {
        currentStock,
        currentQuantity,
        currentPerQuantity,
        toDispense,
      });

      // Validate we have enough stock
      if (currentStock < toDispense) {
        throw new ValidationError("Insufficient stock available");
      }

      // Calculate the dispensing logic (same algorithm as prescriptionDispense)
      console.log("Log 4 - Starting stock calculation");

      let perQuantityReal: number;
      let perQuantityRemainder: number;

      if (currentPerQuantity > 0) {
        // If we have a perQuantity value, use the same logic as prescriptionDispense
        perQuantityReal =
          toDispense > currentPerQuantity
            ? Math.floor(toDispense / currentPerQuantity)
            : toDispense;

        perQuantityRemainder =
          toDispense >= currentPerQuantity
            ? toDispense % currentPerQuantity
            : currentPerQuantity;
      } else {
        // If perQuantity is 0, we just deduct from quantity directly
        perQuantityReal = toDispense;
        perQuantityRemainder = 0;
      }

      console.log("Log 5 - Calculation results:", {
        perQuantityReal,
        perQuantityRemainder,
      });

      const newQuantity = currentQuantity - perQuantityReal;
      const newPerQuantity = currentPerQuantity - perQuantityRemainder;

      // Ensure no negative values
      const finalQuantity = Math.max(0, newQuantity);
      const finalPerQuantity = Math.max(0, newPerQuantity);

      // Calculate new total stock
      const newTotalStock = finalQuantity * finalPerQuantity;

      console.log("Log 6 - Updated values:", {
        newQuantity: finalQuantity,
        newPerQuantity: finalPerQuantity,
        newTotalStock,
      });

      // 2. Create the dispense record
      console.log("Log 7 - Creating dispense record");
      await tx.supplyDispenseRecord.create({
        data: {
          refCode: await generateDispenseRef(),
          supplyStockTrackId: body.id,
          quantity: toDispense.toString(),
          remarks: body.desc || "",
          userId: body.userId || null,
          departmentId: body.unitId || null,
        },
      });

      // 3. Update the stock by deducting the quantity
      console.log("Log 8 - Updating stock track");
      await tx.supplyStockTrack.update({
        where: {
          id: body.id,
        },
        data: {
          stock: newTotalStock,
          quantity: finalQuantity,
          perQuantity: finalPerQuantity,
        },
      });

      // 4. Create a log entry for tracking
      console.log("Log 9 - Creating system log");
      // await tx.systemLogs.create({
      //   data: {
      //     userId: body.userId || null,
      //     action: "DISPENSE_ITEM",
      //     message: `Dispensed ${toDispense} units of supply item ${stockItem.supplyId}`,
      //     details: JSON.stringify({
      //       stockItemId: body.id,
      //       quantityDispensed: toDispense,
      //       previousStock: currentStock,
      //       newStock: newTotalStock,
      //       remarks: body.desc
      //     }),
      //   },
      // });

      console.log("Log 10 - Transaction completed successfully");
    });

    res.code(200).send({
      success: true,
      message: "Item dispensed successfully",
    });
  } catch (error) {
    console.error("Error in dispenseItem:", error);

    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      // Handle specific Prisma errors
      switch (error.code) {
        case "P2002":
          throw new AppError("DUPLICATE_ENTRY", 409, "Duplicate record");
        case "P2003":
          throw new AppError(
            "FOREIGN_KEY_CONSTRAINT",
            400,
            "Invalid reference",
          );
        case "P2025":
          throw new AppError("RECORD_NOT_FOUND", 404, "Record not found");
        default:
          console.error("Prisma error code:", error.code);
          throw new AppError("DB_ERROR", 500, "Database operation failed");
      }
    }

    if (error instanceof ValidationError) {
      throw error;
    }

    if (error instanceof Error) {
      console.error("Error stack:", error.stack);
    }

    throw new AppError("INTERNAL_ERROR", 500, "An unexpected error occurred");
  }
};

export const supplyList = async (req: FastifyRequest, res: FastifyReply) => {
  const params = req.query as PagingProps;

  if (!params.id) throw new ValidationError("BAD_REQUEST");

  try {
    const take = params.limit ? parseInt(params.limit, 10) : 20;
    const cursor = params.lastCursor ? { id: params.lastCursor } : undefined;

    // Build search filter on Supplies (item name / refNumber)
    const searchFilter: any = {};
    if (params.query) {
      const terms = params.query.trim().split(/\s+/);
      if (terms.length === 1) {
        searchFilter.OR = [
          { item: { contains: terms[0], mode: "insensitive" } },
          { refNumber: { contains: terms[0], mode: "insensitive" } },
        ];
      } else {
        searchFilter.AND = terms.map((term) => ({
          OR: [
            { item: { contains: term, mode: "insensitive" } },
            { refNumber: { contains: term, mode: "insensitive" } },
          ],
        }));
      }
    }

    // Return Supplies rows joined to the list via their stock-tracks.
    const supplies = await prisma.supplies.findMany({
      where: {
        ...searchFilter,
        SupplyStockTrack: {
          some: { supplyBatchId: params.id },
        },
      },
      skip: cursor ? 1 : 0,
      take,
      cursor,
      orderBy: { item: "asc" },
      include: {
        SupplyStockTrack: {
          where: { supplyBatchId: params.id },
          orderBy: { timestamp: "desc" },
          include: {
            brand: {
              select: { brand: true, model: true },
              orderBy: { timestamp: "desc" },
              take: 1,
            },
            // Pulled so the Dispense flow can label each batch with its
            // supplier name (e.g. "Stock: 12 → Supplier 1"). Null when
            // the stock row was created without a supplier reference.
            supplier: { select: { id: true, name: true } },
          },
        },
        SupplyPriceTrack: {
          select: { value: true, timestamp: true },
          orderBy: { timestamp: "desc" },
          take: 1,
        },
      },
    });

    // Attach computed `totalStock` per supply (sum of quantity * perQuantity)
    const list = supplies.map((s) => {
      const tracks = s.SupplyStockTrack ?? [];
      const totalStock = tracks.reduce(
        (sum, t) => sum + (t.quantity ?? 0) * (t.perQuantity || 1),
        0,
      );
      return { ...s, totalStock };
    });

    const newLastCursorId = list.length > 0 ? list[list.length - 1].id : null;
    const hasMore = list.length === take;

    return res.code(200).send({ list, lastCursor: newLastCursorId, hasMore });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DB_CONNECTION_FAILED", 500, "BD_ERROR");
    }
    throw error;
  }
};

export const timebaseSupplyReport = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const params = req.query as PagingProps;
  if (!params.id) throw new ValidationError("BAD_REQUEST");

  try {
    let period: number = 1;
    if (params.period === "Quarterly") period = 4;
    if (params.period === "Semi-Annual") period = 2;
    if (params.period === "Annually") period = 1;

    const cursor = params.lastCursor ? { id: params.lastCursor } : undefined;

    const currentYear = new Date().getFullYear();
    const startOfYear = new Date(currentYear, 0, 1); // Jan 1, current year
    const endOfYear = new Date(currentYear, 11, 31, 23, 59, 59, 999);

    const response = await prisma.supplyStockTrack.findMany({
      where: {
        supplyBatchId: params.id,
        supply: {
          SupplyOrder: {
            some: {
              status: { not: "Drafted" },
            },
          },
        },
      },
      include: {
        price: {
          where: {
            timestamp: {
              gte: startOfYear,
              lt: endOfYear,
            },
          },
          select: {
            value: true,
            timestamp: true,
          },
        },
        supply: {
          select: {
            id: true,
            item: true,
          },
        },
      },
      cursor,
    });

    const groupedPrice: TimebaseGroupPrice[] = [];

    response.forEach((item) => {
      const existed = groupedPrice.find((stock) => stock.item.id === item.id);
      if (!existed) {
        groupedPrice.push({
          item: item,
          price: {
            first: getPriceTotal(item.price, period, 1),
            second: getPriceTotal(item.price, period, 2),
            third: getPriceTotal(item.price, period, 3),
            fourth: getPriceTotal(item.price, period, 4),
          },
        });
      }
    });

    const newLastCursorId =
      groupedPrice.length > 0
        ? groupedPrice[groupedPrice.length - 1].item.id
        : null;
    const hasMore = groupedPrice.length === parseInt(params.limit, 10);

    return res
      .code(200)
      .send({ list: groupedPrice, lastCursor: newLastCursorId, hasMore });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DB_CONNECTION_ERROR", 500, "DB_ERROR");
    }
    throw error;
  }
};

export const categories = async (req: FastifyRequest, res: FastifyReply) => {
  const params = req.query as PagingProps;

  if (!params.id) throw new ValidationError("INVALID REQUIRED ID");
  if (!params.query)
    return res.code(200).send({ list: [], lastCursor: null, hasMore: false });
  try {
    const cursor = params.lastCursor ? { id: params.lastCursor } : undefined;
    const limit = params.limit ? parseInt(params.limit, 10) : 10;

    const response = await prisma.supplyCategory.findMany({
      where: {
        label: {
          contains: params.query,
          mode: "insensitive",
        },
      },
      take: limit,
      skip: cursor ? 1 : 0,
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
      throw new AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
    }
    throw error;
  }
};

export const supplyDispenseTransaction = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const params = req.query as PagingProps & {
    dateFrom?: string;
    dateTo?: string;
  };
  if (!params.id) throw new ValidationError("INVALID REQUIRED ID");
  try {
    const cursor = params.lastCursor ? { id: params.lastCursor } : undefined;
    const limit = params.limit ? parseInt(params.limit, 10) : 20;

    const filter: any = {
      supplyBatchId: params.id,
    };

    // Date range filter on timestamp.
    // dateFrom = inclusive start of day, dateTo = inclusive end of day.
    if (params.dateFrom || params.dateTo) {
      filter.timestamp = {};
      if (params.dateFrom) {
        const start = new Date(params.dateFrom);
        start.setHours(0, 0, 0, 0);
        filter.timestamp.gte = start;
      }
      if (params.dateTo) {
        const end = new Date(params.dateTo);
        end.setHours(23, 59, 59, 999);
        filter.timestamp.lte = end;
      }
    }

    if (params.query) {
      const searchTerms = params.query.trim().split(/\s+/);

      // Create OR conditions for each search term
      filter.OR = searchTerms.map((term) => ({
        OR: [
          // Search in user/dispensary names
          {
            user: {
              OR: [
                {
                  firstName: {
                    contains: term,
                    mode: "insensitive",
                  },
                },
                {
                  lastName: {
                    contains: term,
                    mode: "insensitive",
                  },
                },
              ],
            },
          },
          {
            dispensary: {
              OR: [
                {
                  firstName: {
                    contains: term,
                    mode: "insensitive",
                  },
                },
                {
                  lastName: {
                    contains: term,
                    mode: "insensitive",
                  },
                },
              ],
            },
          },
          // Search in department name
          {
            unit: {
              name: {
                contains: term,
                mode: "insensitive",
              },
            },
          },
          // Search in remarks
          {
            remarks: {
              contains: term,
              mode: "insensitive",
            },
          },
          // Search in quantity (exact match for numbers)
          {
            quantity: {
              equals: term,
            },
          },
          // Search in ID fields (partial match)
          {
            id: {
              contains: term,
              mode: "insensitive",
            },
          },
          // Search in supplyStockTrackId
          {
            supplyStockTrackId: {
              contains: term,
              mode: "insensitive",
            },
          },
          // Search in suppliesId
          {
            suppliesId: {
              contains: term,
              mode: "insensitive",
            },
          },
          // Search in userId
          {
            userId: {
              contains: term,
              mode: "insensitive",
            },
          },
          // Search in departmentId
          {
            departmentId: {
              contains: term,
              mode: "insensitive",
            },
          },
          // Search in inventoryBoxId
          {
            inventoryBoxId: {
              contains: term,
              mode: "insensitive",
            },
          },
        ],
      }));
    }

    const response = await prisma.supplyDispenseRecord.findMany({
      where: filter,
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
          },
        },
        unit: {
          select: {
            name: true,
          },
        },
        dispensary: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
          },
        },
      },
      skip: cursor ? 1 : 0,
      orderBy: {
        timestamp: "desc",
      },
      cursor,
      take: limit,
    });

    const newLastCursorId =
      response.length > 0 ? response[response.length - 1].id : null;
    const hasMore = limit === response.length;

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

export const supplyTimeBaseReport = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const params = req.query as PagingProps;
  console.log({ params });

  if (!params.id) throw new ValidationError("INVALID REQUIRED ID");
  try {
    const currentYear = params.yearRange;
    let years: any[] = [];

    if (typeof currentYear === "string") {
      const trimmed = currentYear.trim();

      if (trimmed.includes("-")) {
        // Handle "2025-2026" format - get the last year (2026)
        const parts = trimmed.split("-");
        // Parse all parts and filter out invalid numbers
        const parsedYears = parts
          .map((part) => parseInt(part.trim(), 10))
          .filter((num) => !isNaN(num));

        if (parsedYears.length > 0) {
          years = parsedYears;
        }
      } else {
        // Handle "2025" format - get that year
        const yearNum = parseInt(trimmed, 10);
        if (!isNaN(yearNum)) {
          years = [yearNum];
        }
      }
    }

    console.log("Range: ", { years });

    const yearStart = years.length > 1 ? years[years.length - 1] : years[0];
    const yearEnd = years[0];

    // If yearStart is still NaN (unlikely with our validation), fallback to current year
    const finalYearStart = !isNaN(yearStart)
      ? yearStart
      : new Date().getFullYear();

    console.log("Selected Year: ", finalYearStart);

    const firstHalfStart = new Date(finalYearStart, 0, 1); // January 1
    const firstHalfEnd = new Date(finalYearStart, 5, 30, 23, 59, 59, 999); // June 30
    const secondHalfStart = new Date(yearEnd, 6, 1); // July 1
    const secondHalfEnd = new Date(yearEnd, 11, 31, 23, 59, 59, 999); // December 31

    console.log({
      firstHalfEnd: firstHalfEnd,
      firstHalfStart: firstHalfStart,
      secondHalfEnd: secondHalfEnd,
      secondHalfStart: secondHalfStart,
    });

    const cursor = params.lastCursor ? { id: params.lastCursor } : undefined;
    const limit = params.limit ? parseInt(params.limit) : 20;

    //console.log(JSON.stringify(supplies, null, 2));

    const response = await prisma.supplies.findMany({
      where: {
        SupplieRecieveHistory: {
          some: {
            supplyBatchId: params.id,
          },
        },
      },
      select: {
        id: true,
        item: true,
        SupplieRecieveHistory: {
          where: {
            supplyBatchId: params.id,
          },
          select: {
            id: true,
            perQuantity: true,
            suppliesId: true,
            pricePerItem: true,
            quantity: true,
            quality: true,
            timestamp: true,
          },
          orderBy: {
            timestamp: "asc",
          },
        },
        supplyDispenseRecords: {
          select: {
            suppliesId: true,
            quantity: true,
            timestamp: true,
          },
        },
        SuppliesDataSet: {
          select: {
            id: true,
            title: true,
          },
        },
        suppliesDataSetId: true,
      },
      skip: cursor ? 1 : 0,
      take: limit,
      cursor,
    });

    console.log({ response });

    const processedData = response.map((item) => {
      console.log("Entry");

      // Calculate individual supply data
      const firstHalfRecieved = item.SupplieRecieveHistory.reduce(
        (base, acc) => {
          if (
            acc.timestamp >= firstHalfStart &&
            acc.timestamp <= firstHalfEnd
          ) {
            console.log("1 R found");

            return (base += acc.quantity);
          }
          return base;
        },
        0,
      );

      const secondhalfRecieved = item.SupplieRecieveHistory.reduce(
        (base, acc) => {
          if (
            acc.timestamp >= secondHalfStart &&
            acc.timestamp <= secondHalfEnd
          ) {
            console.log("2 R found");
            return (base += acc.quantity);
          }
          return base;
        },
        0,
      );

      const firstHalfCost = item.SupplieRecieveHistory.reduce((base, acc) => {
        if (acc.timestamp >= firstHalfStart && acc.timestamp <= firstHalfEnd) {
          console.log("1 C found");

          return (base += acc.pricePerItem);
        }
        return base;
      }, 0);

      const secondhalfCost = item.SupplieRecieveHistory.reduce((base, acc) => {
        if (
          acc.timestamp >= secondHalfStart &&
          acc.timestamp <= secondHalfEnd
        ) {
          return (base += acc.pricePerItem);
        }
        return base;
      }, 0);

      const firstHalfdispense = item.supplyDispenseRecords.reduce(
        (base, acc) => {
          if (
            acc.timestamp >= firstHalfStart &&
            acc.timestamp <= firstHalfEnd
          ) {
            const quantity = parseInt(acc.quantity);
            return (base += quantity);
          }
          return base;
        },
        0,
      );

      const secondHalfDispense = item.supplyDispenseRecords.reduce(
        (base, acc) => {
          if (
            acc.timestamp >= secondHalfStart &&
            acc.timestamp <= secondHalfEnd
          ) {
            const quantity = parseInt(acc.quantity);
            return (base += quantity);
          }
          return base;
        },
        0,
      );
      const totalQuantity = firstHalfRecieved + secondhalfRecieved;
      const totalInsuance = firstHalfdispense + secondHalfDispense;
      const totalBalance = totalQuantity - totalInsuance;

      return {
        id: item.id,
        name: item.item,
        firstHalfRecieved,
        secondhalfRecieved,
        firstHalfCost,
        secondhalfCost,
        firstHalfdispense,
        secondHalfDispense,
        totalQuantity,
        totalInsuance,
        totalBalanceQuantity: totalBalance,
        supplyDataSetId: item.suppliesDataSetId,
      };
    });

    const newLastCursorId =
      processedData.length > 0
        ? processedData[processedData.length - 1].id
        : null;
    const hasMore = limit === processedData.length;
    console.log({ processedData });

    return res
      .code(200)
      .send({ list: processedData, newLastCursorId, hasMore });
  } catch (error) {
    console.error("Error in supplyTimeBaseReport:", error);

    if (error instanceof ValidationError) {
      throw error;
    }

    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      console.error("Prisma error code:", error.code);
      throw new AppError("DB_CONNECTION_ERROR", 500, "Database error occurred");
    }

    if (error instanceof Error) {
      console.error("Error stack:", error.stack);
    }

    throw new AppError("INTERNAL_ERROR", 500, "An unexpected error occurred");
  }
};

export const removeStockInList = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const body = req.query as {
    id: string;
    userId: string;
    listId: string;
    inventoryId: string;
    lineId: string;
  };

  console.log({ body });

  if (
    !body.id ||
    !body.inventoryId ||
    !body.lineId ||
    !body.listId ||
    !body.userId
  ) {
    throw new ValidationError("INVALID_REQUIRED_ID");
  }

  try {
    // First, check if all required related records exist
    const [stock, inventory, supplyBatch, line] = await Promise.all([
      prisma.supplyStockTrack.findUnique({
        where: { id: body.id },
        select: {
          id: true,
          suppliesId: true,
          quantity: true,
          perQuantity: true,
          quality: true,
          // Add relation checks
        },
      }),
      prisma.inventoryBox.findUnique({
        where: { id: body.inventoryId },
        select: { id: true },
      }),
      prisma.supplyBatch.findUnique({
        where: { id: body.listId },
        select: { id: true },
      }),
      prisma.line.findUnique({
        where: { id: body.lineId },
        select: { id: true },
      }),
    ]);

    if (!stock) {
      throw new ValidationError("STOCK_NOT_FOUND");
    }
    if (!inventory) {
      throw new ValidationError("INVENTORY_NOT_FOUND");
    }
    if (!supplyBatch) {
      throw new ValidationError("SUPPLY_BATCH_NOT_FOUND");
    }
    if (!line) {
      throw new ValidationError("LINE_NOT_FOUND");
    }

    // Execute transaction
    const response = await prisma.$transaction(
      async (tx) => {
        // First, check if there are any dependent records that might cause null constraint
        // This depends on your schema - adjust based on actual relations

        // Option 1: If there are dependent records, handle them first
        // Example: Clear or update related records before delete
        // await tx.someRelatedModel.updateMany({
        //   where: { supplyStockTrackId: body.id },
        //   data: { supplyStockTrackId: null } // or another valid value
        // });

        // Option 2: Check if deletion is allowed
        const canDelete = await tx.supplyStockTrack.findUnique({
          where: { id: body.id },
        });

        // Delete the stock record
        const deletedStock = await tx.supplyStockTrack.delete({
          where: {
            id: body.id,
          },
        });

        // Create the transaction record
        const transaction = await tx.supplyTransaction.create({
          data: {
            lineId: body.lineId,
            supplyBatchId: body.listId,
            userId: body.userId,
            suppliesId: stock.suppliesId,
            action: 3, // 0 - add, 1 - update, 3 - remove
            quantity: stock.quantity,
            perQuantity: stock.perQuantity,
            quality: stock.quality || "N/A",
            inventoryBoxId: body.inventoryId,
            // If your schema requires linking to the deleted stock,
            // you might need to store the ID differently or skip it
            // supplyStockTrackId: body.id, // This might cause null constraint if NOT NULL
          },
          select: { id: true },
        });

        return {
          success: true,
          transactionId: transaction.id,
          deletedStockId: deletedStock.id,
        };
      },
      {
        maxWait: 10000,
        timeout: 15000,
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable, // Add isolation level
      },
    );

    if (!response.success) {
      throw new ValidationError("TRANSACTION_FAILED");
    }

    return res.code(200).send({
      message: "OK",
      transactionId: response.transactionId,
      deletedStockId: response.deletedStockId,
    });
  } catch (error) {
    console.error("Error in Remove Item:", error);

    // Handle specific Prisma errors
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      switch (error.code) {
        case "P2011":
          console.error("Null constraint violation:", error.meta);
          throw new AppError(
            "DELETION_CONSTRAINT_VIOLATION",
            400,
            "Cannot delete this record due to database constraints. Please check related records.",
          );
        case "P2025":
          console.error("Record not found for deletion:", error.meta);
          throw new ValidationError("RECORD_NOT_FOUND_FOR_DELETION");
        case "P2028":
          console.error("Transaction timeout occurred");
          throw new AppError(
            "TRANSACTION_TIMEOUT",
            408,
            "Transaction took too long to complete. Please try again.",
          );
        case "P2003":
          console.error("Foreign key constraint failed:", error.meta);
          throw new AppError(
            "FOREIGN_KEY_CONSTRAINT",
            400,
            "Cannot delete due to foreign key constraints.",
          );
        default:
          console.error("Prisma error code:", error.code, error.meta);
          throw new AppError(
            "DB_CONNECTION_ERROR",
            500,
            "Database error occurred",
          );
      }
    }

    if (error instanceof ValidationError) {
      throw error;
    }

    if (error instanceof AppError) {
      throw error;
    }

    console.error(
      "Unexpected error stack:",
      error instanceof Error ? error.stack : error,
    );
    throw new AppError("INTERNAL_ERROR", 500, "An unexpected error occurred");
  }
};

export const supplyTransactionInfo = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const query = req.query as { id: string };
  console.log({ query });

  if (!query.id) {
    throw new ValidationError("INVALID_ID");
  }

  try {
    const transaction = await prisma.supplyDispenseRecord.findUnique({
      where: {
        id: query.id,
      },
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            userProfilePictures: {
              select: {
                file_name: true,
                file_size: true,
                file_url: true,
              },
            },
          },
        },
        unit: {
          select: {
            id: true,
            name: true,
          },
        },
        supply: {
          select: {
            supply: {
              select: {
                item: true,
                refNumber: true,
                code: true,
              },
            },
            stock: true,
          },
        },
        supplyItem: {
          select: {
            item: true,
            id: true,
            code: true,
          },
        },
      },
    });

    if (!transaction) {
      throw new ValidationError("TRANSACTION_NOT_FOUND");
    }

    return res.code(200).send(transaction);
  } catch (error) {
    console.error("Error in supplyTransactionInfo:", error);

    if (error instanceof ValidationError) {
      throw error;
    }

    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      console.error("Prisma error code:", error.code);
      throw new AppError("DB_CONNECTION_ERROR", 500, "Database error occurred");
    }

    if (error instanceof Error) {
      console.error("Error stack:", error.stack);
    }

    throw new AppError("INTERNAL_ERROR", 500, "An unexpected error occurred");
  }
};

export const userSupplyDispenseRecords = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const query = req.query as PagingProps;
  console.log({ query });

  if (!query.id) {
    throw new ValidationError("INVALID_USER_ID");
  }

  try {
    const cursor = query.lastCursor ? { id: query.lastCursor } : undefined;
    const limit = query.limit ? parseInt(query.limit, 10) : 20;

    const records = await prisma.supplyDispenseRecord.findMany({
      where: {
        userId: query.id,
      },
      include: {
        supply: {
          select: {
            supply: {
              select: {
                item: true,
                refNumber: true,
                code: true,
              },
            },
            stock: true,
          },
        },
        dispensary: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
          },
        },
      },
      skip: cursor ? 1 : 0,
      take: limit,
      cursor,
    });
    console.log({ records });
    const newLastCursorId =
      records.length > 0 ? records[records.length - 1].id : null;
    const hasMore = records.length === limit;

    return res
      .code(200)
      .send({ list: records, lastCursor: newLastCursorId, hasMore });
  } catch (error) {
    console.error("Error in userSupplyDispenseRecords:", error);

    if (error instanceof ValidationError) {
      throw error;
    }

    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      console.error("Prisma error code:", error.code);
      throw new AppError("DB_CONNECTION_ERROR", 500, "Database error occurred");
    }

    if (error instanceof Error) {
      console.error("Error stack:", error.stack);
    }

    throw new AppError("INTERNAL_ERROR", 500, "An unexpected error occurred");
  }
};

export const unitSupplyDispenseRecords = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const query = req.query as PagingProps;
  console.log("Unit: ", { query });
  if (!query.id) {
    throw new ValidationError("INVALID_UNIT_ID");
  }
  try {
    const cursor = query.lastCursor ? { id: query.lastCursor } : undefined;
    const limit = query.limit ? parseInt(query.limit, 10) : 20;
    const records = await prisma.supplyDispenseRecord.findMany({
      where: {
        departmentId: query.id,
      },
      include: {
        dispensary: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
          },
        },
        supply: {
          select: {
            supply: {
              select: {
                item: true,
                refNumber: true,
                code: true,
              },
            },
            stock: true,
          },
        },
        supplyItem: {
          select: {
            item: true,
            id: true,
          },
        },
      },
      skip: cursor ? 1 : 0,
      take: limit,
      cursor,
    });
    const newLastCursorId =
      records.length > 0 ? records[records.length - 1].id : null;
    const hasMore = records.length === limit;
    return res
      .code(200)
      .send({ list: records, lastCursor: newLastCursorId, hasMore });
  } catch (error) {
    console.error("Error in unitSupplyDispenseRecords:", error);

    if (error instanceof ValidationError) {
      throw error;
    }

    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      console.error("Prisma error code:", error.code);
      throw new AppError("DB_CONNECTION_ERROR", 500, "Database error occurred");
    }

    if (error instanceof Error) {
      console.error("Error stack:", error.stack);
    }

    throw new AppError("INTERNAL_ERROR", 500, "An unexpected error occurred");
  }
};

/**
 * Quarterly stock + dispense report.
 *
 * Behaviour:
 * - When `quarter` is a valid number (1-4): each item is returned as a
 *   per-quarter object whose populated field is the requested quarter only;
 *   dispense records are filtered to that quarter's date range.
 * - Otherwise: returns every item with all four quarters (q1..q4) computed,
 *   plus a full list of the dispense records for the year.
 */
/**
 * Inventory issuance report.
 *
 * Returns each stock-track row with up to the first 5 issuance (dispense)
 * records of the chosen year (optionally narrowed to a single quarter) laid
 * out as `first`, `second`, `third`, `fourth`, `fifth`. Records beyond the
 * 5th are still counted into `totalDispensed` so the balance math stays
 * correct.
 *
 * Query params:
 *   - id      (required) supplyBatchId
 *   - year    (optional, defaults to current year) — 4-digit issuance year
 *   - quarter (optional, 1..4) — narrows the issuance pool to that quarter
 *   - lastCursor / limit — standard cursor paging
 */
export const timebaseReport = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const params = req.query as PagingProps & {
    year?: string | number;
    quarter?: string | number;
  };

  if (!params.id) {
    throw new ValidationError("INVALID REQUIRED FIELD");
  }

  try {
    const cursor = params.lastCursor ? { id: params.lastCursor } : undefined;
    const limit = params.limit ? parseInt(params.limit, 10) : 20;

    // ── Year (defaults to current) ─────────────────────────────────────────
    const yearNum =
      typeof params.year === "number"
        ? params.year
        : typeof params.year === "string" && /^\d{4}$/.test(params.year.trim())
          ? parseInt(params.year.trim(), 10)
          : new Date().getFullYear();

    // ── Quarter (optional, 1..4) ───────────────────────────────────────────
    const quarterRaw =
      typeof params.quarter === "number"
        ? params.quarter
        : typeof params.quarter === "string" && params.quarter.trim() !== ""
          ? parseInt(params.quarter, 10)
          : NaN;
    const quarter =
      Number.isFinite(quarterRaw) && quarterRaw >= 1 && quarterRaw <= 4
        ? (quarterRaw as 1 | 2 | 3 | 4)
        : null;

    // ── Date range — full year, or just the requested quarter ─────────────
    const quarterRanges: Record<1 | 2 | 3 | 4, { start: Date; end: Date }> = {
      1: {
        start: new Date(yearNum, 0, 1),
        end: new Date(yearNum, 2, 31, 23, 59, 59, 999),
      },
      2: {
        start: new Date(yearNum, 3, 1),
        end: new Date(yearNum, 5, 30, 23, 59, 59, 999),
      },
      3: {
        start: new Date(yearNum, 6, 1),
        end: new Date(yearNum, 8, 30, 23, 59, 59, 999),
      },
      4: {
        start: new Date(yearNum, 9, 1),
        end: new Date(yearNum, 11, 31, 23, 59, 59, 999),
      },
    };
    const rangeStart = quarter
      ? quarterRanges[quarter].start
      : new Date(yearNum, 0, 1);
    const rangeEnd = quarter
      ? quarterRanges[quarter].end
      : new Date(yearNum, 11, 31, 23, 59, 59, 999);

    const response = await prisma.supplyStockTrack.findMany({
      where: { supplyBatchId: params.id },
      skip: cursor ? 1 : 0,
      take: limit,
      cursor,
      orderBy: { timestamp: "desc" },
      select: {
        SupplyDispenseRecord: {
          where: { timestamp: { gte: rangeStart, lte: rangeEnd } },
          select: { quantity: true, timestamp: true },
          orderBy: { timestamp: "asc" }, // chronological → first = earliest
        },
        supply: {
          select: {
            item: true,
            SupplieRecieveHistory: {
              // Initial QTY scoped to THIS list + the selected year/quarter
              where: {
                supplyBatchId: params.id,
                timestamp: { gte: rangeStart, lte: rangeEnd },
              },
              select: {
                quality: true,
                perQuantity: true,
                pricePerItem: true,
                quantity: true,
                timestamp: true,
              },
              orderBy: { timestamp: "desc" },
            },
          },
        },
        price: {
          // Price fallback also scoped to the selected year/quarter
          where: { timestamp: { gte: rangeStart, lte: rangeEnd } },
          select: { value: true, timestamp: true },
          orderBy: { timestamp: "desc" },
          take: 1,
        },
        stock: true,
        perQuantity: true,
        quantity: true,
        quality: true,
        id: true,
      },
    });

    const parseQty = (q: string | null | undefined) =>
      q ? parseInt(q, 10) || 0 : 0;
    const slot = (records: { quantity: string }[], index: number) =>
      records[index]?.quantity ? parseQty(records[index].quantity) : null;

    const processedData = response.map((item) => {
      const records = item.SupplyDispenseRecord;
      // Scope received qty to THIS batch (segmented by unit/quality + per-qty).
      // Receive history is fetched per supply+list, but a supply can have
      // several batches in one list — without this filter every batch row would
      // show the supply's combined receive total.
      const receiveHistory = (item.supply?.SupplieRecieveHistory ?? []).filter(
        (r) =>
          (r.quality ?? null) === (item.quality ?? null) &&
          (r.perQuantity || 0) === (item.perQuantity || 0),
      );

      // ── Initial QTY = Σ (receive.quantity × receive.perQuantity) ─────────
      const totalStock = receiveHistory.reduce(
        (sum, r) => sum + (r.quantity ?? 0) * (r.perQuantity || 1),
        0,
      );

      // Unit cost: latest pricePerItem from receive history, falling back to
      // SupplyPriceTrack, then 0.
      const latestPrice =
        receiveHistory[0]?.pricePerItem ?? item.price?.[0]?.value ?? 0;

      const totalDispensed = records.reduce(
        (sum, r) => sum + parseQty(r.quantity),
        0,
      );
      const remaining = totalStock - totalDispensed;

      return {
        id: item.id,
        desc: item.supply?.item ?? "N/A",
        unit: receiveHistory[0]?.quality ?? item.quality ?? "N/A",
        first: slot(records, 0),
        second: slot(records, 1),
        third: slot(records, 2),
        fourth: slot(records, 3),
        fifth: slot(records, 4),
        recordedIssuances: records.length,
        totalDispensed,
        qty: totalStock,                       // initial QTY
        unitCost: latestPrice,                 // per-unit price
        totalCost: totalStock * latestPrice,   // qty × unit cost
        balStock: remaining,                   // remaining stock on hand
        balAmount: remaining * latestPrice,    // balance × unit cost
        // legacy aliases (kept so any older consumer doesn't break)
        totalStock,
        price: latestPrice,
      };
    });

    const newLastCursorId =
      processedData.length > 0
        ? processedData[processedData.length - 1].id
        : null;
    const hasMore = processedData.length === limit;

    return res.code(200).send({
      list: processedData,
      lastCursor: newLastCursorId,
      hasMore,
      meta: { year: yearNum, quarter: quarter ?? null },
    });
  } catch (error) {
    console.error("Error in timebaseReport:", error);

    if (error instanceof ValidationError) throw error;
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      console.error("Prisma error code:", error.code);
      throw new AppError("DB_CONNECTION_ERROR", 500, "Database error occurred");
    }
    if (error instanceof Error) {
      console.error("Error stack:", error.stack);
    }

    throw new AppError("INTERNAL_ERROR", 500, "An unexpected error occurred");
  }
};

/**
 * Excel export of the inventory issuance report.
 * Renders the SUPPLIES YYYY workbook layout: letterhead → "As of …" →
 * merged "ISSUANCE YYYY" header spanning 1ST..5TH → data rows → TOTAL →
 * Certified Correct block.
 */
export const timebaseReportExport = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const params = req.query as {
    id?: string;
    year?: string | number;
    quarter?: string | number;
    listTitle?: string;
    certifiedBy?: string;
    certifiedTitle?: string;
  };

  if (!params.id) throw new ValidationError("INVALID REQUIRED FIELD");

  try {
    const yearNum =
      typeof params.year === "number"
        ? params.year
        : typeof params.year === "string" && /^\d{4}$/.test(params.year.trim())
          ? parseInt(params.year.trim(), 10)
          : new Date().getFullYear();

    const quarterRaw =
      typeof params.quarter === "number"
        ? params.quarter
        : typeof params.quarter === "string" && params.quarter.trim() !== ""
          ? parseInt(params.quarter, 10)
          : NaN;
    const quarter =
      Number.isFinite(quarterRaw) && quarterRaw >= 1 && quarterRaw <= 4
        ? (quarterRaw as 1 | 2 | 3 | 4)
        : null;

    const quarterRanges: Record<1 | 2 | 3 | 4, { start: Date; end: Date }> = {
      1: {
        start: new Date(yearNum, 0, 1),
        end: new Date(yearNum, 2, 31, 23, 59, 59, 999),
      },
      2: {
        start: new Date(yearNum, 3, 1),
        end: new Date(yearNum, 5, 30, 23, 59, 59, 999),
      },
      3: {
        start: new Date(yearNum, 6, 1),
        end: new Date(yearNum, 8, 30, 23, 59, 59, 999),
      },
      4: {
        start: new Date(yearNum, 9, 1),
        end: new Date(yearNum, 11, 31, 23, 59, 59, 999),
      },
    };
    const rangeStart = quarter
      ? quarterRanges[quarter].start
      : new Date(yearNum, 0, 1);
    const rangeEnd = quarter
      ? quarterRanges[quarter].end
      : new Date(yearNum, 11, 31, 23, 59, 59, 999);

    const rows = await prisma.supplyStockTrack.findMany({
      where: { supplyBatchId: params.id },
      orderBy: { timestamp: "desc" },
      select: {
        SupplyDispenseRecord: {
          where: { timestamp: { gte: rangeStart, lte: rangeEnd } },
          select: { quantity: true, timestamp: true },
          orderBy: { timestamp: "asc" },
        },
        supply: {
          select: {
            item: true,
            SupplieRecieveHistory: {
              // Scoped to THIS list + the selected year/quarter range
              where: {
                supplyBatchId: params.id,
                timestamp: { gte: rangeStart, lte: rangeEnd },
              },
              select: {
                quantity: true,
                perQuantity: true,
                pricePerItem: true,
                quality: true,
                timestamp: true,
              },
              orderBy: { timestamp: "desc" },
            },
          },
        },
        price: {
          // Price fallback also scoped to the selected year/quarter
          where: { timestamp: { gte: rangeStart, lte: rangeEnd } },
          select: { value: true, timestamp: true },
          orderBy: { timestamp: "desc" },
          take: 1,
        },
        stock: true,
        perQuantity: true,
        quantity: true,
        quality: true,
        id: true,
      },
    });

    const parseQty = (q: string | null | undefined) =>
      q ? parseInt(q, 10) || 0 : 0;

    const items = rows.map((item) => {
      const records = item.SupplyDispenseRecord;
      // Scope received qty to THIS batch (unit/quality + per-qty), matching the
      // on-screen report.
      const receiveHistory = (item.supply?.SupplieRecieveHistory ?? []).filter(
        (r) =>
          (r.quality ?? null) === (item.quality ?? null) &&
          (r.perQuantity || 0) === (item.perQuantity || 0),
      );

      // Initial QTY = Σ (receive.quantity × receive.perQuantity)
      const totalStock = receiveHistory.reduce(
        (sum, r) => sum + (r.quantity ?? 0) * (r.perQuantity || 1),
        0,
      );
      // Unit cost: latest pricePerItem from receive history → fallback to
      // SupplyPriceTrack → 0.
      const unitCost =
        receiveHistory[0]?.pricePerItem ?? item.price?.[0]?.value ?? 0;

      const totalDispensed = records.reduce(
        (s, r) => s + parseQty(r.quantity),
        0,
      );
      const balStock = totalStock - totalDispensed;
      return {
        desc: item.supply?.item ?? "N/A",
        unit: receiveHistory[0]?.quality ?? item.quality ?? "",
        first: records[0]?.quantity ? parseQty(records[0].quantity) : null,
        second: records[1]?.quantity ? parseQty(records[1].quantity) : null,
        third: records[2]?.quantity ? parseQty(records[2].quantity) : null,
        fourth: records[3]?.quantity ? parseQty(records[3].quantity) : null,
        fifth: records[4]?.quantity ? parseQty(records[4].quantity) : null,
        qty: totalStock,
        unitCost,
        totalCost: totalStock * unitCost,
        balStock,
        balAmount: balStock * unitCost,
      };
    });

    // Workbook layout matches the supplied SUPPLIES YYYY template exactly:
    //   Columns A..M: Item No. | DESCRIPTION | UNIT | QTY | UNIT COST |
    //   TOTAL COST | 1ST | 2ND | 3RD | 4TH | 5TH | Balance On Stock | Total Amount
    //   Header group "ISSUANCE {YEAR}" spans D9:M9.
    const wb = new ExcelJS.Workbook();
    wb.creator = "GMITP";
    wb.created = new Date();
    const ws = wb.addWorksheet(`Supplies ${yearNum}`, {
      views: [{ state: "frozen", ySplit: 10 }],
    });

    ws.columns = [
      { width: 7 },    // A Item No.
      { width: 41.8 }, // B DESCRIPTION
      { width: 10.5 }, // C UNIT
      { width: 12 },   // D QTY
      { width: 12 },   // E UNIT COST
      { width: 12 },   // F TOTAL COST
      { width: 10 },   // G 1ST
      { width: 10 },   // H 2ND
      { width: 10 },   // I 3RD
      { width: 10 },   // J 4TH
      { width: 10 },   // K 5TH
      { width: 14 },   // L Balance On Stock
      { width: 14 },   // M Total Amount
    ];

    // ── Letterhead (rows 1, 2, 3, blank 4, title 5, blank 6, "As of" 7) ──
    const letterhead: { row: number; text: string; bold: boolean; size: number }[] = [
      { row: 1, text: "Republic of the Philippines",    bold: false, size: 11 },
      { row: 2, text: "Province of Marinduque",         bold: false, size: 11 },
      { row: 3, text: "MUNICIPALITY OF GASAN",          bold: true,  size: 11 },
      { row: 5, text: "SUPPLIES & EQUIPMENT INVENTORY", bold: true,  size: 14 },
    ];
    letterhead.forEach(({ row, text, bold, size }) => {
      const r = ws.getRow(row);
      r.getCell(1).value = text;
      ws.mergeCells(row, 1, row, 13);
      r.alignment = { horizontal: "center", vertical: "middle" };
      r.font = { name: "Arial", bold, size };
    });

    const monthName = new Date(yearNum, new Date().getMonth(), 1)
      .toLocaleString("en-US", { month: "long" })
      .toUpperCase();
    const asOf = quarter
      ? `As of Q${quarter} ${yearNum}`
      : `As of ${monthName} ${yearNum}`;
    ws.getRow(7).getCell(1).value = asOf;
    ws.mergeCells(7, 1, 7, 13);
    ws.getRow(7).alignment = { horizontal: "center" };
    ws.getRow(7).font = { name: "Arial", italic: true, size: 11 };

    // ── Table headers in rows 9-10 ───────────────────────────────────────
    const headerTopRow = 9;
    const headerSubRow = 10;

    // Row 9 top headers (parent labels)
    ws.getRow(headerTopRow).values = [
      "Item No.",          // A
      "DESCRIPTION",       // B
      "UNIT",              // C
      `ISSUANCE ${yearNum}`, // D — merged across D9:M9
      null, null, null, null, null, null, null, null, null,
    ];
    // Row 10 sub-headers
    ws.getRow(headerSubRow).values = [
      null, null, null,
      "QTY",         // D
      "UNIT COST",   // E
      "TOTAL COST",  // F
      "1ST",         // G
      "2ND",         // H
      "3RD",         // I
      "4TH",         // J
      "5TH",         // K
      "Balance On Stock", // L
      "Total Amount",     // M
    ];

    // Merges
    ws.mergeCells(headerTopRow, 1, headerSubRow, 1);  // A9:A10 Item No.
    ws.mergeCells(headerTopRow, 2, headerSubRow, 2);  // B9:B10 DESCRIPTION
    ws.mergeCells(headerTopRow, 3, headerSubRow, 3);  // C9:C10 UNIT
    ws.mergeCells(headerTopRow, 4, headerTopRow, 13); // D9:M9  ISSUANCE YYYY

    const styleHeader = (rowIdx: number) => {
      const row = ws.getRow(rowIdx);
      row.font = { bold: true, size: 10 };
      row.alignment = {
        horizontal: "center",
        vertical: "middle",
        wrapText: true,
      };
      row.height = 22;
      row.eachCell({ includeEmpty: true }, (cell) => {
        cell.border = {
          top: { style: "thin" },
          left: { style: "thin" },
          right: { style: "thin" },
          bottom: { style: "thin" },
        };
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FFF2F2F2" },
        };
      });
    };
    styleHeader(headerTopRow);
    styleHeader(headerSubRow);

    // ── Data rows starting at row 11, columns matching template A..M ─────
    const dataStartRow = headerSubRow + 1;
    items.forEach((it, i) => {
      const rowIdx = dataStartRow + i;
      const r = ws.getRow(rowIdx);
      r.values = [
        i + 1,        // A Item No.
        it.desc,      // B DESCRIPTION
        it.unit,      // C UNIT
        it.qty,       // D QTY
        it.unitCost,  // E UNIT COST
        // F TOTAL COST as a live D*E formula (matches the original template)
        { formula: `D${rowIdx}*E${rowIdx}`, result: it.totalCost },
        it.first  ?? "", // G 1ST
        it.second ?? "", // H 2ND
        it.third  ?? "", // I 3RD
        it.fourth ?? "", // J 4TH
        it.fifth  ?? "", // K 5TH
        it.balStock,     // L Balance On Stock
        it.balAmount,    // M Total Amount
      ];
      r.font = { name: "Arial", size: 10 };
      r.alignment = { vertical: "middle" };
      r.getCell(1).alignment = { horizontal: "center", vertical: "middle" };
      r.getCell(2).alignment = { horizontal: "left",   vertical: "middle", wrapText: true };
      r.getCell(3).alignment = { horizontal: "center", vertical: "middle" };
      r.getCell(4).alignment = { horizontal: "center", vertical: "middle" }; // QTY
      // Currency cells: E UNIT COST, F TOTAL COST, M Total Amount
      [5, 6, 13].forEach((c) => {
        r.getCell(c).numFmt = '"₱"#,##0.00';
        r.getCell(c).alignment = { horizontal: "right", vertical: "middle" };
      });
      // Issuance slots G..K — centered
      for (let c = 7; c <= 11; c++) {
        r.getCell(c).alignment = { horizontal: "center", vertical: "middle" };
      }
      r.getCell(12).alignment = { horizontal: "center", vertical: "middle" };
      r.eachCell({ includeEmpty: true }, (cell) => {
        cell.border = {
          top: { style: "thin" },
          left: { style: "thin" },
          right: { style: "thin" },
          bottom: { style: "thin" },
        };
      });
    });

    // ── TOTAL row ────────────────────────────────────────────────────────
    const totalRowIdx = dataStartRow + items.length;
    const totalRow = ws.getRow(totalRowIdx);
    const totalQty    = items.reduce((s, x) => s + x.qty, 0);
    const totalCost   = items.reduce((s, x) => s + x.totalCost, 0);
    const totalAmount = items.reduce((s, x) => s + x.balAmount, 0);
    totalRow.values = [
      null,        // A
      "TOTAL",     // B (merged label across A:C)
      null,        // C
      totalQty,    // D
      null,        // E
      totalCost,   // F
      null, null, null, null, null, // G..K issuance slots
      null,        // L Balance On Stock (blank — sum doesn't make sense across mixed units)
      totalAmount, // M Total Amount
    ];
    ws.mergeCells(totalRowIdx, 1, totalRowIdx, 3); // "TOTAL" label spans A:C

    totalRow.font = { name: "Arial", bold: true, size: 10 };
    totalRow.getCell(2).alignment = { horizontal: "right",  vertical: "middle" };
    totalRow.getCell(4).alignment = { horizontal: "center", vertical: "middle" };
    [5, 6, 13].forEach((c) => {
      totalRow.getCell(c).numFmt = '"₱"#,##0.00';
      totalRow.getCell(c).alignment = { horizontal: "right", vertical: "middle" };
    });
    totalRow.eachCell({ includeEmpty: true }, (cell) => {
      cell.border = {
        top:    { style: "double" }, left:   { style: "thin" },
        right:  { style: "thin"   }, bottom: { style: "double" },
      };
      cell.fill = {
        type: "pattern", pattern: "solid",
        fgColor: { argb: "FFFAFAFA" },
      };
    });

    const certByRow = totalRowIdx + 3;
    ws.getRow(certByRow).getCell(2).value = "Certified Correct:";
    ws.getRow(certByRow).getCell(2).font = { italic: true, size: 10 };

    const signerRow = certByRow + 3;
    ws.getRow(signerRow).getCell(2).value =
      params.certifiedBy ?? "MICHELLE CHRISTINE Z. ILAO";
    ws.getRow(signerRow).getCell(2).font = { bold: true, size: 10 };

    const titleRow = signerRow + 1;
    ws.getRow(titleRow).getCell(2).value =
      params.certifiedTitle ?? "Administrative Officer I (SO I)";
    ws.getRow(titleRow).getCell(2).font = { italic: true, size: 9 };

    const buffer = (await wb.xlsx.writeBuffer()) as ArrayBuffer;
    const nodeBuffer = Buffer.from(new Uint8Array(buffer));

    const filenameSafe = (
      params.listTitle ?? `SUPPLIES_${yearNum}${quarter ? `_Q${quarter}` : ""}`
    ).replace(/[^a-z0-9_\-]+/gi, "_");

    return res
      .code(200)
      .header(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      )
      .header(
        "Content-Disposition",
        `attachment; filename="${filenameSafe}.xlsx"`,
      )
      .send(nodeBuffer);
  } catch (error) {
    console.error("Error in timebaseReportExport:", error);
    if (error instanceof ValidationError) throw error;
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DB_CONNECTION_ERROR", 500, "Database error occurred");
    }
    throw new AppError("INTERNAL_ERROR", 500, "An unexpected error occurred");
  }
};

export const uploadBulkExcel = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const isMultipart = req.isMultipart();
  if (!isMultipart) {
    throw new ValidationError("INVALID MULTI-PART");
  }

  try {
    const parts = req.parts();
    let fileBuffer: Buffer | null = null;
    const formData: Record<string, string> = {};

    for await (const part of parts) {
      if (part.type === "file") {
        const buffers: Buffer[] = [];
        for await (const chunk of part.file) buffers.push(chunk as Buffer);
        fileBuffer = Buffer.concat(buffers);
      } else {
        formData[part.fieldname] = part.value as string;
      }
    }

    if (!formData.lineId) {
      throw new ValidationError("INVALID REQUIRED FIELD: lineId");
    }
    if (!formData.dataSetId) {
      throw new ValidationError("INVALID REQUIRED FIELD: dataSetId");
    }
    if (!fileBuffer) {
      throw new ValidationError("INVALID FILE");
    }

    const workbook = new ExcelJS.Workbook();
    const stream = Readable.from(fileBuffer);
    await workbook.xlsx.read(stream);

    const itemsToInsert: string[] = [];
    workbook.eachSheet((sheet) => {
      sheet.eachRow((row) => {
        const value = row.getCell(1).value;
        if (value && value.toString().trim()) {
          itemsToInsert.push(value.toString());
        }
      });
    });

    if (itemsToInsert.length === 0) {
      throw new ValidationError("No valid data found in Excel file");
    }

    const BATCH_SIZE = 50;
    const existingItems = new Set<string>();

    for (let i = 0; i < itemsToInsert.length; i += BATCH_SIZE) {
      const batch = itemsToInsert.slice(i, i + BATCH_SIZE);
      const existingBatch = await prisma.supplies.findMany({
        where: {
          item: { in: batch },
          suppliesDataSetId: formData.dataSetId,
          lineId: formData.lineId,
        },
        select: { item: true },
      });
      existingBatch.forEach((item) => existingItems.add(item.item));
    }

    const newItems = itemsToInsert.filter((item) => !existingItems.has(item));

    if (newItems.length === 0) {
      return res.status(200).send({
        message: "All items already exist. No new items to insert.",
        totalChecked: itemsToInsert.length,
        existingCount: existingItems.size,
        insertedCount: 0,
      });
    }

    const suppliesData: Array<{
      item: string;
      code: number;
      suppliesDataSetId: string;
      lineId: string;
      consumable: boolean;
      description: string;
    }> = [];
    for (const item of newItems) {
      const code = await generatedItemCode();
      suppliesData.push({
        item,
        code,
        suppliesDataSetId: formData.dataSetId,
        lineId: formData.lineId,
        consumable: false,
        description: "",
      });
    }

    let insertedCount = 0;
    for (let i = 0; i < suppliesData.length; i += BATCH_SIZE) {
      const batch = suppliesData.slice(i, i + BATCH_SIZE);
      try {
        const result = await prisma.supplies.createMany({
          data: batch,
          skipDuplicates: true,
        });
        insertedCount += result.count;
      } catch (error) {
        console.error(`Error inserting batch ${i / BATCH_SIZE + 1}:`, error);
        throw new AppError(
          "BATCH_INSERT_ERROR",
          500,
          `Failed to insert batch ${i / BATCH_SIZE + 1}`,
        );
      }
    }

    return res.status(200).send({
      message: "Bulk upload completed",
      totalChecked: itemsToInsert.length,
      existingCount: existingItems.size,
      insertedCount,
      skippedCount: itemsToInsert.length - insertedCount,
    });
  } catch (error) {
    if (error instanceof ValidationError) throw error;
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      console.error("Prisma error code:", error.code);
      throw new AppError("DB_CONNECTION_ERROR", 500, "Database error occurred");
    }
    if (error instanceof Error) {
      console.error("Error stack:", error.stack);
    }
    throw new AppError("INTERNAL_ERROR", 500, "An unexpected error occurred");
  }
};

// POST /supply/restock
// DIRECT re-stock: add stock to a supply inside a container/list WITHOUT going
// through the order process (no SupplyOrder / purchase-request workflow). It
// mirrors the stock-writing half of the order fulfillment (saveItemOrder) so
// the order/transaction system stays fully intact for those who still need it.
export const restockSupply = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const body = req.body as {
    suppliesId?: string;
    inventoryBoxId?: string;
    listId?: string; // SupplyBatch id
    quantity?: number | string;
    perQuantity?: number | string;
    quality?: string | null;
    supplier?: string | null; // supplier id OR free-text name
    price?: number | string | null;
    expiration?: string | null;
    brand?: string | null; // comma-separated
    lineId?: string;
    userId?: string;
    // The container dataset the item belongs to (datasets are per-container, and
    // a list isn't pinned to one). Required when creating a new item.
    datasetId?: string;
    // Idempotency key for offline desktop restocks: a retried push with the same
    // clientOpId is detected and skipped so stock is never applied twice.
    clientOpId?: string;
    // When creating a brand-new item, pass newItem to create the supply in the
    // chosen dataset and stock it in one shot — still no order process.
    newItem?: {
      item?: string;
      description?: string | null;
      consumable?: boolean;
    } | null;
  };

  if (
    (!body.suppliesId && !body.newItem?.item?.trim()) ||
    !body.inventoryBoxId ||
    !body.listId ||
    !body.quantity
  ) {
    throw new ValidationError(
      "An existing item (suppliesId) or a new item name, plus inventoryBoxId, listId and quantity, are required",
    );
  }

  const quantity = parseInt(String(body.quantity), 10);
  if (Number.isNaN(quantity) || quantity < 1) {
    throw new ValidationError("Quantity must be a positive number");
  }
  const perQuantity = body.perQuantity
    ? parseInt(String(body.perQuantity), 10) || 1
    : 1;
  const priceValue = body.price ? Math.round(parseFloat(String(body.price))) || 0 : 0;
  const addedStock = quantity * perQuantity;
  const brands = body.brand
    ? String(body.brand)
        .split(",")
        .map((b) => b.trim())
        .filter((b) => b.length > 0)
    : [];

  // Offline desktop restocks carry a stable clientOpId so a retried push is
  // idempotent — if we've already recorded this op, return OK without applying
  // it again (this mirrors the dispense flow's clientOpId dedup).
  const clientOpId = body.clientOpId?.trim() || undefined;

  try {
    if (clientOpId) {
      const existing = await prisma.supplieRecieveHistory.findUnique({
        where: { clientOpId },
        select: { id: true },
      });
      if (existing) {
        return res
          .code(200)
          .send({ message: "OK", duplicate: true });
      }
    }

    await prisma.$transaction(async (tx) => {
      // Resolve (or create) the supply item.
      let supply;
      let suppliesId: string;
      if (body.suppliesId) {
        supply = await tx.supplies.findUnique({
          where: { id: body.suppliesId },
        });
        if (!supply) throw new NotFoundError("Supply not found");
        suppliesId = supply.id;
      } else {
        // New item — create it in the chosen container dataset, then stock it.
        if (!body.datasetId) {
          throw new ValidationError(
            "Pick a dataset for the new item before adding it.",
          );
        }
        if (!body.lineId) {
          throw new ValidationError("lineId is required to create a new item");
        }
        const code = await generatedItemCode();
        supply = await tx.supplies.create({
          data: {
            item: body.newItem!.item!.trim(),
            description: body.newItem?.description ?? null,
            consumable: !!body.newItem?.consumable,
            suppliesDataSetId: body.datasetId,
            lineId: body.lineId,
            code,
          },
        });
        suppliesId = supply.id;
        if (body.userId) {
          await tx.inventoryAccessLogs.create({
            data: {
              userId: body.userId,
              inventoryBoxId: body.inventoryBoxId,
              action: `Added Supply (direct): ${supply.item}`,
              timestamp: new Date(),
            },
          });
        }
      }

      // Resolve supplier — accept an id, a known name, or create a new one.
      // Supplier.name is GLOBALLY unique, so reuse any existing match by name
      // (regardless of line) before creating, to avoid a unique violation.
      let supplierId: string | undefined;
      if (body.supplier && body.supplier.trim()) {
        const raw = body.supplier.trim();
        const byId = await tx.supplier.findUnique({ where: { id: raw } });
        if (byId) {
          supplierId = byId.id;
        } else {
          const byName = await tx.supplier.findFirst({
            where: { name: { equals: raw, mode: "insensitive" } },
          });
          if (byName) supplierId = byName.id;
          else if (body.lineId) {
            const created = await tx.supplier.create({
              data: { name: raw, lineId: body.lineId },
            });
            supplierId = created.id;
          }
        }
      }

      const optional: any = {};
      if (body.expiration)
        optional.expiration = new Date(body.expiration).toISOString();
      if (supplierId) optional.supplierId = supplierId;

      const brandCreates = brands.map((brand) => ({ brand, suppliesId }));

      // Stock is segmented per (item, batch, container, supplier, unit,
      // perQuantity) — same key the order flow uses, so direct restocks merge
      // cleanly into existing batches instead of fragmenting them.
      const stock = await tx.supplyStockTrack.findFirst({
        where: {
          suppliesId,
          supplyBatchId: body.listId,
          inventoryBoxId: body.inventoryBoxId,
          supplierId: supplierId ?? null,
          quality: body.quality ?? null,
          perQuantity,
        },
      });

      if (stock) {
        await tx.supplyStockTrack.update({
          where: { id: stock.id },
          data: {
            stock: stock.stock + addedStock,
            quantity: stock.quantity + quantity,
            ...(body.quality ? { quality: body.quality } : {}),
            ...optional,
            ...(brandCreates.length > 0
              ? { brand: { createMany: { data: brandCreates } } }
              : {}),
            price: { create: { value: priceValue, suppliesId } },
          },
        });
      } else {
        await tx.supplyStockTrack.create({
          data: {
            suppliesId,
            stock: addedStock,
            quantity,
            quality: body.quality ?? null,
            perQuantity,
            inventoryBoxId: body.inventoryBoxId,
            supplyBatchId: body.listId,
            ...optional,
            price: { create: { value: priceValue, suppliesId } },
            ...(brandCreates.length > 0
              ? { brand: { createMany: { data: brandCreates } } }
              : {}),
          },
        });
      }

      // Receive history — the Time-Based / Issuance report derives received QTY
      // (and Balance On Stock) from SupplieRecieveHistory, NOT from
      // SupplyStockTrack. An order fulfillment writes this row, so a direct
      // restock must too, or the report shows QTY 0 and a negative balance.
      await tx.supplieRecieveHistory.create({
        data: {
          suppliesId,
          quality: body.quality ?? null,
          quantity, // received units of measure (× perQuantity in the report)
          perQuantity,
          pricePerItem: body.price ? parseFloat(String(body.price)) || 0 : 0,
          condition: "New",
          supplyBatchId: body.listId,
          inventoryBoxId: body.inventoryBoxId,
          ...(supplierId ? { supplierId } : {}),
          ...(clientOpId ? { clientOpId } : {}),
        },
      });

      // Audit trail (system requirement) — the stock-in is still recorded even
      // though it skipped the order process.
      if (body.userId && body.lineId) {
        await tx.inventoryLogs.create({
          data: {
            lineId: body.lineId,
            userId: body.userId,
            action: 1,
            desc: `DIRECT RESTOCK: +${addedStock} unit(s) of "${supply.item}" (qty ${quantity} x ${perQuantity})`,
          },
        });
      }
    });

    return res.code(200).send({ message: "OK" });
  } catch (error) {
    if (error instanceof NotFoundError || error instanceof ValidationError) {
      throw error;
    }
    console.error("[restock] failed:", error);
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      const meta = (error.meta ?? {}) as Record<string, unknown>;
      const target = meta.target ?? meta.field_name ?? meta.modelName;
      throw new AppError(
        `Restock DB error ${error.code}${target ? ` (${Array.isArray(target) ? target.join(", ") : target})` : ""}`,
        500,
        "DB_ERROR",
      );
    }
    throw new AppError(
      `Restock failed: ${error instanceof Error ? error.message : "unknown"}`,
      500,
      "DB_ERROR",
    );
  }
};

// GET /supply/container-datasets?id=<inventoryBoxId>
// Datasets belong to a CONTAINER (a container can have several), and lists
// aren't pinned to one — so the direct "Add item" form searches/creates within
// the container's datasets. Returns them with their supply counts.
export const containerDatasets = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const params = req.query as { id?: string };
  if (!params.id) throw new ValidationError("INVALID REQUIRED ID");
  const datasets = await prisma.suppliesDataSet.findMany({
    where: { inventoryBoxId: params.id },
    orderBy: { timestamp: "asc" },
    select: {
      id: true,
      title: true,
      _count: { select: { supplies: true } },
    },
  });
  return res.code(200).send({
    list: datasets.map((d) => ({
      id: d.id,
      title: d.title,
      count: d._count.supplies,
    })),
  });
};
