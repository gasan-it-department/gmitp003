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
 * ONE STAMP PER OFFICE. There is a single rubber stamp on the counter and
 * whoever is on duty inks it, so the artwork, the size and the layout belong
 * to the Document Room and every member — owner, signatory, receiver —
 * shares them. Only two things are the person's own: the name on the BY
 * line, and the signature, which is whichever they have marked active. That
 * is why a colleague setting up their name does not have to hunt down a
 * scan of a stamp they have never held.
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
import { callerContext, requireRoomMember } from "../service/callerScope";
import { renderPdfPage } from "../service/pdfRaster";
import { ROOM_MEMBER_TYPES } from "./roomConfigController";

/**
 * The common stamp, and the default — but only the default.
 *
 * A rubber stamp is whatever the shop cut, so the office states its own
 * size before uploading and everything downstream works from that: the
 * shape the artwork is checked against, and the page the render lays out.
 */
export const DEFAULT_W_MM = 58;
export const DEFAULT_H_MM = 30;
const MM_PER_PT = 25.4 / 72;
/** Millimetres to PDF points. */
export const mmToPt = (mm: number) => mm / MM_PER_PT;

/**
 * What a stamp may measure.
 *
 * Small enough that it is still a stamp and not a letterhead; large enough
 * that a two-line date-and-name box fits. A rubber stamp outside this range
 * is somebody typing in centimetres or inches.
 */
const MIN_MM = 10;
const MAX_MM = 150;
const clampMm = (v: unknown, fallback: number) => {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.max(MIN_MM, Math.min(MAX_MM, Math.round(n * 10) / 10));
};

const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const BP = 10000;

