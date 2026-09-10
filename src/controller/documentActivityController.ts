// The Document module's Activity panel.
//
// One request, because the panel is one glance. It answers two questions,
// in the order somebody actually asks them:
//
//   1. What is waiting for ME?                (needsYou)
//   2. What did we send, and where is it now? (outbox)
//
// The Logs tab is the third question — what just happened — and is paged
// separately below.
//
// Everything here is scoped to ONE receiving room: the office the reader
// works in. "Waiting for you" is meaningless without it. The room id comes
// from the query and is checked against the caller's membership before a
// single row is read.

import { FastifyReply, FastifyRequest } from "../barrel/fastify";
import { prisma, Prisma } from "../barrel/prisma";
import { AppError, ValidationError } from "../errors/errors";
import { callerContext, requireRoomMember } from "../service/callerScope";
import { VISIBLE_TO_ROOM } from "../service/copyFurnish";
import { ROOM_MEMBER_TYPES } from "./roomConfigController";

/** How many rows of each pile the panel shows before "and N more". */
const PEEK = 6;

/**
 * Midnight, here.
 *
 * The server runs in UTC and the office does not. A "today" counted in UTC
 * is eight hours out: at nine in the morning in Gasan it would still be
 * reporting yesterday's work, which is exactly when somebody looks at it.
 */
const PH_OFFSET_MIN = 8 * 60;
const startOfToday = (): Date => {
  const shifted = new Date(Date.now() + PH_OFFSET_MIN * 60_000);
  shifted.setUTCHours(0, 0, 0, 0);
  return new Date(shifted.getTime() - PH_OFFSET_MIN * 60_000);
};

