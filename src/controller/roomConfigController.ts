import { FastifyReply, FastifyRequest } from "../barrel/fastify";
import { prisma, Prisma } from "../barrel/prisma";
import {
  NotFoundError,
  ValidationError,
  UnauthorizedError,
  dbError,
} from "../errors/errors";
import { callerUserId, sendEmail } from "../middleware/handler";
import { createUserNotification } from "../service/notificationEvents";
import { EncryptionService } from "../service/encryption";

/**
 * Document room configuration.
 *
 * A ReceivingRoom is identified by `code` (its name, unique across the
 * system) and carries an `address` plus a membership list of
 * RoomAuthorizedUser rows. `type` distinguishes what a member may do:
 *
 *   0  owner       — created or was granted the room; full control
 *   1  signatory   — may sign documents in this room
 *   2  receiver    — may receive/act on documents routed here
 *
 * Everything here is scoped to the caller's line, and every membership change
 * notifies the person concerned: being made a signatory on a document room is
 * an authority change, not a silent bit-flip.
 */

export const ROOM_MEMBER_TYPES = {
  owner: 0,
  signatory: 1,
  receiver: 2,
} as const;

export const roomMemberLabel = (type: number) =>
  type === ROOM_MEMBER_TYPES.owner
    ? "Owner"
    : type === ROOM_MEMBER_TYPES.receiver
      ? "Receiver"
      : "Signatory";

const dec = async (d?: string | null, iv?: string | null) => {
  if (!d) return "";
  if (!iv) return d;
  try {
    return (await EncryptionService.decrypt(d, iv)) ?? "";
  } catch {
    return d;
  }
};

const callerLine = async (req: FastifyRequest) => {
  const accountId = (req.user as { id?: string } | undefined)?.id;
  if (!accountId) return null;
  const a = await prisma.account.findUnique({
    where: { id: accountId },
    select: { lineId: true, User: { select: { lineId: true } } },
  });
  return a?.lineId ?? a?.User?.lineId ?? null;
};

/** Resolves a room the caller's line actually owns. */
const ownedRoom = async (req: FastifyRequest, roomId: string) => {
  const lineId = await callerLine(req);
  if (!lineId) throw new UnauthorizedError("No line for this account");
  const room = await prisma.receivingRoom.findFirst({
    where: { id: roomId, lineId },
    select: { id: true, code: true, address: true, lineId: true, status: true },
  });
  if (!room) throw new NotFoundError("Document room not found");
  return { room, lineId };
};

/** Best-effort notify + email. Never lets a delivery failure undo the change. */
const tellMember = async (
  userId: string,
  actorId: string | null,
  title: string,
  content: string,
) => {
  try {
    await createUserNotification(prisma, {
      recipientId: userId,
      title,
      content,
      senderId: actorId,
    });
  } catch (e) {
    console.warn("[roomConfig] notification failed:", e);
  }
  try {
    const u = await prisma.user.findUnique({
      where: { id: userId },
      select: { firstName: true, lastName: true, email: true, emailIv: true },
    });
    const to = await dec(u?.email, u?.emailIv);
    if (!to) return;
    await sendEmail(
      title,
      to,
      `Good day ${u?.firstName ?? ""} ${u?.lastName ?? ""},

${content}

You can see the room in the portal under Document Room.

Human Resources Office
LGU Gasan`,
      "Gasan LGU HR",
    );
  } catch (e) {
    console.warn("[roomConfig] email failed:", e);
  }
};

