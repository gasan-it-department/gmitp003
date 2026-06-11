// Employee complaints — self-service ticketing.
//
// Any line user can file a complaint (no HR enrolment needed). HR can
// see/triage/respond via the same endpoints; visibility is governed by
// the `userId` filter — if the caller passes their own userId they only
// see theirs, if they pass just `lineId` they see all in the line.

import { FastifyReply, FastifyRequest } from "../barrel/fastify";
import { prisma, Prisma } from "../barrel/prisma";
import { AppError, NotFoundError, ValidationError } from "../errors/errors";

const CATEGORIES = new Set([
  "general",
  "hr",
  "facilities",
  "it",
  "payroll",
  "safety",
]);
const STATUSES = new Set(["open", "in_progress", "resolved", "closed"]);
const PRIORITIES = new Set(["low", "normal", "high"]);

// ─── Create (multipart: text fields + zero-to-many evidence files) ────
const EVIDENCE_MIMES = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "image/gif",
  "application/pdf",
]);
const EVIDENCE_MAX_BYTES = 10 * 1024 * 1024; // 10 MB per file

export const createComplaint = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  // Accept either JSON (no files) or multipart (with files).
  let fields: Record<string, string> = {};
  const files: Array<{
    fileName: string;
    fileType: string;
    buffer: Buffer;
  }> = [];

  if (req.isMultipart()) {
    const parts = req.parts();
    for await (const part of parts) {
      if (part.type === "file") {
        const chunks: Buffer[] = [];
        for await (const chunk of part.file) chunks.push(chunk as Buffer);
        const buf = Buffer.concat(chunks);
        if (!EVIDENCE_MIMES.has(part.mimetype)) {
          throw new ValidationError(
            `Unsupported file type: ${part.mimetype}. PNG/JPG/WebP/GIF/PDF only.`,
          );
        }
        if (buf.length > EVIDENCE_MAX_BYTES) {
          throw new ValidationError(
            `File ${part.filename} exceeds the 10MB limit.`,
          );
        }
        files.push({
          fileName: part.filename,
          fileType: part.mimetype,
          buffer: buf,
        });
      } else {
        fields[part.fieldname] = String(part.value);
      }
    }
  } else {
    fields = (req.body as Record<string, string>) ?? {};
  }

  const {
    userId,
    lineId,
    title,
    description,
    category,
    priority,
    againstUserId,
  } = fields;

  if (!userId || !lineId || !title || !description) {
    throw new ValidationError("INVALID REQUIRED FIELDS");
  }
  const cat =
    category && CATEGORIES.has(category) ? category : "general";
  const pr =
    priority && PRIORITIES.has(priority) ? priority : "normal";

  if (againstUserId && againstUserId === userId) {
    throw new ValidationError("You can't file a complaint against yourself.");
  }

  try {
    const created = await prisma.$transaction(async (tx) => {
      const c = await tx.complaint.create({
        data: {
          userId,
          lineId,
          title,
          description,
          category: cat,
          priority: pr,
          status: "open",
          againstUserId: againstUserId || null,
        },
      });
      if (files.length > 0) {
        await tx.complaintEvidence.createMany({
          data: files.map((f) => ({
            complaintId: c.id,
            fileName: f.fileName,
            fileType: f.fileType,
            fileSize: f.buffer.length,
            data: f.buffer,
            uploadedById: userId,
          })),
        });
      }
      return c;
    });
    return res.code(200).send({ message: "OK", complaint: created });
  } catch (error) {
    if (error instanceof ValidationError) throw error;
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
    }
    throw error;
  }
};

