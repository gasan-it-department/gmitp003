import { FastifyRequest, FastifyReply } from "../barrel/fastify";
import { prisma } from "../barrel/prisma";

// A single endpoint that serves every audit-log model in a normalised shape so
// the admin panel can render them all with one table:
//   { id, timestamp, action, description, actor, line }
//
// type ∈ hr | medicine | document | activity | inventory | inventoryAccess |
//        admin | message | record | mobileUpload

type LogRow = {
  id: string;
  timestamp: Date | null;
  action: string;
  description: string;
  actor: string;
  line: string | null;
};

const userSel = {
  select: { firstName: true, lastName: true, username: true },
} as const;
const lineSel = { select: { name: true } } as const;

const fullName = (
  u?: {
    firstName?: string | null;
    lastName?: string | null;
    username?: string | null;
  } | null,
): string => {
  if (!u) return "—";
  const n = [u.firstName, u.lastName].filter(Boolean).join(" ").trim();
  return n || u.username || "—";
};

// action int → label maps (documented in the schema where available).
const MED = ["Removed", "Added", "Updated", "Dispensed"];
const DOC = [
  "Removed",
  "Added",
  "Updated",
  "Archived",
  "Requested",
  "Approved",
  "Rejected",
];
const INV = ["Removed", "Added", "Transferred", "Adjusted", "Dispensed"];
const GEN = ["Removed", "Added", "Updated"];
const MSG = ["Pending", "Sent", "Failed"];

const lbl = (map: string[], a: number) => map[a] ?? `Action ${a}`;

// The catalogue the admin panel shows as sub-tabs.
export const LOG_TYPES = [
  { key: "hr", label: "Human Resources" },
  { key: "medicine", label: "Medicine" },
  { key: "document", label: "Documents" },
  { key: "activity", label: "Activity" },
  { key: "inventory", label: "Inventory" },
  { key: "inventoryAccess", label: "Inventory Access" },
  { key: "admin", label: "Admin" },
  { key: "message", label: "Messages (SMS)" },
  { key: "record", label: "User Records" },
  { key: "mobileUpload", label: "Mobile Uploads" },
];

export const adminLogTypes = async (
  _req: FastifyRequest,
  res: FastifyReply,
) => res.code(200).send({ types: LOG_TYPES });

