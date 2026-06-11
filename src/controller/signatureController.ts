// Signature management for the e-sign module.
//
// Surface:
//   GET    /document/user/signatures           list paginated
//   POST   /document/user/signatures/upload    multipart (file + title)
//   PATCH  /document/user/signatures/activate  set active (de-activates others)
//   DELETE /document/user/signatures/remove    remove a signature
//
// Active rule: exactly one signature per user can be `active: true`. The
// activate handler flips the chosen row on and clears the others.
//
// Storage: signature blobs live on the Signature.signature `Bytes?`
// column (PNG/JPEG/SVG, ideally a transparent PNG). The list response
// returns each signature as a base64 data URL so the UI can show a
// preview without a second round-trip per row.

import { FastifyReply, FastifyRequest } from "../barrel/fastify";
import { prisma, Prisma } from "../barrel/prisma";
import { AppError, NotFoundError, ValidationError } from "../errors/errors";

const ALLOWED_MIMES = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "image/svg+xml",
]);

// 5MB cap — signatures are tiny by nature.
const MAX_SIGNATURE_BYTES = 5 * 1024 * 1024;

const toDataUrl = (
  bytes: Buffer | Uint8Array | null | undefined,
  mime = "image/png",
) => {
  if (!bytes) return null;
  const b = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes as Uint8Array);
  return `data:${mime};base64,${b.toString("base64")}`;
};

/**
 * Heuristic mime detection so a previously-uploaded signature can be
 * served with the right content type even though we don't store mime
 * on the row.
 */
const sniffMime = (buf: Buffer | null): string => {
  if (!buf || buf.length < 4) return "image/png";
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47)
    return "image/png";
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (
    buf[0] === 0x52 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x46 &&
    buf.length >= 12 &&
    buf[8] === 0x57 &&
    buf[9] === 0x45 &&
    buf[10] === 0x42 &&
    buf[11] === 0x50
  )
    return "image/webp";
  // Quick SVG sniff
  const head = buf.slice(0, 64).toString("utf8").trim().toLowerCase();
  if (head.startsWith("<svg") || head.startsWith("<?xml"))
    return "image/svg+xml";
  return "image/png";
};

export const listUserSignatures = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const params = req.query as {
    id?: string;
    lastCursor?: string | null;
    limit?: string;
    query?: string;
  };
  if (!params.id) throw new ValidationError("INVALID REQUIRED ID");

  try {
    const cursor = params.lastCursor ? { id: params.lastCursor } : undefined;
    const limit = params.limit ? parseInt(params.limit, 10) : 20;

    const where: any = { userId: params.id };
    if (params.query && params.query.trim()) {
      where.title = { contains: params.query.trim(), mode: "insensitive" };
    }

    const rows = await prisma.signature.findMany({
      where,
      take: limit,
      skip: cursor ? 1 : 0,
      cursor,
      orderBy: [{ active: "desc" }, { timestamp: "desc" }],
    });

    const list = rows.map((r) => {
      const buf = r.signature ? Buffer.from(r.signature) : null;
      const mime = sniffMime(buf);
      return {
        id: r.id,
        title: r.title,
        active: r.active,
        default: r.defalt, // schema field name is `defalt` (typo, preserved)
        forRenew: r.forRenew,
        timestamp: r.timestamp,
        roomAuthorizedUserId: r.roomAuthorizedUserId,
        qrEnabled: r.qrEnabled,
        // base64 data URL so the UI can <img src={preview}> directly.
        preview: toDataUrl(buf, mime),
        size: buf?.length ?? 0,
      };
    });

    const lastCursor = list.length > 0 ? list[list.length - 1].id : null;
    const hasMore = list.length === limit;

    return res.code(200).send({ list, lastCursor, hasMore });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
    }
    throw error;
  }
};