// ─── Evidence: add more files to an existing complaint ────────────────
export const addEvidence = async (req: FastifyRequest, res: FastifyReply) => {
  if (!req.isMultipart()) throw new ValidationError("Multipart required");

  const fields: Record<string, string> = {};
  const files: Array<{
    fileName: string;
    fileType: string;
    buffer: Buffer;
  }> = [];

  const parts = req.parts();
  for await (const part of parts) {
    if (part.type === "file") {
      const chunks: Buffer[] = [];
      for await (const chunk of part.file) chunks.push(chunk as Buffer);
      const buf = Buffer.concat(chunks);
      if (!EVIDENCE_MIMES.has(part.mimetype)) {
        throw new ValidationError(`Unsupported file type: ${part.mimetype}.`);
      }
      if (buf.length > EVIDENCE_MAX_BYTES) {
        throw new ValidationError(`${part.filename} exceeds 10MB.`);
      }
      files.push({
        fileName: part.filename,
        fileType: part.mimetype,
        buffer: buf,
      });
    } else {
      fields[part.fieldname] = String(part.value);
    }
  }
  const { complaintId, userId } = fields;
  if (!complaintId || !userId || files.length === 0) {
    throw new ValidationError("INVALID REQUIRED FIELDS");
  }

  try {
    await prisma.complaintEvidence.createMany({
      data: files.map((f) => ({
        complaintId,
        fileName: f.fileName,
        fileType: f.fileType,
        fileSize: f.buffer.length,
        data: f.buffer,
        uploadedById: userId,
      })),
    });
    return res.code(200).send({ message: "OK", added: files.length });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
    }
    throw error;
  }
};

// ─── Evidence: stream a single file ───────────────────────────────────
export const streamEvidence = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const params = req.query as { id: string };
  if (!params.id) throw new ValidationError("INVALID REQUIRED ID");
  try {
    const row = await prisma.complaintEvidence.findUnique({
      where: { id: params.id },
    });
    if (!row) throw new NotFoundError("Evidence not found");
    const buf = Buffer.from(row.data);
    res.header("Content-Type", row.fileType || "application/octet-stream");
    res.header(
      "Content-Disposition",
      `inline; filename="${row.fileName}"`,
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

// ─── Evidence: remove (only the uploader can remove) ──────────────────
export const removeEvidence = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const params = req.query as { id: string; userId: string };
  if (!params.id || !params.userId) {
    throw new ValidationError("INVALID REQUIRED FIELDS");
  }
  try {
    const row = await prisma.complaintEvidence.findUnique({
      where: { id: params.id },
      select: { uploadedById: true },
    });
    if (!row) throw new NotFoundError("Evidence not found");
    if (row.uploadedById && row.uploadedById !== params.userId) {
      throw new ValidationError("Only the uploader can remove this file.");
    }
    await prisma.complaintEvidence.delete({ where: { id: params.id } });
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

// ─── List ──────────────────────────────────────────────────────────────
export const listComplaints = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const params = req.query as {
    userId?: string;
    lineId?: string;
    status?: string;
    category?: string;
    query?: string;
    lastCursor?: string | null;
    limit?: string;
  };
  if (!params.userId && !params.lineId) {
    throw new ValidationError("Provide userId or lineId");
  }
  try {
    const limit = params.limit ? parseInt(params.limit, 10) : 20;
    const cursor =
      params.lastCursor && params.lastCursor !== "null"
        ? { id: params.lastCursor }
        : undefined;

    const where: Prisma.ComplaintWhereInput = {};
    if (params.userId) where.userId = params.userId;
    if (params.lineId) where.lineId = params.lineId;
    if (params.status && params.status !== "all") where.status = params.status;
    if (params.category && params.category !== "all") {
      where.category = params.category;
    }
    if (params.query?.trim()) {
      const q = params.query.trim();
      where.OR = [
        { title: { contains: q, mode: "insensitive" } },
        { description: { contains: q, mode: "insensitive" } },
      ];
    }

    const rows = await prisma.complaint.findMany({
      where,
      take: limit,
      skip: cursor ? 1 : 0,
      cursor,
      orderBy: { createdAt: "desc" },
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            username: true,
            Position: { select: { name: true } },
          },
        },
        againstUser: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            username: true,
            Position: { select: { name: true } },
          },
        },
        assignedTo: {
          select: { id: true, firstName: true, lastName: true },
        },
        _count: { select: { replies: true, evidence: true } },
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

// ─── Detail ────────────────────────────────────────────────────────────
export const complaintDetail = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const params = req.query as { id: string };
  if (!params.id) throw new ValidationError("INVALID REQUIRED ID");
  try {
    const row = await prisma.complaint.findUnique({
      where: { id: params.id },
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            username: true,
            Position: { select: { name: true } },
          },
        },
        againstUser: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            username: true,
            Position: { select: { name: true } },
          },
        },
        assignedTo: {
          select: { id: true, firstName: true, lastName: true },
        },
        replies: {
          orderBy: { createdAt: "asc" },
          include: {
            user: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                Position: { select: { name: true } },
              },
            },
          },
        },
        evidence: {
          orderBy: { createdAt: "asc" },
          select: {
            id: true,
            fileName: true,
            fileType: true,
            fileSize: true,
            caption: true,
            createdAt: true,
            uploadedById: true,
          },
        },
      },
    });
    if (!row) throw new NotFoundError("Complaint not found");
    return res.code(200).send(row);
  } catch (error) {
    if (error instanceof NotFoundError) throw error;
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
    }
    throw error;
  }
};

