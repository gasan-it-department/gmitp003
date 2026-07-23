import { FastifyRequest, FastifyReply } from "../barrel/fastify";
import { prisma, Prisma } from "../barrel/prisma";
import { AppError, ValidationError, dbError } from "../errors/errors";

/**
 * Per-storage "Dispense Access" (web Medicine > Storage > Dispense Access tab).
 *
 * Rule — LOCKED BY DEFAULT: a user may dispense/restock in a storage ONLY
 * when they hold a MedicineStorageAccess grant on that exact storage. No
 * grant = blocked, for everyone. Enforced server-side on dispense + every
 * stock mutation (web, mobile, and desktop sync pushes), and mirrored to the
 * desktop app via the storage_access sync table.
 */

const fullName = (u: {
  firstName: string;
  lastName: string;
  middleName?: string | null;
}) =>
  `${u.lastName}, ${u.firstName}${u.middleName ? " " + u.middleName : ""}`;

/**
 * Self-healing default for mobile scanner users: when a user already holds
 * PharmacyMobileAccess (an admin explicitly let them scan for this line) and
 * the line has EXACTLY ONE active storage, grant them Dispense & Stock
 * Access on it automatically — there is no "wrong" storage to pick, and
 * scanner access is meaningless without it. Ambiguous lines (2+ storages)
 * are never auto-granted; the admin assigns those on the storage's
 * Dispense & Stock Access tab. Best-effort: never throws.
 */
export async function autoGrantSoleStorageAccess(
  userId: string | null | undefined,
  lineId: string | null | undefined,
): Promise<void> {
  try {
    if (!userId || !lineId) return;
    const storages = await prisma.medicineStorage.findMany({
      where: { lineId, status: { not: 0 } },
      select: { id: true, name: true, refNumber: true },
      take: 2,
    });
    if (storages.length !== 1) return; // none, or ambiguous — don't guess
    const sole = storages[0];
    const existing = await prisma.medicineStorageAccess.findFirst({
      where: { userId, medicineStorageId: sole.id },
      select: { id: true },
    });
    if (existing) return;
    const mobile = await prisma.pharmacyMobileAccess.findUnique({
      where: { lineId_userId: { lineId, userId } },
      select: { id: true },
    });
    if (!mobile) return; // only heal users an admin already trusted to scan
    await prisma.medicineStorageAccess.create({
      data: { userId, medicineStorageId: sole.id },
    });
    await prisma.medicineLogs.create({
      data: {
        action: 1,
        message:
          `Auto-assigned Dispense & Stock Access on ${sole.name} ` +
          `(${sole.refNumber}) — the line's only storage — for a mobile scanner user`,
        userId,
        lineId,
      },
    });
  } catch (e) {
    console.warn("[autoGrantSoleStorageAccess] skipped:", e);
  }
}

/**
 * The storages this user is granted on (possibly empty — empty means the
 * user can't touch ANY storage's stock).
 */
export async function allowedStorageIds(
  userId: string,
): Promise<Set<string>> {
  const grants = await prisma.medicineStorageAccess.findMany({
    where: { userId },
    select: { medicineStorageId: true },
  });
  return new Set(grants.map((g) => g.medicineStorageId));
}

/**
 * LOCKED BY DEFAULT: throw a ValidationError unless `userId` holds a grant on
 * EVERY storage in `storageIds`. Call before mutating stock or dispensing.
 * (Batches with no storage location fall outside the storage system and are
 * not blocked; null/undefined entries are skipped.)
 */
export async function assertStorageAccess(
  userId: string | null | undefined,
  storageIds: Array<string | null | undefined>,
  action: string,
): Promise<void> {
  if (!userId) return; // no identity on this call — token auth still applies
  const wanted = [...new Set(storageIds.filter(Boolean) as string[])];
  if (wanted.length === 0) return;
  const grants = await prisma.medicineStorageAccess.findMany({
    where: { userId, medicineStorageId: { in: wanted } },
    select: { medicineStorageId: true },
  });
  const have = new Set(grants.map((g) => g.medicineStorageId));
  const blocked = wanted.filter((id) => !have.has(id));
  if (blocked.length === 0) return;
  const names = await prisma.medicineStorage.findMany({
    where: { id: { in: blocked } },
    select: { name: true, refNumber: true },
  });
  const label =
    names.map((n) => `${n.name} (${n.refNumber})`).join(", ") ||
    "this storage";
  throw new ValidationError(
    `No storage access: only users granted Dispense & Stock Access on ${label} ` +
      `can ${action} there. Ask your admin to add you ` +
      `(Pharmacy > Storage > Dispense & Stock Access).`,
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
      throw dbError(error);
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
      throw dbError(error);
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
      throw dbError(error);
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
      throw dbError(error);
    throw error;
  }
};
