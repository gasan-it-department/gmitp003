// Thin wrapper around Expo's push notification HTTP API.
//
// Why Expo's service: it's the standard recommended path for SDK-based
// apps. We don't have to ship FCM/APNs keys to the backend; Expo fans
// the message out to both. Tokens are obtained client-side via
// `expo-notifications` and registered with our /push/register endpoint.
//
// Doc: https://docs.expo.dev/push-notifications/sending-notifications/

import { prisma } from "../barrel/prisma";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

export interface ExpoPushMessage {
  to: string | string[];
  title: string;
  body: string;
  data?: Record<string, unknown>;
  sound?: "default" | null;
  badge?: number;
  channelId?: string;
  priority?: "default" | "normal" | "high";
}

interface ExpoTicket {
  status: "ok" | "error";
  id?: string;
  message?: string;
  details?: {
    error?:
      | "DeviceNotRegistered"
      | "MessageTooBig"
      | "MessageRateExceeded"
      | "InvalidCredentials";
  };
}

const isExpoToken = (t: string) =>
  t.startsWith("ExponentPushToken[") || t.startsWith("ExpoPushToken[");

/**
 * Look up every push token for the given user and fire a push to each.
 * Returns silently if the user has no registered tokens — the in-app
 * socket path will still deliver while the app is open.
 *
 * Tokens that come back as "DeviceNotRegistered" are pruned from the
 * database so we don't keep retrying dead devices on every notification.
 */
export const sendPushToUser = async (
  userId: string,
  payload: Omit<ExpoPushMessage, "to">,
): Promise<void> => {
  const tokens = await prisma.pushToken.findMany({
    where: { userId },
    select: { token: true },
  });
  if (tokens.length === 0) return;

  const valid = tokens.map((t) => t.token).filter(isExpoToken);
  if (valid.length === 0) return;

  const messages: ExpoPushMessage[] = valid.map((to) => ({
    to,
    title: payload.title,
    body: payload.body,
    data: payload.data ?? {},
    sound: payload.sound ?? "default",
    priority: payload.priority ?? "high",
    channelId: payload.channelId ?? "default",
  }));

  try {
    const res = await fetch(EXPO_PUSH_URL, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Accept-encoding": "gzip, deflate",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(messages),
    });

    if (!res.ok) {
      console.warn("[expoPush] HTTP", res.status, await res.text().catch(() => ""));
      return;
    }

    const body = (await res.json().catch(() => null)) as
      | { data?: ExpoTicket[] }
      | null;
    const tickets = body?.data ?? [];
    const dead: string[] = [];
    tickets.forEach((ticket, idx) => {
      if (
        ticket?.status === "error" &&
        ticket.details?.error === "DeviceNotRegistered"
      ) {
        dead.push(valid[idx]);
      } else if (ticket?.status === "error") {
        console.warn("[expoPush] ticket error", ticket);
      }
    });
    if (dead.length > 0) {
      await prisma.pushToken
        .deleteMany({ where: { token: { in: dead } } })
        .catch((e) => console.warn("[expoPush] cleanup failed", e));
    }
  } catch (e) {
    console.warn("[expoPush] send failed", e);
  }
};
