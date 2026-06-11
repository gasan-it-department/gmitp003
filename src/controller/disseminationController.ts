// Document Dissemination — the routing/approval pipeline.
//
// Entities involved:
//   - SignatureQueueRoom: the dissemination room (1 per "send-out").
//     • receivingRoomId   = the "from" room (where the disseminator works)
//     • status:  0 draft · 1 active · 2 completed · 3 cancelled
//     • step:    0 setup · 1 dispatched (in-flight)
//   - TargetRoom: receivers (which rooms the docs land in).
//   - SignatoryArrangement: ordered list of signatories that must sign.
//     • Carries an explicit `index` so we control the signing order.
//     • status: 0 pending · 1 signed · 2 rejected
//
// All writes are scoped to the room the disseminator belongs to (the
// front-end passes the room id from DocumentRoomProvider).

import { FastifyReply, FastifyRequest } from "../barrel/fastify";
import { prisma, Prisma } from "../barrel/prisma";
import { AppError, NotFoundError, ValidationError } from "../errors/errors";
import { createUserNotification } from "../service/notificationEvents";

// ── Outbox: disseminations created BY this room ────────────────────────
export const disseminationOutbox = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const params = req.query as {
    fromRoomId?: string;
    lastCursor?: string | null;
    limit?: string;
    query?: string;
    status?: string; // "draft" | "active" | "completed" | "all"
  };
  if (!params.fromRoomId) throw new ValidationError("INVALID REQUIRED ID");

  try {
    const limit = params.limit ? parseInt(params.limit, 10) : 20;
    // Axios serializes null query params as the literal string "null".
    // Guard against that here so Prisma doesn't get { id: "null" } and
    // return an empty page.
    const cursor =
      params.lastCursor && params.lastCursor !== "null"
        ? { id: params.lastCursor }
        : undefined;

    const statusMap: Record<string, number | undefined> = {
      draft: 0,
      active: 1,
      completed: 2,
      cancelled: 3,
    };
    const where: any = { receivingRoomId: params.fromRoomId };
    if (params.status && params.status !== "all") {
      const s = statusMap[params.status];
      if (typeof s === "number") where.status = s;
    }
    if (params.query?.trim()) {
      where.title = {
        contains: params.query.trim(),
        mode: "insensitive",
      };
    }

    const rows = await prisma.signatureQueueRoom.findMany({
      where,
      take: limit,
      skip: cursor ? 1 : 0,
      cursor,
      orderBy: { timestamp: "desc" },
      include: {
        _count: {
          select: {
            documents: true,
            signatotyArrangement: true,
            targetRooms: true,
          },
        },
        targetRooms: {
          select: {
            id: true,
            roomReceiver: { select: { id: true, code: true, address: true } },
          },
        },
        signatotyArrangement: {
          orderBy: { index: "asc" },
          select: { id: true, index: true, status: true },
        },
      },
    });

    const lastCursor = rows.length ? rows[rows.length - 1].id : null;
    const hasMore = rows.length === limit;
    return res.code(200).send({ list: rows, lastCursor, hasMore });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
    }
    throw error;
  }
};

// ── Inbox: disseminations targeting this room ──────────────────────────
export const disseminationInbox = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const params = req.query as {
    toRoomId?: string;
    lastCursor?: string | null;
    limit?: string;
  };
  if (!params.toRoomId) throw new ValidationError("INVALID REQUIRED ID");

  try {
    const limit = params.limit ? parseInt(params.limit, 10) : 20;
    // Axios serializes null query params as the literal string "null".
    // Guard against that here so Prisma doesn't get { id: "null" } and
    // return an empty page.
    const cursor =
      params.lastCursor && params.lastCursor !== "null"
        ? { id: params.lastCursor }
        : undefined;

    // Diagnostic snapshot of every TargetRoom that matches this room id
    // (regardless of dispatch state). Surfaced in the response so the
    // empty-inbox screen can show what the data actually looks like.
    const rawTargets = await prisma.targetRoom.findMany({
      where: { receivingRoomId: params.toRoomId },
      orderBy: { timestamp: "desc" },
      take: 10,
      select: {
        id: true,
        status: true,
        signatureQueueRoomId: true,
        queueRoom: {
          select: { id: true, title: true, status: true, step: true },
        },
      },
    });
    const dispatchedCount = rawTargets.filter(
      (t) => (t.queueRoom?.status ?? 0) >= 1,
    ).length;

    const rows = await prisma.targetRoom.findMany({
      where: {
        receivingRoomId: params.toRoomId,
        queueRoom: { is: { status: { gte: 1 } } },
      },
      take: limit,
      skip: cursor ? 1 : 0,
      cursor,
      orderBy: { timestamp: "desc" },
      include: {
        queueRoom: {
          select: {
            id: true,
            title: true,
            status: true,
            step: true,
            timestamp: true,
            user: { select: { id: true, firstName: true, lastName: true } },
            fromRoom: {
              select: { id: true, code: true, address: true },
            },
            _count: { select: { documents: true } },
          },
        },
      },
    });

    const lastCursor = rows.length ? rows[rows.length - 1].id : null;
    const hasMore = rows.length === limit;
    return res.code(200).send({
      list: rows,
      lastCursor,
      hasMore,
      debug: {
        toRoomId: params.toRoomId,
        rawCount: rawTargets.length,
        dispatchedCount,
        sample: rawTargets,
      },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
    }
    throw error;
  }
};

// ── Detail ─────────────────────────────────────────────────────────────
export const disseminationDetail = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const params = req.query as { id: string };
  if (!params.id) throw new ValidationError("INVALID REQUIRED ID");

  try {
    const row = await prisma.signatureQueueRoom.findUnique({
      where: { id: params.id },
      include: {
        fromRoom: {
          select: { id: true, code: true, address: true, lineId: true },
        },
        targetRooms: {
          select: {
            id: true,
            receivingRoomId: true,
            roomReceiver: {
              select: { id: true, code: true, address: true },
            },
          },
        },
        documents: {
          select: { id: true, title: true, timestamp: true },
        },
        signatotyArrangement: {
          orderBy: { index: "asc" },
          select: {
            id: true,
            index: true,
            status: true,
            signedAt: true,
            timestamp: true,
          },
        },
        user: { select: { id: true, firstName: true, lastName: true } },
      },
    });
    if (!row) throw new NotFoundError("DISSEMINATION NOT FOUND");

    return res.code(200).send(row);
  } catch (error) {
    if (error instanceof NotFoundError) throw error;
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
    }
    throw error;
  }
};

// ── Set target rooms (replace) ─────────────────────────────────────────
export const setTargetRooms = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const body = req.body as {
    queueRoomId: string;
    targetRoomIds: string[];
    userId: string;
    lineId: string;
  };
  if (!body.queueRoomId || !Array.isArray(body.targetRoomIds)) {
    throw new ValidationError("INVALID REQUIRED FIELDS");
  }

  try {
    await prisma.$transaction(async (tx) => {
      const queue = await tx.signatureQueueRoom.findUnique({
        where: { id: body.queueRoomId },
      });
      if (!queue) throw new NotFoundError("Dissemination not found");
      if (queue.status !== 0) {
        throw new ValidationError(
          "Cannot change targets after the dissemination has been dispatched.",
        );
      }

      // Replace strategy: drop existing target rows for this queue, recreate.
      await tx.targetRoom.deleteMany({
        where: { signatureQueueRoomId: body.queueRoomId },
      });
      console.log("[setTargets] queueRoomId:", body.queueRoomId);
      console.log("[setTargets] targetRoomIds:", body.targetRoomIds);
      if (body.targetRoomIds.length > 0) {
        const created = await tx.targetRoom.createMany({
          data: body.targetRoomIds.map((rid) => ({
            signatureQueueRoomId: body.queueRoomId,
            receivingRoomId: rid,
            status: 0,
          })),
        });
        console.log("[setTargets] created count:", created.count);
      }

      if (body.userId) {
        await tx.documentActivityLogs.create({
          data: {
            userId: body.userId,
            lineId: body.lineId,
            title: "Updated dissemination targets",
            desc:
              `Set ${body.targetRoomIds.length} target room` +
              `${body.targetRoomIds.length === 1 ? "" : "s"} on queue ${body.queueRoomId}`,
            action: 2,
          },
        });
      }
    });
    return res.code(200).send({ message: "OK" });
  } catch (error) {
    if (error instanceof NotFoundError) throw error;
    if (error instanceof ValidationError) throw error;
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
    }
    throw error;
  }
};

