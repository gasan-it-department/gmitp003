// Personal self-sign tool — a user uploads their OWN document, drops
// signature placeholder boxes on it, then signs every box in one click.
// No dissemination, no targets, no other signatories. The same image-stamp
// + flatten machinery used for dispatched disseminations is reused for
// the final download.
//
// Data model reuse:
//   - Document               (file holder, userId = owner, queueRoomId = null)
//   - DocumentPage           (lazy, one per page that has placements)
//   - SignatureCoor          (placement boxes)
//   - SignatoryArrangement   (single row per document, queueRoomId = null,
//                             userId = owner; status 0=pending, 1=signed)
//   - ArchiveDocument        (for the optional "store in room archive")

import { FastifyReply, FastifyRequest } from "../barrel/fastify";
import { prisma, Prisma } from "../barrel/prisma";
import { AppError, NotFoundError, ValidationError } from "../errors/errors";

const MAX_DOC_BYTES = 25 * 1024 * 1024; // 25 MB

// ─── Upload ────────────────────────────────────────────────────────────
export const selfSignUpload = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  if (!req.isMultipart()) throw new ValidationError("INVALID REQUEST");

  let upload: {
    fileName: string;
    mimetype: string;
    buffer: Buffer;
  } | null = null;
  const fields: Record<string, string> = {};
  try {
    const parts = req.parts();
    for await (const part of parts) {
      if (part.type === "file") {
        const chunks: Buffer[] = [];
        for await (const chunk of part.file) chunks.push(chunk as Buffer);
        upload = {
          fileName: part.filename,
          mimetype: part.mimetype,
          buffer: Buffer.concat(chunks),
        };
      } else {
        fields[part.fieldname] = String(part.value);
      }
    }
    if (!upload) throw new ValidationError("FILE REQUIRED");
    if (upload.mimetype !== "application/pdf") {
      throw new ValidationError("ONLY PDF FILES ARE ALLOWED");
    }
    if (upload.buffer.length > MAX_DOC_BYTES) {
      throw new ValidationError("FILE EXCEEDS 25MB LIMIT");
    }
    const { userId, lineId, title } = fields;
    if (!userId || !lineId) {
      throw new ValidationError("INVALID REQUIRED FIELDS");
    }

    const result = await prisma.$transaction(async (tx) => {
      const doc = await tx.document.create({
        data: {
          title: title || upload!.fileName.replace(/\.pdf$/i, ""),
          size: upload!.buffer.length,
          lineId,
          userId,
          docType: 0,
          type: 9, // 9 = self-sign (distinct from dissemination docs)
          original: 1,
        },
        select: { id: true, title: true, timestamp: true },
      });
      await tx.decodedFile.create({
        data: {
          documentId: doc.id,
          fileName: upload!.fileName,
          fileSize: String(upload!.buffer.length),
          fileType: upload!.mimetype,
          fileDecoded: upload!.buffer,
        },
      });
      // One arrangement per self-sign doc (no queue). The placements
      // bind to this so the existing signed-PDF endpoint works.
      const arr = await tx.signatoryArrangement.create({
        data: {
          signatureQueueRoomId: null,
          index: 0,
          status: 0,
          userId,
        },
        select: { id: true },
      });
      return { doc, arrangementId: arr.id };
    });

    return res.code(200).send({
      message: "OK",
      document: result.doc,
      arrangementId: result.arrangementId,
    });
  } catch (error) {
    if (error instanceof ValidationError) throw error;
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError(error.message, 500, error.code);
    }
    throw error;
  }
};

