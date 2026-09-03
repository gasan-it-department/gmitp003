import type { FastifyRequest } from "../barrel/fastify";
import { prisma } from "../barrel/prisma";
import { UnauthorizedError } from "../errors/errors";

/**
 * Who is actually making this request.
 *
 * A long tail of handlers took the acting identity out of the request —
 * `body.userId`, `query.lineId` — and believed it. That is not a check
 * with a bug in it; it is the absence of one, and it means any signed-in
 * account can act as any other by typing their id.
 *
 * The token is the only thing a caller cannot choose, so identity comes
 * from here and the parameters are ignored.
 */
export interface Caller {
  /** The User id behind the token. */
  actorId: string;
  /** Their municipality. Null only for an account with no line on record. */
  lineId: string | null;
}

export const callerContext = async (req: FastifyRequest): Promise<Caller> => {
  const accountId = (req.user as { id?: string } | undefined)?.id;
  if (!accountId) throw new UnauthorizedError("Not signed in");
  const account = await prisma.account.findUnique({
    where: { id: accountId },
    select: { lineId: true, User: { select: { id: true, lineId: true } } },
  });
  const actorId = account?.User?.id;
  if (!actorId) throw new UnauthorizedError("Not signed in");
  return { actorId, lineId: account.User?.lineId ?? account.lineId ?? null };
};

/**
 * The caller, and a promise that they belong to the municipality they are
 * asking about.
 *
 * This is a ceiling, not a fence: it stops another municipality's staff
 * and it stops an id typed at random, but any colleague on the same line
 * still passes. Tightening it further needs the module-permission system
 * to reach the server, which it does not yet — the UI decides who sees
 * these screens and the API has never been told. Worth doing; a different
 * job from closing the door on everybody else.
 */
export const requireSameLine = async (
  req: FastifyRequest,
  lineId: string | null | undefined,
): Promise<Caller> => {
  const caller = await callerContext(req);
  if (!lineId || !caller.lineId || caller.lineId !== lineId) {
    console.warn(
      `[scope] refused: user ${caller.actorId} (line ${caller.lineId}) ` +
        `asked for line ${lineId}`,
    );
    throw new UnauthorizedError("This is not your municipality's data.");
  }
  return caller;
};

/** Acting on a person: it has to be yourself. */
export const requireSelf = async (
  req: FastifyRequest,
  userId: string | null | undefined,
): Promise<Caller> => {
  const caller = await callerContext(req);
  if (userId && userId !== caller.actorId) {
    console.warn(
      `[scope] refused: user ${caller.actorId} attempted to act as ${userId}`,
    );
    throw new UnauthorizedError("You can only act on your own behalf.");
  }
  return caller;
};

/**
 * A room's business belongs to the people who work in that room.
 *
 * Any of the three roles counts — an owner, a signatory and a receiver all
 * genuinely work there. A REMOVED member keeps their row at status 0 and
 * is refused by it, which is the point of removing someone.
 *
 * Returns the role so a caller that also needs it does not pay for a
 * second query.
 */
export const requireRoomMember = async (
  req: FastifyRequest,
  roomId: string,
): Promise<{ actorId: string; type: number }> => {
  const { actorId } = await callerContext(req);
  const member = await prisma.roomAuthorizedUser.findFirst({
    where: { receivingRoomId: roomId, userId: actorId, status: 1 },
    select: { type: true },
  });
  if (!member) {
    console.warn(`[scope] refused: user ${actorId} asked for room ${roomId}`);
    throw new UnauthorizedError("This is not your office.");
  }
  return { actorId, type: member.type };
};
