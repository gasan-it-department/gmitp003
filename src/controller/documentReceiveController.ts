import { FastifyReply, FastifyRequest } from "../barrel/fastify";
import { prisma } from "../barrel/prisma";
import { ValidationError } from "../errors/errors";

/**
 * Document Receiving — barcode-stickered physical documents logged by the
 * office/unit receiving personnel.
 *
 *   sync  : incremental download for the mobile offline mirror (since=ms)
 *   find  : online lookup of one barcode (mobile fallback when not local)
 *   create: idempotent register (client id + [lineId,barcode] unique — a
 *           replay or a race with another device returns the existing row)
 *   list  : paged/searchable registry for the web tool
 */

const shape = (r: any) => ({
  id: r.id,
  lineId: r.lineId,
  barcode: r.barcode,
  title: r.title,
  senderUnitId: r.senderUnitId ?? null,
  senderUnitName: r.senderUnitName ?? null,
  senderName: r.senderName ?? null,
  receivedById: r.receivedById ?? null,
  receivedByName: r.receivedByName ?? null,
  createdAt: r.createdAt,
  updatedAt: r.updatedAt,
  deletedAt: r.deletedAt ?? null,
});

// GET /document/receive/sync?lineId=&since=<ms>
export const documentReceiveSync = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const q = req.query as { lineId?: string; since?: string };
  if (!q.lineId) throw new ValidationError("BAD_REQUEST: lineId required");
  const sinceMs = q.since ? parseInt(q.since, 10) : 0;
  const sinceDate = sinceMs > 0 ? new Date(sinceMs) : undefined;

  const rows = await prisma.documentReceiveRecord.findMany({
    where: {
      lineId: q.lineId,
      ...(sinceDate ? { updatedAt: { gt: sinceDate } } : {}),
    },
    orderBy: { updatedAt: "asc" },
    take: 2000,
  });
  const pageMap = await pagesFor(rows.map((r) => r.id));
  return res.code(200).send({
    list: rows.map((r) => ({ ...shape(r), pages: pageMap[r.id] ?? [] })),
    now: Date.now(),
  });
};

// GET /document/receive/find?lineId=&barcode=
export const documentReceiveFind = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const q = req.query as { lineId?: string; barcode?: string };
  if (!q.lineId || !q.barcode) throw new ValidationError("BAD_REQUEST");
  const row = await prisma.documentReceiveRecord.findUnique({
    where: { lineId_barcode: { lineId: q.lineId, barcode: q.barcode.trim() } },
  });
  if (!row || row.deletedAt) return res.code(200).send({ record: null });
  const pageMap = await pagesFor([row.id]);
  return res
    .code(200)
    .send({ record: { ...shape(row), pages: pageMap[row.id] ?? [] } });
};

// POST /document/receive
// { id?, lineId, barcode, title, senderUnitId?, senderUnitName?, senderName?, userId? }
export const documentReceiveCreate = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const b = req.body as {
    id?: string;
    lineId?: string;
    barcode?: string;
    title?: string;
    senderUnitId?: string | null;
    senderUnitName?: string | null;
    senderName?: string | null;
    userId?: string | null;
  };
  const lineId = (b.lineId ?? "").trim();
  const barcode = (b.barcode ?? "").trim();
  const title = (b.title ?? "").trim();
  if (!lineId || !barcode || !title)
    throw new ValidationError("BAD_REQUEST: lineId, barcode and title required");

  // Replay of the same offline op → return what it created.
  if (b.id) {
    const byId = await prisma.documentReceiveRecord.findUnique({
      where: { id: b.id },
    });
    if (byId) return res.code(200).send({ record: shape(byId), existing: true });
  }
  // Barcode already registered on this line (e.g. another device won) → return it.
  const byCode = await prisma.documentReceiveRecord.findUnique({
    where: { lineId_barcode: { lineId, barcode } },
  });
  if (byCode)
    return res.code(200).send({ record: shape(byCode), existing: true });

  // Denormalise names so mobile/offline lists render without joins.
  let senderUnitName = (b.senderUnitName ?? "").trim() || null;
  const senderUnitId = (b.senderUnitId ?? "").trim() || null;
  if (senderUnitId && !senderUnitName) {
    const dep = await prisma.department.findUnique({
      where: { id: senderUnitId },
      select: { name: true },
    });
    senderUnitName = dep?.name ?? null;
  }
  let receivedByName: string | null = null;
  const receivedById = (b.userId ?? "").trim() || null;
  if (receivedById) {
    const u = await prisma.user.findUnique({
      where: { id: receivedById },
      select: { firstName: true, lastName: true },
    });
    if (u)
      receivedByName =
        [u.firstName, u.lastName].filter(Boolean).join(" ").trim() || null;
  }

  const created = await prisma.documentReceiveRecord.create({
    data: {
      ...(b.id ? { id: b.id } : {}),
      lineId,
      barcode,
      title,
      senderUnitId,
      senderUnitName,
      senderName: (b.senderName ?? "").trim() || null,
      receivedById,
      receivedByName,
      clientOpId: b.id ?? null,
    },
  });
  return res.code(200).send({ record: shape(created), existing: false });
};