export const adminLogs = async (req: FastifyRequest, res: FastifyReply) => {
  const q = req.query as {
    type?: string;
    lastCursor?: string;
    limit?: string;
    query?: string;
  };
  const type = q.type || "hr";
  const limit = q.limit ? parseInt(q.limit, 10) : 25;
  const cursor = q.lastCursor ? { id: q.lastCursor } : undefined;
  const skip = cursor ? 1 : 0;
  const search = (q.query ?? "").trim();
  const like = { contains: search, mode: "insensitive" as const };

  try {
    const send = (list: LogRow[], rawLen: number) =>
      res.code(200).send({
        list,
        lastCursor: list.length ? list[list.length - 1].id : null,
        hasMore: rawLen === limit,
      });

    switch (type) {
      case "hr": {
        const rows = await prisma.humanResourcesLogs.findMany({
          cursor,
          take: limit,
          skip,
          orderBy: { timestamp: "desc" },
          where: search
            ? { OR: [{ action: like }, { desc: like }] }
            : undefined,
          include: { user: userSel, line: lineSel },
        });
        return send(
          rows.map((r) => ({
            id: r.id,
            timestamp: r.timestamp,
            action: r.action,
            description: r.desc,
            actor: fullName(r.user),
            line: r.line?.name ?? null,
          })),
          rows.length,
        );
      }

      case "medicine": {
        const rows = await prisma.medicineLogs.findMany({
          cursor,
          take: limit,
          skip,
          orderBy: { timestamp: "desc" },
          where: search ? { message: like } : undefined,
          include: { user: userSel, line: lineSel },
        });
        return send(
          rows.map((r) => ({
            id: r.id,
            timestamp: r.timestamp,
            action: lbl(MED, r.action),
            description: r.message,
            actor: fullName(r.user),
            line: r.line?.name ?? null,
          })),
          rows.length,
        );
      }

      case "document": {
        const rows = await prisma.documentActivityLogs.findMany({
          cursor,
          take: limit,
          skip,
          orderBy: { timestamp: "desc" },
          where: search
            ? { OR: [{ title: like }, { desc: like }] }
            : undefined,
          include: { user: userSel, line: lineSel },
        });
        return send(
          rows.map((r) => ({
            id: r.id,
            timestamp: r.timestamp,
            action: lbl(DOC, r.action),
            description: [r.title, r.desc].filter(Boolean).join(" — "),
            actor: fullName(r.user),
            line: r.line?.name ?? null,
          })),
          rows.length,
        );
      }

      case "activity": {
        const rows = await prisma.activityLogs.findMany({
          cursor,
          take: limit,
          skip,
          orderBy: { timestamp: "desc" },
          where: search ? { desc: like } : undefined,
          include: { user: userSel, line: lineSel },
        });
        return send(
          rows.map((r) => ({
            id: r.id,
            timestamp: r.timestamp,
            action: lbl(GEN, r.action),
            description: r.desc ?? "—",
            actor: fullName(r.user),
            line: r.line?.name ?? null,
          })),
          rows.length,
        );
      }

      case "inventory": {
        const rows = await prisma.inventoryLogs.findMany({
          cursor,
          take: limit,
          skip,
          orderBy: { timestamp: "desc" },
          where: search ? { desc: like } : undefined,
          include: { user: userSel, line: lineSel },
        });
        return send(
          rows.map((r) => ({
            id: r.id,
            timestamp: r.timestamp,
            action: lbl(INV, r.action),
            description: r.desc ?? "—",
            actor: fullName(r.user),
            line: r.line?.name ?? null,
          })),
          rows.length,
        );
      }

      case "inventoryAccess": {
        const rows = await prisma.inventoryAccessLogs.findMany({
          cursor,
          take: limit,
          skip,
          orderBy: { timestamp: "desc" },
          where: search
            ? { OR: [{ action: like }, { path: like }] }
            : undefined,
          include: { user: userSel },
        });
        return send(
          rows.map((r) => ({
            id: r.id,
            timestamp: r.timestamp,
            action: r.action,
            description: r.path ?? "—",
            actor: fullName(r.user),
            line: null,
          })),
          rows.length,
        );
      }

      case "admin": {
        const rows = await prisma.adminLogs.findMany({
          cursor,
          take: limit,
          skip,
          orderBy: { timestamp: "desc" },
          where: search ? { desc: like } : undefined,
          include: { admin: { select: { username: true } } },
        });
        return send(
          rows.map((r) => ({
            id: r.id,
            timestamp: r.timestamp,
            action: `Action ${r.action}`,
            description: r.desc ?? "—",
            actor: r.admin?.username ?? "—",
            line: null,
          })),
          rows.length,
        );
      }

      case "message": {
        const rows = await prisma.messageLogs.findMany({
          cursor,
          take: limit,
          skip,
          orderBy: { timestamp: "desc" },
          where: search
            ? { OR: [{ number: like }, { content: like }] }
            : undefined,
        });
        return send(
          rows.map((r) => ({
            id: r.id,
            timestamp: r.timestamp ?? null,
            action: lbl(MSG, r.status),
            description: r.content ?? "—",
            actor: r.number,
            line: null,
          })),
          rows.length,
        );
      }

      case "record": {
        const rows = await prisma.logRecord.findMany({
          cursor,
          take: limit,
          skip,
          orderBy: { timestamp: "desc" },
          where: search ? { action: like } : undefined,
          include: { user: userSel },
        });
        return send(
          rows.map((r) => ({
            id: r.id,
            timestamp: r.timestamp,
            action: r.action,
            description: "—",
            actor: fullName(r.user),
            line: null,
          })),
          rows.length,
        );
      }

      case "mobileUpload": {
        const rows = await prisma.mobileUploadLog.findMany({
          cursor,
          take: limit,
          skip,
          orderBy: { createdAt: "desc" },
          where: search
            ? { OR: [{ kind: like }, { message: like }] }
            : undefined,
        });
        return send(
          rows.map((r) => ({
            id: r.id,
            timestamp: r.createdAt,
            action: r.kind,
            description: r.message ?? "—",
            actor: r.userId ?? "—",
            line: null,
          })),
          rows.length,
        );
      }

      default:
        return res.code(400).send({ message: "Unknown log type" });
    }
  } catch (error) {
    console.error("[adminLogs]", error);
    return res.code(500).send({ message: "Internal Server Error" });
  }
};
