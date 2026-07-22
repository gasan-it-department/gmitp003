import { FastifyRequest, FastifyReply } from "../barrel/fastify";
import { prisma, Prisma } from "../barrel/prisma";
import { AppError, ValidationError } from "../errors/errors";

/**
 * "Mobile Access" for the Pharmacy module (web Medicine > Config > Mobile Access
 * tab). Grants/revokes a user's line-wide access to the MOBILE pharmacy features
 * (scanner + add-stock + sync). Enforced server-side by `pharmacyMobileAuth`
 * on the mobile-only endpoints, so ungranted users can't modify medicine data.
 */

const fullName = (u: { firstName: string; lastName: string; middleName?: string | null }) =>
  `${u.lastName}, ${u.firstName}${u.middleName ? " " + u.middleName : ""}`;

// GET /medicine/mobile-access?lineId — users granted mobile pharmacy access
export const listMobileAccess = async (req: FastifyRequest, res: FastifyReply) => {
  const { lineId } = req.query as { lineId?: string };
  if (!lineId) throw new ValidationError("lineId is required");
  try {
    const rows = await prisma.pharmacyMobileAccess.findMany({
      where: { lineId },
      orderBy: { timestamp: "desc" },
      include: {
        user: {
          select: {
            id: true, firstName: true, lastName: true, middleName: true,
            username: true, department: { select: { name: true } },
          },
        },
        grantedBy: { select: { firstName: true, lastName: true } },
      },
    });
    // Which storages of THIS line each scanner user is assigned to — so the
    // Mobile Access tab can flag anyone who can scan but has no storage to
    // stock into (their uploads would bounce on Dispense & Stock Access).
    const lineStorages = await prisma.medicineStorage.findMany({
      where: { lineId, status: { not: 0 } },
      select: { id: true, name: true, refNumber: true },
    });
    const storageName = new Map(
      lineStorages.map((s) => [s.id, s.refNumber || s.name || s.id]),
    );
    const grants = rows.length
      ? await prisma.medicineStorageAccess.findMany({
          where: {
            userId: { in: rows.map((r) => r.userId) },
            medicineStorageId: { in: lineStorages.map((s) => s.id) },
          },
          select: { userId: true, medicineStorageId: true },
        })
      : [];
    const byUser = new Map<string, string[]>();
    for (const g of grants) {
      const label = storageName.get(g.medicineStorageId);
      if (!label) continue;
      const arr = byUser.get(g.userId) ?? [];
      arr.push(label);
      byUser.set(g.userId, arr);
    }

    const list = rows.map((r) => ({
      id: r.id,
      userId: r.userId,
      name: fullName(r.user),
      username: r.user.username,
      department: r.user.department?.name ?? null,
      grantedAt: r.timestamp,
      grantedBy: r.grantedBy ? `${r.grantedBy.lastName}, ${r.grantedBy.firstName}` : null,
      storages: byUser.get(r.userId) ?? [],
    }));
    return res.code(200).send({ list, lineStorageCount: lineStorages.length });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError)
      throw new AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
    throw error;
  }
};

// GET /medicine/mobile-access/candidates?lineId&query — line users NOT yet granted
export const mobileAccessCandidates = async (req: FastifyRequest, res: FastifyReply) => {
  const { lineId, query } = req.query as { lineId?: string; query?: string };
  if (!lineId) throw new ValidationError("lineId is required");
  try {
    const granted = await prisma.pharmacyMobileAccess.findMany({
      where: { lineId },
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
        id: true, firstName: true, lastName: true, middleName: true,
        username: true, department: { select: { name: true } },
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

// POST /medicine/mobile-access { lineId, userId, grantedById } — grant (idempotent)
export const grantMobileAccess = async (req: FastifyRequest, res: FastifyReply) => {
  const body = req.body as { lineId?: string; userId?: string; grantedById?: string };
  if (!body.lineId || !body.userId) throw new ValidationError("lineId and userId are required");
  try {
    const user = await prisma.user.findFirst({
      where: { id: body.userId, lineId: body.lineId },
      select: { id: true, firstName: true, lastName: true },
    });
    if (!user) throw new ValidationError("USER_NOT_IN_LINE");

    await prisma.pharmacyMobileAccess.upsert({
      where: { lineId_userId: { lineId: body.lineId, userId: body.userId } },
      create: { lineId: body.lineId, userId: body.userId, grantedById: body.grantedById ?? null },
      update: {},
    });

    // audit (best-effort) — only when we know who granted it
    if (body.grantedById) {
      try {
        await prisma.medicineLogs.create({
          data: {
            action: 1,
            lineId: body.lineId,
            userId: body.grantedById,
            message: `Granted mobile pharmacy access to ${user.lastName}, ${user.firstName}.`,
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

// DELETE /medicine/mobile-access { lineId, userId, revokedById } — revoke
export const revokeMobileAccess = async (req: FastifyRequest, res: FastifyReply) => {
  const body = req.body as { lineId?: string; userId?: string; revokedById?: string };
  if (!body.lineId || !body.userId) throw new ValidationError("lineId and userId are required");
  try {
    const user = await prisma.user.findUnique({
      where: { id: body.userId },
      select: { firstName: true, lastName: true },
    });
    await prisma.pharmacyMobileAccess.deleteMany({
      where: { lineId: body.lineId, userId: body.userId },
    });
    if (body.revokedById && user) {
      try {
        await prisma.medicineLogs.create({
          data: {
            action: 0,
            lineId: body.lineId,
            userId: body.revokedById,
            message: `Revoked mobile pharmacy access from ${user.lastName}, ${user.firstName}.`,
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

// GET /medicine/mobile-access/me — the mobile app's self-check (uses the token)
export const myMobileAccess = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const accountId = (req.user as { id?: string } | undefined)?.id;
    if (!accountId) return res.code(200).send({ granted: false });
    const account = await prisma.account.findUnique({
      where: { id: accountId },
      select: { lineId: true, User: { select: { id: true } } },
    });
    const lineId = account?.lineId ?? null;
    const userId = account?.User?.id ?? null;
    if (!lineId || !userId) return res.code(200).send({ granted: false, reason: "no-user-or-line" });
    const access = await prisma.pharmacyMobileAccess.findUnique({
      where: { lineId_userId: { lineId, userId } },
      select: { id: true },
    });
    return res.code(200).send({ granted: !!access });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError)
      throw new AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
    throw error;
  }
};