// ─── Save placements ───────────────────────────────────────────────────
// Replace strategy: every save call wipes existing SignatureCoor rows on
// the document and recreates them from the payload. Auto-saved by the
// frontend on every box change.
export const selfSignSavePlacements = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const body = req.body as {
    documentId: string;
    arrangementId: string;
    userId: string;
    placements: Array<{
      page: number;
      xAxis: number;
      yAxis: number;
      width: number;
      height: number;
    }>;
  };
  if (
    !body.documentId ||
    !body.arrangementId ||
    !Array.isArray(body.placements)
  ) {
    throw new ValidationError("INVALID REQUIRED FIELDS");
  }

  try {
    await prisma.$transaction(async (tx) => {
      const doc = await tx.document.findUnique({
        where: { id: body.documentId },
        select: { id: true, userId: true },
      });
      if (!doc) throw new NotFoundError("Document not found");
      if (doc.userId !== body.userId) {
        throw new ValidationError("Not the document owner.");
      }

      const arr = await tx.signatoryArrangement.findUnique({
        where: { id: body.arrangementId },
        select: { id: true, userId: true, status: true },
      });
      if (!arr) throw new NotFoundError("Arrangement not found");
      if (arr.userId !== body.userId) {
        throw new ValidationError("Not the arrangement owner.");
      }
      if (arr.status !== 0) {
        throw new ValidationError(
          "Document already signed — placements are frozen.",
        );
      }

      // Group by page; ensure DocumentPage rows exist.
      const pageNums = Array.from(
        new Set(body.placements.map((p) => p.page)),
      ).filter((n) => Number.isFinite(n) && n > 0);
      const existing = await tx.documentPage.findMany({
        where: { documentId: body.documentId, page: { in: pageNums } },
        select: { id: true, page: true },
      });
      const byPage = new Map<number, string>(
        existing.map((p) => [p.page, p.id]),
      );
      for (const p of pageNums) {
        if (!byPage.has(p)) {
          const created = await tx.documentPage.create({
            data: { documentId: body.documentId, page: p, content: "" },
            select: { id: true, page: true },
          });
          byPage.set(p, created.id);
        }
      }

      // Drop existing placements on this document, recreate.
      const allPages = await tx.documentPage.findMany({
        where: { documentId: body.documentId },
        select: { id: true },
      });
      if (allPages.length > 0) {
        await tx.signatureCoor.deleteMany({
          where: { documentPageId: { in: allPages.map((p) => p.id) } },
        });
      }
      if (body.placements.length > 0) {
        await tx.signatureCoor.createMany({
          data: body.placements.map((p) => ({
            documentPageId: byPage.get(p.page)!,
            signatoryArrangementId: body.arrangementId,
            xAxis: Math.round(p.xAxis),
            yAxis: Math.round(p.yAxis),
            width: Math.round(p.width),
            height: Math.round(p.height),
          })),
        });
      }
    });
    return res.code(200).send({ message: "OK" });
  } catch (error) {
    if (error instanceof NotFoundError) throw error;
    if (error instanceof ValidationError) throw error;
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError(error.message, 500, error.code);
    }
    throw error;
  }
};

