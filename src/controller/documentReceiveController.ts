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
  return res.code(200).send({ list: rows.map(shape), now: Date.now() });
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
  return res
    .code(200)
    .send({ record: row && !row.deletedAt ? shape(row) : null });
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
  return res.code(200).send({
    list: rows.map(shape),
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