// GET /document/receive/list?lineId=&cursor=&limit=&query=  (web registry)
export const documentReceiveList = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const q = req.query as {
    lineId?: string;
    cursor?: string;
    limit?: string;
    query?: string;
  };
  if (!q.lineId) throw new ValidationError("BAD_REQUEST: lineId required");
  const take = Math.min(parseInt(q.limit ?? "20", 10) || 20, 100);

  const where: any = { lineId: q.lineId, deletedAt: null };
  if (q.query && q.query.trim()) {
    const s = q.query.trim();
    where.OR = [
      { barcode: { contains: s, mode: "insensitive" } },
      { title: { contains: s, mode: "insensitive" } },
      { senderUnitName: { contains: s, mode: "insensitive" } },
      { senderName: { contains: s, mode: "insensitive" } },
      { receivedByName: { contains: s, mode: "insensitive" } },
    ];
  }

  const rows = await prisma.documentReceiveRecord.findMany({
    where,
    take,
    skip: q.cursor ? 1 : 0,
    ...(q.cursor ? { cursor: { id: q.cursor } } : {}),
    orderBy: { createdAt: "desc" },
  });
  const pageMap = await pagesFor(rows.map((r) => r.id));
  return res.code(200).send({
    list: rows.map((r) => ({ ...shape(r), pages: pageMap[r.id] ?? [] })),
    hasMore: rows.length === take,
    lastCursor: rows.length > 0 ? rows[rows.length - 1].id : null,
  });
};

// ═══════════════ Mobile Access (who may use the mobile doc scanner) ═══════

const fullName = (u: {
  firstName: string;
  lastName: string;
  middleName?: string | null;
}) => `${u.lastName}, ${u.firstName}${u.middleName ? " " + u.middleName : ""}`;

// GET /document/mobile-access?lineId — users granted mobile document access
export const listDocMobileAccess = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const { lineId } = req.query as { lineId?: string };
  if (!lineId) throw new ValidationError("lineId is required");
  const rows = await prisma.documentMobileAccess.findMany({
    where: { lineId },
    orderBy: { timestamp: "desc" },
    include: {
      user: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          middleName: true,
          username: true,
          department: { select: { name: true } },
        },
      },
      grantedBy: { select: { firstName: true, lastName: true } },
    },
  });
  const list = rows.map((r) => ({
    id: r.id,
    userId: r.userId,
    name: fullName(r.user),
    username: r.user.username,
    department: r.user.department?.name ?? null,
    grantedAt: r.timestamp,
    grantedBy: r.grantedBy
      ? `${r.grantedBy.lastName}, ${r.grantedBy.firstName}`
      : null,
  }));
  return res.code(200).send({ list });
};