export const uploadUserSignature = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  if (!req.isMultipart()) throw new ValidationError("Missing multipart payload");

  try {
    let fileBuffer: Buffer | null = null;
    let filename = "";
    let mimetype = "";
    let title = "";
    let userId = "";
    let setActive = false;

    for await (const part of req.parts()) {
      if (part.type === "file") {
        if (fileBuffer) continue; // only first file
        fileBuffer = await part.toBuffer();
        filename = part.filename;
        mimetype = part.mimetype;
      } else {
        const v = String(part.value ?? "");
        if (part.fieldname === "title") title = v;
        else if (part.fieldname === "userId") userId = v;
        else if (part.fieldname === "active") setActive = v === "true";
      }
    }

    if (!userId) throw new ValidationError("userId is required");
    if (!fileBuffer) throw new ValidationError("No signature file uploaded");
    if (fileBuffer.length > MAX_SIGNATURE_BYTES) {
      throw new ValidationError(
        `Signature file too large (max ${MAX_SIGNATURE_BYTES / 1024 / 1024}MB).`,
      );
    }
    // Accept by mime first, fall back to sniff (camera uploads can lie).
    const finalMime = ALLOWED_MIMES.has(mimetype)
      ? mimetype
      : sniffMime(fileBuffer);
    if (!ALLOWED_MIMES.has(finalMime)) {
      throw new ValidationError(
        "Only PNG, JPEG, WEBP, or SVG signatures are supported.",
      );
    }

    const finalTitle =
      title.trim() ||
      filename?.replace(/\.[^.]+$/, "").slice(0, 40) ||
      "My Signature";

    const created = await prisma.$transaction(async (tx) => {
      // If the user asked for this one to be active, clear the others.
      if (setActive) {
        await tx.signature.updateMany({
          where: { userId, active: true },
          data: { active: false },
        });
      }
      // If the user has no signature yet, the first one is active by default.
      let shouldBeActive = setActive;
      if (!shouldBeActive) {
        const existing = await tx.signature.count({ where: { userId } });
        if (existing === 0) shouldBeActive = true;
      }
      return tx.signature.create({
        data: {
          userId,
          title: finalTitle,
          signature: fileBuffer,
          active: shouldBeActive,
        },
        select: {
          id: true,
          title: true,
          active: true,
          timestamp: true,
        },
      });
    });

    return res.code(200).send({ message: "OK", signature: created });
  } catch (error) {
    if (error instanceof ValidationError) throw error;
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
    }
    throw error;
  }
};

export const activateUserSignature = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const body = req.body as { id: string; userId: string };
  if (!body.id || !body.userId) throw new ValidationError("INVALID REQUIRED ID");

  try {
    await prisma.$transaction(async (tx) => {
      const target = await tx.signature.findFirst({
        where: { id: body.id, userId: body.userId },
      });
      if (!target) throw new NotFoundError("Signature not found");

      // Single-active invariant.
      await tx.signature.updateMany({
        where: { userId: body.userId, active: true, NOT: { id: body.id } },
        data: { active: false },
      });
      await tx.signature.update({
        where: { id: body.id },
        data: { active: true },
      });
    });

    return res.code(200).send({ message: "OK", id: body.id, active: true });
  } catch (error) {
    if (error instanceof NotFoundError) throw error;
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
    }
    throw error;
  }
};

export const deleteUserSignature = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const params = req.query as { id: string; userId: string };
  if (!params.id || !params.userId) {
    throw new ValidationError("INVALID REQUIRED ID");
  }

  try {
    const target = await prisma.signature.findFirst({
      where: { id: params.id, userId: params.userId },
    });
    if (!target) throw new NotFoundError("Signature not found");

    const wasActive = target.active;

    await prisma.$transaction(async (tx) => {
      await tx.signature.delete({ where: { id: target.id } });

      // If we just removed the active one, promote the most-recent
      // remaining signature so the user still has something to sign with.
      if (wasActive) {
        const next = await tx.signature.findFirst({
          where: { userId: params.userId },
          orderBy: { timestamp: "desc" },
        });
        if (next) {
          await tx.signature.update({
            where: { id: next.id },
            data: { active: true },
          });
        }
      }
    });

    return res.code(200).send({ message: "OK", id: params.id });
  } catch (error) {
    if (error instanceof NotFoundError) throw error;
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
    }
    throw error;
  }
};

// ─── Per-signature QR toggle ──────────────────────────────────────────
// Each Signature row carries its own `qrEnabled` flag — users can keep
// QR ON for their formal signature and OFF for a casual one.
export const setSignatureQr = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const body = req.body as {
    id: string;
    userId: string;
    qrEnabled: boolean;
  };
  if (!body.id || !body.userId || typeof body.qrEnabled !== "boolean") {
    throw new ValidationError("INVALID REQUIRED FIELDS");
  }
  try {
    const target = await prisma.signature.findFirst({
      where: { id: body.id, userId: body.userId },
      select: { id: true },
    });
    if (!target) throw new NotFoundError("Signature not found");
    await prisma.signature.update({
      where: { id: body.id },
      data: { qrEnabled: body.qrEnabled },
    });
    return res
      .code(200)
      .send({ message: "OK", id: body.id, qrEnabled: body.qrEnabled });
  } catch (error) {
    if (error instanceof NotFoundError) throw error;
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError(error.message, 500, error.code);
    }
    throw error;
  }
};