// ── Set signatories with order (replace) ───────────────────────────────
export const setSignatoryArrangement = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const body = req.body as {
    queueRoomId: string;
    /**
     * Caller-defined ordered list of signatories. Each entry refers to a
     * RoomAuthorizedUser.id; the index is the signing order (0-based).
     */
    signatories: { roomAuthorizedUserId: string }[];
    userId: string;
    lineId: string;
  };

  if (!body.queueRoomId || !Array.isArray(body.signatories)) {
    throw new ValidationError("INVALID REQUIRED FIELDS");
  }

  try {
    await prisma.$transaction(async (tx) => {
      const queue = await tx.signatureQueueRoom.findUnique({
        where: { id: body.queueRoomId },
      });
      if (!queue) throw new NotFoundError("Dissemination not found");
      if (queue.status !== 0) {
        throw new ValidationError(
          "Cannot change signatories after the dissemination has been dispatched.",
        );
      }

      // Resolve each RoomAuthorizedUser.id → its underlying User.id so
      // we can persist who actually owns each signing slot. Signers later
      // identify themselves by User.id when auto-signing.
      console.log("[setSignatories] incoming:", {
        queueRoomId: body.queueRoomId,
        count: body.signatories.length,
        ids: body.signatories.map((s) => s.roomAuthorizedUserId),
      });
      const authUsers = await tx.roomAuthorizedUser.findMany({
        where: {
          id: { in: body.signatories.map((s) => s.roomAuthorizedUserId) },
        },
        select: { id: true, userId: true },
      });
      console.log("[setSignatories] resolved auth users:", authUsers);
      const authToUserId = new Map(
        authUsers.map((r) => [r.id, r.userId]),
      );

      // Upsert by index — preserve existing arrangement rows (boxes drawn
      // during the Documents step are bound to these by index, so we can't
      // just delete them). Also (re)assign the user at each slot.
      const existing = await tx.signatoryArrangement.findMany({
        where: { signatureQueueRoomId: body.queueRoomId },
        select: { id: true, index: true },
      });
      const byIndex = new Map(existing.map((r) => [r.index, r.id]));

      for (let i = 0; i < body.signatories.length; i++) {
        const userIdForSlot =
          authToUserId.get(body.signatories[i].roomAuthorizedUserId) ?? null;
        const arrId = byIndex.get(i);
        console.log("[setSignatories] slot", i, {
          roomAuthUserId: body.signatories[i].roomAuthorizedUserId,
          userIdForSlot,
          existingArrId: arrId,
        });
        if (!arrId) {
          await tx.signatoryArrangement.create({
            data: {
              signatureQueueRoomId: body.queueRoomId,
              index: i,
              status: 0,
              userId: userIdForSlot,
            },
          });
        } else {
          // Update assignment if it changed.
          await tx.signatoryArrangement.update({
            where: { id: arrId },
            data: { userId: userIdForSlot },
          });
        }
      }
      // Drop any rows beyond the new count — placements bound to those
      // slots become orphaned (signCoor.signatoryArrangementId = NULL via
      // optional FK), which the editor surfaces so the user can re-assign.
      const drop = existing
        .filter((r) => r.index >= body.signatories.length)
        .map((r) => r.id);
      if (drop.length > 0) {
        await tx.signatoryArrangement.deleteMany({
          where: { id: { in: drop } },
        });
      }

      if (body.userId) {
        await tx.documentActivityLogs.create({
          data: {
            userId: body.userId,
            lineId: body.lineId,
            title: "Updated signatory arrangement",
            desc:
              `Set ${body.signatories.length} signator` +
              `${body.signatories.length === 1 ? "y" : "ies"} on queue ${body.queueRoomId}`,
            action: 2,
          },
        });
      }
    });
    return res.code(200).send({ message: "OK" });
  } catch (error) {
    if (error instanceof NotFoundError) throw error;
    if (error instanceof ValidationError) throw error;
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
    }
    throw error;
  }
};

// ── Finalize: flip status from draft (0) → active (1) ──────────────────
export const finalizeDissemination = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const body = req.body as {
    queueRoomId: string;
    userId: string;
    lineId: string;
  };
  if (!body.queueRoomId) throw new ValidationError("INVALID REQUIRED ID");

  try {
    const result = await prisma.$transaction(async (tx) => {
      const queue = await tx.signatureQueueRoom.findUnique({
        where: { id: body.queueRoomId },
        include: {
          _count: { select: { targetRooms: true, documents: true } },
        },
      });
      if (!queue) throw new NotFoundError("Dissemination not found");
      if (queue.status !== 0) {
        throw new ValidationError(
          "Already dispatched. Only drafts can be finalized.",
        );
      }
      if ((queue._count?.targetRooms ?? 0) === 0) {
        throw new ValidationError("Add at least one target room first.");
      }
      if ((queue._count?.documents ?? 0) === 0) {
        throw new ValidationError("Attach at least one document first.");
      }

      const updated = await tx.signatureQueueRoom.update({
        where: { id: body.queueRoomId },
        data: { status: 1, step: 1 },
      });
      console.log("[finalize] queue updated:", {
        id: updated.id,
        status: updated.status,
        step: updated.step,
      });

      // Mark every target row as delivered.
      const targetUpdate = await tx.targetRoom.updateMany({
        where: { signatureQueueRoomId: body.queueRoomId },
        data: { status: 1, receivedAt: new Date() },
      });
      console.log("[finalize] target rows updated:", targetUpdate.count);

      // Diagnostic: what target rows actually exist for this queue?
      const targetsAfter = await tx.targetRoom.findMany({
        where: { signatureQueueRoomId: body.queueRoomId },
        select: { id: true, receivingRoomId: true, status: true },
      });
      console.log("[finalize] target rows present:", targetsAfter);

      if (body.userId) {
        await tx.documentActivityLogs.create({
          data: {
            userId: body.userId,
            lineId: body.lineId,
            title: "Dispatched dissemination",
            desc: `Dissemination "${queue.title ?? body.queueRoomId}" finalized and dispatched.`,
            action: 1,
          },
        });
      }

      // Real-time notifications to every signatory so they know they
      // have something to sign. We use the User.id from the arrangement
      // (set during the wizard's Signatories step).
      const signatories = await tx.signatoryArrangement.findMany({
        where: {
          signatureQueueRoomId: body.queueRoomId,
          userId: { not: null },
        },
        select: { userId: true },
      });
      const seen = new Set<string>();
      for (const s of signatories) {
        if (!s.userId || seen.has(s.userId)) continue;
        seen.add(s.userId);
        await createUserNotification(tx, {
          recipientId: s.userId,
          senderId: body.userId,
          title: "Signature requested",
          content: `You're a signatory on "${queue.title ?? "a dissemination"}". Open it from your Inbox to sign.`,
          path: `documents/dissemination?tab=inbox`,
        });
      }
      return updated;
    });
    return res.code(200).send({ message: "OK", id: result.id });
  } catch (error) {
    if (error instanceof NotFoundError) throw error;
    if (error instanceof ValidationError) throw error;
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
    }
    throw error;
  }
};

// ── Remove (drafts only) ───────────────────────────────────────────────
export const removeDissemination = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const params = req.query as {
    id: string;
    userId: string;
    lineId: string;
  };
  if (!params.id) throw new ValidationError("INVALID REQUIRED ID");

  try {
    await prisma.$transaction(async (tx) => {
      const queue = await tx.signatureQueueRoom.findUnique({
        where: { id: params.id },
      });
      if (!queue) throw new NotFoundError("Dissemination not found");
      if (queue.status !== 0) {
        throw new ValidationError(
          "Only draft disseminations can be removed.",
        );
      }
      await tx.signatureQueueRoom.delete({ where: { id: queue.id } });

      if (params.userId) {
        await tx.documentActivityLogs.create({
          data: {
            userId: params.userId,
            lineId: params.lineId,
            title: "Removed dissemination",
            desc: `Removed draft dissemination ${queue.title ?? queue.id}`,
            action: 0,
          },
        });
      }
    });
    return res.code(200).send({ message: "OK", id: params.id });
  } catch (error) {
    if (error instanceof NotFoundError) throw error;
    if (error instanceof ValidationError) throw error;
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
    }
    throw error;
  }
};

// ── Helper: list candidate target rooms for the disseminator ───────────
// Returns receiving rooms in the same line, excluding the from-room.
export const targetRoomCandidates = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const params = req.query as {
    lineId: string;
    excludeRoomId?: string;
    query?: string;
    limit?: string;
  };
  if (!params.lineId) throw new ValidationError("INVALID REQUIRED ID");

  try {
    const limit = params.limit ? parseInt(params.limit, 10) : 50;
    // Only rooms that actually have authorized users — otherwise orphaned
    // ReceivingRoom rows (left behind by membership resets) show up as
    // viable targets and dispatches go into a void.
    const where: any = {
      lineId: params.lineId,
      authorizedUser: { some: {} },
    };
    if (params.excludeRoomId) where.NOT = { id: params.excludeRoomId };
    if (params.query?.trim()) {
      const q = params.query.trim();
      where.OR = [
        { address: { contains: q, mode: "insensitive" } },
        { code: { contains: q, mode: "insensitive" } },
      ];
    }
    const rows = await prisma.receivingRoom.findMany({
      where,
      take: limit,
      orderBy: { timestamp: "desc" },
      select: {
        id: true,
        code: true,
        address: true,
        status: true,
        _count: { select: { authorizedUser: true } },
      },
    });
    return res.code(200).send({ list: rows });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
    }
    throw error;
  }
};

// ── Helper: list candidate signatories (room authorized users) ─────────
export const signatoryCandidates = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const params = req.query as {
    lineId: string;
    query?: string;
    limit?: string;
  };
  if (!params.lineId) throw new ValidationError("INVALID REQUIRED ID");

  try {
    const limit = params.limit ? parseInt(params.limit, 10) : 50;
    const where: any = {
      receivingRoom: { lineId: params.lineId },
    };
    if (params.query?.trim()) {
      const q = params.query.trim();
      where.user = {
        OR: [
          { firstName: { contains: q, mode: "insensitive" } },
          { lastName: { contains: q, mode: "insensitive" } },
          { username: { contains: q, mode: "insensitive" } },
        ],
      };
    }
    const rows = await prisma.roomAuthorizedUser.findMany({
      where,
      take: limit,
      orderBy: { timestamp: "desc" },
      select: {
        id: true,
        type: true,
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            username: true,
            Position: { select: { name: true } },
          },
        },
        receivingRoom: {
          select: { id: true, code: true, address: true },
        },
      },
    });
    return res.code(200).send({ list: rows });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
    }
    throw error;
  }
};