// GET /document/mobile-access/candidates?lineId&query — line users not yet granted
export const docMobileAccessCandidates = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const { lineId, query } = req.query as { lineId?: string; query?: string };
  if (!lineId) throw new ValidationError("lineId is required");
  const granted = await prisma.documentMobileAccess.findMany({
    where: { lineId },
    select: { userId: true },
  });
  const grantedIds = granted.map((g) => g.userId);
  const term = (query ?? "").trim();
  const users = await prisma.user.findMany({
    where: {
      lineId,
      active: 1,
      ...(grantedIds.length ? { id: { notIn: grantedIds } } : {}),
      ...(term
        ? {
            OR: [
              { firstName: { contains: term, mode: "insensitive" } },
              { lastName: { contains: term, mode: "insensitive" } },
              { username: { contains: term, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    take: 20,
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    select: {
      id: true,
      firstName: true,
      lastName: true,
      middleName: true,
      username: true,
      department: { select: { name: true } },
    },
  });
  return res.code(200).send({
    list: users.map((u) => ({
      id: u.id,
      name: fullName(u),
      username: u.username,
      department: u.department?.name ?? null,
    })),
  });
};

// POST /document/mobile-access { lineId, userId, grantedById } — grant (idempotent)
export const grantDocMobileAccess = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const body = req.body as {
    lineId?: string;
    userId?: string;
    grantedById?: string;
  };
  if (!body.lineId || !body.userId)
    throw new ValidationError("lineId and userId are required");
  const user = await prisma.user.findFirst({
    where: { id: body.userId, lineId: body.lineId },
    select: { id: true },
  });
  if (!user) throw new ValidationError("USER_NOT_IN_LINE");
  await prisma.documentMobileAccess.upsert({
    where: { lineId_userId: { lineId: body.lineId, userId: body.userId } },
    create: {
      lineId: body.lineId,
      userId: body.userId,
      grantedById: body.grantedById ?? null,
    },
    update: {},
  });
  return res.code(200).send({ message: "OK" });
};

// DELETE /document/mobile-access { lineId, userId } — revoke
export const revokeDocMobileAccess = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const body = req.body as { lineId?: string; userId?: string };
  if (!body.lineId || !body.userId)
    throw new ValidationError("lineId and userId are required");
  await prisma.documentMobileAccess.deleteMany({
    where: { lineId: body.lineId, userId: body.userId },
  });
  return res.code(200).send({ message: "OK" });
};

// GET /document/mobile-access/me — the mobile app's self-check (uses the token)
export const myDocMobileAccess = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const accountId = (req.user as { id?: string } | undefined)?.id;
  if (!accountId) return res.code(200).send({ granted: false });
  const account = await prisma.account.findUnique({
    where: { id: accountId },
    select: { lineId: true, User: { select: { id: true, lineId: true } } },
  });
  const lineId = account?.lineId ?? account?.User?.lineId ?? null;
  const userId = account?.User?.id ?? null;
  if (!lineId || !userId)
    return res.code(200).send({ granted: false, reason: "no-user-or-line" });
  const access = await prisma.documentMobileAccess.findUnique({
    where: { lineId_userId: { lineId, userId } },
    select: { id: true },
  });
  return res.code(200).send({ granted: !!access });
};

// ═══════════════ Scanned pages (mobile document scanner) ══════════════════

const pageUrl = (req: FastifyRequest, id: string) => {
  const proto =
    (req.headers["x-forwarded-proto"] as string) || req.protocol || "http";
  const host = (req.headers["x-forwarded-host"] as string) || req.headers.host;
  return `${proto}://${host}/document/receive/page/${id}`;
};

/** pages per record (id + page number), for list/find/sync responses. */
const pagesFor = async (recordIds: string[]) => {
  if (recordIds.length === 0)
    return {} as Record<string, { id: string; page: number }[]>;
  const rows = await prisma.documentReceivePage.findMany({
    where: { recordId: { in: recordIds } },
    select: { id: true, recordId: true, page: true },
    orderBy: { page: "asc" },
  });
  const map: Record<string, { id: string; page: number }[]> = {};
  for (const r of rows) {
    if (!map[r.recordId]) map[r.recordId] = [];
    map[r.recordId].push({ id: r.id, page: r.page });
  }
  return map;
};

// POST /document/receive/page — multipart: fields id, recordId, page + file.
// Idempotent by client-supplied id (offline queue replays are no-ops).
export const documentReceivePageUpload = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  if (!req.isMultipart()) throw new ValidationError("NOT_MULTIPART");

  let file: { mimetype: string; buffer: Buffer } | null = null;
  const fields: Record<string, string> = {};
  for await (const part of req.parts()) {
    if (part.type === "file") {
      const chunks: Buffer[] = [];
      for await (const chunk of part.file) chunks.push(chunk as Buffer);
      file = { mimetype: part.mimetype, buffer: Buffer.concat(chunks) };
    } else if (part.type === "field") {
      fields[part.fieldname] = String(part.value ?? "");
    }
  }

  const id = (fields.id ?? "").trim();
  const recordId = (fields.recordId ?? "").trim();
  const page = Math.max(1, parseInt(fields.page ?? "1", 10) || 1);
  if (!recordId) throw new ValidationError("BAD_REQUEST: recordId required");

  // Replay of the same offline op → succeed without duplicating.
  if (id) {
    const existing = await prisma.documentReceivePage.findUnique({
      where: { id },
      select: { id: true, page: true },
    });
    if (existing)
      return res.code(200).send({
        pageId: existing.id,
        page: existing.page,
        url: pageUrl(req, existing.id),
        existing: true,
      });
  }

  const record = await prisma.documentReceiveRecord.findUnique({
    where: { id: recordId },
    select: { id: true },
  });
  if (!record) throw new ValidationError("RECORD_NOT_FOUND");

  if (!file) throw new ValidationError("MISSING_FILE");
  if (!file.mimetype.startsWith("image/"))
    throw new ValidationError("FILE_MUST_BE_AN_IMAGE");
  if (file.buffer.length > 10 * 1024 * 1024)
    throw new ValidationError("IMAGE_TOO_LARGE");

  const saved = await prisma.documentReceivePage.create({
    data: {
      ...(id ? { id } : {}),
      recordId,
      page,
      mime: file.mimetype,
      bytes: file.buffer,
    },
    select: { id: true, page: true },
  });
  return res.code(200).send({
    pageId: saved.id,
    page: saved.page,
    url: pageUrl(req, saved.id),
    existing: false,
  });
};

// GET /document/receive/page/:id — serve the image (uuid-obscured, like chat).
export const documentReceivePageServe = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const { id } = req.params as { id?: string };
  if (!id) throw new ValidationError("BAD_REQUEST");
  const img = await prisma.documentReceivePage.findUnique({
    where: { id },
    select: { bytes: true, mime: true },
  });
  if (!img) return res.code(404).send({ message: "Not found" });
  res.header("Content-Type", img.mime);
  res.header("Cache-Control", "private, max-age=31536000, immutable");
  return res.send(Buffer.from(img.bytes));
};
