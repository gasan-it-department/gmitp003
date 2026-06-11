// Thin wrapper around `tx.notification.create` that also pushes a
// real-time `notification:user-new` event over the socket so the
// recipient's UI can update without polling.
//
// Lives in `service/` so controllers don't need to know about the socket
// instance — they just write notifications the way they always have, and
// the side-effect happens automatically.

import type { Prisma } from "../barrel/prisma";

type Tx = Prisma.TransactionClient;

export interface UserNotificationInput {
  recipientId: string;
  title: string;
  content: string;
  path?: string | null;
  senderId?: string | null;
}

/**
 * Create a Notification row inside the given transaction and emit it
 * over the socket once the row has an id and createdAt. The emit
 * happens *inside* the transaction callback, but Socket.IO is fire-and-
 * forget at the network layer, so a later transaction rollback won't
 * surface as a phantom "you got a notification" toast unless the client
 * acts on the payload speculatively (it doesn't — the UI invalidates
 * its query and re-reads).
 */
export async function createUserNotification(
  tx: Tx,
  data: UserNotificationInput,
) {
  const row = await tx.notification.create({
    data: {
      recipientId: data.recipientId,
      title: data.title,
      content: data.content,
      path: data.path ?? null,
      senderId: data.senderId ?? null,
    },
    select: {
      id: true,
      title: true,
      content: true,
      path: true,
      createdAt: true,
      isRead: true,
      recipientId: true,
    },
  });

  try {
    const { notificationSocket } = await import("..");
    notificationSocket.emitUserNotification(row.recipientId, {
      id: row.id,
      title: row.title,
      content: row.content,
      path: row.path,
      createdAt: row.createdAt.toISOString(),
      isRead: row.isRead,
    });
  } catch (e) {
    // Socket failures must never break the DB transaction.
    console.warn("[notificationEvents] emit failed:", e);
  }

  // Fire OS-level push to every device the recipient has registered.
  // Runs after the socket emit so a slow push call doesn't delay the
  // in-app banner; we intentionally don't await so socket + push can
  // race and the transaction returns promptly.
  void (async () => {
    try {
      const { sendPushToUser } = await import("./expoPush");
      await sendPushToUser(row.recipientId, {
        title: row.title,
        body: row.content,
        data: {
          notificationId: row.id,
          path: row.path,
          createdAt: row.createdAt.toISOString(),
        },
      });
    } catch (e) {
      console.warn("[notificationEvents] push failed:", e);
    }
  })();

  return row;
}