// ── Documents in a queue (for the placement editor) ────────────────────
// Returns the docs attached to a dissemination, including each page already
// known to us and any existing SignatureCoor placements (so the editor can
// hydrate when the user re-enters).
export const disseminationDocuments = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const params = req.query as { queueRoomId: string };
  if (!params.queueRoomId) throw new ValidationError("INVALID REQUIRED ID");

  try {
    const docs = await prisma.document.findMany({
      where: { signatureQueueRoomId: params.queueRoomId },
      orderBy: { timestamp: "asc" },
      select: {
        id: true,
        title: true,
        size: true,
        timestamp: true,
        file: { select: { fileName: true, fileType: true, fileSize: true } },
        pages: {
          select: {
            id: true,
            page: true,
            signCoor: {
              select: {
                id: true,
                xAxis: true,
                yAxis: true,
                width: true,
                height: true,
                signatoryArrangementId: true,
              },
            },
          },
          orderBy: { page: "asc" },
        },
      },
    });

    const signatories = await prisma.signatoryArrangement.findMany({
      where: { signatureQueueRoomId: params.queueRoomId },
      orderBy: { index: "asc" },
      select: { id: true, index: true, status: true },
    });

    return res.code(200).send({ documents: docs, signatories });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
    }
    throw error;
  }
};

// ── Stream the raw document bytes (for the PDF viewer) ─────────────────
export const streamDocumentFile = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const params = req.query as { id: string };
  if (!params.id) throw new ValidationError("INVALID REQUIRED ID");

  try {
    const file = await prisma.decodedFile.findFirst({
      where: { documentId: params.id },
    });
    if (!file || !file.fileDecoded) {
      throw new NotFoundError("FILE NOT FOUND");
    }
    const buf = Buffer.from(file.fileDecoded);
    res.header(
      "Content-Type",
      file.fileType || "application/octet-stream",
    );
    res.header(
      "Content-Disposition",
      `inline; filename="${file.fileName || "document.pdf"}"`,
    );
    res.header("Content-Length", buf.length.toString());
    return res.code(200).send(buf);
  } catch (error) {
    if (error instanceof NotFoundError) throw error;
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
    }
    throw error;
  }
};

// ── Save signature placements (per document, replace strategy) ─────────
// Each placement is anchored to a page number. We create the DocumentPage
// row lazily if it doesn't exist yet. Coordinates are basis points (0-10000)
// of the rendered page so they remain resolution-independent.
export const saveSignaturePlacements = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const body = req.body as {
    queueRoomId: string;
    documentId: string;
    userId: string;
    lineId: string;
    /**
     * Each placement is bound to an ordinal signatory slot (1-based). The
     * backend resolves the slot to a SignatoryArrangement row by index,
     * creating the row on the fly if it doesn't exist yet — that way the
     * user can draw boxes BEFORE picking the actual signatories.
     */
    placements: Array<{
      page: number;
      slotIndex: number; // 1-based
      xAxis: number;
      yAxis: number;
      width: number;
      height: number;
    }>;
  };

  if (!body.queueRoomId || !body.documentId || !Array.isArray(body.placements)) {
    throw new ValidationError("INVALID REQUIRED FIELDS");
  }

  try {
    await prisma.$transaction(async (tx) => {
      const queue = await tx.signatureQueueRoom.findUnique({
        where: { id: body.queueRoomId },
      });
      if (!queue) throw new NotFoundError("Dissemination not found");
      if (queue.status !== 0) {
        throw new ValidationError("Cannot edit placements after dispatch.");
      }

      const doc = await tx.document.findUnique({
        where: { id: body.documentId },
        select: { id: true, signatureQueueRoomId: true },
      });
      if (!doc || doc.signatureQueueRoomId !== body.queueRoomId) {
        throw new ValidationError("Document does not belong to this queue.");
      }

      // Group placements by page, ensure DocumentPage rows exist.
      const pages = Array.from(
        new Set(body.placements.map((p) => p.page)),
      ).filter((n) => Number.isFinite(n) && n > 0);

      const existing = await tx.documentPage.findMany({
        where: { documentId: body.documentId, page: { in: pages } },
        select: { id: true, page: true },
      });
      const byPage = new Map<number, string>(
        existing.map((p) => [p.page, p.id]),
      );

      for (const p of pages) {
        if (!byPage.has(p)) {
          const created = await tx.documentPage.create({
            data: { documentId: body.documentId, page: p, content: "" },
            select: { id: true, page: true },
          });
          byPage.set(p, created.id);
        }
      }

      // Drop all existing placements for this document, then recreate.
      const allPagesForDoc = await tx.documentPage.findMany({
        where: { documentId: body.documentId },
        select: { id: true },
      });
      const allPageIds = allPagesForDoc.map((p) => p.id);
      if (allPageIds.length > 0) {
        await tx.signatureCoor.deleteMany({
          where: { documentPageId: { in: allPageIds } },
        });
      }

      // Resolve slot indexes to SignatoryArrangement rows (creating any
      // that don't exist yet on this queue).
      const slots = Array.from(
        new Set(body.placements.map((p) => p.slotIndex)),
      ).filter((n) => Number.isFinite(n) && n >= 1);
      const slotToArrId = new Map<number, string>();
      if (slots.length > 0) {
        const arr = await tx.signatoryArrangement.findMany({
          where: {
            signatureQueueRoomId: body.queueRoomId,
            index: { in: slots.map((s) => s - 1) },
          },
          select: { id: true, index: true },
        });
        for (const r of arr) slotToArrId.set(r.index + 1, r.id);
        for (const s of slots) {
          if (!slotToArrId.has(s)) {
            const created = await tx.signatoryArrangement.create({
              data: {
                signatureQueueRoomId: body.queueRoomId,
                index: s - 1,
                status: 0,
              },
              select: { id: true },
            });
            slotToArrId.set(s, created.id);
          }
        }
      }

      if (body.placements.length > 0) {
        await tx.signatureCoor.createMany({
          data: body.placements.map((p) => ({
            documentPageId: byPage.get(p.page)!,
            signatoryArrangementId: slotToArrId.get(p.slotIndex)!,
            xAxis: Math.round(p.xAxis),
            yAxis: Math.round(p.yAxis),
            width: Math.round(p.width),
            height: Math.round(p.height),
          })),
        });
      }

      if (body.userId) {
        await tx.documentActivityLogs.create({
          data: {
            userId: body.userId,
            lineId: body.lineId,
            title: "Updated signature placements",
            desc:
              `Saved ${body.placements.length} placement` +
              `${body.placements.length === 1 ? "" : "s"} for document ${body.documentId}`,
            action: 2,
          },
        });
      }
    });

    return res.code(200).send({ message: "OK" });
  } catch (error) {
    if (error instanceof NotFoundError) throw error;
    if (error instanceof ValidationError) throw error;
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
    }
    throw error;
  }
};

// ── Upload a document to a queue (draft-only) ──────────────────────────
const ALLOWED_DOC_MIMES = new Set<string>([
  "application/pdf",
]);
const MAX_DOC_BYTES = 25 * 1024 * 1024; // 25 MB

export const uploadDisseminationDocument = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  if (!req.isMultipart()) throw new ValidationError("INVALID REQUEST");

  try {
    const parts = req.parts();
    const formData: Record<string, string> = {};
    let upload: {
      filename: string;
      mimetype: string;
      buffer: Buffer;
    } | null = null;

    for await (const part of parts) {
      if (part.type === "file") {
        const chunks: Buffer[] = [];
        for await (const chunk of part.file) chunks.push(chunk as Buffer);
        upload = {
          filename: part.filename,
          mimetype: part.mimetype,
          buffer: Buffer.concat(chunks),
        };
      } else {
        formData[part.fieldname] = String(part.value);
      }
    }

    if (!upload) throw new ValidationError("FILE REQUIRED");
    if (!ALLOWED_DOC_MIMES.has(upload.mimetype)) {
      throw new ValidationError("ONLY PDF FILES ARE ALLOWED");
    }
    if (upload.buffer.length > MAX_DOC_BYTES) {
      throw new ValidationError("FILE EXCEEDS 25MB LIMIT");
    }

    const { queueRoomId, userId, lineId, title } = formData;
    if (!queueRoomId || !lineId) {
      throw new ValidationError("INVALID REQUIRED FIELDS");
    }

    const queue = await prisma.signatureQueueRoom.findUnique({
      where: { id: queueRoomId },
      select: { id: true, status: true, receivingRoomId: true },
    });
    if (!queue) throw new NotFoundError("Dissemination not found");
    if (queue.status !== 0) {
      throw new ValidationError("Cannot attach documents after dispatch.");
    }

    const created = await prisma.$transaction(async (tx) => {
      const doc = await tx.document.create({
        data: {
          title: title || upload.filename,
          size: upload.buffer.length,
          lineId,
          userId: userId || undefined,
          signatureQueueRoomId: queueRoomId,
          receivingRoomId: queue.receivingRoomId,
          docType: 0,
          type: 0,
          original: 1,
        },
        select: { id: true, title: true, size: true, timestamp: true },
      });
      await tx.decodedFile.create({
        data: {
          documentId: doc.id,
          fileName: upload.filename,
          fileSize: String(upload.buffer.length),
          fileType: upload.mimetype,
          fileDecoded: upload.buffer,
        },
      });
      if (userId) {
        await tx.documentActivityLogs.create({
          data: {
            userId,
            lineId,
            title: "Attached document",
            desc: `Attached ${upload.filename} to dissemination ${queueRoomId}`,
            action: 1,
          },
        });
      }
      return doc;
    });

    return res.code(200).send({ message: "OK", document: created });
  } catch (error) {
    if (error instanceof ValidationError) throw error;
    if (error instanceof NotFoundError) throw error;
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
    }
    throw error;
  }
};