// ── Read ───────────────────────────────────────────────────────────────────
/** GET /document/room/config?roomId= — the room plus its membership. */
export const roomConfig = async (req: FastifyRequest, res: FastifyReply) => {
  const { roomId } = req.query as { roomId?: string };
  if (!roomId) throw new ValidationError("roomId is required");
  const { room } = await ownedRoom(req, roomId);

  const members = await prisma.roomAuthorizedUser.findMany({
    where: { receivingRoomId: room.id, status: 1 },
    select: {
      id: true,
      type: true,
      timestamp: true,
      userId: true,
      user: {
        select: {
          id: true,
          firstName: true,
          firstNameIv: true,
          lastName: true,
          lastNameIv: true,
          username: true,
          profilePicture: true,
          Position: { select: { name: true } },
          department: { select: { name: true } },
        },
      },
    },
    orderBy: [{ type: "asc" }, { timestamp: "asc" }],
  });

  const list = [];
  for (const m of members) {
    const first = await dec(m.user?.firstName, m.user?.firstNameIv);
    const last = await dec(m.user?.lastName, m.user?.lastNameIv);
    list.push({
      id: m.id,
      userId: m.userId,
      type: m.type,
      role: roomMemberLabel(m.type),
      addedAt: m.timestamp,
      name:
        `${last}, ${first}`.replace(/^,\s*|,\s*$/g, "").trim() ||
        m.user?.username ||
        "Unnamed",
      position: m.user?.Position?.name ?? null,
      office: m.user?.department?.name ?? null,
      profilePicture: m.user?.profilePicture ?? null,
    });
  }

  return res.code(200).send({ room, members: list });
};

/**
 * GET /document/room/config/candidates?roomId=&query=
 *
 * Line staff who could be added. People already in the room are marked rather
 * than hidden, so HR can see why someone is missing from the results.
 */
/**
 * Which OTHER room each of these people already belongs to.
 *
 * A person belongs to one document room. Their room is where their work
 * arrives and where their signature authority sits, so being in two makes
 * "route this to them" ambiguous and quietly splits their queue in half.
 *
 * `exceptRoomId` is the room being edited: membership there is not a clash,
 * and neither is a membership that was removed (status 0) — re-adding
 * someone you took out has to keep working.
 */
const otherRoomOf = async (
  userIds: string[],
  exceptRoomId: string,
): Promise<Map<string, { id: string; code: string }>> => {
  const out = new Map<string, { id: string; code: string }>();
  if (!userIds.length) return out;
  const rows = await prisma.roomAuthorizedUser.findMany({
    where: {
      userId: { in: userIds },
      status: 1,
      receivingRoomId: { not: null },
      NOT: { receivingRoomId: exceptRoomId },
    },
    select: {
      userId: true,
      receivingRoom: { select: { id: true, code: true } },
    },
  });
  for (const r of rows) {
    if (!r.userId || !r.receivingRoom) continue;
    if (out.has(r.userId)) continue;
    out.set(r.userId, {
      id: r.receivingRoom.id,
      code: r.receivingRoom.code ?? "another room",
    });
  }
  return out;
};

export const roomCandidates = async (req: FastifyRequest, res: FastifyReply) => {
  const q = req.query as { roomId?: string; query?: string };
  if (!q.roomId) throw new ValidationError("roomId is required");
  const { room, lineId } = await ownedRoom(req, q.roomId);
  const term = (q.query || "").trim().toLowerCase();

  const already = new Set(
    (
      await prisma.roomAuthorizedUser.findMany({
        where: { receivingRoomId: room.id, status: 1 },
        select: { userId: true },
      })
    )
      .map((r) => r.userId)
      .filter((x): x is string => !!x),
  );

  const users = await prisma.user.findMany({
    where: { lineId, active: 1, archivedAt: null },
    select: {
      id: true,
      firstName: true,
      firstNameIv: true,
      lastName: true,
      lastNameIv: true,
      username: true,
      profilePicture: true,
      Position: { select: { name: true } },
      department: { select: { name: true } },
    },
    take: 600,
  });

  // Anyone already in a different room cannot be added here, so the list
  // says so instead of offering them and failing on save.
  const taken = await otherRoomOf(
    users.map((u) => u.id),
    room.id,
  );

  const out: Array<Record<string, unknown>> = [];
  for (const u of users) {
    const first = await dec(u.firstName, u.firstNameIv);
    const last = await dec(u.lastName, u.lastNameIv);
    const name =
      `${last}, ${first}`.replace(/^,\s*|,\s*$/g, "").trim() ||
      u.username ||
      "Unnamed";
    if (
      term &&
      !`${name} ${u.Position?.name ?? ""} ${u.department?.name ?? ""}`
        .toLowerCase()
        .includes(term)
    )
      continue;
    out.push({
      id: u.id,
      name,
      position: u.Position?.name ?? null,
      office: u.department?.name ?? null,
      profilePicture: u.profilePicture ?? null,
      added: already.has(u.id),
      /** The room they are already in, if it is not this one. */
      inRoom: taken.get(u.id) ?? null,
    });
    if (out.length >= 200) break;
  }
  out.sort((a, b) => String(a.name).localeCompare(String(b.name)));
  return res.code(200).send({ candidates: out });
};