const fullName = (
  u?: { firstName?: string | null; lastName?: string | null } | null,
) => (u ? `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim() || null : null);

export const documentActivityPanel = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const params = req.query as { roomId?: string };
  if (!params.roomId) throw new ValidationError("INVALID REQUIRED ID");
  const member = await requireRoomMember(req, params.roomId);
  const roomId = params.roomId;
  const me = member.actorId;

  // A signatory signs and a receiver receives. Somebody who can do
  // neither should not be handed a pile labelled "waiting for you".
  const canAcknowledge =
    member.type === ROOM_MEMBER_TYPES.owner ||
    member.type === ROOM_MEMBER_TYPES.receiver;

  try {
    const since = startOfToday();

    /** Rows that have actually reached this office. */
    const delivered: Prisma.TargetRoomWhereInput = {
      receivingRoomId: roomId,
      queueRoom: { is: { status: { gte: 1 } } },
      ...VISIBLE_TO_ROOM,
    };
    const arrivedRow = {
      id: true,
      timestamp: true,
      releasedAt: true,
      viewedAt: true,
      acknowledgedAt: true,
      copyFurnished: true,
      queueRoom: {
        select: {
          id: true,
          title: true,
          status: true,
          user: { select: { firstName: true, lastName: true } },
          fromRoom: { select: { code: true } },
        },
      },
    } as const;

    const [
      // ── 1. Waiting for you ──────────────────────────────────────────
      toSignRows,
      toSignTotal,
      unopenedRows,
      unopenedTotal,
      unreceivedRows,
      unreceivedTotal,
      inboxTotal,
      // ── 2. What we sent ─────────────────────────────────────────────
      outRows,
      outCounts,
      // ── 3. Today ────────────────────────────────────────────────────
      signedToday,
      openedToday,
      receiptsToday,
      startedToday,
      responseSample,
    ] = await Promise.all([
      prisma.signatoryArrangement.findMany({
        where: {
          userId: me,
          status: 0,
          signatureQueueRoom: { is: { status: 1 } },
        },
        orderBy: { timestamp: "asc" },
        take: PEEK,
        select: {
          id: true,
          index: true,
          timestamp: true,
          signatureQueueRoom: {
            select: {
              id: true,
              title: true,
              timestamp: true,
              fromRoom: { select: { code: true } },
              user: { select: { firstName: true, lastName: true } },
              signatotyArrangement: { select: { status: true } },
            },
          },
        },
      }),
      prisma.signatoryArrangement.count({
        where: {
          userId: me,
          status: 0,
          signatureQueueRoom: { is: { status: 1 } },
        },
      }),

      prisma.targetRoom.findMany({
        where: { ...delivered, viewedAt: null },
        orderBy: { timestamp: "desc" },
        take: PEEK,
        select: arrivedRow,
      }),
      prisma.targetRoom.count({ where: { ...delivered, viewedAt: null } }),

      prisma.targetRoom.findMany({
        where: { ...delivered, acknowledgedAt: null },
        orderBy: { timestamp: "asc" }, // the oldest debt first
        take: PEEK,
        select: arrivedRow,
      }),
      prisma.targetRoom.count({ where: { ...delivered, acknowledgedAt: null } }),
      prisma.targetRoom.count({ where: delivered }),

      prisma.signatureQueueRoom.findMany({
        where: { receivingRoomId: roomId, status: 1 },
        orderBy: { timestamp: "desc" },
        take: PEEK,
        select: {
          id: true,
          title: true,
          timestamp: true,
          signatotyArrangement: { select: { status: true } },
          targetRooms: {
            where: VISIBLE_TO_ROOM,
            select: {
              viewedAt: true,
              acknowledgedAt: true,
              roomReceiver: { select: { code: true } },
            },
          },
        },
      }),
      prisma.signatureQueueRoom.groupBy({
        by: ["status"],
        where: { receivingRoomId: roomId },
        _count: { _all: true },
      }),

      prisma.signatoryArrangement.count({
        where: { userId: me, status: 1, signedAt: { gte: since } },
      }),
      prisma.targetRoom.count({
        where: { receivingRoomId: roomId, viewedAt: { gte: since } },
      }),
      prisma.targetRoom.count({
        where: { receivingRoomId: roomId, acknowledgedAt: { gte: since } },
      }),
      prisma.signatureQueueRoom.count({
        where: { receivingRoomId: roomId, timestamp: { gte: since } },
      }),
      // How long this office takes to sign for what it gets. Real
      // numbers from the last 50 receipts, and shown only once there are
      // enough of them to mean anything.
      prisma.targetRoom.findMany({
        where: { receivingRoomId: roomId, acknowledgedAt: { not: null } },
        orderBy: { acknowledgedAt: "desc" },
        take: 50,
        select: { timestamp: true, releasedAt: true, acknowledgedAt: true },
      }),
    ]);

    // ── Shape 1: signatures with your name on them ────────────────────
    const toSign = toSignRows.map((a) => {
      const slots = a.signatureQueueRoom?.signatotyArrangement ?? [];
      return {
        arrangementId: a.id,
        queueId: a.signatureQueueRoom?.id ?? null,
        title: a.signatureQueueRoom?.title ?? "Untitled routing",
        from:
          a.signatureQueueRoom?.fromRoom?.code ??
          fullName(a.signatureQueueRoom?.user) ??
          "—",
        sentAt: a.signatureQueueRoom?.timestamp ?? a.timestamp,
        // Position on the sheet, and how much of it is already done.
        // Deliberately NOT phrased as "your turn": signing is not
        // order-gated in this system, so saying it was would tell people
        // to wait when they can sign right now.
        position: a.index + 1,
        totalSignatories: slots.length,
        signed: slots.filter((s) => s.status === 1).length,
      };
    });

    const arrived = (r: (typeof unopenedRows)[number]) => ({
      targetId: r.id,
      queueId: r.queueRoom?.id ?? null,
      title: r.queueRoom?.title ?? "Untitled routing",
      from: r.queueRoom?.fromRoom?.code ?? fullName(r.queueRoom?.user) ?? "—",
      arrivedAt: r.releasedAt ?? r.timestamp,
      copyFurnished: r.copyFurnished,
      viewedAt: r.viewedAt,
      acknowledgedAt: r.acknowledgedAt,
    });

    // ── Shape 2: where the things we sent have got to ─────────────────
    const inFlight = outRows.map((q) => {
      const slots = q.signatotyArrangement;
      const targets = q.targetRooms;
      return {
        queueId: q.id,
        title: q.title ?? "Untitled routing",
        sentAt: q.timestamp,
        signed: slots.filter((s) => s.status === 1).length,
        totalSignatories: slots.length,
        opened: targets.filter((t) => t.viewedAt).length,
        received: targets.filter((t) => t.acknowledgedAt).length,
        totalRecipients: targets.length,
        // The offices still owing you a receipt, by name. A panel that
        // says "3 of 5" and makes you open the routing to find out which
        // two is not saving anybody a phone call.
        waitingOn: targets
          .filter((t) => !t.acknowledgedAt)
          .map((t) => t.roomReceiver?.code)
          .filter((x): x is string => !!x)
          .slice(0, 4),
      };
    });

    const byStatus = (s: number) =>
      outCounts.find((c) => c.status === s)?._count._all ?? 0;

    const gaps = responseSample
      .map((r) => {
        const from = (r.releasedAt ?? r.timestamp)?.getTime();
        const to = r.acknowledgedAt?.getTime();
        return from && to && to > from ? to - from : null;
      })
      .filter((x): x is number => x !== null);
    const avgResponseMs =
      gaps.length >= 3
        ? Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length)
        : null;

    return res.code(200).send({
      room: { id: roomId },
      canAcknowledge,
      needsYou: {
        toSign,
        toSignTotal,
        toOpen: unopenedRows.map(arrived),
        toOpenTotal: unopenedTotal,
        // Only somebody whose job it is gets handed the receipts pile.
        toReceive: canAcknowledge ? unreceivedRows.map(arrived) : [],
        toReceiveTotal: canAcknowledge ? unreceivedTotal : 0,
      },
      inbox: { total: inboxTotal },
      outbox: {
        inFlight,
        draft: byStatus(0),
        active: byStatus(1),
        completed: byStatus(2),
        cancelled: byStatus(3),
      },
      today: {
        signedByYou: signedToday,
        opened: openedToday,
        receipts: receiptsToday,
        started: startedToday,
        avgResponseMs,
      },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
    }
    throw error;
  }
};

/**
 * The Logs tab: what has happened in this municipality's Document module.
 *
 * A municipal audit trail rather than a personal one — the same rows the
 * admin log reads, paged for a narrow panel. Scoped to the caller's line
 * through their room, never through a line id in the query.
 */
export const documentActivityLog = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const params = req.query as {
    roomId?: string;
    lastCursor?: string | null;
    limit?: string;
  };
  if (!params.roomId) throw new ValidationError("INVALID REQUIRED ID");
  await requireRoomMember(req, params.roomId);

  try {
    const room = await prisma.receivingRoom.findUnique({
      where: { id: params.roomId },
      select: { lineId: true },
    });
    if (!room?.lineId)
      return res.code(200).send({ list: [], lastCursor: null, hasMore: false });

    const limit = Math.min(params.limit ? parseInt(params.limit, 10) : 20, 50);
    // Axios serialises a null query param as the string "null".
    const cursor =
      params.lastCursor && params.lastCursor !== "null"
        ? { id: params.lastCursor }
        : undefined;

    const rows = await prisma.documentActivityLogs.findMany({
      where: { lineId: room.lineId },
      take: limit,
      skip: cursor ? 1 : 0,
      cursor,
      orderBy: { timestamp: "desc" },
      select: {
        id: true,
        title: true,
        desc: true,
        action: true,
        timestamp: true,
        documentId: true,
        user: { select: { id: true, firstName: true, lastName: true } },
      },
    });

    return res.code(200).send({
      list: rows.map((r) => ({
        id: r.id,
        title: r.title,
        desc: r.desc,
        action: r.action,
        timestamp: r.timestamp,
        documentId: r.documentId,
        who: fullName(r.user),
      })),
      lastCursor: rows.length ? rows[rows.length - 1].id : null,
      hasMore: rows.length === limit,
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
    }
    throw error;
  }
};

/**
 * Everything the CALLER personally owes, across every office they work in.
 *
 * The panel endpoint above is office-shaped: it needs a room id, because
 * "waiting on you" on a desktop means "waiting on this office". A phone
 * has no room picker and its owner does not think in rooms — they think
 * "do I have anything to sign". So this one is person-shaped: it takes no
 * room, walks the caller's memberships itself, and answers that question.
 *
 * It is also what the mobile badge counts, so it stays cheap: two lists
 * capped short, and the true totals alongside them.
 */
const PENDING_PEEK = 25;

export const documentMyPending = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const { actorId } = await callerContext(req);

  try {
    // The offices this person actually works in, and in which role. Only
    // an owner or a receiver can sign for a document, so only their rooms
    // contribute to the "to receive" pile — showing a signatory a receipt
    // they are not allowed to make is worse than showing them nothing.
    const memberships = await prisma.roomAuthorizedUser.findMany({
      where: { userId: actorId, status: 1 },
      select: { receivingRoomId: true, type: true },
    });
    const receiptRoomIds = memberships
      .filter(
        (m) =>
          m.type === ROOM_MEMBER_TYPES.owner ||
          m.type === ROOM_MEMBER_TYPES.receiver,
      )
      .map((m) => m.receivingRoomId)
      .filter((x): x is string => !!x);

    const owedHere: Prisma.TargetRoomWhereInput = {
      receivingRoomId: { in: receiptRoomIds },
      queueRoom: { is: { status: { gte: 1 } } },
      acknowledgedAt: null,
      ...VISIBLE_TO_ROOM,
    };
    const mineToSign: Prisma.SignatoryArrangementWhereInput = {
      userId: actorId,
      status: 0,
      signatureQueueRoom: { is: { status: 1 } },
    };

    const [signRows, signTotal, recvRows, recvTotal] = await Promise.all([
      prisma.signatoryArrangement.findMany({
        where: mineToSign,
        orderBy: { timestamp: "asc" },
        take: PENDING_PEEK,
        select: {
          id: true,
          index: true,
          timestamp: true,
          signatureQueueRoom: {
            select: {
              id: true,
              title: true,
              timestamp: true,
              fromRoom: { select: { code: true } },
              user: { select: { firstName: true, lastName: true } },
              signatotyArrangement: { select: { status: true } },
              _count: { select: { documents: true } },
            },
          },
        },
      }),
      prisma.signatoryArrangement.count({ where: mineToSign }),
      receiptRoomIds.length
        ? prisma.targetRoom.findMany({
            where: owedHere,
            orderBy: { timestamp: "asc" },
            take: PENDING_PEEK,
            select: {
              id: true,
              timestamp: true,
              releasedAt: true,
              viewedAt: true,
              copyFurnished: true,
              roomReceiver: { select: { id: true, code: true } },
              queueRoom: {
                select: {
                  id: true,
                  title: true,
                  user: { select: { firstName: true, lastName: true } },
                  fromRoom: { select: { code: true } },
                  _count: { select: { documents: true } },
                },
              },
            },
          })
        : Promise.resolve([]),
      receiptRoomIds.length
        ? prisma.targetRoom.count({ where: owedHere })
        : Promise.resolve(0),
    ]);

    const toSign = signRows.map((a) => {
      const slots = a.signatureQueueRoom?.signatotyArrangement ?? [];
      return {
        arrangementId: a.id,
        queueId: a.signatureQueueRoom?.id ?? null,
        title: a.signatureQueueRoom?.title ?? "Untitled routing",
        from:
          a.signatureQueueRoom?.fromRoom?.code ??
          fullName(a.signatureQueueRoom?.user) ??
          "—",
        sentAt: a.signatureQueueRoom?.timestamp ?? a.timestamp,
        position: a.index + 1,
        totalSignatories: slots.length,
        signed: slots.filter((s) => s.status === 1).length,
        files: a.signatureQueueRoom?._count.documents ?? 0,
      };
    });

    const toReceive = recvRows.map((r) => ({
      targetId: r.id,
      queueId: r.queueRoom?.id ?? null,
      title: r.queueRoom?.title ?? "Untitled routing",
      from: r.queueRoom?.fromRoom?.code ?? fullName(r.queueRoom?.user) ?? "—",
      // Which of your offices owes this one. Somebody who sits in two
      // rooms cannot act on the list without being told.
      office: r.roomReceiver?.code ?? null,
      arrivedAt: r.releasedAt ?? r.timestamp,
      copyFurnished: r.copyFurnished,
      opened: r.viewedAt !== null,
      files: r.queueRoom?._count.documents ?? 0,
    }));

    return res.code(200).send({
      toSign,
      toReceive,
      counts: {
        toSign: signTotal,
        toReceive: recvTotal,
        total: signTotal + recvTotal,
      },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
    }
    throw error;
  }
};
