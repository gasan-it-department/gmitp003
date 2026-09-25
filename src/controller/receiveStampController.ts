/**
 * The receiving stamp.
 *
 * Every office has a rubber stamp: a box that says RECEIVED, the office
 * name, and two empty lines — DATE and BY. A clerk inks it onto whatever
 * arrives and writes the date and their name by hand.
 *
 * This is that stamp, done once. The office uploads its own artwork, says
 * where on it the date, the name and the signature belong, and from then on
 * the app fills those three in. The artwork is never generated here: it is
 * the office's real stamp, scanned, because a receiving stamp that does not
 * look like the office's receiving stamp is not evidence of anything.
 *
 * Placements are basis points of the artwork (0-10000, origin top-left) —
 * the same unit SignatureCoor uses, so the editor on screen and the render
 * below divide by the same number and cannot drift apart.
 */
import { FastifyRequest, FastifyReply } from "../barrel/fastify";
import { prisma, Prisma } from "../barrel/prisma";
import {
  AppError,
  NotFoundError,
  ValidationError,
  UnauthorizedError,
} from "../errors/errors";
import { callerContext } from "../service/callerScope";
import { renderPdfPage } from "../service/pdfRaster";

/** The physical stamp, in millimetres. Not negotiable: it is a rubber stamp. */
export const STAMP_W_MM = 58;
export const STAMP_H_MM = 30;
const MM_PER_PT = 25.4 / 72;
export const STAMP_W_PT = STAMP_W_MM / MM_PER_PT; // ~164.4
export const STAMP_H_PT = STAMP_H_MM / MM_PER_PT; // ~85.0

const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const BP = 10000;

/** Everything except the bytes — the config the editor works on. */
const SHAPE = {
  id: true,
  userId: true,
  lineId: true,
  mime: true,
  imageW: true,
  imageH: true,
  sigX: true,
  sigY: true,
  sigW: true,
  sigH: true,
  nickname: true,
  nameX: true,
  nameY: true,
  nameSizePt: true,
  dateX: true,
  dateY: true,
  dateSizePt: true,
  timestamp: true,
  updatedAt: true,
} as const;

const clampBp = (v: unknown, fallback: number) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(BP, Math.round(n)));
};

const clampPt = (v: unknown, fallback: number) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  // Below 4pt nothing is readable when printed; above 24pt nothing fits.
  return Math.max(4, Math.min(24, Math.round(n * 10) / 10));
};

/** GET /document/receive-stamp — the caller's own stamp setup. */
export const myReceiveStamp = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const { actorId, lineId } = await callerContext(req);

  const row = await prisma.receiveStamp.findUnique({
    where: { userId: actorId },
    select: { ...SHAPE, image: true },
  });

  // The signature this stamp will carry. It is the caller's ACTIVE one, the
  // same one their documents are signed with — a receiving stamp signed with
  // a different hand than the signature on file would be worse than useless.
  const signature = await prisma.signature.findFirst({
    where: { userId: actorId, active: true },
    select: { id: true, title: true, signature: true },
  });

  return res.code(200).send({
    stamp: row
      ? { ...row, image: undefined, hasImage: !!row.image }
      : null,
    /**
     * Whether a signature is on file at all. Without one the stamp cannot
     * be completed, and saying so here means the editor can explain that
     * instead of silently rendering an empty box.
     */
    signature: signature
      ? { id: signature.id, title: signature.title, hasImage: !!signature.signature }
      : null,
    stampSize: { widthMm: STAMP_W_MM, heightMm: STAMP_H_MM },
    lineId,
  });
};

/** GET /document/receive-stamp/image — the raw artwork, for the editor. */
export const receiveStampImage = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const { actorId } = await callerContext(req);
  const row = await prisma.receiveStamp.findUnique({
    where: { userId: actorId },
    select: { image: true, mime: true, updatedAt: true },
  });
  if (!row?.image) throw new NotFoundError("No stamp artwork uploaded yet");
  return res
    .header("Content-Type", row.mime || "image/png")
    .header("Cache-Control", "private, max-age=0, must-revalidate")
    .header("ETag", `"${row.updatedAt.getTime()}"`)
    .code(200)
    .send(Buffer.from(row.image));
};