// ── Remove a queue document (draft-only) ───────────────────────────────
export const removeDisseminationDocument = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const params = req.query as {
    id: string;
    queueRoomId: string;
    userId?: string;
    lineId?: string;
  };
  if (!params.id || !params.queueRoomId) {
    throw new ValidationError("INVALID REQUIRED ID");
  }

  try {
    await prisma.$transaction(async (tx) => {
      const queue = await tx.signatureQueueRoom.findUnique({
        where: { id: params.queueRoomId },
        select: { id: true, status: true },
      });
      if (!queue) throw new NotFoundError("Dissemination not found");
      if (queue.status !== 0) {
        throw new ValidationError("Cannot remove documents after dispatch.");
      }

      const doc = await tx.document.findUnique({
        where: { id: params.id },
        select: { id: true, signatureQueueRoomId: true, title: true },
      });
      if (!doc || doc.signatureQueueRoomId !== params.queueRoomId) {
        throw new ValidationError("Document does not belong to this queue.");
      }

      await tx.document.delete({ where: { id: doc.id } });

      if (params.userId) {
        await tx.documentActivityLogs.create({
          data: {
            userId: params.userId,
            lineId: params.lineId || "",
            title: "Removed document",
            desc: `Removed ${doc.title ?? doc.id} from dissemination ${params.queueRoomId}`,
            action: 0,
          },
        });
      }
    });
    return res.code(200).send({ message: "OK", id: params.id });
  } catch (error) {
    if (error instanceof ValidationError) throw error;
    if (error instanceof NotFoundError) throw error;
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
    }
    throw error;
  }
};

// ── Self-repair: ensure the current user has a ReceivingRoom membership ─
// Plug for the historical approval bug where requesters whose own
// roomRegistration was approved never got a RoomAuthorizedUser row.
// Idempotent: if they're already in a room, returns it.
export const repairRoomMembership = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const body = req.body as { userId: string };
  if (!body.userId) throw new ValidationError("INVALID REQUIRED ID");

  try {
    const result = await prisma.$transaction(async (tx) => {
      // Already a member somewhere? Nothing to do.
      const existing = await tx.receivingRoom.findFirst({
        where: { authorizedUser: { some: { userId: body.userId } } },
        select: { id: true, code: true },
      });
      if (existing) return { action: "noop", room: existing };

      // Find their most recent approved registration.
      const reg = await tx.roomRegistration.findFirst({
        where: { userId: body.userId, status: 1 },
        orderBy: { dateApproved: "desc" },
        include: { authorizedUser: true },
      });
      if (!reg) {
        throw new ValidationError(
          "No approved room registration found for this user.",
        );
      }

      // Always mint a fresh ReceivingRoom for this user — sharing rooms
      // across registrations by lineId+address caused two recipients to
      // resolve to the same room id (Room 1 dispatches to Room 2 but
      // Room 2's user landed in Room 1's record). Each registration
      // approval owns exactly one room.
      const created = await tx.receivingRoom.create({
        data: {
          address: reg.address,
          code: `RM-${Math.random().toString(36).slice(2, 9).toUpperCase()}`,
          lineId: reg.lineId,
        },
        select: { id: true, code: true },
      });
      const room = created;

      // Build the membership list (requester + co-signatories), dedupe.
      const members = [
        { userId: reg.userId, type: 0 },
        ...reg.authorizedUser.map((u) => ({ userId: u.userId, type: u.type })),
      ];
      const seen = new Set<string>();
      const unique = members.filter((m) => {
        if (seen.has(m.userId)) return false;
        seen.add(m.userId);
        return true;
      });

      // Only insert the ones not already linked to this room.
      const already = await tx.roomAuthorizedUser.findMany({
        where: {
          receivingRoomId: room.id,
          userId: { in: unique.map((u) => u.userId) },
        },
        select: { userId: true },
      });
      const linked = new Set(already.map((r) => r.userId));
      const toInsert = unique.filter((u) => !linked.has(u.userId));

      if (toInsert.length > 0) {
        await tx.roomAuthorizedUser.createMany({
          data: toInsert.map((m) => ({
            userId: m.userId,
            type: m.type,
            receivingRoomId: room!.id,
          })),
        });
      }

      return { action: "repaired", room, inserted: toInsert.length };
    });

    return res.code(200).send(result);
  } catch (error) {
    if (error instanceof ValidationError) throw error;
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
    }
    throw error;
  }
};

// ─── Document module overview (panel stats) ────────────────────────────
// Backs the home panel of the Document module. Numbers are live, scoped
// by line (and the active user's receiving room for inbox/outbox counts).
export const documentOverview = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const params = req.query as { lineId: string; userId?: string };
  if (!params.lineId) throw new ValidationError("INVALID REQUIRED ID");

  try {
    // Find the user's receiving room (for inbox/outbox).
    let roomId: string | null = null;
    if (params.userId) {
      const room = await prisma.receivingRoom.findFirst({
        where: {
          lineId: params.lineId,
          authorizedUser: { some: { userId: params.userId } },
        },
        select: { id: true },
      });
      roomId = room?.id ?? null;
    }

    const [
      archiveTotal,
      disseminationDraft,
      disseminationActive,
      disseminationCompleted,
      inboxTotal,
      outboxTotal,
      pendingForMe,
      signaturesTotal,
    ] = await Promise.all([
      prisma.archiveDocument.count({ where: { lineId: params.lineId } }),
      prisma.signatureQueueRoom.count({
        where: { fromRoom: { lineId: params.lineId }, status: 0 },
      }),
      prisma.signatureQueueRoom.count({
        where: { fromRoom: { lineId: params.lineId }, status: 1 },
      }),
      prisma.signatureQueueRoom.count({
        where: { fromRoom: { lineId: params.lineId }, status: 2 },
      }),
      roomId
        ? prisma.targetRoom.count({
            where: {
              receivingRoomId: roomId,
              queueRoom: { is: { status: { gte: 1 } } },
            },
          })
        : Promise.resolve(0),
      roomId
        ? prisma.signatureQueueRoom.count({
            where: { receivingRoomId: roomId, status: { gte: 1 } },
          })
        : Promise.resolve(0),
      params.userId
        ? prisma.signatoryArrangement.count({
            where: {
              status: 0,
              signatureQueueRoom: { status: 1 },
            },
          })
        : Promise.resolve(0),
      params.userId
        ? prisma.signature.count({
            where: { userId: params.userId },
          })
        : Promise.resolve(0),
    ]);

    return res.code(200).send({
      archive: { total: archiveTotal },
      dissemination: {
        draft: disseminationDraft,
        active: disseminationActive,
        completed: disseminationCompleted,
      },
      myRoom: { id: roomId, inbox: inboxTotal, outbox: outboxTotal },
      signatures: { mine: signaturesTotal, pendingForMe },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
    }
    throw error;
  }
};

// ─── Reset membership: peel the user off whatever room they're in and ──
// mint a brand new ReceivingRoom for them. Cleans up the cross-linked
// state caused by an earlier buggy repair that matched rooms by
// (lineId, address) and ended up sharing a single room across multiple
// registrations.
export const resetRoomMembership = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const body = req.body as { userId: string };
  if (!body.userId) throw new ValidationError("INVALID REQUIRED ID");

  try {
    const result = await prisma.$transaction(async (tx) => {
      const reg = await tx.roomRegistration.findFirst({
        where: { userId: body.userId, status: 1 },
        orderBy: { dateApproved: "desc" },
        include: { authorizedUser: true },
      });
      if (!reg) {
        throw new ValidationError(
          "No approved room registration found for this user.",
        );
      }

      // Snapshot the rooms this user belongs to BEFORE we unlink them,
      // so we can clean up any that become orphaned by the reset.
      const beforeRooms = await tx.roomAuthorizedUser.findMany({
        where: { userId: body.userId },
        select: { receivingRoomId: true },
      });
      const beforeRoomIds = Array.from(
        new Set(
          beforeRooms
            .map((r) => r.receivingRoomId)
            .filter((id): id is string => !!id),
        ),
      );

      // Drop every existing membership row for this user.
      await tx.roomAuthorizedUser.deleteMany({
        where: { userId: body.userId },
      });

      // For each old room: if no other user is still linked AND no
      // dissemination has been dispatched from/to it, delete it.
      // Otherwise leave it alone (active data).
      for (const oldId of beforeRoomIds) {
        const stillLinked = await tx.roomAuthorizedUser.count({
          where: { receivingRoomId: oldId },
        });
        if (stillLinked > 0) continue;
        const sentFrom = await tx.signatureQueueRoom.count({
          where: { receivingRoomId: oldId },
        });
        const targetedTo = await tx.targetRoom.count({
          where: { receivingRoomId: oldId },
        });
        if (sentFrom === 0 && targetedTo === 0) {
          await tx.receivingRoom.delete({ where: { id: oldId } });
        }
      }

      // Mint a fresh, dedicated ReceivingRoom.
      const room = await tx.receivingRoom.create({
        data: {
          address: reg.address,
          code: `RM-${Math.random().toString(36).slice(2, 9).toUpperCase()}`,
          lineId: reg.lineId,
        },
        select: { id: true, code: true },
      });

      // Insert the new owner-membership row.
      await tx.roomAuthorizedUser.create({
        data: {
          userId: body.userId,
          type: 0,
          receivingRoomId: room.id,
        },
      });

      // Pull in co-signatories from the registration — but only if they
      // aren't already members of some other room (don't yank them out).
      for (const u of reg.authorizedUser) {
        if (u.userId === body.userId) continue;
        const linked = await tx.roomAuthorizedUser.findFirst({
          where: { userId: u.userId },
          select: { id: true },
        });
        if (!linked) {
          await tx.roomAuthorizedUser.create({
            data: {
              userId: u.userId,
              type: u.type,
              receivingRoomId: room.id,
            },
          });
        }
      }

      return { room };
    });

    return res.code(200).send({ message: "OK", ...result });
  } catch (error) {
    if (error instanceof ValidationError) throw error;
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
    }
    throw error;
  }
};

