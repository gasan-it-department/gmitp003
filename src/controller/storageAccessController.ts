import { FastifyRequest, FastifyReply } from "../barrel/fastify";
import { prisma, Prisma } from "../barrel/prisma";
import { AppError, ValidationError } from "../errors/errors";

/**
 * Per-storage "Dispense Access" (web Medicine > Storage > Dispense Access tab).
 *
 * Rule: a user with at least one MedicineStorageAccess grant may dispense and
 * restock ONLY in the storages they are granted. A user with no grants at all
 * is unrestricted (backward compatible — nothing changes until you assign
 * someone). Enforced server-side on dispense + every stock mutation, and
 * mirrored to the desktop app via the storage_access sync table.
 */

const fullName = (u: {
  firstName: string;
  lastName: string;
  middleName?: string | null;
}) =>
  `${u.lastName}, ${u.firstName}${u.middleName ? " " + u.middleName : ""}`;

/**
 * The storages this user may act on, or null when the user has no grants
 * anywhere (= unrestricted).
 */
export async function allowedStorageIds(
  userId: string,
): Promise<Set<string> | null> {
  const grants = await prisma.medicineStorageAccess.findMany({
    where: { userId },
    select: { medicineStorageId: true },
  });
  if (grants.length === 0) return null;
  return new Set(grants.map((g) => g.medicineStorageId));
}

/**
 * Throw a ValidationError when `userId` is restricted and any of `storageIds`
 * falls outside their granted set. Call before mutating stock or dispensing.
 */
export async function assertStorageAccess(
  userId: string | null | undefined,
  storageIds: Array<string | null | undefined>,
  action: string,
): Promise<void> {
  if (!userId) return; // no identity on this call — token auth still applies
  const allowed = await allowedStorageIds(userId);
  if (!allowed) return; // no grants anywhere = unrestricted
  const wanted = [...new Set(storageIds.filter(Boolean) as string[])];
  const blocked = wanted.filter((id) => !allowed.has(id));
  if (blocked.length === 0) return;
  const names = await prisma.medicineStorage.findMany({
    where: { id: { in: blocked } },
    select: { name: true, refNumber: true },
  });
  const label =
    names.map((n) => `${n.name} (${n.refNumber})`).join(", ") ||
    "this storage";
  throw new ValidationError(
    `No storage access: you can only ${action} in storages assigned to you. ` +
      `Not assigned: ${label}. Ask your admin (Storage > Dispense Access).`,
  );
}

// GET /medicine/storage-access?storageId — users granted on this storage
export const listStorageAccess = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const { storageId } = req.query as { storageId?: string };
  if (!storageId) throw new ValidationError("storageId is required");
  try {
    const rows = await prisma.medicineStorageAccess.findMany({
      where: { medicineStorageId: storageId },
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
      },
    });
    const list = rows.map((r) => ({
      id: r.id,
      userId: r.userId,
      name: fullName(r.user),
      username: r.user.username,
      department: r.user.department?.name ?? null,
      grantedAt: r.timestamp,
      grantedBy: null as string | null, // model has no grantedBy — audit is in MedicineLogs
    }));
    return res.code(200).send({ list });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError)
      throw new AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
    throw error;
  }
};

// GET /medicine/storage-access/candidates?storageId&lineId&query
export const storageAccessCandidates = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const { storageId, lineId, query } = req.query as {
    storageId?: string;
    lineId?: string;
    query?: string;
  };
  if (!storageId || !lineId)
    throw new ValidationError("storageId and lineId are required");
  try {
    const granted = await prisma.medicineStorageAccess.findMany({
      where: { medicineStorageId: storageId },
      select: { userId: true },
    });
    const grantedIds = granted.map((g) => g.userId);

    const term = (query ?? "").trim();
    const where: Prisma.UserWhereInput = {
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
    };

    const users = await prisma.user.findMany({
      where,
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
    const list = users.map((u) => ({
      id: u.id,
      name: fullName(u),
      username: u.username,
      department: u.department?.name ?? null,
    }));
    return res.code(200).send({ list });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError)
      throw new AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
    throw error;
  }
};

// POST /medicine/storage-access { storageId, lineId, userId, grantedById }
export const grantStorageAccess = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const body = req.body as {
    storageId?: string;
    lineId?: string;
    userId?: string;
    grantedById?: string;
  };
  if (!body.storageId || !body.lineId || !body.userId)
    throw new ValidationError("storageId, lineId and userId are required");
  try {
    const [user, storage] = await Promise.all([
      prisma.user.findFirst({
        where: { id: body.userId, lineId: body.lineId },
        select: { id: true, firstName: true, lastName: true },
      }),
      prisma.medicineStorage.findFirst({
        where: { id: body.storageId, lineId: body.lineId },
        select: { id: true, name: true, refNumber: true },
      }),
    ]);
    if (!user) throw new ValidationError("USER_NOT_IN_LINE");
    if (!storage) throw new ValidationError("STORAGE_NOT_FOUND");

    // no unique constraint on (storage,user) — check-then-create, idempotent
    const dup = await prisma.medicineStorageAccess.findFirst({
      where: { medicineStorageId: body.storageId, userId: body.userId },
      select: { id: true },
    });
    if (!dup) {
      await prisma.medicineStorageAccess.create({
        data: {
          medicineStorageId: body.storageId,
          userId: body.userId,
          previlege: 1,
        },
      });
    }

    if (body.grantedById) {
      try {
        await prisma.medicineLogs.create({
          data: {
            action: 1,
            lineId: body.lineId,
            userId: body.grantedById,
            message:
              `Granted dispense access on storage ${storage.name} ` +
              `(${storage.refNumber}) to ${user.lastName}, ${user.firstName}.`,
          },
        });
      } catch {
        /* audit is best-effort */
      }
    }
    return res.code(200).send({ message: "OK" });
  } catch (error) {
    if (error instanceof ValidationError) throw error;
    if (error instanceof Prisma.PrismaClientKnownRequestError)
      throw new AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
    throw error;
  }
};

// DELETE /medicine/storage-access { storageId, lineId, userId, revokedById }
export const revokeStorageAccess = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const body = req.body as {
    storageId?: string;
    lineId?: string;
    userId?: string;
    revokedById?: string;
  };
  if (!body.storageId || !body.userId)
    throw new ValidationError("storageId and userId are required");
  try {
    const [user, storage] = await Promise.all([
      prisma.user.findUnique({
        where: { id: body.userId },
        select: { firstName: true, lastName: true },
      }),
      prisma.medicineStorage.findUnique({
        where: { id: body.storageId },
        select: { name: true, refNumber: true },
      }),
    ]);
    await prisma.medicineStorageAccess.deleteMany({
      where: { medicineStorageId: body.storageId, userId: body.userId },
    });
    if (body.revokedById && user && storage) {
      try {
        await prisma.medicineLogs.create({
          data: {
            action: 0,
            lineId: body.lineId ?? null,
            userId: body.revokedById,
            message:
              `Revoked dispense access on storage ${storage.name} ` +
              `(${storage.refNumber}) from ${user.lastName}, ${user.firstName}.`,
          },
        });
      } catch {
        /* audit is best-effort */
      }
    }
    return res.code(200).send({ message: "OK" });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError)
      throw new AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
    throw error;
  }
};