/** POST /document/receive-stamp/image — upload the office's artwork. */
export const uploadReceiveStampImage = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  if (!req.isMultipart()) throw new ValidationError("INVALID REQUEST");
  const { actorId, lineId } = await callerContext(req);

  let buf: Buffer | null = null;
  let mime = "image/png";
  for await (const part of req.parts()) {
    if (part.type === "file") {
      const chunks: Buffer[] = [];
      let total = 0;
      for await (const c of part.file) {
        total += c.length;
        if (total > MAX_IMAGE_BYTES) {
          throw new ValidationError("The stamp image must be under 4 MB.");
        }
        chunks.push(c as Buffer);
      }
      buf = Buffer.concat(chunks);
      mime = part.mimetype || mime;
    }
  }
  if (!buf?.length) throw new ValidationError("No image was uploaded.");

  /**
   * PNG only, and read its real size from the header.
   *
   * A stamp is inked onto paper that already has print on it, so the
   * background has to be transparent — which JPEG cannot do. Rejecting it
   * here is kinder than a stamp that lands as a white box over the text it
   * was supposed to sit beside.
   */
  const isPng =
    buf.length > 24 &&
    buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (!isPng) {
    throw new ValidationError(
      "The stamp must be a PNG with a transparent background — a JPEG would print as a white box over the page.",
    );
  }
  const imageW = buf.readUInt32BE(16);
  const imageH = buf.readUInt32BE(20);
  if (!imageW || !imageH) throw new ValidationError("That PNG could not be read.");

  /**
   * Shape, not size. The artwork is 58mm x 30mm — a ratio of about 1.93 —
   * and anything markedly different is a different stamp, or a screenshot
   * with the desktop around it. A tolerance because a scan is never exact.
   */
  const ratio = imageW / imageH;
  const want = STAMP_W_MM / STAMP_H_MM;
  if (ratio < want * 0.8 || ratio > want * 1.2) {
    throw new ValidationError(
      `The stamp should be ${STAMP_W_MM}mm x ${STAMP_H_MM}mm (about ${want.toFixed(2)}:1). ` +
        `This image is ${imageW}x${imageH}, which is ${ratio.toFixed(2)}:1 — crop it to the stamp itself and try again.`,
    );
  }

  const saved = await prisma.receiveStamp.upsert({
    where: { userId: actorId },
    update: { image: buf, mime, imageW, imageH, lineId },
    create: { userId: actorId, lineId, image: buf, mime, imageW, imageH },
    select: SHAPE,
  });

  return res.code(200).send({ message: "OK", stamp: { ...saved, hasImage: true } });
};

/** PATCH /document/receive-stamp — where things sit, and what the name says. */
export const saveReceiveStamp = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const { actorId, lineId } = await callerContext(req);
  const b = req.body as Record<string, unknown>;

  const current = await prisma.receiveStamp.findUnique({
    where: { userId: actorId },
    select: SHAPE,
  });

  const nickname = String(b.nickname ?? current?.nickname ?? "").trim().slice(0, 40);

  const data = {
    lineId,
    nickname,
    sigX: clampBp(b.sigX, current?.sigX ?? 5200),
    sigY: clampBp(b.sigY, current?.sigY ?? 6200),
    sigW: clampBp(b.sigW, current?.sigW ?? 3600),
    sigH: clampBp(b.sigH, current?.sigH ?? 2600),
    nameX: clampBp(b.nameX, current?.nameX ?? 2400),
    nameY: clampBp(b.nameY, current?.nameY ?? 8600),
    nameSizePt: clampPt(b.nameSizePt, current?.nameSizePt ?? 9),
    dateX: clampBp(b.dateX, current?.dateX ?? 2400),
    dateY: clampBp(b.dateY, current?.dateY ?? 7000),
    dateSizePt: clampPt(b.dateSizePt, current?.dateSizePt ?? 9),
  };

  // A box with no area is a box nothing can be drawn in.
  if (data.sigW < 200 || data.sigH < 150) {
    throw new ValidationError("The signature area is too small to print into.");
  }

  const saved = await prisma.receiveStamp.upsert({
    where: { userId: actorId },
    update: data,
    create: { userId: actorId, ...data },
    select: SHAPE,
  });

  return res.code(200).send({ message: "OK", stamp: saved });
};