// ─── Reply ─────────────────────────────────────────────────────────────
export const replyComplaint = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const body = req.body as {
    complaintId: string;
    userId: string;
    content: string;
    internal?: boolean;
  };
  if (!body.complaintId || !body.userId || !body.content?.trim()) {
    throw new ValidationError("INVALID REQUIRED FIELDS");
  }
  try {
    const reply = await prisma.complaintReply.create({
      data: {
        complaintId: body.complaintId,
        userId: body.userId,
        content: body.content.trim(),
        internal: !!body.internal,
      },
      include: {
        user: {
          select: { id: true, firstName: true, lastName: true },
        },
      },
    });
    // Bump updatedAt so it surfaces in listings sorted by activity.
    await prisma.complaint.update({
      where: { id: body.complaintId },
      data: { updatedAt: new Date() },
    });
    return res.code(200).send({ message: "OK", reply });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
    }
    throw error;
  }
};

// ─── Status / triage ───────────────────────────────────────────────────
export const updateComplaintStatus = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const body = req.body as {
    id: string;
    status?: string;
    priority?: string;
    assignedToUserId?: string | null;
  };
  if (!body.id) throw new ValidationError("INVALID REQUIRED ID");
  if (body.status && !STATUSES.has(body.status)) {
    throw new ValidationError("INVALID STATUS");
  }
  if (body.priority && !PRIORITIES.has(body.priority)) {
    throw new ValidationError("INVALID PRIORITY");
  }
  try {
    const data: Prisma.ComplaintUpdateInput = {};
    if (body.status) {
      data.status = body.status;
      data.resolvedAt =
        body.status === "resolved" || body.status === "closed"
          ? new Date()
          : null;
    }
    if (body.priority) data.priority = body.priority;
    if (body.assignedToUserId !== undefined) {
      data.assignedTo = body.assignedToUserId
        ? { connect: { id: body.assignedToUserId } }
        : { disconnect: true };
    }
    const updated = await prisma.complaint.update({
      where: { id: body.id },
      data,
    });
    return res.code(200).send({ message: "OK", complaint: updated });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
    }
    throw error;
  }
};

// ─── Remove (author can withdraw while still open) ────────────────────
export const removeComplaint = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const params = req.query as { id: string; userId: string };
  if (!params.id || !params.userId) {
    throw new ValidationError("INVALID REQUIRED FIELDS");
  }
  try {
    const row = await prisma.complaint.findUnique({
      where: { id: params.id },
    });
    if (!row) throw new NotFoundError("Complaint not found");
    if (row.userId !== params.userId) {
      throw new ValidationError("Only the author can withdraw a complaint.");
    }
    if (row.status !== "open") {
      throw new ValidationError("Only open complaints can be withdrawn.");
    }
    await prisma.complaint.delete({ where: { id: params.id } });
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
