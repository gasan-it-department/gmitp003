// Low-stock alert helpers — MEDICINE-LEVEL.
//
// Business rules (one threshold per MEDICINE, not per batch):
//   * A medicine is "low" when Medicine.lowStockThreshold > 0 AND the SUM
//     of actualStock across EVERY batch row of that medicine in the line
//     is <= that threshold.
//   * We don't spam: an active medicine-level MedicineAlert (type=1,
//     medicineId set) means the low state is already known. We only emit
//     when transitioning INTO the state.
//   * When the total rises back above the threshold (restock), the
//     medicine's alerts are cleared so the next dip notifies again.
//   * Notifications fan out to storage-access holders + every Pharmacy
//     module user in the line.
//
// Both helpers keep their historical (tx, stockId) signatures — every
// stock mutation site calls them with the touched batch row, and the
// helpers resolve the medicine from it.

import type { Prisma } from "../barrel/prisma";

type Tx = Prisma.TransactionClient;

/** SUM of actualStock across every batch row of the medicine (line-wide). */
async function medicineTotal(tx: Tx, medicineId: string): Promise<number> {
  const agg = await tx.medicineStock.aggregate({
    where: { medicineId },
    _sum: { actualStock: true },
  });
  return agg._sum.actualStock ?? 0;
}

/**
 * After a stock row has been mutated, check whether its MEDICINE crossed
 * into low-stock state (total <= Medicine.lowStockThreshold). If so,
 * notify once and plant a medicine-level sentinel alert.
 */
export async function checkAndNotifyLowStock(
  tx: Tx,
  stockId: string,
): Promise<{ notified: number } | null> {
  const stock = await tx.medicineStock.findUnique({
    where: { id: stockId },
    include: {
      medicine: {
        select: {
          id: true,
          name: true,
          serialNumber: true,
          lowStockThreshold: true,
        },
      },
      MedicineStorage: {
        select: { id: true, name: true, refNumber: true, lineId: true },
      },
    },
  });
  if (!stock || !stock.medicine || !stock.MedicineStorage) return null;
  const threshold = stock.medicine.lowStockThreshold;
  if (threshold <= 0) return null;

  const total = await medicineTotal(tx, stock.medicine.id);
  if (total > threshold) return null;

  // Already in a known low state for this MEDICINE? Skip.
  const existing = await tx.medicineAlert.findFirst({
    where: { medicineId: stock.medicine.id, type: 1 },
    orderBy: { timestamp: "desc" },
  });
  if (existing) return null;

  // Sentinel — bound to the touched row (FK), keyed by the medicine.
  await tx.medicineAlert.create({
    data: {
      type: 1,
      count: total,
      medicineId: stock.medicine.id,
      medicineStockId: stock.id,
      expiration: stock.expiration ?? null,
    },
  });

  const lineId = stock.MedicineStorage.lineId;

  const [accessRows, moduleUsers] = await Promise.all([
    tx.medicineStorageAccess.findMany({
      where: { medicineStorageId: stock.MedicineStorage.id },
      select: { userId: true },
    }),
    tx.module.findMany({
      where: {
        lineId,
        OR: [
          { moduleName: { equals: "medicine", mode: "insensitive" } },
          { moduleName: { equals: "Pharmacy", mode: "insensitive" } },
        ],
      },
      select: { userId: true },
    }),
  ]);

  const recipientIds = [
    ...new Set([
      ...accessRows.map((a) => a.userId),
      ...moduleUsers.map((m) => m.userId),
    ]),
  ];
  if (recipientIds.length === 0) return { notified: 0 };

  const isOut = total <= 0;
  const title = isOut ? "Out of stock" : "Low stock alert";
  const message =
    `${stock.medicine.name} (${stock.medicine.serialNumber}) ` +
    (isOut
      ? "is OUT of stock across all storages."
      : `is low: ${total} left in total (threshold ${threshold}).`);

  const path = `medicine/storage/${stock.MedicineStorage.id}`;
  const created = await Promise.all(
    recipientIds.map((userId) =>
      tx.medicineNotification.create({
        data: {
          userId,
          view: 0,
          title,
          message,
          lineId,
          path,
          type: 1,
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
      }),
    ),
  );

  try {
    const { notificationSocket } = await import("..");
    for (const n of created) {
      notificationSocket.emitMedicineNotification(lineId, {
        id: n.id,
        userId: n.userId,
        title: n.title,
        message: n.message,
        lineId: n.lineId,
        path: n.path ?? undefined,
        timestamp:
          typeof n.timestamp === "string"
            ? n.timestamp
            : n.timestamp.toISOString(),
        type: n.type,
        view: n.view,
      });
    }
  } catch (e) {
    console.warn("[medicineAlerts] socket emit failed:", e);
  }

  return { notified: recipientIds.length };
}

/**
 * After a restock/add, clear the MEDICINE's active low-stock alerts if its
 * total is back above the threshold — so the next dip notifies again.
 * (Also clears any legacy per-stock alerts bound to this row.)
 */
export async function clearLowStockAlerts(
  tx: Tx,
  stockId: string,
): Promise<number> {
  const stock = await tx.medicineStock.findUnique({
    where: { id: stockId },
    select: {
      id: true,
      medicineId: true,
      medicine: { select: { lowStockThreshold: true } },
    },
  });
  let count = 0;
  if (stock?.medicineId) {
    const threshold = stock.medicine?.lowStockThreshold ?? 0;
    const total = await medicineTotal(tx, stock.medicineId);
    if (threshold <= 0 || total > threshold) {
      const r = await tx.medicineAlert.deleteMany({
        where: { medicineId: stock.medicineId, type: 1 },
      });
      count += r.count;
    }
  }
  // Legacy per-stock alerts (pre-medicine-level era) — always clearable.
  const legacy = await tx.medicineAlert.deleteMany({
    where: { medicineStockId: stockId, medicineId: null, type: 1 },
  });
  return count + legacy.count;
}