// ─── Sign all in one click ─────────────────────────────────────────────
export const selfSignAll = async (req: FastifyRequest, res: FastifyReply) => {
  const body = req.body as {
    arrangementId: string;
    userId: string;
    geo?: { lat: number; lng: number; accuracy?: number | null } | null;
  };
  if (!body.arrangementId || !body.userId) {
    throw new ValidationError("INVALID REQUIRED FIELDS");
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const arr = await tx.signatoryArrangement.findUnique({
        where: { id: body.arrangementId },
        select: { id: true, userId: true, status: true, sign: { select: { id: true } } },
      });
      if (!arr) throw new NotFoundError("Arrangement not found");
      if (arr.userId !== body.userId) {
        throw new ValidationError("Not your arrangement.");
      }
      if (arr.status !== 0) {
        throw new ValidationError("Already signed.");
      }
      if (arr.sign.length === 0) {
        throw new ValidationError(
          "Draw at least one signature placeholder before signing.",
        );
      }

      // Confirm the user has an active signature on file.
      const sig = await tx.signature.findFirst({
        where: { userId: body.userId, active: true },
        select: { id: true },
      });
      if (!sig) {
        throw new ValidationError(
          "You don't have an active signature on file. Upload and activate one in Signature Management first.",
        );
      }

      const now = new Date();
      const updated = await tx.signatoryArrangement.update({
        where: { id: arr.id },
        data: {
          status: 1,
          signedAt: now,
          signedLat: body.geo?.lat ?? null,
          signedLng: body.geo?.lng ?? null,
          signedAccuracy: body.geo?.accuracy ?? null,
        },
        select: { id: true, status: true, signedAt: true },
      });
      return { boxes: arr.sign.length, signedAt: updated.signedAt };
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

// ─── List self-signed docs (history) ───────────────────────────────────
export const selfSignList = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const params = req.query as {
    userId: string;
    lineId: string;
    lastCursor?: string | null;
    limit?: string;
  };
  if (!params.userId || !params.lineId) {
    throw new ValidationError("INVALID REQUIRED FIELDS");
  }
  try {
    const limit = params.limit ? parseInt(params.limit, 10) : 20;
    const cursor =
      params.lastCursor && params.lastCursor !== "null"
        ? { id: params.lastCursor }
        : undefined;

    const rows = await prisma.document.findMany({
      where: {
        userId: params.userId,
        lineId: params.lineId,
        signatureQueueRoomId: null,
        type: 9,
      },
      take: limit,
      skip: cursor ? 1 : 0,
      cursor,
      orderBy: { timestamp: "desc" },
      include: {
        file: { select: { fileName: true, fileType: true } },
        pages: {
          select: {
            signCoor: {
              select: {
                signatoryArrangement: {
                  select: { id: true, status: true, signedAt: true },
                },
              },
            },
          },
        },
        archiveDocuments: { select: { id: true } },
      },
    });

    // Flatten: each doc gets its single arrangement (the self-sign one).
    const list = rows.map((d) => {
      const arr =
        d.pages
          .flatMap((p) => p.signCoor)
          .map((c) => c.signatoryArrangement)
          .find((a) => a && a.id) ?? null;
      const boxCount = d.pages.reduce((a, p) => a + p.signCoor.length, 0);
      return {
        id: d.id,
        title: d.title,
        size: d.size,
        timestamp: d.timestamp,
        file: d.file,
        arrangement: arr,
        boxCount,
        archived: !!d.archiveDocuments,
      };
    });

    const lastCursor = rows.length ? rows[rows.length - 1].id : null;
    const hasMore = rows.length === limit;
    return res.code(200).send({ list, lastCursor, hasMore });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError(error.message, 500, error.code);
    }
    throw error;
  }
};

// ─── Get a single self-sign doc (for the editor) ───────────────────────
export const selfSignDetail = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const params = req.query as { id: string; userId: string };
  if (!params.id || !params.userId) {
    throw new ValidationError("INVALID REQUIRED FIELDS");
  }
  try {
    const doc = await prisma.document.findUnique({
      where: { id: params.id },
      include: {
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
    });
    if (!doc) throw new NotFoundError("Document not found");
    if (doc.userId !== params.userId) {
      throw new ValidationError("Not the document owner.");
    }
    // Pull the single self-sign arrangement (placements bind to it).
    const arrIds = Array.from(
      new Set(
        doc.pages.flatMap((p) =>
          p.signCoor
            .map((c) => c.signatoryArrangementId)
            .filter((x): x is string => !!x),
        ),
      ),
    );
    let arrangement: {
      id: string;
      status: number;
      signedAt: Date | null;
    } | null = null;
    if (arrIds.length > 0) {
      const row = await prisma.signatoryArrangement.findFirst({
        where: { id: { in: arrIds }, userId: params.userId },
        select: { id: true, status: true, signedAt: true },
      });
      arrangement = row ?? null;
    }
    if (!arrangement) {
      // Fallback: find the user's own arrangement for this doc even when
      // no placements exist yet (just-uploaded state).
      arrangement = await prisma.signatoryArrangement.findFirst({
        where: { userId: params.userId, signatureQueueRoomId: null },
        orderBy: { timestamp: "desc" },
        select: { id: true, status: true, signedAt: true },
      });
    }

    // Always return the caller's signature image as a data URL so the
    // editor can render the stamp inside signed boxes without an extra
    // round-trip. Active preferred, falls back to most recent.
    let signatureDataUrl: string | null = null;
    const sigRow = await prisma.signature.findFirst({
      where: { userId: params.userId },
      orderBy: [{ active: "desc" }, { timestamp: "desc" }],
      select: { signature: true },
    });
    if (sigRow?.signature) {
      const buf = Buffer.from(sigRow.signature as Uint8Array);
      const text = buf.toString("utf8").trim();
      if (text.startsWith("data:image/")) {
        signatureDataUrl = text;
      } else if (
        /^[A-Za-z0-9+/=\r\n]+$/.test(text.slice(0, 200)) &&
        !looksLikeBinary(buf)
      ) {
        signatureDataUrl = `data:image/png;base64,${text.replace(/\s+/g, "")}`;
      } else {
        let mime = "image/png";
        if (
          buf.length >= 4 &&
          buf[0] === 0x89 &&
          buf[1] === 0x50 &&
          buf[2] === 0x4e &&
          buf[3] === 0x47
        ) {
          mime = "image/png";
        } else if (
          buf.length >= 3 &&
          buf[0] === 0xff &&
          buf[1] === 0xd8 &&
          buf[2] === 0xff
        ) {
          mime = "image/jpeg";
        }
        signatureDataUrl = `data:${mime};base64,${buf.toString("base64")}`;
      }
    }

    return res
      .code(200)
      .send({ document: doc, arrangement, signatureDataUrl });
  } catch (error) {
    if (error instanceof NotFoundError) throw error;
    if (error instanceof ValidationError) throw error;
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError(error.message, 500, error.code);
    }
    throw error;
  }
};

