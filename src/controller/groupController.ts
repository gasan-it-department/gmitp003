import { FastifyReply, FastifyRequest } from "../barrel/fastify";
import { prisma, Prisma } from "../barrel/prisma";

import { AppError, NotFoundError, ValidationError } from "../errors/errors";
import { PagingProps } from "../models/route";

/**
 * Paginated list of departments (a.k.a. units) for a line.
 *
 * Each row is annotated with `_count.users` so the list page can show
 * a member count without an extra round-trip per row.
 */
export const groupList = async (req: FastifyRequest, res: FastifyReply) => {
  const params = req.query as PagingProps;
  if (!params.id) throw new ValidationError("INVALID_REQUEST");

  try {
    const cursor = params.lastCursor ? { id: params.lastCursor } : undefined;
    const limit = params.limit ? parseInt(params.limit, 10) : 20;

    const where: any = { lineId: params.id };
    if (params.query && params.query.trim()) {
      const q = params.query.trim();
      where.OR = [
        { name: { contains: q, mode: "insensitive" } },
        { idCode: { contains: q, mode: "insensitive" } },
      ];
    }

    const groups = await prisma.department.findMany({
      where,
      take: limit,
      cursor,
      skip: cursor ? 1 : 0,
      orderBy: { createdAt: "desc" },
      include: {
        _count: { select: { users: true } },
        head: {
          select: { id: true, firstName: true, lastName: true, email: true },
        },
      },
    });

    const newLastCursorId =
      groups.length > 0 ? groups[groups.length - 1].id : null;
    const hasMore = groups.length === limit;
    return res
      .code(200)
      .send({ list: groups, lastCursor: newLastCursorId, hasMore });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DB_CONNECTION_EROR", 500, "DB_FAILED");
    }
    throw error;
  }
};

/**
 * Create a new department under a line.
 *
 * Refuses duplicates (case-insensitive) within the same line.
 */
export const createGroup = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const body = req.body as {
      title: string;
      description?: string;
      lineId: string;
      userId: string;
    };

    if (!body || !body.lineId) throw new ValidationError("INVALID_REQUEST");
    const name = body.title?.trim();
    if (!name) throw new ValidationError("Unit name is required.");
    if (name.length > 120)
      throw new ValidationError("Unit name is too long (max 120 chars).");

    const existing = await prisma.department.findFirst({
      where: {
        name: { equals: name, mode: "insensitive" },
        lineId: body.lineId,
      },
      select: { id: true },
    });
    if (existing) {
      throw new ValidationError(
        "A unit with this name already exists in this line.",
      );
    }

    const created = await prisma.department.create({
      data: {
        name,
        description: body.description?.trim() || null,
        lineId: body.lineId,
      },
    });

    // Audit is best-effort and deliberately OUTSIDE the transaction: a bad
    // userId (its column is a User FK) used to roll the whole unit back and
    // surface as an opaque 500, so an audit row could veto real work.
    try {
      await prisma.humanResourcesLogs.create({
        data: {
          action: "CREATED UNIT",
          lineId: body.lineId,
          userId: body.userId,
          desc: `Created new unit: ${created.name}`,
        },
      });
    } catch (e) {
      console.warn("[createGroup] audit log skipped:", e);
    }

    return res.code(200).send({ message: "OK", id: created.id });
  } catch (error) {
    if (error instanceof ValidationError) throw error;
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      // Keep the Prisma code — "DB_CONNECTION_EROR" told us nothing while
      // this was actually a foreign-key violation.
      console.error("[createGroup] prisma error", error.code, error.meta);
      if (error.code === "P2002")
        throw new ValidationError("A unit with this name already exists in this line.");
      if (error.code === "P2003")
        throw new ValidationError(
          "Couldn't record this unit against your account. Sign in again and retry.",
        );
      throw new AppError(`DB_ERROR (${error.code})`, 500, "DB_FAILED");
    }
    throw error;
  }
};

/**
 * Patch a department's editable fields (name, description).
 * Refuses to collide with another unit in the same line.
 */
