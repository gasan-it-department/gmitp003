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