// ─── View a dispatched dissemination (signing page) ────────────────────
// Returns the full queue with documents, page placements, every
// SignatoryArrangement (with its user + signed-at signature image when
// applicable). The frontend uses this to render docs with overlays
// showing whose-signed-what.
export const viewDissemination = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const params = req.query as { id: string };
  if (!params.id) throw new ValidationError("INVALID REQUIRED ID");

  try {
    const row = await prisma.signatureQueueRoom.findUnique({
      where: { id: params.id },
      include: {
        fromRoom: { select: { id: true, code: true, address: true } },
        targetRooms: {
          select: {
            id: true,
            status: true,
            receivedAt: true,
            roomReceiver: { select: { id: true, code: true } },
          },
        },
        documents: {
          select: {
            id: true,
            title: true,
            size: true,
            timestamp: true,
            file: { select: { fileName: true, fileType: true } },
            pages: {
              orderBy: { page: "asc" },
              select: {
                id: true,
                page: true,
                signCoor: {
                  select: {
                    id: true,
                    xAxis: true,
                    yAxis: true,
                    width: true,
                    height: true,
                    signatoryArrangementId: true,
                  },
                },
              },
            },
          },
        },
        signatotyArrangement: {
          orderBy: { index: "asc" },
          select: {
            id: true,
            index: true,
            status: true,
            signedAt: true,
            userId: true,
            user: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                username: true,
                Position: { select: { name: true } },
              },
            },
          },
        },
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            Position: { select: { name: true } },
          },
        },
      },
    });
    if (!row) throw new NotFoundError("Dissemination not found");

    // Pull each signer's active signature image (base64) so the renderer
    // can stamp it inside the SignatureCoor boxes without an extra fetch.
    const signedUserIds = Array.from(
      new Set(
        row.signatotyArrangement
          .filter((a) => a.status === 1 && a.userId)
          .map((a) => a.userId as string),
      ),
    );
    let signaturesByUser: Record<
      string,
      { id: string; title: string | null; mime: string; dataUrl: string }
    > = {};
    console.log("[view] signedUserIds:", signedUserIds);
    if (signedUserIds.length > 0) {
      // Prefer active signatures, fall back to the user's most recent
      // signature if no active flag is set. Either way every signed
      // arrangement gets an image we can stamp into the box.
      let sigs = await prisma.signature.findMany({
        where: { userId: { in: signedUserIds }, active: true },
        select: { id: true, userId: true, title: true, signature: true },
      });
      console.log("[view] active sigs found:", sigs.length);
      const usersWithSig = new Set(sigs.map((s) => s.userId));
      const missing = signedUserIds.filter((id) => !usersWithSig.has(id));
      if (missing.length > 0) {
        const fallback = await prisma.signature.findMany({
          where: { userId: { in: missing } },
          orderBy: { timestamp: "desc" },
          select: { id: true, userId: true, title: true, signature: true },
        });
        console.log(
          "[view] fallback sigs for missing users:",
          fallback.map((s) => ({ userId: s.userId, hasBytes: !!s.signature })),
        );
        const seen = new Set<string>();
        for (const s of fallback) {
          if (!s.userId || seen.has(s.userId)) continue;
          seen.add(s.userId);
          sigs.push(s);
        }
      }
      for (const s of sigs) {
        if (!s.signature || !s.userId) {
          console.log(
            "[view] SKIPPING sig — userId:",
            s.userId,
            "hasBytes:",
            !!s.signature,
          );
          continue;
        }
        const buf = Buffer.from(s.signature as Uint8Array);
        console.log(
          "[view] encoding sig — userId:",
          s.userId,
          "bytes:",
          buf.length,
          "first4:",
          [buf[0], buf[1], buf[2], buf[3]],
        );

        // Three possible storage formats observed in the wild:
        //   1. Raw image bytes (PNG/JPEG/WebP/SVG magic bytes at offset 0).
        //   2. A base64-encoded string of those bytes.
        //   3. A full `data:image/...;base64,...` data URL string.
        // Handle all three so the UI always gets a working data URL.
        let dataUrl: string;
        let mime = "image/png";

        // PNG magic bytes
        const isPng =
          buf.length >= 4 &&
          buf[0] === 0x89 &&
          buf[1] === 0x50 &&
          buf[2] === 0x4e &&
          buf[3] === 0x47;
        const isJpeg =
          buf.length >= 3 &&
          buf[0] === 0xff &&
          buf[1] === 0xd8 &&
          buf[2] === 0xff;
        const isWebp =
          buf.length >= 12 &&
          buf[0] === 0x52 &&
          buf[1] === 0x49 &&
          buf[2] === 0x46 &&
          buf[3] === 0x46 &&
          buf[8] === 0x57 &&
          buf[9] === 0x45 &&
          buf[10] === 0x42 &&
          buf[11] === 0x50;

        if (isPng || isJpeg || isWebp) {
          mime = isPng ? "image/png" : isJpeg ? "image/jpeg" : "image/webp";
          dataUrl = `data:${mime};base64,${buf.toString("base64")}`;
        } else {
          // Try treating it as a string (case 2 or 3).
          const asText = buf.toString("utf8").trim();
          if (asText.startsWith("data:image/")) {
            // Case 3: already a data URL.
            dataUrl = asText;
            const m = asText.match(/^data:([^;]+);/);
            if (m) mime = m[1];
          } else if (asText.startsWith("<svg") || asText.startsWith("<?xml")) {
            mime = "image/svg+xml";
            dataUrl = `data:${mime};base64,${Buffer.from(asText, "utf8").toString("base64")}`;
          } else if (/^[A-Za-z0-9+/=\r\n]+$/.test(asText.slice(0, 200))) {
            // Case 2: base64 string. Assume PNG (most common).
            dataUrl = `data:image/png;base64,${asText.replace(/\s+/g, "")}`;
          } else {
            // Unknown shape — last resort, encode whatever's there as PNG.
            dataUrl = `data:image/png;base64,${buf.toString("base64")}`;
          }
        }

        signaturesByUser[s.userId] = {
          id: s.id,
          title: s.title ?? null,
          mime,
          dataUrl,
        };
      }
    }
    console.log(
      "[view] signaturesByUser keys returned:",
      Object.keys(signaturesByUser),
    );

    return res.code(200).send({ queue: row, signaturesByUser });
  } catch (error) {
    if (error instanceof NotFoundError) throw error;
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError(error.message, 500, error.code);
    }
    throw error;
  }
};

