// Low-stock alert helpers.
//
// Business rules:
//   * A stock row is "low" when threshold > 0 AND actualStock <= threshold.
//   * We don't spam notifications: an active MedicineAlert (type=1) means
//     the row is in a known low-stock state. We only emit a new notification
//     when transitioning INTO that state.
//   * When a row crosses back over its threshold (e.g. after restock), we
//     clear its active alerts so the next dip will notify again.
//   * Notifications fan out to every user with MedicineStorageAccess on the
//     affected storage so the responsible humans actually see it.

import type { Prisma } from "../barrel/prisma";

type Tx = Prisma.TransactionClient;

/**
 * After a stock row has been mutated, check whether it crossed into
 * low-stock state. If so, create one MedicineNotification per user with
 * access to the storage + a single MedicineAlert sentinel so we don't
 * fire again for the same dip.
 */
export async function checkAndNotifyLowStock(
  tx: Tx,
  stockId: string,
): Promise<{ notified: number } | null> {
  const stock = await tx.medicineStock.findUnique({
    where: { id: stockId },
    include: {
      medicine: { select: { id: true, name: true, serialNumber: true } },
      MedicineStorage: {
        select: { id: true, name: true, refNumber: true, lineId: true },
      },
    },
  });
  if (!stock) return null;
  if (!stock.MedicineStorage) return null;
  if (stock.threshold <= 0) return null;
  if (stock.actualStock > stock.threshold) return null;

  // Already in a known low-stock state? Skip — alert was emitted earlier.
  const existing = await tx.medicineAlert.findFirst({
    where: { medicineStockId: stock.id, type: 1 },
    orderBy: { timestamp: "desc" },
  });
  if (existing) return null;

  // Mark this transition with a sentinel alert.
  await tx.medicineAlert.create({
    data: {
      type: 1,
      count: stock.actualStock,
      medicineStockId: stock.id,
      expiration: stock.expiration ?? null,
    },
  });

  // Fan out to users with access to this storage.
  const accessRows = await tx.medicineStorageAccess.findMany({
    where: { medicineStorageId: stock.MedicineStorage.id },
    select: { userId: true },
  });

  if (accessRows.length === 0) return { notified: 0 };

  const isOut = stock.actualStock <= 0;
  const title = isOut ? "Out of stock" : "Low stock alert";
  const message =
    `${stock.medicine?.name ?? "Medicine"} ` +
    `(${stock.medicine?.serialNumber ?? "—"}) ` +
    `is ${isOut ? "out of stock" : `low: ${stock.actualStock} left`} ` +
    `in storage ${stock.MedicineStorage.refNumber}.`;

  // `createMany` won't return rows; create one-by-one so we can emit
  // each over the socket with its real id and timestamp.
  const lineId = stock.MedicineStorage!.lineId;
  const path = `medicine/storage/${stock.MedicineStorage!.id}`;
  const created = await Promise.all(
    accessRows.map((a) =>
      tx.medicineNotification.create({
        data: {
          userId: a.userId,
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

  // Real-time fan-out. Imported lazily so the service file stays
  // free of a top-level dependency on index.ts.
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

  return { notified: accessRows.length };
}

/**
 * Clear active low-stock alerts for a stock row. Call after restocking so
 * the next dip can notify again.
 */
export async function clearLowStockAlerts(
  tx: Tx,
  stockId: string,
): Promise<number> {
  const r = await tx.medicineAlert.deleteMany({
    where: { medicineStockId: stockId, type: 1 },
  });
  return r.count;
}
