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

/**
 * The person themselves, or HR of the municipality the record belongs to.
 *
 * `requireSameLine` is the right shape for data that belongs to an office:
 * anybody who works there may see it. It is the wrong shape for a record
 * that belongs to ONE PERSON. A Personal Data Sheet holds a colleague's
 * birth date, place of birth, TIN, PhilHealth number, home address and
 * parents' names, and "we work for the same municipality" is not a reason
 * to be handed it.
 *
 * So: you, or someone whose job is personnel records.
 *
 * The module check is deliberately stricter than the ad-hoc one in
 * employee.ts, which matches on userId + moduleName alone:
 *
 *   - `status: 1`, because access is suspended by flipping that column as
 *     well as by deleting the row. Ignoring it keeps a revoked grant
 *     working, which is the opposite of what revoking means.
 *   - the module's own `lineId`, because a Module row is per line. HR in
 *     one municipality is not HR in another.
 *
 * Returns how the caller got in, so the handler can log it: "HR exported
 * someone else's PDS" and "a person exported their own" are different
 * events and should not look identical afterwards.
 */
export const requireHrOrSelf = async (
  req: FastifyRequest,
  subject: { userId?: string | null; lineId?: string | null },
  what = "this record",
): Promise<{ caller: Caller; via: "self" | "hr" }> => {
  const caller = await callerContext(req);

  // Yourself, always — regardless of line, module, or anything else.
  if (subject.userId && subject.userId === caller.actorId) {
    return { caller, via: "self" };
  }

  if (!subject.lineId || !caller.lineId || caller.lineId !== subject.lineId) {
    console.warn(
      `[scope] refused: user ${caller.actorId} (line ${caller.lineId}) ` +
        `asked for ${what} in line ${subject.lineId}`,
    );
    throw new UnauthorizedError("This is not your municipality's data.");
  }

  /*
    A super-admin managing this line through "Manage HR".

    That feature mints a real session for an account of the line, and
    PREFERS an HR one — but falls back to the line admin, or any active
    account, when the line has no HR user at all. Those are exactly the
    lines a super-admin needs to go in and fix, so requiring the module
    here would lock them out of the case the feature exists for.

    Deliberately checked after the same-line test above, so a borrowed
    session is still confined to the line it was borrowed for.
  */
  if ((req as FastifyRequest & { impersonated?: boolean }).impersonated) {
    return { caller, via: "hr" };
  }

  const hr = await prisma.module.findFirst({
    where: {
      userId: caller.actorId,
      lineId: subject.lineId,
      moduleName: "human-resources",
      status: 1,
    },
    select: { id: true },
  });
  if (!hr) {
    console.warn(
      `[scope] refused: user ${caller.actorId} is not HR and asked for ` +
        `${what} belonging to ${subject.userId ?? "another person"}`,
    );
    throw new UnauthorizedError(
      "Only HR can open another person's records.",
    );
  }
  return { caller, via: "hr" };
};

/**
 * HR of this municipality, and nobody else — not even the subject.
 *
 * `requireHrOrSelf` lets a person through for their OWN record, which is
 * right for reading a payslip or a PDS. It is wrong for an act performed
 * ON somebody: granting a step increment is a decision about pay, and the
 * person it benefits must not be the one who approves it.
 *
 * Same module rules as requireHrOrSelf — active grant, in this line — and
 * the same deliberate exception for a super-admin's borrowed session,
 * checked after the line test so it stays confined to that line.
 */
export const requireHr = async (
  req: FastifyRequest,
  lineId: string | null | undefined,
  what = "this action",
): Promise<Caller> => {
  const caller = await callerContext(req);

  if (!lineId || !caller.lineId || caller.lineId !== lineId) {
    console.warn(
      `[scope] refused: user ${caller.actorId} (line ${caller.lineId}) ` +
        `attempted ${what} in line ${lineId}`,
    );
    throw new UnauthorizedError("This is not your municipality's data.");
  }

  if ((req as FastifyRequest & { impersonated?: boolean }).impersonated) {
    return caller;
  }

  const hr = await prisma.module.findFirst({
    where: {
      userId: caller.actorId,
      lineId,
      moduleName: "human-resources",
      status: 1,
    },
    select: { id: true },
  });
  if (!hr) {
    console.warn(
      `[scope] refused: user ${caller.actorId} is not HR and attempted ${what}`,
    );
    throw new UnauthorizedError("Only HR can do this.");
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