// ─── Sign every pending slot assigned to the current user ──────────────
// One click → flips every SignatoryArrangement where
// (userId = me, signatureQueueRoomId = queue, status = 0) to status=1.
// If every arrangement on the queue is now signed, the queue also rolls
// from "active" (1) → "completed" (2).
export const signMine = async (req: FastifyRequest, res: FastifyReply) => {
  const body = req.body as {
    queueRoomId: string;
    userId: string;
    // Optional geolocation captured from the browser at click time.
    geo?: { lat: number; lng: number; accuracy?: number | null } | null;
  };
  if (!body.queueRoomId || !body.userId) {
    throw new ValidationError("INVALID REQUIRED FIELDS");
  }
  try {
    const result = await prisma.$transaction(async (tx) => {
      // Pull the queue WITH its from-room so we can grab the real lineId
      // for activity logging. Earlier this used `queue.receivingRoomId`
      // (a ReceivingRoom id, not a Line id) which violated the FK and
      // made the whole tx fail with DB_CONNECTION_FAILED.
      const queue = await tx.signatureQueueRoom.findUnique({
        where: { id: body.queueRoomId },
        include: { fromRoom: { select: { lineId: true } } },
      });
      if (!queue) throw new NotFoundError("Dissemination not found");
      if (queue.status !== 1) {
        throw new ValidationError(
          "Only active (dispatched) disseminations can be signed.",
        );
      }

      // Confirm the user has an active signature on file — refusing to
      // sign without one prevents a "signed but invisible" state.
      const sig = await tx.signature.findFirst({
        where: { userId: body.userId, active: true },
        select: { id: true },
      });
      if (!sig) {
        throw new ValidationError(
          "You don't have an active signature on file. Upload and activate one in Signature Management first.",
        );
      }

      // Sign every pending slot either assigned to this user OR currently
      // unassigned. Auto-binding the unassigned ones to the signer means
      // the signing flow works on old dispatches (created before the
      // userId column existed) without a separate Claim step.
      const pending = await tx.signatoryArrangement.findMany({
        where: {
          signatureQueueRoomId: body.queueRoomId,
          status: 0,
          OR: [{ userId: body.userId }, { userId: null }],
        },
        select: { id: true, userId: true, index: true },
      });
      console.log("[signMine] pending matches:", pending);
      if (pending.length === 0) {
        return { signed: 0, completed: false };
      }
      const now = new Date();
      // Stamp signedAt + status + userId + geolocation in one updateMany
      // so unassigned slots end up owned by the signer and the geo lands
      // alongside the signing event for the verification QR.
      await tx.signatoryArrangement.updateMany({
        where: { id: { in: pending.map((p) => p.id) } },
        data: {
          status: 1,
          signedAt: now,
          userId: body.userId,
          signedLat: body.geo?.lat ?? null,
          signedLng: body.geo?.lng ?? null,
          signedAccuracy: body.geo?.accuracy ?? null,
        },
      });

      // If every arrangement on the queue is now status >= 1, mark the
      // queue completed.
      const remaining = await tx.signatoryArrangement.count({
        where: { signatureQueueRoomId: body.queueRoomId, status: 0 },
      });
      let completed = false;
      if (remaining === 0) {
        await tx.signatureQueueRoom.update({
          where: { id: body.queueRoomId },
          data: { status: 2 },
        });
        completed = true;
      }

      // Only write the activity log when we have a real lineId — the FK
      // is optional, so passing undefined skips the constraint cleanly.
      const realLineId = queue.fromRoom?.lineId ?? undefined;
      if (realLineId) {
        await tx.documentActivityLogs.create({
          data: {
            userId: body.userId,
            lineId: realLineId,
            title: completed
              ? "Signed and completed dissemination"
              : "Signed dissemination slots",
            desc:
              `Signed ${pending.length} slot${pending.length === 1 ? "" : "s"} on queue ${body.queueRoomId}` +
              (completed ? " (queue completed)" : ""),
            action: 1,
          },
        });
      }

      // Notify the disseminator that someone signed, and notify everyone
      // if this was the last signature (queue now concluded).
      const everyone = await tx.signatoryArrangement.findMany({
        where: {
          signatureQueueRoomId: body.queueRoomId,
          userId: { not: null },
        },
        select: { userId: true },
      });
      const recipients = new Set<string>();
      // include the disseminator
      const queueOwner = await tx.signatureQueueRoom.findUnique({
        where: { id: body.queueRoomId },
        select: { userId: true, title: true },
      });
      if (queueOwner?.userId) recipients.add(queueOwner.userId);
      for (const e of everyone) if (e.userId) recipients.add(e.userId);
      // don't ping the signer themselves
      recipients.delete(body.userId);

      const title = queueOwner?.title ?? "a dissemination";
      for (const rid of recipients) {
        await createUserNotification(tx, {
          recipientId: rid,
          senderId: body.userId,
          title: completed ? "Dissemination concluded" : "Dissemination signed",
          content: completed
            ? `All signatures collected on "${title}". The dissemination is now concluded.`
            : `Someone signed on "${title}".`,
          path: `documents/dissemination?tab=inbox`,
        });
      }

      return { signed: pending.length, completed };
    });

    return res.code(200).send({ message: "OK", ...result });
  } catch (error) {
    if (error instanceof NotFoundError) throw error;
    if (error instanceof ValidationError) throw error;
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      // Surface the actual Prisma message so we don't keep masking
      // real constraint failures as a generic "DB_CONNECTION_FAILED".
      throw new AppError(error.message, 500, error.code);
    }
    throw error;
  }
};

// ─── Claim an unassigned slot ──────────────────────────────────────────
// Salvage path for arrangements that were created before SignatoryArrangement
// carried a userId. Any room user can claim a still-pending, still-unassigned
// slot — they become its signer.
export const claimSignatorySlot = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const body = req.body as { arrangementId: string; userId: string };
  if (!body.arrangementId || !body.userId) {
    throw new ValidationError("INVALID REQUIRED FIELDS");
  }
  try {
    const result = await prisma.$transaction(async (tx) => {
      const arr = await tx.signatoryArrangement.findUnique({
        where: { id: body.arrangementId },
        select: { id: true, userId: true, status: true },
      });
      if (!arr) throw new NotFoundError("Arrangement not found");
      if (arr.userId && arr.userId !== body.userId) {
        throw new ValidationError("This slot is already assigned.");
      }
      if (arr.status !== 0) {
        throw new ValidationError("This slot is no longer pending.");
      }
      const updated = await tx.signatoryArrangement.update({
        where: { id: arr.id },
        data: { userId: body.userId },
      });
      return updated;
    });
    return res.code(200).send({ message: "OK", arrangement: result });
  } catch (error) {
    if (error instanceof NotFoundError) throw error;
    if (error instanceof ValidationError) throw error;
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
    }
    throw error;
  }
};

// ─── Archive a concluded dissemination's documents into the line ───────
// Only callable when the queue's status === 2 (completed). Each Document
// in the queue is wrapped in an ArchiveDocument row (or skipped if it
// already has one — the @unique constraint on documentId prevents dupes).
export const archiveDissemination = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const body = req.body as { queueRoomId: string; userId: string };
  if (!body.queueRoomId || !body.userId) {
    throw new ValidationError("INVALID REQUIRED FIELDS");
  }
  try {
    const result = await prisma.$transaction(async (tx) => {
      const queue = await tx.signatureQueueRoom.findUnique({
        where: { id: body.queueRoomId },
        include: {
          documents: { select: { id: true } },
          fromRoom: { select: { id: true, lineId: true } },
        },
      });
      if (!queue) throw new NotFoundError("Dissemination not found");
      if (queue.status !== 2) {
        throw new ValidationError(
          "Only concluded disseminations (all signatures collected) can be archived.",
        );
      }

      const lineId = queue.fromRoom?.lineId;
      const receivingRoomId = queue.fromRoom?.id;
      let created = 0;
      let skipped = 0;
      for (const doc of queue.documents) {
        const existing = await tx.archiveDocument.findUnique({
          where: { documentId: doc.id },
        });
        if (existing) {
          skipped += 1;
          continue;
        }
        await tx.archiveDocument.create({
          data: {
            documentId: doc.id,
            lineId: lineId ?? undefined,
            receivingRoomId: receivingRoomId ?? undefined,
            status: 1,
          },
        });
        created += 1;
      }
      if (lineId) {
        await tx.documentActivityLogs.create({
          data: {
            userId: body.userId,
            lineId,
            title: "Archived concluded dissemination",
            desc: `Archived ${created} document${created === 1 ? "" : "s"} from queue ${body.queueRoomId} (${skipped} already archived)`,
            action: 1,
          },
        });
      }
      return { created, skipped };
    });
    return res.code(200).send({ message: "OK", ...result });
  } catch (error) {
    if (error instanceof NotFoundError) throw error;
    if (error instanceof ValidationError) throw error;
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError(error.message, 500, error.code);
    }
    throw error;
  }
};
// (will be appended)

