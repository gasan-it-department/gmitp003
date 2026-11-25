/**
 * Which municipality does this piece of inventory belong to?
 *
 * The supplies module had no answer to that question anywhere: six
 * controllers, not one call to callerScope, and roughly twenty places
 * that took `lineId` straight from the request. `dispenseSupply` in
 * particular took a stock id and dispensed it, so any signed-in user
 * could draw down another municipality's shelves by knowing an id.
 *
 * Ownership is not uniform, which is why it belongs in one place rather
 * than being re-derived in each handler:
 *
 *   Supplies, InventoryBox, SuppliesDataSet, Supplier,
 *   SupplyBatchOrder, SupplyTransaction      carry lineId themselves
 *   SupplyStockTrack, SupplyDispenseRecord   -> their Supplies
 *   SupplyBatch                              -> its InventoryBox
 *   SupplyOrder                              -> its Supplies
 *
 * Every function here throws rather than returning false, so a handler
 * cannot forget to check the result.
 */
import { FastifyRequest } from "../barrel/fastify";
import { prisma } from "../barrel/prisma";
import { NotFoundError, UnauthorizedError } from "../errors/errors";
import { callerContext } from "./callerScope";

/** The caller's municipality. Throws when they are not attached to one. */
export const callerLine = async (req: FastifyRequest): Promise<string> => {
  const caller = await callerContext(req);
  if (!caller.lineId) {
    throw new UnauthorizedError("Your account is not attached to a line.");
  }
  return caller.lineId;
};

/**
 * The caller's line, having checked any line they named is their own.
 *
 * Handlers used to take `lineId` from the body or query and trust it.
 * Accepting a matching value keeps every existing client working —
 * the web, both desktop apps and the offline replay all send it — while
 * a value for somebody else's municipality is refused instead of being
 * quietly honoured.
 */
export const assertLine = async (
  req: FastifyRequest,
  claimed?: string | null,
): Promise<string> => {
  const mine = await callerLine(req);
  if (claimed && claimed !== mine) {
    throw new UnauthorizedError("This is not your municipality's data.");
  }
  return mine;
};

export type InventoryKind =
  | "supply"
  | "stock"
  | "dispense"
  | "container"
  | "batch"
  | "dataset"
  | "order"
  | "batchOrder"
  | "supplier"
  | "transaction";

/** How to find the owning line for each kind of record. */
const OWNER: Record<
  InventoryKind,
  (id: string) => Promise<string | null | undefined>
> = {
  supply: async (id) =>
    (await prisma.supplies.findUnique({ where: { id }, select: { lineId: true } }))
      ?.lineId,
  container: async (id) =>
    (await prisma.inventoryBox.findUnique({ where: { id }, select: { lineId: true } }))
      ?.lineId,
  dataset: async (id) =>
    (await prisma.suppliesDataSet.findUnique({ where: { id }, select: { lineId: true } }))
      ?.lineId,
  supplier: async (id) =>
    (await prisma.supplier.findUnique({ where: { id }, select: { lineId: true } }))
      ?.lineId,
  batchOrder: async (id) =>
    (await prisma.supplyBatchOrder.findUnique({ where: { id }, select: { lineId: true } }))
      ?.lineId,
  transaction: async (id) =>
    (await prisma.supplyTransaction.findUnique({ where: { id }, select: { lineId: true } }))
      ?.lineId,
  // Indirect: the stock row and the dispense record belong to their supply.
  stock: async (id) =>
    (
      await prisma.supplyStockTrack.findUnique({
        where: { id },
        select: { supply: { select: { lineId: true } } },
      })
    )?.supply?.lineId,
  dispense: async (id) =>
    (
      await prisma.supplyDispenseRecord.findUnique({
        where: { id },
        select: { supplyItem: { select: { lineId: true } } },
      })
    )?.supplyItem?.lineId,
  order: async (id) =>
    (
      await prisma.supplyOrder.findUnique({
        where: { id },
        select: { supply: { select: { lineId: true } } },
      })
    )?.supply?.lineId,
  // A list lives in a container, and the container carries the line.
  batch: async (id) =>
    (
      await prisma.supplyBatch.findUnique({
        where: { id },
        select: { box: { select: { lineId: true } } },
      })
    )?.box?.lineId,
};

const LABEL: Record<InventoryKind, string> = {
  supply: "supply item",
  stock: "stock record",
  dispense: "dispense record",
  container: "container",
  batch: "list",
  dataset: "data set",
  order: "order item",
  batchOrder: "order",
  supplier: "supplier",
  transaction: "transaction",
};

/**
 * Refuse unless this record belongs to the caller's municipality.
 *
 * Returns the line id so a handler can go on to use it without asking
 * again. A missing record is reported as not found rather than as a
 * permission error — but only AFTER the caller has been identified, so
 * this cannot be used to probe for ids that exist elsewhere.
 */
export const assertOwned = async (
  req: FastifyRequest,
  kind: InventoryKind,
  id: string | null | undefined,
): Promise<string> => {
  const mine = await callerLine(req);
  if (!id) throw new NotFoundError(`No ${LABEL[kind]} id was given.`);
  const owner = await OWNER[kind](id);
  if (owner === undefined || owner === null) {
    throw new NotFoundError(`That ${LABEL[kind]} does not exist.`);
  }
  if (owner !== mine) {
    throw new UnauthorizedError("This is not your municipality's data.");
  }
  return mine;
};