export const updateGroup = async (req: FastifyRequest, res: FastifyReply) => {
  const body = req.body as {
    id: string;
    name?: string;
    description?: string | null;
    userId: string;
    lineId: string;
  };

  if (!body.id || !body.lineId) throw new ValidationError("INVALID_REQUEST");

  try {
    const existing = await prisma.department.findUnique({
      where: { id: body.id },
    });
    if (!existing) throw new NotFoundError("UNIT_NOT_FOUND");

    const data: any = {};
    if (typeof body.name === "string") {
      const next = body.name.trim();
      if (!next) throw new ValidationError("Name cannot be empty.");
      if (next.toLowerCase() !== (existing.name ?? "").toLowerCase()) {
        const clash = await prisma.department.findFirst({
          where: {
            name: { equals: next, mode: "insensitive" },
            lineId: body.lineId,
            id: { not: body.id },
          },
          select: { id: true },
        });
        if (clash) {
          throw new ValidationError(
            "Another unit in this line already uses that name.",
          );
        }
      }
      data.name = next;
    }
    if (body.description !== undefined) {
      data.description = body.description?.toString().trim() || null;
    }

    const updated = await prisma.$transaction(async (tx) => {
      const row = await tx.department.update({
        where: { id: body.id },
        data,
      });
      await tx.humanResourcesLogs.create({
        data: {
          action: "UPDATED UNIT",
          userId: body.userId,
          lineId: body.lineId,
          desc: `Updated unit ${existing.name ?? ""} → ${row.name ?? ""}`,
        },
      });
      return row;
    });

    return res.code(200).send({ message: "OK", id: updated.id });
  } catch (error) {
    if (error instanceof NotFoundError) throw error;
    if (error instanceof ValidationError) throw error;
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DB_CONNECTION_EROR", 500, "DB_FAILED");
    }
    throw error;
  }
};

export const unitInfo = async (req: FastifyRequest, res: FastifyReply) => {
  const params = req.query as { id: string };

  if (!params.id) throw new ValidationError("INVALID_REQUEST");
  try {
    const unit = await prisma.department.findUnique({
      where: { id: params.id },
      include: {
        _count: { select: { users: true } },
        head: {
          select: { id: true, firstName: true, lastName: true, email: true },
        },
        line: { select: { id: true, name: true } },
      },
    });

    if (!unit) throw new NotFoundError("UNIT_NOT_FOUND");
    return res.code(200).send(unit);
  } catch (error) {
    if (error instanceof NotFoundError) throw error;
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DB_CONNECTION_EROR", 500, "DB_FAILED");
    }
    throw error;
  }
};

/**
 * Hard-delete a department.
 *
 * Refuses to delete a unit that still has users assigned to it — the
 * cascade would orphan or null out user.departmentId across the board.
 */
export const deleteUnit = async (req: FastifyRequest, res: FastifyReply) => {
  const params = req.query as { id: string; userId: string; lineId: string };

  if (!params.id || !params.lineId || !params.userId) {
    throw new ValidationError("INVALID REQUIRED ID");
  }

  try {
    const unit = await prisma.department.findUnique({
      where: { id: params.id },
      include: { _count: { select: { users: true } } },
    });
    if (!unit) throw new NotFoundError("UNIT_NOT_FOUND");

    if ((unit._count?.users ?? 0) > 0) {
      throw new ValidationError(
        `This unit still has ${unit._count.users} user${
          unit._count.users === 1 ? "" : "s"
        } assigned. Reassign them first.`,
      );
    }

    await prisma.$transaction(async (tx) => {
      await tx.department.delete({ where: { id: params.id } });
      await tx.humanResourcesLogs.create({
        data: {
          userId: params.userId,
          lineId: params.lineId,
          action: "REMOVE",
          desc: `REMOVE UNIT: ${unit.name ?? ""}`,
        },
      });
    });

    return res.code(200).send({ message: "OK" });
  } catch (error) {
    if (error instanceof NotFoundError) throw error;
    if (error instanceof ValidationError) throw error;
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DB_CONNECTION_EROR", 500, "DB_FAILED");
    }
    throw error;
  }
};