/** Everything except the bytes — the config the editor works on. */
const SHAPE = {
  id: true,
  roomId: true,
  userId: true,
  updatedById: true,
  lineId: true,
  mime: true,
  widthMm: true,
  heightMm: true,
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

/**
 * Which office the caller is acting as.
 *
 * Almost everyone belongs to one Document Room and never thinks about this.
 * Somebody who belongs to two has to be asked, so the screen sends the room
 * it is showing; when nothing is sent, the same deterministic rule the
 * signatory registry uses picks one — the room they own, else the oldest —
 * so the answer never changes between two requests a second apart.
 */
export const resolveStampRoom = async (
  req: FastifyRequest,
  roomId?: string | null,
): Promise<{ actorId: string; roomId: string; type: number; lineId: string | null }> => {
  const { actorId, lineId } = await callerContext(req);
  if (!actorId) throw new UnauthorizedError("Not signed in");

  if (roomId) {
    const m = await requireRoomMember(req, roomId);
    return { actorId, roomId, type: m.type, lineId };
  }

  const mine = await prisma.roomAuthorizedUser.findMany({
    where: { userId: actorId, status: 1, receivingRoomId: { not: null } },
    orderBy: [{ type: "asc" }, { timestamp: "asc" }],
    select: { receivingRoomId: true, type: true },
  });
  const first = mine[0];
  if (!first?.receivingRoomId) {
    throw new ValidationError(
      "You are not a member of any Document Room yet, so there is no office stamp to set up. Ask the room owner or HR to add you.",
    );
  }
  return { actorId, roomId: first.receivingRoomId, type: first.type, lineId };
};

/** Every Document Room the caller belongs to, for the office picker. */
const myRooms = async (actorId: string) => {
  const rows = await prisma.roomAuthorizedUser.findMany({
    where: { userId: actorId, status: 1, receivingRoomId: { not: null } },
    orderBy: [{ type: "asc" }, { timestamp: "asc" }],
    select: {
      type: true,
      receivingRoom: { select: { id: true, code: true, address: true } },
    },
  });
  const seen = new Set<string>();
  const out: Array<{ id: string; code: string; address: string | null; myType: number }> = [];
  for (const r of rows) {
    if (!r.receivingRoom || seen.has(r.receivingRoom.id)) continue;
    seen.add(r.receivingRoom.id);
    out.push({ ...r.receivingRoom, myType: r.type });
  }
  return out;
};

/**
 * The date and time on the stamp.
 *
 * A receiving stamp records the moment the office took delivery, and for a
 * document that moment is often the whole point: a deadline met at 4:55pm
 * is not the same as one met the next morning. So the time prints too, in
 * words rather than slashes, because "28 September 2026" cannot be read as
 * the 9th of the 28th.
 *
 * Always Philippine time. The server runs in UTC, so a document received at
 * 7am in Gasan would otherwise be stamped with yesterday's date.
 */
export const stampDateText = (when: Date) => {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Manila",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).formatToParts(when);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const period = get("dayPeriod").toLowerCase().replace(/\./g, "");
  return `${get("day")} ${get("month")} ${get("year")} ${get("hour")}:${get("minute")} ${period}`;
};

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

/** GET /document/receive-stamp?roomId= — the office's stamp, and my half. */
export const myReceiveStamp = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const q = req.query as { roomId?: string };
  const { actorId, roomId, type, lineId } = await resolveStampRoom(req, q.roomId);

  let row = await prisma.receiveStamp.findUnique({
    where: { roomId },
    select: { ...SHAPE, image: true },
  });

  /*
    The first version of this feature gave each person their own stamp. If
    somebody already set one up that way and their office has none, the room
    adopts it rather than making them scan the same artwork again. Their own
    name comes across with it as their name.
  */
  if (!row) {
    const legacy = await prisma.receiveStamp.findFirst({
      where: { userId: actorId, roomId: null },
      select: { id: true, nickname: true },
    });
    if (legacy) {
      row = await prisma.receiveStamp.update({
        where: { id: legacy.id },
        data: { roomId, updatedById: actorId },
        select: { ...SHAPE, image: true },
      });
      if (legacy.nickname) {
        await prisma.receiveStampName.upsert({
          where: { stampId_userId: { stampId: legacy.id, userId: actorId } },
          update: {},
          create: { stampId: legacy.id, userId: actorId, nickname: legacy.nickname },
        });
      }
    }
  }

  // My name on it, and everyone else's — so the editor can show that a
  // colleague's stamp will read differently from mine.
  const names = row
    ? await prisma.receiveStampName.findMany({
        where: { stampId: row.id },
        select: {
          userId: true,
          nickname: true,
          user: { select: { firstName: true, lastName: true } },
        },
      })
    : [];
  const mine = names.find((n) => n.userId === actorId) ?? null;

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
    /** The office this is, and every office I could be acting for. */
    room: { id: roomId, myType: type },
    rooms: await myRooms(actorId),
    /**
     * The name on MY BY line. Everything else on the stamp is the office's
     * and shared; this is the half that is mine.
     */
    myName: mine?.nickname ?? "",
    colleagues: names
      .filter((n) => n.userId !== actorId)
      .map((n) => ({
        userId: n.userId,
        nickname: n.nickname,
        name: `${n.user?.firstName ?? ""} ${n.user?.lastName ?? ""}`.trim(),
      })),
    /**
     * Whether a signature is on file at all. Without one the stamp cannot
     * be completed, and saying so here means the editor can explain that
     * instead of silently rendering an empty box.
     */
    signature: signature
      ? { id: signature.id, title: signature.title, hasImage: !!signature.signature }
      : null,
    // Their own size when they have set one, otherwise the default they
    // will start from.
    stampSize: {
      widthMm: row?.widthMm ?? DEFAULT_W_MM,
      heightMm: row?.heightMm ?? DEFAULT_H_MM,
    },
    defaultSize: { widthMm: DEFAULT_W_MM, heightMm: DEFAULT_H_MM },
    lineId,
  });
};

