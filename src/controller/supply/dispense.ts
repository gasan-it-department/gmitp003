/**
 * Issuing stock, and correcting an issue after the fact.
 *
 * The stock row is locked while a dispense is worked out; see the
 * comments in dispenseSupply for why that is not optional.
 *
 * Moved out of supplyController.ts, which had grown to 3,034 lines
 * across twenty unrelated handlers. The code itself is unchanged.
 */
import { FastifyReply, FastifyRequest } from "../../barrel/fastify";
import { boxesConsistent, boxesFor, stockFields } from "../../service/stockMath";
import { assertLine, assertOwned } from "../../service/inventoryScope";
import { Prisma, prisma } from "../../barrel/prisma";
import { DispenseItemProps } from "../../models/route";
import { generateDispenseRef } from "../../middleware/handler";
import {
  AppError,
  NotFoundError,
  ValidationError,
  dbError,
} from "../../errors/errors";


export const dispenseSupply = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const body = req.body as DispenseItemProps;

  if (!body.id || !body.quantity || parseInt(body.quantity, 10) <= 0) {
    throw new ValidationError("Item ID and positive quantity are required");
  }
  /*
    The stock row has to belong to the caller's municipality. Without
    this the handler took an id and dispensed it, so knowing an id from
    anywhere was enough to draw down another LGU's shelves.
  */
  await assertOwned(req, "stock", body.id);

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

    /*
      From here to the writes, everything happens inside ONE transaction
      with the stock row LOCKED.

      This used to read the row outside any transaction, work out the
      remainder in JavaScript, and write that number back as an absolute
      value. Two dispenses at once both read the same starting figure and
      both wrote the same remainder, so one deduction simply disappeared:
      ten concurrent dispenses of ten pieces from two hundred left the row
      reading 190 instead of 100. The "insufficient stock" check could not
      catch it either, being tested against the same stale read. Worse, the
      dispense RECORDS were all correct — so the books disagreed with the
      shelf and nothing pointed at why.

      SELECT ... FOR UPDATE makes concurrent dispensers of the same row
      queue instead of race. The packing arithmetic below is left exactly
      as it was; serialising it is safer than restating it as an atomic
      expression, because the opened-box and loose-piece cases are easy to
      get subtly wrong in SQL.
    */
    const refCode = await generateDispenseRef();

    const result = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "SupplyStockTrack" WHERE id = ${body.id} FOR UPDATE`;
      const stock = await tx.supplyStockTrack.findUnique({
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

      /*
        The row records the amount twice. `stock` is the authority — it
        is what this function decrements and what "insufficient stock"
        is judged against — so a disagreeing `quantity` is repaired from
        it rather than reported and ignored.

        The check here used to be `stock !== quantity * perQuantity`,
        which is only true when no box has been opened. It therefore
        warned on ordinary correct data and, being the wrong rule, would
        have stayed silent on real drift.
      */
      if (!boxesConsistent({ ...stock, perQuantity: perBox })) {
        console.warn(
          `[supply] stock ${stock.id}: ${currentStockPieces} pieces but ` +
            `${currentBoxes} boxes of ${perBox}; recomputing boxes as ` +
            `${boxesFor(currentStockPieces, perBox)}.`,
        );
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

      /*
        One derivation for both columns. `totalBoxesAfter` reached the
        same answer by a separate route through the packing arithmetic,
        which is a second chance to disagree with the piece count;
        boxesFor is the only place boxes are worked out now.
      */
      const updateData: any = stockFields(remainingPieces, perBox);

      console.log("Update data:", updateData);

      // Prepare data for dispense record - Using ALL fields from your schema
      const dispenseRecordData: any = {
        refCode,
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

      /*
        The write is guarded as well as locked. The lock is what makes this
        correct; the `stock: { gte: toDispense }` condition is what makes it
        fail loudly rather than go negative if anyone later moves this out
        from under the lock.
      */
      const applied = await tx.supplyStockTrack.updateMany({
        where: { id: body.id, stock: { gte: toDispense } },
        data: updateData,
      });
      if (applied.count === 0) {
        throw new ValidationError(
          "This item's stock changed while the dispense was being recorded. " +
            "Nothing was dispensed — refresh and try again.",
        );
      }

      await tx.supplyDispenseRecord.create({ data: dispenseRecordData });

      return {
        toDispense,
        fullBoxesToGive,
        loosePieces,
        totalBoxesAfter,
        remainingPieces,
        remainingFullBoxes,
        openedBoxRemainingPieces,
        currentBoxes,
        currentStockPieces,
      };
    },
    /*
      Dispensers of the same item now queue on the row lock instead of
      racing, so a burst — the desktop flushing an offline queue, or a
      counter with several staff — must be allowed to wait rather than be
      rejected by the default two-second maxWait. These match the figures
      already used by the bulk path further down this file.
    */
    { maxWait: 10000, timeout: 15000 });


    if (!result) throw new ValidationError("FAILED TO DISPENSE");

    // Computed under the lock, so these describe what was actually written.
    const {
      toDispense,
      fullBoxesToGive,
      loosePieces,
      totalBoxesAfter,
      remainingPieces,
      remainingFullBoxes,
      openedBoxRemainingPieces,
      currentBoxes,
      currentStockPieces,
    } = result;

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

  /* The record being adjusted must belong to the caller's line. */
  await assertOwned(req, "dispense", body.id);

  try {
    const result = await prisma.$transaction(async (tx) => {
      /*
        Lock the stock row this adjustment will move, BEFORE reading it.

        The read below is inside the transaction, which is not by itself
        enough: under Read Committed another dispense can change the row
        between this read and the write, and the write sets an absolute
        figure, so that change is silently discarded. The stock id is only
        known from the record, hence the subquery — it locks the right row
        in one statement rather than reading twice.
      */
      await tx.$queryRaw`
        SELECT t.id FROM "SupplyStockTrack" t
        WHERE t.id = (
          SELECT r."supplyStockTrackId" FROM "SupplyDispenseRecord" r
          WHERE r.id = ${body.id}
        )
        FOR UPDATE`;

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

        await tx.supplyStockTrack.update({
          where: { id: stock.id },
          data: stockFields(newStockPieces, perQ),
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
      throw dbError(error);
    }
    throw error;
  }
};

/*
  dispenseItem lived here and was deleted on 2026-11-25.

  It was never routed, never imported and no client referenced it,
  but it carried a THIRD and incompatible model of the stock columns:
  it decremented `perQuantity` — the pieces-per-box ratio, which is a
  constant property of the packaging — and then derived `stock` from
  boxes times that mutated ratio. Wiring it up would have corrupted
  stock levels quietly. Dead code that is merely unused is clutter;
  dead code that is WRONG is a trap, so it is gone rather than fixed.

  dispenseSupply is the live dispense path.
*/

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

  /* The stock row, and any lineId named, must be the caller's own. */
  await assertOwned(req, "stock", body.id);
  await assertLine(req, body.lineId);

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