// ── Rename / re-address ────────────────────────────────────────────────────
/** PATCH /document/room/config { roomId, code?, address? } */
export const updateRoomConfig = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const b = req.body as { roomId?: string; code?: string; address?: string };
  if (!b.roomId) throw new ValidationError("roomId is required");
  const { room, lineId } = await ownedRoom(req, b.roomId);
  const actorId = await callerUserId(req);

  const data: Prisma.ReceivingRoomUpdateInput = {};
  if (b.code !== undefined) {
    const code = b.code.trim();
    if (!code) throw new ValidationError("The room needs a name");
    if (code.length > 80)
      throw new ValidationError("That room name is too long");
    // `code` is globally unique — catch the clash here so the user gets a
    // sentence instead of a Prisma P2002.
    if (code.toLowerCase() !== room.code.toLowerCase()) {
      const clash = await prisma.receivingRoom.findUnique({
        where: { code },
        select: { id: true },
      });
      if (clash && clash.id !== room.id)
        throw new ValidationError(
          `Another document room is already named "${code}".`,
        );
    }
    data.code = code;
  }
  if (b.address !== undefined) data.address = b.address.trim() || null;

  if (!Object.keys(data).length)
    throw new ValidationError("Nothing to change");

  try {
    const updated = await prisma.receivingRoom.update({
      where: { id: room.id },
      data,
      select: { id: true, code: true, address: true },
    });

    await prisma.humanResourcesLogs
      .create({
        data: {
          action: "UPDATE",
          desc: `DOCUMENT ROOM updated -> ${room.code}${
            data.code ? ` renamed to ${updated.code}` : ""
          }`,
          lineId,
          userId: actorId ?? "",
        },
      })
      .catch((e) => console.warn("[roomConfig] log failed:", e));

    return res.code(200).send(updated);
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError) throw dbError(e);
    throw e;
  }
};

// ── Membership ─────────────────────────────────────────────────────────────
/** POST /document/room/config/members { roomId, userIds[], type } */
export const addRoomMembers = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const b = req.body as {
    roomId?: string;
    userIds?: string[];
    type?: number | string;
  };
  if (!b.roomId) throw new ValidationError("roomId is required");
  const { room, lineId } = await ownedRoom(req, b.roomId);
  const actorId = await callerUserId(req);

  const type = Number(b.type ?? ROOM_MEMBER_TYPES.signatory);
  if (![0, 1, 2].includes(type))
    throw new ValidationError("Pick signatory or receiver");

  const ids = [...new Set(Array.isArray(b.userIds) ? b.userIds : [])];
  if (!ids.length) throw new ValidationError("Pick at least one person");

  // The candidate list already hides these, but a list is a hint and this
  // is the rule: one person, one room.
  const taken = await otherRoomOf(ids, room.id);

  let added = 0;
  const notified: string[] = [];
  /** Who was refused, and which room already has them. */
  const skipped: Array<{ userId: string; room: string }> = [];
  for (const userId of ids) {
    // Line-scoped: a room can never be handed to someone from another office.
    const u = await prisma.user.findFirst({
      where: { id: userId, lineId },
      select: { id: true },
    });
    if (!u) continue;

    const clash = taken.get(userId);
    if (clash) {
      skipped.push({ userId, room: clash.code });
      continue;
    }

    const existing = await prisma.roomAuthorizedUser.findFirst({
      where: { receivingRoomId: room.id, userId },
      select: { id: true, type: true, status: true },
    });

    if (existing) {
      // Re-adding someone who was removed reinstates them; changing their role
      // updates it. Either way it is one membership row, never a duplicate.
      if (existing.status === 1 && existing.type === type) continue;
      await prisma.roomAuthorizedUser.update({
        where: { id: existing.id },
        data: { type, status: 1 },
      });
    } else {
      await prisma.roomAuthorizedUser.create({
        data: { receivingRoomId: room.id, userId, type, status: 1 },
      });
    }
    added++;
    notified.push(userId);
  }

  // Notify outside the write loop so a slow mail server cannot stall the save.
  for (const userId of notified) {
    void tellMember(
      userId,
      actorId,
      `Added to ${room.code}`,
      `You have been added to the document room "${room.code}" as a ${roomMemberLabel(
        type,
      ).toLowerCase()}.`,
    );
  }

  await prisma.humanResourcesLogs
    .create({
      data: {
        action: "CREATE",
        desc: `DOCUMENT ROOM ${room.code} -> added ${added} ${roomMemberLabel(type).toLowerCase()}(s)`,
        lineId,
        userId: actorId ?? "",
      },
    })
    .catch(() => undefined);

  return res.code(200).send({ added, notified: notified.length, skipped });
};