/** GET /document/receive-stamp/image?roomId= — the raw artwork. */
export const receiveStampImage = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const q = req.query as { roomId?: string };
  const { roomId } = await resolveStampRoom(req, q.roomId);
  const row = await prisma.receiveStamp.findUnique({
    where: { roomId },
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

  let buf: Buffer | null = null;
  let mime = "image/png";
  /**
   * The size can ride along with the upload, so "say the size, then pick
   * the file" is one action rather than two saves the user can get wrong
   * the order of. Falls back to whatever is already stored.
   */
  const fields: Record<string, string> = {};
  for await (const part of req.parts()) {
    if (part.type === "field") {
      fields[part.fieldname] = String((part as { value?: unknown }).value ?? "");
      continue;
    }
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

  /*
    The room comes in as a field with everything else. Membership is checked
    before a single byte is stored: this is the office's stamp, and uploading
    to an office you do not belong to would put your artwork on their paper.
  */
  const { actorId, roomId, lineId } = await resolveStampRoom(req, fields.roomId);

  const existing = await prisma.receiveStamp.findUnique({
    where: { roomId },
    select: { widthMm: true, heightMm: true },
  });
  const widthMm = clampMm(fields.widthMm, existing?.widthMm ?? DEFAULT_W_MM);
  const heightMm = clampMm(fields.heightMm, existing?.heightMm ?? DEFAULT_H_MM);

  /**
   * Shape, not size. The artwork is 58mm x 30mm — a ratio of about 1.93 —
   * and anything markedly different is a different stamp, or a screenshot
   * with the desktop around it. A tolerance because a scan is never exact.
   */
  const ratio = imageW / imageH;
  const want = widthMm / heightMm;
  if (ratio < want * 0.8 || ratio > want * 1.2) {
    throw new ValidationError(
      `You said this stamp is ${widthMm}mm x ${heightMm}mm, which is about ` +
        `${want.toFixed(2)}:1. This image is ${imageW}x${imageH}, which is ` +
        `${ratio.toFixed(2)}:1 — either crop it to the stamp itself, or correct the size above.`,
    );
  }

  const saved = await prisma.receiveStamp.upsert({
    where: { roomId },
    update: {
      image: buf, mime, imageW, imageH, widthMm, heightMm, lineId,
      updatedById: actorId,
    },
    create: {
      roomId, userId: actorId, updatedById: actorId, lineId,
      image: buf, mime, imageW, imageH, widthMm, heightMm,
    },
    select: SHAPE,
  });

  return res.code(200).send({ message: "OK", stamp: { ...saved, hasImage: true } });
};

/**
 * PATCH /document/receive-stamp — where things sit, and what my name says.
 *
 * The placements and the size go to the office's stamp, shared by everybody.
 * The nickname goes to my row and nobody else's: the whole point of the
 * split is that a colleague stamping the next document gets the same box
 * with their own name in it.
 */
export const saveReceiveStamp = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const b = req.body as Record<string, unknown>;
  const { actorId, roomId, lineId } = await resolveStampRoom(
    req,
    typeof b.roomId === "string" ? b.roomId : undefined,
  );

  const current = await prisma.receiveStamp.findUnique({
    where: { roomId },
    select: SHAPE,
  });

  const myRow = current
    ? await prisma.receiveStampName.findUnique({
        where: { stampId_userId: { stampId: current.id, userId: actorId } },
        select: { nickname: true },
      })
    : null;
  const nickname = String(b.nickname ?? myRow?.nickname ?? "").trim().slice(0, 40);

  const data = {
    lineId,
    updatedById: actorId,
    widthMm: clampMm(b.widthMm, current?.widthMm ?? DEFAULT_W_MM),
    heightMm: clampMm(b.heightMm, current?.heightMm ?? DEFAULT_H_MM),
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
    where: { roomId },
    update: data,
    create: { roomId, userId: actorId, ...data },
    select: SHAPE,
  });

  await prisma.receiveStampName.upsert({
    where: { stampId_userId: { stampId: saved.id, userId: actorId } },
    update: { nickname },
    create: { stampId: saved.id, userId: actorId, nickname },
  });

  return res.code(200).send({ message: "OK", stamp: saved, myName: nickname });
};

