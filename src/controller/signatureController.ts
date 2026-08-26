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
// SECURITY: every handler here resolves the owner from the BEARER TOKEN and
// ignores any userId supplied by the client. These endpoints previously
// trusted a request-supplied userId, which let any authenticated user read,
// activate, delete and QR-toggle another person's signature — including
// downloading their signature IMAGE. Never reintroduce a client-provided
// owner id here.
//
// Storage: signature blobs live on the Signature.signature `Bytes?`
// column (PNG/JPEG/SVG, ideally a transparent PNG). The list response
// returns each signature as a base64 data URL so the UI can show a
// preview without a second round-trip per row.

import { FastifyReply, FastifyRequest } from "../barrel/fastify";
import { prisma, Prisma } from "../barrel/prisma";
import { AppError, NotFoundError, ValidationError, UnauthorizedError } from "../errors/errors";
import { callerUserId } from "../middleware/handler";

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
  // `params.id` is ignored on purpose — see the SECURITY note above. A user
  // may only ever list their own signatures.
  const ownerId = await callerUserId(req);
  if (!ownerId) throw new UnauthorizedError("Not signed in");

  try {
    const cursor = params.lastCursor ? { id: params.lastCursor } : undefined;
    const limit = params.limit ? parseInt(params.limit, 10) : 20;

    const where: any = { userId: ownerId };
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
        // How this one stamps: null height means it still fits to whatever
        // box was drawn on the page (the old behaviour).
        inkHeightPt: r.inkHeightPt,
        baselinePct: r.baselinePct,
        ink:
          r.inkX0 === null || r.inkY0 === null || r.inkX1 === null || r.inkY1 === null
            ? null
            : { x0: r.inkX0, y0: r.inkY0, x1: r.inkX1, y1: r.inkY1 },
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
    let ink = "";

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
        // The browser already decoded the image to show a preview, so it
        // measures where the ink actually is and sends it along. The server
        // has no image decoder and does not need one for this; the value is
        // cosmetic geometry, and it is clamped before it is stored.
        else if (part.fieldname === "ink") ink = v;
      }
    }

    // The multipart `userId` field is ignored — a signature always belongs to
    // whoever is signed in, never to whoever the form claims.
    const ownerId = await callerUserId(req);
    if (!ownerId) throw new UnauthorizedError("Not signed in");
    userId = ownerId;
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
          ...inkFields(ink),
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
  const body = req.body as { id: string; userId?: string };
  if (!body.id) throw new ValidationError("INVALID REQUIRED ID");
  const ownerId = await callerUserId(req);
  if (!ownerId) throw new UnauthorizedError("Not signed in");

  try {
    await prisma.$transaction(async (tx) => {
      const target = await tx.signature.findFirst({
        where: { id: body.id, userId: ownerId },
      });
      if (!target) throw new NotFoundError("Signature not found");

      // Single-active invariant.
      await tx.signature.updateMany({
        where: { userId: ownerId, active: true, NOT: { id: body.id } },
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
  const params = req.query as { id: string; userId?: string };
  const ownerId = await callerUserId(req);
  if (!ownerId) throw new UnauthorizedError("Not signed in");
  if (!params.id) {
    throw new ValidationError("INVALID REQUIRED ID");
  }

  try {
    const target = await prisma.signature.findFirst({
      where: { id: params.id, userId: ownerId },
    });
    if (!target) throw new NotFoundError("Signature not found");

    const wasActive = target.active;

    await prisma.$transaction(async (tx) => {
      await tx.signature.delete({ where: { id: target.id } });

      // If we just removed the active one, promote the most-recent
      // remaining signature so the user still has something to sign with.
      if (wasActive) {
        const next = await tx.signature.findFirst({
          where: { userId: ownerId },
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
/** 0-1, or undefined when the value is missing or nonsense. */
const frac = (v: unknown): number | undefined => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 && n <= 1 ? n : undefined;
};

/**
 * `{"x0":..,"y0":..,"x1":..,"y1":..}` → columns, or nothing.
 *
 * A box that is inverted or smaller than 1% of the file is thrown away
 * rather than stored: stamping divides by its height, and "the whole file"
 * is a safe answer where a broken measurement is not.
 */
const inkFields = (raw: string) => {
  if (!raw) return {};
  try {
    const o = JSON.parse(raw);
    const x0 = frac(o.x0), y0 = frac(o.y0), x1 = frac(o.x1), y1 = frac(o.y1);
    if (x0 === undefined || y0 === undefined || x1 === undefined || y1 === undefined)
      return {};
    if (x1 - x0 < 0.01 || y1 - y0 < 0.01) return {};
    return { inkX0: x0, inkY0: y0, inkX1: x1, inkY1: y1 };
  } catch {
    return {};
  }
};

/**
 * POST /document/user/signatures/placement
 * { id, inkHeightPt, baselinePct, ink? }
 *
 * How big this signature prints and where its writing line is. Sending a
 * null/0 height puts it back to fitting whatever box was drawn on the page.
 */
export const setSignaturePlacement = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const body = req.body as {
    id?: string;
    inkHeightPt?: number | null;
    baselinePct?: number | null;
    ink?: { x0?: number; y0?: number; x1?: number; y1?: number } | null;
  };
  if (!body.id) throw new ValidationError("INVALID REQUIRED FIELDS");

  const ownerId = await callerUserId(req);
  if (!ownerId) throw new UnauthorizedError("Not signed in");

  const target = await prisma.signature.findFirst({
    where: { id: body.id, userId: ownerId },
    select: { id: true },
  });
  if (!target) throw new NotFoundError("Signature not found");

  // A signature taller than a page, or a hairline, is a typo rather than an
  // intention. 4pt-288pt covers everything from an initial to a full page-
  // width flourish.
  const h = Number(body.inkHeightPt);
  const inkHeightPt =
    body.inkHeightPt === null || !Number.isFinite(h) || h <= 0
      ? null
      : Math.min(288, Math.max(4, h));

  const b = Number(body.baselinePct);
  const baselinePct = Number.isFinite(b)
    ? Math.min(100, Math.max(0, Math.round(b)))
    : 100;

  const updated = await prisma.signature.update({
    where: { id: body.id },
    data: {
      inkHeightPt,
      baselinePct,
      ...(body.ink ? inkFields(JSON.stringify(body.ink)) : {}),
    },
    select: {
      id: true,
      inkHeightPt: true,
      baselinePct: true,
      inkX0: true,
      inkY0: true,
      inkX1: true,
      inkY1: true,
    },
  });

  return res.code(200).send({ message: "OK", signature: updated });
};

export const setSignatureQr = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const body = req.body as {
    id: string;
    userId?: string;
    qrEnabled: boolean;
  };
  if (!body.id || typeof body.qrEnabled !== "boolean") {
    throw new ValidationError("INVALID REQUIRED FIELDS");
  }
  const ownerId = await callerUserId(req);
  if (!ownerId) throw new UnauthorizedError("Not signed in");
  try {
    const target = await prisma.signature.findFirst({
      where: { id: body.id, userId: ownerId },
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