/** PATCH /document/room/config/member { roomId, memberId, type } */
export const updateRoomMember = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const b = req.body as { roomId?: string; memberId?: string; type?: number };
  if (!b.roomId || !b.memberId)
    throw new ValidationError("roomId and memberId are required");
  const { room } = await ownedRoom(req, b.roomId);
  const actorId = await callerUserId(req);

  const type = Number(b.type);
  if (![0, 1, 2].includes(type)) throw new ValidationError("Unknown role");

  const member = await prisma.roomAuthorizedUser.findFirst({
    where: { id: b.memberId, receivingRoomId: room.id },
    select: { id: true, userId: true, type: true },
  });
  if (!member) throw new NotFoundError("That person is not in this room");
  if (member.type === type) return res.code(200).send({ message: "OK" });

  // Never leave a room with nobody who can administer it.
  if (member.type === ROOM_MEMBER_TYPES.owner) {
    const owners = await prisma.roomAuthorizedUser.count({
      where: {
        receivingRoomId: room.id,
        type: ROOM_MEMBER_TYPES.owner,
        status: 1,
      },
    });
    if (owners <= 1)
      throw new ValidationError(
        "This is the room's only owner. Make someone else an owner first.",
      );
  }

  await prisma.roomAuthorizedUser.update({
    where: { id: member.id },
    data: { type },
  });

  if (member.userId)
    void tellMember(
      member.userId,
      actorId,
      `Your role in ${room.code} changed`,
      `You are now a ${roomMemberLabel(type).toLowerCase()} in the document room "${room.code}".`,
    );

  return res.code(200).send({ message: "OK", type });
};

/** DELETE /document/room/config/member?roomId=&memberId= */
export const removeRoomMember = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const q = req.query as { roomId?: string; memberId?: string };
  if (!q.roomId || !q.memberId)
    throw new ValidationError("roomId and memberId are required");
  const { room } = await ownedRoom(req, q.roomId);
  const actorId = await callerUserId(req);

  const member = await prisma.roomAuthorizedUser.findFirst({
    where: { id: q.memberId, receivingRoomId: room.id },
    select: { id: true, userId: true, type: true },
  });
  if (!member) throw new NotFoundError("That person is not in this room");

  if (member.type === ROOM_MEMBER_TYPES.owner) {
    const owners = await prisma.roomAuthorizedUser.count({
      where: {
        receivingRoomId: room.id,
        type: ROOM_MEMBER_TYPES.owner,
        status: 1,
      },
    });
    if (owners <= 1)
      throw new ValidationError(
        "This is the room's only owner — the room would be left with nobody in charge.",
      );
  }

  // Soft-remove: their signatures and past actions in this room stay
  // attributable. A hard delete would cascade the audit trail away.
  await prisma.roomAuthorizedUser.update({
    where: { id: member.id },
    data: { status: 0 },
  });

  if (member.userId)
    void tellMember(
      member.userId,
      actorId,
      `Removed from ${room.code}`,
      `You no longer have access to the document room "${room.code}".`,
    );

  return res.code(200).send({ message: "OK" });
};