// ─── Download a document with signatures burned in ─────────────────────
// Loads the document's PDF, walks every SignatureCoor whose arrangement
// is signed, and stamps the signer's signature image directly onto the
// page at the recorded coordinates. The returned PDF is flattened — the
// signature is part of the page graphics, not a removable image layer,
// so you can't lift it out by reopening the file in a viewer.
//
// The raw signature bytes are NEVER exposed by this endpoint. Only the
// signer themselves can fetch their own raw signature via the existing
// /document/user/signatures route (which is ACL'd to userId === self).
export const downloadSignedDocument = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const params = req.query as { documentId: string };
  if (!params.documentId) throw new ValidationError("INVALID REQUIRED ID");

  try {
    const doc = await prisma.document.findUnique({
      where: { id: params.documentId },
      include: {
        file: { select: { fileName: true, fileType: true, fileDecoded: true } },
        pages: {
          select: {
            page: true,
            signCoor: {
              select: {
                xAxis: true,
                yAxis: true,
                width: true,
                height: true,
                signatoryArrangement: {
                  select: {
                    id: true,
                    status: true,
                    signedAt: true,
                    userId: true,
                    index: true,
                  },
                },
              },
            },
          },
        },
      },
    });
    if (!doc || !doc.file?.fileDecoded) {
      throw new NotFoundError("Document file not found");
    }

    type StampPlacement = {
      page: number;
      xBp: number;
      yBp: number;
      wBp: number;
      hBp: number;
      userId: string;
      signedAt: Date | null;
      slot: number;
      arrangementId: string;
    };
    const stamps: StampPlacement[] = [];
    for (const p of doc.pages) {
      for (const c of p.signCoor) {
        const arr = c.signatoryArrangement;
        if (!arr || arr.status !== 1 || !arr.userId) continue;
        stamps.push({
          page: p.page,
          xBp: c.xAxis,
          yBp: c.yAxis,
          wBp: c.width,
          hBp: c.height,
          userId: arr.userId,
          signedAt: arr.signedAt,
          slot: arr.index + 1,
          arrangementId: arr.id,
        });
      }
    }

    const signerIds = Array.from(new Set(stamps.map((s) => s.userId)));
    // Single fetch — we pull `qrEnabled` and bytes from the SAME row so
    // the "stamp QR for this signer?" decision can never disagree with
    // the signature that actually got embedded.
    const sigRows = signerIds.length
      ? await prisma.signature.findMany({
          where: { userId: { in: signerIds } },
          orderBy: [{ active: "desc" }, { timestamp: "desc" }],
          select: {
            id: true,
            userId: true,
            signature: true,
            qrEnabled: true,
            active: true,
          },
        })
      : [];
    const sigByUser = new Map<string, Buffer>();
    const sigQrByUser = new Map<string, boolean>();
    const sigIdByUser = new Map<string, string>(); // for logging
    for (const r of sigRows) {
      if (!r.userId || !r.signature) continue;
      if (sigByUser.has(r.userId)) continue;
      const raw = Buffer.from(r.signature as Uint8Array);
      const text = raw.toString("utf8").trim();
      if (text.startsWith("data:image/")) {
        const comma = text.indexOf(",");
        if (comma > 0) {
          sigByUser.set(r.userId, Buffer.from(text.slice(comma + 1), "base64"));
        } else {
          sigByUser.set(r.userId, raw);
        }
      } else if (
        /^[A-Za-z0-9+/=\r\n]+$/.test(text.slice(0, 200)) &&
        !looksLikeBinary(raw)
      ) {
        sigByUser.set(r.userId, Buffer.from(text.replace(/\s+/g, ""), "base64"));
      } else {
        sigByUser.set(r.userId, raw);
      }
      sigQrByUser.set(r.userId, !!r.qrEnabled);
      sigIdByUser.set(r.userId, r.id);
    }
    console.log(
      "[signedDoc] picked sig per user:",
      Array.from(sigIdByUser.entries()).map(([uid, sid]) => ({
        userId: uid,
        sigId: sid,
        qrEnabled: sigQrByUser.get(uid),
      })),
    );

    const { PDFDocument, rgb, StandardFonts } = await import("pdf-lib");
    const pdfDoc = await PDFDocument.load(Buffer.from(doc.file.fileDecoded));
    const font = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const dateFont = await pdfDoc.embedFont(StandardFonts.Helvetica);

    const embeddedByUser = new Map<string, any>();
    const embedSig = async (userId: string) => {
      if (embeddedByUser.has(userId)) return embeddedByUser.get(userId);
      const buf = sigByUser.get(userId);
      if (!buf || buf.length === 0) return null;
      let img: any = null;
      try {
        if (
          buf[0] === 0x89 &&
          buf[1] === 0x50 &&
          buf[2] === 0x4e &&
          buf[3] === 0x47
        ) {
          img = await pdfDoc.embedPng(buf);
        } else if (buf[0] === 0xff && buf[1] === 0xd8) {
          img = await pdfDoc.embedJpg(buf);
        } else {
          try {
            img = await pdfDoc.embedPng(buf);
          } catch {
            img = await pdfDoc.embedJpg(buf);
          }
        }
      } catch (e) {
        console.warn("[signedDoc] failed to embed signature for", userId, e);
      }
      embeddedByUser.set(userId, img);
      return img;
    };

    console.log("[signedDoc] stamps to draw:", stamps.length);
    // Cache the embedded QR image per stamp (one QR per placement since
    // coordinates and time differ). qrcode is required lazily so non-QR
    // downloads don't pay for the module load.
    let qrcodeMod: typeof import("qrcode") | null = null;
    const embedQr = async (payload: string) => {
      if (!qrcodeMod) qrcodeMod = await import("qrcode");
      const pngBuf = await qrcodeMod.toBuffer(payload, {
        errorCorrectionLevel: "M",
        margin: 1,
        scale: 4,
        type: "png",
      });
      return pdfDoc.embedPng(pngBuf);
    };

    const pages = pdfDoc.getPages();
    for (const s of stamps) {
      const pageIdx = s.page - 1;
      if (pageIdx < 0 || pageIdx >= pages.length) continue;
      const page = pages[pageIdx];
      const { width: pw, height: ph } = page.getSize();
      // basis-points (0-10000) → PDF user units (origin = bottom-left).
      const boxW = (s.wBp / 10000) * pw;
      const boxH = (s.hBp / 10000) * ph;
      const boxX = (s.xBp / 10000) * pw;
      const boxYTop = (s.yBp / 10000) * ph;
      const boxY = ph - boxYTop - boxH;

      const sig = await embedSig(s.userId);
      if (sig) {
        const ar = sig.width / sig.height;
        let drawW = boxW;
        let drawH = boxW / ar;
        if (drawH > boxH) {
          drawH = boxH;
          drawW = boxH * ar;
        }
        const dx = boxX + (boxW - drawW) / 2;
        const dy = boxY + (boxH - drawH) / 2;
        page.drawImage(sig, { x: dx, y: dy, width: drawW, height: drawH });
      } else {
        page.drawRectangle({
          x: boxX,
          y: boxY,
          width: boxW,
          height: boxH,
          borderColor: rgb(0.06, 0.73, 0.51),
          borderWidth: 0.8,
        });
        page.drawText("SIGNED", {
          x: boxX + 4,
          y: boxY + boxH / 2 - 4,
          size: Math.min(10, boxH * 0.4),
          font,
          color: rgb(0.06, 0.73, 0.51),
        });
      }

      if (s.signedAt) {
        const caption = s.signedAt.toISOString().slice(0, 16).replace("T", " ");
        page.drawText(caption, {
          x: boxX,
          y: Math.max(0, boxY - 8),
          size: 6,
          font: dateFont,
          color: rgb(0.36, 0.36, 0.36),
        });
      }

      // Verification QR — opt-in per signature. Encodes a URL pointing
      // at the readable HTML verify page on this API. Scanning opens the
      // page directly in the user's browser; no app needed.
      const qrOn = sigQrByUser.get(s.userId);
      console.log("[signedDoc] stamp", {
        userId: s.userId,
        page: s.page,
        slot: s.slot,
        qrOn,
        arrangementId: s.arrangementId,
      });
      if (qrOn && s.arrangementId) {
        // QR opens a frontend page (not the API HTML). We derive the FE
        // base from the request's Origin / Referer — that's where the
        // download was triggered from. Falls back to an env var, then
        // localhost for dev.
        const fromHeader = (h: string | string[] | undefined) =>
          Array.isArray(h) ? h[0] : h;
        const origin =
          fromHeader(req.headers.origin) ||
          (fromHeader(req.headers.referer)
            ? new URL(fromHeader(req.headers.referer) as string).origin
            : undefined) ||
          process.env.PUBLIC_WEB_URL ||
          "http://localhost:5173";
        const verifyUrl = `${origin.replace(/\/$/, "")}/verify/${s.arrangementId}`;
        try {
          const qrImg = await embedQr(verifyUrl);
          // Smaller QR — caps at 28pt, scales down with tiny boxes.
          const qrSize = Math.max(18, Math.min(boxH, 28));
          // Place the QR FLUSH against the signature box (1pt gap).
          // Try right → below → left → above → page corner as fallbacks.
          const candidates = [
            { x: boxX + boxW + 1, y: boxY },
            { x: boxX, y: Math.max(2, boxY - qrSize - 1) },
            { x: Math.max(2, boxX - qrSize - 1), y: boxY },
            { x: boxX, y: Math.min(ph - qrSize - 2, boxY + boxH + 1) },
            { x: pw - qrSize - 4, y: ph - qrSize - 4 },
          ];
          let placed = false;
          for (const c of candidates) {
            if (
              c.x >= 0 &&
              c.y >= 0 &&
              c.x + qrSize <= pw &&
              c.y + qrSize <= ph
            ) {
              page.drawImage(qrImg, {
                x: c.x,
                y: c.y,
                width: qrSize,
                height: qrSize,
              });
              console.log("[signedDoc] QR drawn", { at: c, size: qrSize, url: verifyUrl });
              placed = true;
              break;
            }
          }
          if (!placed) {
            console.warn("[signedDoc] QR could not be placed", {
              userId: s.userId,
              boxX,
              boxY,
              boxW,
              boxH,
              pw,
              ph,
            });
          }
        } catch (e) {
          console.warn("[signedDoc] QR embed failed:", e);
        }
      }
    }

    const out = await pdfDoc.save({ useObjectStreams: true });

    const filename =
      (doc.title || doc.file.fileName || "document")
        .replace(/[^a-zA-Z0-9._-]/g, "_")
        .replace(/\.pdf$/i, "") + "-signed.pdf";
    res.header("Content-Type", "application/pdf");
    res.header("Content-Disposition", `attachment; filename="${filename}"`);
    res.header("Content-Length", out.length.toString());
    return res.code(200).send(Buffer.from(out));
  } catch (error) {
    if (error instanceof NotFoundError) throw error;
    if (error instanceof ValidationError) throw error;
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError(error.message, 500, error.code);
    }
    throw error;
  }
};

// Treat input as binary if >10% of the leading bytes are non-printable.
function looksLikeBinary(buf: Buffer): boolean {
  const sample = buf.slice(0, Math.min(200, buf.length));
  let nonPrintable = 0;
  for (let i = 0; i < sample.length; i++) {
    const b = sample[i];
    if (b < 9 || (b > 13 && b < 32) || b === 127) nonPrintable++;
  }
  return nonPrintable / sample.length > 0.1;
}