/** DELETE /document/receive-stamp — start again. */
export const deleteReceiveStamp = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const { actorId } = await callerContext(req);
  const row = await prisma.receiveStamp.findUnique({
    where: { userId: actorId },
    select: { id: true },
  });
  if (!row) throw new NotFoundError("Nothing to remove");
  await prisma.receiveStamp.delete({ where: { id: row.id } });
  return res.code(200).send({ message: "OK" });
};

/**
 * Compose the finished stamp.
 *
 * Built as a one-page PDF exactly 58mm x 30mm and then rasterised, rather
 * than by pasting pixels: the placements are physical, the type has to be
 * real type at a real point size, and this project already renders PDFs
 * this way for signed documents. The same pipeline means a stamp previewed
 * on screen and a stamp printed on paper come from one code path.
 *
 * Exported so the receiving flow can call it directly when the time comes
 * to actually apply a stamp to an arriving document.
 */
export const renderReceiveStamp = async (
  userId: string,
  when: Date = new Date(),
  widthPx = 900,
): Promise<Buffer> => {
  const row = await prisma.receiveStamp.findUnique({
    where: { userId },
    select: { ...SHAPE, image: true },
  });
  if (!row?.image) throw new NotFoundError("No stamp artwork uploaded yet");

  const sig = await prisma.signature.findFirst({
    where: { userId, active: true },
    select: { signature: true },
  });

  const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([STAMP_W_PT, STAMP_H_PT]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);

  // The artwork fills the page — it IS the page.
  const art = await pdf.embedPng(Buffer.from(row.image));
  page.drawImage(art, { x: 0, y: 0, width: STAMP_W_PT, height: STAMP_H_PT });

  /**
   * Basis points are measured from the TOP; PDF measures from the bottom.
   * Every placement goes through here so the flip happens exactly once.
   */
  const toPt = (xBp: number, yBp: number) => ({
    x: (xBp / BP) * STAMP_W_PT,
    yTop: (yBp / BP) * STAMP_H_PT,
  });

  if (sig?.signature?.length) {
    const { x, yTop } = toPt(row.sigX, row.sigY);
    const w = (row.sigW / BP) * STAMP_W_PT;
    const h = (row.sigH / BP) * STAMP_H_PT;
    try {
      const img = await pdf.embedPng(Buffer.from(sig.signature));
      // Fit inside the box, keeping the writing's own proportions — a
      // stretched signature is not the person's signature.
      const scale = Math.min(w / img.width, h / img.height);
      const dw = img.width * scale;
      const dh = img.height * scale;
      page.drawImage(img, {
        x: x + (w - dw) / 2,
        y: STAMP_H_PT - yTop - h + (h - dh) / 2,
        width: dw,
        height: dh,
      });
    } catch {
      // A signature stored as something other than PNG. The stamp is still
      // worth producing; the rest of it is correct.
    }
  }

  const ink = rgb(0, 0, 0);
  const dateText = when.toLocaleDateString("en-PH", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const d = toPt(row.dateX, row.dateY);
  page.drawText(dateText, {
    x: d.x,
    y: STAMP_H_PT - d.yTop - row.dateSizePt,
    size: row.dateSizePt,
    font,
    color: ink,
  });

  if (row.nickname) {
    const n = toPt(row.nameX, row.nameY);
    page.drawText(row.nickname, {
      x: n.x,
      y: STAMP_H_PT - n.yTop - row.nameSizePt,
      size: row.nameSizePt,
      font,
      color: ink,
    });
  }

  const bytes = Buffer.from(await pdf.save());
  const { png } = await renderPdfPage(bytes, 1, widthPx);
  return png;
};

/** GET /document/receive-stamp/preview — the finished stamp, as it will print. */
export const receiveStampPreview = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const { actorId } = await callerContext(req);
  if (!actorId) throw new UnauthorizedError("Not signed in");
  const q = req.query as { width?: string };
  const width = q.width ? parseInt(q.width, 10) : 900;

  try {
    const png = await renderReceiveStamp(actorId, new Date(), width);
    return res
      .header("Content-Type", "image/png")
      .header("Cache-Control", "no-store")
      .code(200)
      .send(png);
  } catch (error) {
    if (error instanceof NotFoundError || error instanceof ValidationError)
      throw error;
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
    }
    throw error;
  }
};
