import { FastifyReply, FastifyRequest } from "../barrel/fastify";
import { prisma } from "../barrel/prisma";

/**
 * POST /admin/line/:lineId/hr-session  (adminAuthenticated)
 *
 * Mints a REAL line Account session token so the super-admin can drive the
 * existing HR module for that line. The token is an ordinary Account JWT
 * (so it passes `authenticated` and `req.user.id` resolves to a real account on
 * the line) plus `imp:true`/`impLineId` markers. HR data endpoints need no
 * change — they scope by the `lineId` passed in the request; the `imp` flag only
 * short-circuits the per-user module-access check (see userModuleAccess).
 */
export const openLineHrSession = async (
  req: FastifyRequest,
  reply: FastifyReply,
) => {
  const { lineId } = req.params as { lineId?: string };
  if (!lineId) return reply.code(400).send({ message: "Missing lineId" });

  const line = await prisma.line.findUnique({
    where: { id: lineId },
    select: { id: true, name: true, status: true },
  });
  if (!line) return reply.code(404).send({ message: "Line not found" });
  if (line.status !== 1)
    return reply.code(400).send({ message: "Line is inactive" });

  // Resolve a real Account on this line to carry req.user.id. Prefer an HR user
  // (so any req.user-based HR logic resolves to a legit HR account); fall back
  // to the line admin, then any active account.
  let accountId: string | null = null;
  let username = "";
  let userId: string | null = null;

  const hrModule = await prisma.module.findFirst({
    where: { lineId, status: 1, moduleName: "human-resources" },
    select: { userId: true },
  });
  if (hrModule?.userId) {
    const u = await prisma.user.findUnique({
      where: { id: hrModule.userId },
      select: { id: true, accountId: true, username: true },
    });
    if (u?.accountId) {
      accountId = u.accountId;
      username = u.username;
      userId = u.id;
    }
  }

  if (!accountId) {
    const acc =
      (await prisma.account.findFirst({
        where: { lineId, role: "admin", active: true, status: 1 },
        select: { id: true, username: true, User: { select: { id: true } } },
      })) ??
      (await prisma.account.findFirst({
        where: { lineId, active: true, status: 1 },
        select: { id: true, username: true, User: { select: { id: true } } },
      }));
    if (acc) {
      accountId = acc.id;
      username = acc.username;
      userId = acc.User?.id ?? null;
    }
  }

  if (!accountId)
    return reply
      .code(409)
      .send({ message: "This line has no account to manage yet." });

  // best-effort audit on the line's activity feed (ActivityLogs.userId is a User FK)
  if (userId) {
    try {
      const admin = req.user as { id?: string } | undefined;
      await prisma.activityLogs.create({
        data: {
          userId,
          lineId,
          action: 0,
          desc: `HR session opened by super-admin${admin?.id ? ` (${admin.id})` : ""}`,
        },
      });
    } catch (e) {
      console.warn("[admin hr-session] audit log failed:", e);
    }
  }

  const token = await reply.jwtSign({
    id: accountId,
    username,
    imp: true,
    impLineId: lineId,
  });

  return reply
    .code(200)
    .send({ token, accountId, lineId, lineName: line.name });
};
