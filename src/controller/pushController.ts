import { FastifyRequest, FastifyReply } from "../barrel/fastify";
import { prisma } from "../barrel/prisma";
import { ValidationError } from "../errors/errors";

interface RegisterBody {
  token: string;
  userId: string;
  platform?: string;
  deviceName?: string;
}

/**
 * Mobile sends its Expo push token here after each successful login.
 * Idempotent: if the same token was previously registered (possibly
 * under a different user, e.g. shared device), we just rewrite the
 * userId and touch lastSeenAt.
 */
export const registerPushToken = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const body = req.body as RegisterBody;
  if (!body?.token || !body?.userId) {
    throw new ValidationError("BAD_REQUEST: token and userId are required");
  }
  if (
    !body.token.startsWith("ExponentPushToken[") &&
    !body.token.startsWith("ExpoPushToken[")
  ) {
    throw new ValidationError("BAD_REQUEST: not a valid Expo push token");
  }

  const row = await prisma.pushToken.upsert({
    where: { token: body.token },
    create: {
      token: body.token,
      userId: body.userId,
      platform: body.platform ?? null,
      deviceName: body.deviceName ?? null,
    },
    update: {
      userId: body.userId,
      platform: body.platform ?? null,
      deviceName: body.deviceName ?? null,
      lastSeenAt: new Date(),
    },
    select: { id: true, lastSeenAt: true },
  });

  return res.code(200).send({ ok: true, id: row.id, lastSeenAt: row.lastSeenAt });
};

/**
 * Called on logout (or when the mobile detects the token has been
 * revoked). Best-effort — if the token isn't found we still 200.
 */
export const unregisterPushToken = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const body = req.body as { token?: string };
  if (!body?.token) {
    throw new ValidationError("BAD_REQUEST: token is required");
  }
  await prisma.pushToken
    .deleteMany({ where: { token: body.token } })
    .catch(() => undefined);
  return res.code(200).send({ ok: true });
};
