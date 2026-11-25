/**
 * Putting stock in: a direct re-stock, and opening an order.
 *
 * Moved out of supplyController.ts, which had grown to 3,034 lines
 * across twenty unrelated handlers. The code itself is unchanged.
 */
import { FastifyReply, FastifyRequest } from "../../barrel/fastify";
import { boxesFor, stockFields } from "../../service/stockMath";
import { assertLine, assertOwned } from "../../service/inventoryScope";
import { callerContext } from "../../service/callerScope";
import { Prisma, prisma } from "../../barrel/prisma";
import { generatedItemCode, generateOrderRef } from "../../middleware/handler";
import { AppError, NotFoundError, ValidationError, UnauthorizedError } from "../../errors/errors";


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

  /*
    Everything this restock touches must be the caller's: the container
    it goes into, the list within it, and the item itself when an
    existing one is named. A lineId in the body is honoured only when it
    is the caller's own.
  */
  await assertLine(req, body.lineId);
  await assertOwned(req, "container", body.inventoryBoxId);
  await assertOwned(req, "batch", body.listId);
  if (body.suppliesId) await assertOwned(req, "supply", body.suppliesId);
  const caller = await callerContext(req);

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
        // Unconditional: this was skipped entirely when the request
        // carried no userId, which is a stock-in with no trail.
        await tx.inventoryAccessLogs.create({
          data: {
            userId: caller.actorId,
            inventoryBoxId: body.inventoryBoxId,
            action: `Added Supply (direct): ${supply.item}`,
            timestamp: new Date(),
          },
        });
      }

      // Resolve supplier — accept an id, a known name, or create a new one.
      // Supplier.name is unique PER LINE, so match within THIS line only —
      // another line's supplier of the same name is a different record.
      let supplierId: string | undefined;
      if (body.supplier && body.supplier.trim()) {
        const raw = body.supplier.trim();
        const byId = await tx.supplier.findUnique({ where: { id: raw } });
        if (byId) {
          supplierId = byId.id;
        } else {
          const byName = await tx.supplier.findFirst({
            where: {
              name: { equals: raw, mode: "insensitive" },
              ...(body.lineId ? { lineId: body.lineId } : {}),
            },
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
            /*
              Atomic, so two deliveries booked in at once cannot lose one
              another's addition. The absolute form — stock.stock + added
              — read a figure that another restock could already have
              moved, and wrote a total that silently discarded it.

              Boxes are NOT incremented alongside: adding ten loose
              pieces to a part-used box should fill that box, not open a
              new one, so the box count is recomputed from the resulting
              piece count just below.
            */
            stock: { increment: addedStock },
            ...(body.quality ? { quality: body.quality } : {}),
            ...optional,
            ...(brandCreates.length > 0
              ? { brand: { createMany: { data: brandCreates } } }
              : {}),
            price: { create: { value: priceValue, suppliesId } },
          },
        });

        /*
          Recompute the box count from the piece count the increment
          actually produced. Done as a second statement because `ceil`
          cannot be expressed in a Prisma atomic update; it is inside
          the same transaction, so no reader sees the intermediate row.
        */
        const after = await tx.supplyStockTrack.findUnique({
          where: { id: stock.id },
          select: { stock: true, perQuantity: true },
        });
        if (after) {
          await tx.supplyStockTrack.update({
            where: { id: stock.id },
            data: { quantity: boxesFor(after.stock, after.perQuantity) },
          });
        }
      } else {
        await tx.supplyStockTrack.create({
          data: {
            suppliesId,
            ...stockFields(addedStock, perQuantity),
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
      // The line is the caller's own — assertLine above saw to that —
      // so fall back to it rather than dropping the row, which is what
      // happened whenever either field was left out of the request.
      const auditLineId = body.lineId || caller.lineId;
      if (auditLineId) {
        await tx.inventoryLogs.create({
          data: {
            lineId: auditLineId,
            userId: caller.actorId,
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

export const newOrder = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const params = req.body as { title: string; id: string; lineId: string };

    /*
      The list being ordered against has to be the caller's, and the order
      is filed under the caller's municipality rather than whichever one
      the body named.
    */
    await assertOwned(req, "batch", params.id);
    const lineId = await assertLine(req, params.lineId);

    const refNumber = await generateOrderRef();
    const response = await prisma.supplyBatchOrder.create({
      data: {
        title: params.title,
        refNumber,
        supplyBatchId: params.id,
        status: 0,
        lineId,
      },
    });

    res.code(200).send({ message: "OK", data: response });
  } catch (error) {
    if (error instanceof UnauthorizedError) throw error;
    console.error(error);
    res.code(500).send({ message: "Internal Server Error" });
  }
};