// ─── Cancel a dispatched dissemination ─────────────────────────────────
// Sender-only. Only active (status=1) queues can be cancelled. Flips
// queue → 3, target rows → 3, and notifies every signatory + target
// room owner so they know to stop signing.
export const cancelDispatchedDissemination = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const body = req.body as {
    queueRoomId: string;
    userId: string;
    reason?: string;
  };
  if (!body.queueRoomId || !body.userId) {
    throw new ValidationError("INVALID REQUIRED FIELDS");
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const queue = await tx.signatureQueueRoom.findUnique({
        where: { id: body.queueRoomId },
        include: {
          fromRoom: { select: { lineId: true } },
        },
      });
      if (!queue) throw new NotFoundError("Dissemination not found");
      if (queue.userId && queue.userId !== body.userId) {
        throw new ValidationError("Only the disseminator can cancel.");
      }
      if (queue.status === 0) {
        throw new ValidationError(
          "This dissemination is still a draft — remove it instead.",
        );
      }
      if (queue.status >= 2) {
        throw new ValidationError(
          "Already concluded or cancelled — nothing to do.",
        );
      }

      await tx.signatureQueueRoom.update({
        where: { id: queue.id },
        data: { status: 3 },
      });
      await tx.targetRoom.updateMany({
        where: { signatureQueueRoomId: queue.id },
        data: { status: 3 },
      });

      const realLineId = queue.fromRoom?.lineId ?? undefined;
      if (realLineId) {
        await tx.documentActivityLogs.create({
          data: {
            userId: body.userId,
            lineId: realLineId,
            title: "Cancelled dispatched dissemination",
            desc:
              `Cancelled "${queue.title ?? queue.id}"` +
              (body.reason ? ` — reason: ${body.reason}` : ""),
            action: 0,
          },
        });
      }

      // Notify every signatory + the from-room user (themselves get
      // skipped because the sender is the one doing this).
      const signatories = await tx.signatoryArrangement.findMany({
        where: {
          signatureQueueRoomId: queue.id,
          userId: { not: null },
        },
        select: { userId: true },
      });
      const recipients = new Set<string>();
      for (const s of signatories) if (s.userId) recipients.add(s.userId);
      // Also notify all members of target rooms — they might be tracking
      // the dispatch in their inbox even if they're not signers.
      const targetRooms = await tx.targetRoom.findMany({
        where: { signatureQueueRoomId: queue.id },
        select: {
          roomReceiver: {
            select: { authorizedUser: { select: { userId: true } } },
          },
        },
      });
      for (const t of targetRooms) {
        for (const a of t.roomReceiver?.authorizedUser ?? []) {
          if (a.userId) recipients.add(a.userId);
        }
      }
      recipients.delete(body.userId);

      for (const rid of recipients) {
        await createUserNotification(tx, {
          recipientId: rid,
          senderId: body.userId,
          title: "Dissemination cancelled",
          content:
            `"${queue.title ?? "A dissemination"}" was cancelled by the sender.` +
            (body.reason ? ` Reason: ${body.reason}` : ""),
          path: `documents/dissemination?tab=inbox`,
        });
      }

      return { recipientsNotified: recipients.size };
    });

    return res.code(200).send({ message: "OK", ...result });
  } catch (error) {
    if (error instanceof NotFoundError) throw error;
    if (error instanceof ValidationError) throw error;
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError(error.message, 500, error.code);
    }
    throw error;
  }
};

// ─── Public-ish verification page (HTML) ───────────────────────────────
// The verification QR encodes a URL to this endpoint. A scanner opens the
// link → server returns a readable HTML page with signer + signed-at +
// geolocation (with a Google Maps link). Auth is not enforced because
// the URL itself is unguessable (arrangement UUID) and the page only
// exposes what's already on the signed PDF.
export const verifySignaturePage = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const params = req.params as { id: string };
  if (!params.id) {
    return res
      .code(400)
      .type("text/html")
      .send("<h1>Missing arrangement id</h1>");
  }

  try {
    const arr = await prisma.signatoryArrangement.findUnique({
      where: { id: params.id },
      select: {
        id: true,
        index: true,
        status: true,
        signedAt: true,
        signedLat: true,
        signedLng: true,
        signedAccuracy: true,
        signatureQueueRoom: {
          select: { id: true, title: true, status: true },
        },
        user: {
          select: {
            firstName: true,
            lastName: true,
            username: true,
            email: true,
            Position: { select: { name: true } },
          },
        },
      },
    });
    if (!arr) {
      return res
        .code(404)
        .type("text/html")
        .send(renderVerifyShell({
          title: "Not Found",
          bodyHtml: `<p class="muted">No signature record matches this code.</p>`,
        }));
    }

    const escape = (s: unknown) =>
      String(s ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");

    const fullName =
      `${arr.user?.firstName ?? ""} ${arr.user?.lastName ?? ""}`.trim() ||
      arr.user?.username ||
      "—";
    const position = arr.user?.Position?.name ?? "—";
    const signedAt = arr.signedAt
      ? new Date(arr.signedAt).toLocaleString("en-PH", {
          weekday: "short",
          year: "numeric",
          month: "long",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          timeZoneName: "short",
        })
      : "—";
    const queueTitle = arr.signatureQueueRoom?.title ?? "—";
    const statusLabel =
      arr.status === 1 ? "✅ Signed" : arr.status === 2 ? "❌ Rejected" : "⏳ Pending";

    const hasGeo =
      arr.signedLat != null && arr.signedLng != null;
    const mapsLink = hasGeo
      ? `https://www.google.com/maps?q=${arr.signedLat},${arr.signedLng}`
      : null;

    const rows: Array<[string, string]> = [
      ["Signer", escape(fullName)],
      ["Position", escape(position)],
      ["Document / Dissemination", escape(queueTitle)],
      ["Slot #", String(arr.index + 1)],
      ["Status", statusLabel],
      ["Signed at", escape(signedAt)],
    ];
    if (hasGeo) {
      const acc = arr.signedAccuracy
        ? ` (±${Math.round(arr.signedAccuracy)}m)`
        : "";
      rows.push([
        "Signing location",
        `<a href="${escape(mapsLink)}" target="_blank" rel="noopener">
           ${escape(arr.signedLat!.toFixed(6))}, ${escape(arr.signedLng!.toFixed(6))}${escape(acc)}
           <br><small>Open in Google Maps ↗</small>
         </a>`,
      ]);
    } else {
      rows.push([
        "Signing location",
        `<span class="muted">Not captured</span>`,
      ]);
    }

    const bodyHtml = `
      <div class="card">
        <div class="badge ${arr.status === 1 ? "ok" : "warn"}">
          ${statusLabel}
        </div>
        <table>
          ${rows
            .map(
              ([k, v]) =>
                `<tr><th>${escape(k)}</th><td>${v}</td></tr>`,
            )
            .join("")}
        </table>
        <p class="muted small">
          Verification id: <code>${escape(arr.id)}</code>
        </p>
      </div>`;

    return res
      .code(200)
      .type("text/html; charset=utf-8")
      .send(renderVerifyShell({ title: "Signature Verification", bodyHtml }));
  } catch (error) {
    console.error("[verify] error:", error);
    return res
      .code(500)
      .type("text/html")
      .send(renderVerifyShell({
        title: "Error",
        bodyHtml: `<p class="muted">Something went wrong while loading this record.</p>`,
      }));
  }
};

// Minimal styled shell — no framework, no JS. Renders the same on any
// scanner browser (mobile included).
function renderVerifyShell(args: { title: string; bodyHtml: string }): string {
  return `<!doctype html><html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${args.title}</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    margin: 0; background: #f7fafc; color: #1a202c;
  }
  .wrap { max-width: 560px; margin: 24px auto; padding: 0 16px; }
  h1 { font-size: 18px; margin: 8px 0 16px; }
  .card {
    background: #fff; border: 1px solid #e2e8f0; border-radius: 12px;
    padding: 16px; box-shadow: 0 1px 3px rgba(0,0,0,0.04);
  }
  .badge {
    display: inline-block; padding: 4px 10px; border-radius: 999px;
    font-size: 12px; font-weight: 600; margin-bottom: 12px;
  }
  .badge.ok { background: #d1fae5; color: #065f46; }
  .badge.warn { background: #fef3c7; color: #92400e; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th, td { text-align: left; padding: 8px 0; border-top: 1px solid #edf2f7; vertical-align: top; }
  th { color: #4a5568; font-weight: 500; width: 38%; }
  td { color: #1a202c; }
  td a { color: #2563eb; text-decoration: none; }
  td a:hover { text-decoration: underline; }
  .muted { color: #718096; }
  .small { font-size: 11px; margin-top: 12px; }
  code { background: #edf2f7; padding: 2px 6px; border-radius: 4px; font-size: 11px; }
  .head {
    display: flex; align-items: center; gap: 8px; margin-bottom: 8px;
  }
  .logo {
    width: 28px; height: 28px; border-radius: 6px; background: #2563eb;
    color: #fff; display: flex; align-items: center; justify-content: center;
    font-weight: 700; font-size: 12px;
  }
</style></head><body>
<div class="wrap">
  <div class="head">
    <div class="logo">✓</div>
    <h1 style="margin:0;">${args.title}</h1>
  </div>
  ${args.bodyHtml}
</div>
</body></html>`;
}

// ─── Public verify data (JSON) — consumed by the FE /verify page ───────
export const verifySignatureData = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const params = req.params as { id: string };
  if (!params.id) throw new ValidationError("INVALID REQUIRED ID");
  try {
    const arr = await prisma.signatoryArrangement.findUnique({
      where: { id: params.id },
      select: {
        id: true,
        index: true,
        status: true,
        signedAt: true,
        signedLat: true,
        signedLng: true,
        signedAccuracy: true,
        signatureQueueRoom: {
          select: { id: true, title: true, status: true },
        },
        user: {
          select: {
            firstName: true,
            lastName: true,
            username: true,
            Position: { select: { name: true } },
          },
        },
      },
    });
    if (!arr) throw new NotFoundError("Not found");
    return res.code(200).send({
      id: arr.id,
      slot: arr.index + 1,
      status: arr.status,
      signedAt: arr.signedAt,
      geo:
        arr.signedLat != null && arr.signedLng != null
          ? {
              lat: arr.signedLat,
              lng: arr.signedLng,
              accuracy: arr.signedAccuracy ?? null,
            }
          : null,
      queue: arr.signatureQueueRoom
        ? {
            id: arr.signatureQueueRoom.id,
            title: arr.signatureQueueRoom.title,
            status: arr.signatureQueueRoom.status,
          }
        : null,
      user: arr.user
        ? {
            firstName: arr.user.firstName,
            lastName: arr.user.lastName,
            username: arr.user.username,
            position: arr.user.Position?.name ?? null,
          }
        : null,
    });
  } catch (error) {
    if (error instanceof NotFoundError) throw error;
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError(error.message, 500, error.code);
    }
    throw error;
  }
};