// ─── Archive a signed self-sign doc to the room archive ────────────────
export const selfSignArchive = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const body = req.body as { documentId: string; userId: string };
  if (!body.documentId || !body.userId) {
    throw new ValidationError("INVALID REQUIRED FIELDS");
  }
  try {
    const result = await prisma.$transaction(async (tx) => {
      const doc = await tx.document.findUnique({
        where: { id: body.documentId },
        select: {
          id: true,
          userId: true,
          lineId: true,
          pages: {
            select: {
              signCoor: {
                select: {
                  signatoryArrangement: {
                    select: { status: true },
                  },
                },
              },
            },
          },
          archiveDocuments: { select: { id: true } },
        },
      });
      if (!doc) throw new NotFoundError("Document not found");
      if (doc.userId !== body.userId) {
        throw new ValidationError("Not the document owner.");
      }
      // Must have at least one signed arrangement attached.
      const signed = doc.pages
        .flatMap((p) => p.signCoor)
        .some((c) => c.signatoryArrangement?.status === 1);
      if (!signed) {
        throw new ValidationError(
          "Sign the document before archiving it.",
        );
      }
      if (doc.archiveDocuments) {
        return { existed: true, archiveId: doc.archiveDocuments.id };
      }
      const room = await tx.receivingRoom.findFirst({
        where: {
          lineId: doc.lineId,
          authorizedUser: { some: { userId: body.userId } },
        },
        select: { id: true },
      });
      const created = await tx.archiveDocument.create({
        data: {
          documentId: doc.id,
          lineId: doc.lineId,
          receivingRoomId: room?.id ?? undefined,
          status: 1,
        },
        select: { id: true },
      });
      return { existed: false, archiveId: created.id };
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

// ─── Remove (only while unsigned) ──────────────────────────────────────
export const selfSignRemove = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const params = req.query as { id: string; userId: string };
  if (!params.id || !params.userId) {
    throw new ValidationError("INVALID REQUIRED FIELDS");
  }
  try {
    const doc = await prisma.document.findUnique({
      where: { id: params.id },
      include: {
        pages: {
          select: {
            signCoor: {
              select: {
                signatoryArrangement: { select: { status: true } },
              },
            },
          },
        },
      },
    });
    if (!doc) throw new NotFoundError("Document not found");
    if (doc.userId !== params.userId) {
      throw new ValidationError("Not the document owner.");
    }
    const isSigned = doc.pages
      .flatMap((p) => p.signCoor)
      .some((c) => c.signatoryArrangement?.status === 1);
    if (isSigned) {
      throw new ValidationError(
        "Signed documents can't be removed. Archive them instead.",
      );
    }
    await prisma.document.delete({ where: { id: doc.id } });
    return res.code(200).send({ message: "OK" });
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