/**
 * DELETE /document/receive-stamp?roomId= — start again.
 *
 * This throws away the whole office's stamp, not just the caller's part of
 * it, so only the room's owner may do it. Everyone else who wants their own
 * name changed can change their own name.
 */
export const deleteReceiveStamp = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const q = req.query as { roomId?: string };
  const { roomId, type } = await resolveStampRoom(req, q.roomId);
  if (type !== ROOM_MEMBER_TYPES.owner) {
    throw new UnauthorizedError(
      "Only the office that owns this Document Room can remove its receiving stamp. You can still change the name that prints on yours.",
    );
  }
  const row = await prisma.receiveStamp.findUnique({
    where: { roomId },
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
 *
 * Two halves come together here: the office's artwork and layout, and the
 * person's name and signature.
 */
export const renderReceiveStamp = async (
  roomId: string,
  userId: string,
  when: Date = new Date(),
  widthPx = 900,
): Promise<Buffer> => {
  const row = await prisma.receiveStamp.findUnique({
    where: { roomId },
    select: { ...SHAPE, image: true },
  });
  if (!row?.image) throw new NotFoundError("No stamp artwork uploaded yet");

  const sig = await prisma.signature.findFirst({
    where: { userId, active: true },
    select: { signature: true },
  });

  const mine = await prisma.receiveStampName.findUnique({
    where: { stampId_userId: { stampId: row.id, userId } },
    select: { nickname: true },
  });
  // Falls back to the stamp's own name only while a setup carried over from
  // the per-person version has not been claimed yet.
  const printedName = (mine?.nickname || row.nickname || "").trim();

  const wPt = mmToPt(row.widthMm);
  const hPt = mmToPt(row.heightMm);

  const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([wPt, hPt]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);

  // The artwork fills the page — it IS the page.
  const art = await pdf.embedPng(Buffer.from(row.image));
  page.drawImage(art, { x: 0, y: 0, width: wPt, height: hPt });

  /**
   * Basis points are measured from the TOP; PDF measures from the bottom.
   * Every placement goes through here so the flip happens exactly once.
   */
  const toPt = (xBp: number, yBp: number) => ({
    x: (xBp / BP) * wPt,
    yTop: (yBp / BP) * hPt,
  });

  if (sig?.signature?.length) {
    const { x, yTop } = toPt(row.sigX, row.sigY);
    const w = (row.sigW / BP) * wPt;
    const h = (row.sigH / BP) * hPt;
    try {
      const img = await pdf.embedPng(Buffer.from(sig.signature));
      // Fit inside the box, keeping the writing's own proportions — a
      // stretched signature is not the person's signature.
      const scale = Math.min(w / img.width, h / img.height);
      const dw = img.width * scale;
      const dh = img.height * scale;
      page.drawImage(img, {
        x: x + (w - dw) / 2,
        y: hPt - yTop - h + (h - dh) / 2,
        width: dw,
        height: dh,
      });
    } catch {
      // A signature stored as something other than PNG. The stamp is still
      // worth producing; the rest of it is correct.
    }
  }

  const ink = rgb(0, 0, 0);

  /**
   * Shrink text until it fits the width left on the stamp.
   *
   * "28 September 2026 8:00 am" is two and a half times as long as the
   * "09/28/2026" this used to print, and a stamp is only 58mm wide. Running
   * off the edge would put half the date on the page beside the stamp, so
   * the size gives way instead — down to 4pt, below which nothing prints
   * legibly anyway.
   */
  const fitted = (text: string, at: number, size: number) => {
    let s = size;
    const room = wPt - at - 2;
    while (s > 4 && font.widthOfTextAtSize(text, s) > room) s -= 0.25;
    return s;
  };

  const dateText = stampDateText(when);
  const d = toPt(row.dateX, row.dateY);
  const dateSize = fitted(dateText, d.x, row.dateSizePt);
  page.drawText(dateText, {
    x: d.x,
    y: hPt - d.yTop - dateSize,
    size: dateSize,
    font,
    color: ink,
  });

  if (printedName) {
    const n = toPt(row.nameX, row.nameY);
    const nameSize = fitted(printedName, n.x, row.nameSizePt);
    page.drawText(printedName, {
      x: n.x,
      y: hPt - n.yTop - nameSize,
      size: nameSize,
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
  const q = req.query as { width?: string; roomId?: string };
  const { actorId, roomId } = await resolveStampRoom(req, q.roomId);
  const width = q.width ? parseInt(q.width, 10) : 900;

  try {
    const png = await renderReceiveStamp(roomId, actorId, new Date(), width);
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

// ── Stamping a received document ──────────────────────────────────────

/**
 * Put the stamp on a page, at a point the receiver chose.
 *
 * POST /document/receive-stamp/apply { documentId, page, xBp, yBp }
 *
 * The file is NEVER rewritten. A received PDF may carry signatures sealed
 * over a hash of its bytes, so changing those bytes would invalidate the
 * very thing the document is evidence of. What is stored is the position;
 * the office's own copy is composed at download time and the original stays
 * exactly as it arrived.
 */
export const applyReceiveStamp = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const b = req.body as {
    documentId?: string;
    roomId?: string;
    page?: number | string;
    xBp?: number | string;
    yBp?: number | string;
  };
  if (!b.documentId) throw new ValidationError("INVALID REQUIRED ID");
  const { actorId, roomId, lineId } = await resolveStampRoom(req, b.roomId);

  // You may only stamp what you are allowed to see.
  const { requireCanSeeDocument } = await import("./disseminationController");
  await requireCanSeeDocument(req, b.documentId);

  const stamp = await prisma.receiveStamp.findUnique({
    where: { roomId },
    select: { image: true },
  });
  if (!stamp?.image) {
    throw new ValidationError(
      "Your office has not set up its receiving stamp yet — Document module, Manage Receive Stamp. Anyone in the office can upload it, and it then works for everybody.",
    );
  }

  const file = await prisma.decodedFile.findFirst({
    where: { documentId: b.documentId },
    select: { fileDecoded: true },
  });
  if (!file?.fileDecoded) throw new NotFoundError("Document file not found");

  const { pdfPageSizes } = await import("../service/pdfRaster");
  const sizes = await pdfPageSizes(Buffer.from(file.fileDecoded));
  const page = Math.max(1, Math.round(Number(b.page ?? 1) || 1));
  if (page > sizes.length) {
    throw new ValidationError(
      `That document has ${sizes.length} page${sizes.length === 1 ? "" : "s"}.`,
    );
  }

  const mark = await prisma.receiveStampMark.upsert({
    where: { documentId_userId: { documentId: b.documentId, userId: actorId } },
    update: { page, xBp: clampBp(b.xBp, 0), yBp: clampBp(b.yBp, 0), roomId, lineId },
    create: {
      documentId: b.documentId,
      userId: actorId,
      roomId,
      lineId,
      page,
      xBp: clampBp(b.xBp, 0),
      yBp: clampBp(b.yBp, 0),
    },
    select: { id: true, page: true, xBp: true, yBp: true, stampedAt: true, roomId: true },
  });

  return res.code(200).send({ message: "OK", mark, pages: sizes.length });
};

/** GET /document/receive-stamp/marks?documentId= — what is on this document. */
export const receiveStampMarks = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const q = req.query as { documentId?: string };
  if (!q.documentId) throw new ValidationError("INVALID REQUIRED ID");
  const { actorId } = await callerContext(req);
  const { requireCanSeeDocument } = await import("./disseminationController");
  await requireCanSeeDocument(req, q.documentId);

  const marks = await prisma.receiveStampMark.findMany({
    where: { documentId: q.documentId },
    orderBy: { stampedAt: "asc" },
    select: {
      id: true, page: true, xBp: true, yBp: true, stampedAt: true, userId: true,
      roomId: true,
      user: { select: { firstName: true, lastName: true } },
      room: { select: { code: true } },
    },
  });
  return res
    .code(200)
    .send({ marks, mine: marks.find((m) => m.userId === actorId) ?? null });
};

/** DELETE /document/receive-stamp/mark?documentId= — take my stamp off again. */
export const removeReceiveStampMark = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const q = req.query as { documentId?: string };
  if (!q.documentId) throw new ValidationError("INVALID REQUIRED ID");
  const { actorId } = await callerContext(req);
  // Your own stamp only — a stamp is somebody's signature that they took
  // delivery, and removing another office's is not yours to do.
  const existing = await prisma.receiveStampMark.findUnique({
    where: { documentId_userId: { documentId: q.documentId, userId: actorId } },
    select: { id: true },
  });
  if (!existing) throw new NotFoundError("You have not stamped this document");
  await prisma.receiveStampMark.delete({ where: { id: existing.id } });
  return res.code(200).send({ message: "OK" });
};

/**
 * GET /document/receive-stamp/stamped?documentId= — the office's copy.
 *
 * The document as it arrived, with every receiving stamp composed onto it
 * at its true physical size. Generated on demand and never stored, so the
 * original bytes — and any seal over them — remain untouched.
 */
export const stampedDocument = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const q = req.query as { documentId?: string };
  if (!q.documentId) throw new ValidationError("INVALID REQUIRED ID");
  const { requireCanSeeDocument } = await import("./disseminationController");
  await requireCanSeeDocument(req, q.documentId);

  const doc = await prisma.document.findUnique({
    where: { id: q.documentId },
    select: { title: true, file: { select: { fileDecoded: true, fileName: true } } },
  });
  if (!doc?.file?.fileDecoded) throw new NotFoundError("Document file not found");

  const marks = await prisma.receiveStampMark.findMany({
    where: { documentId: q.documentId },
    orderBy: { stampedAt: "asc" },
    select: {
      userId: true, roomId: true, page: true, xBp: true, yBp: true,
      stampedAt: true,
    },
  });

  const { PDFDocument } = await import("pdf-lib");
  const pdf = await PDFDocument.load(Buffer.from(doc.file.fileDecoded));
  const pages = pdf.getPages();

  for (const m of marks) {
    /*
      A mark made before offices shared a stamp has no room on it. Fall back
      to the room whose stamp that person set up, so old marks still print.
    */
    const roomId =
      m.roomId ??
      (
        await prisma.receiveStamp.findFirst({
          where: { userId: m.userId, roomId: { not: null } },
          select: { roomId: true },
        })
      )?.roomId;
    if (!roomId) continue;

    const cfg = await prisma.receiveStamp.findUnique({
      where: { roomId },
      select: { widthMm: true, heightMm: true },
    });
    if (!cfg) continue;
    const target = pages[m.page - 1];
    if (!target) continue;

    let png: Buffer;
    try {
      // Composed with the date it was STAMPED, not today — the stamp
      // records when the office took delivery, and reprinting it later
      // must not quietly move that date.
      png = await renderReceiveStamp(roomId, m.userId, m.stampedAt, 1200);
    } catch {
      continue;
    }

    const img = await pdf.embedPng(png);
    const wPt = mmToPt(cfg.widthMm);
    const hPt = mmToPt(cfg.heightMm);
    const { width: pw, height: ph } = target.getSize();
    const x = (m.xBp / BP) * pw;
    const yTop = (m.yBp / BP) * ph;
    target.drawImage(img, {
      x,
      // Basis points measure from the top; PDF from the bottom.
      y: ph - yTop - hPt,
      width: wPt,
      height: hPt,
    });
  }

  const out = Buffer.from(await pdf.save());
  const base = (doc.file.fileName || doc.title || "document").replace(/\.pdf$/i, "");
  return res
    .header("Content-Type", "application/pdf")
    .header("Content-Disposition", `attachment; filename="${base}-received.pdf"`)
    .header("Cache-Control", "no-store")
    .code(200)
    .send(out);
};
