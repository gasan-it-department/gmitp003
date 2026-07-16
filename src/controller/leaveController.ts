// Leave applications, approvals, and credit ledger.
//
// Entities:
//   - Leave           — one application (pending → approved | denied | cancelled)
//   - LeaveCredit     — running balance per (user, category, year)
//   - LeaveLedger     — append-only audit trail of every credit change
//
// PH gov standard categories ship pre-defined; admins may also add custom
// labels by passing any category string. Default annual accruals are
// applied lazily on first credit lookup so we don't have to backfill.

import { FastifyReply, FastifyRequest } from "../barrel/fastify";
import { prisma, Prisma } from "../barrel/prisma";
import { AppError, NotFoundError, ValidationError, dbError } from "../errors/errors";

// ─── Catalogue ────────────────────────────────────────────────────────
// Defaults follow CSC's mandatory minimums for regular gov employees.
export const LEAVE_CATALOGUE = [
  { key: "vacation",         label: "Vacation Leave",          withPay: true,  defaultCredits: 15 },
  { key: "sick",             label: "Sick Leave",              withPay: true,  defaultCredits: 15 },
  { key: "mandatory",        label: "Mandatory/Forced Leave",  withPay: true,  defaultCredits: 5  },
  { key: "maternity",        label: "Maternity Leave",         withPay: true,  defaultCredits: 105 },
  { key: "paternity",        label: "Paternity Leave",         withPay: true,  defaultCredits: 7  },
  { key: "soloParent",       label: "Solo Parent Leave",       withPay: true,  defaultCredits: 7  },
  { key: "specialPrivilege", label: "Special Privilege Leave", withPay: true,  defaultCredits: 3  },
  { key: "bereavement",      label: "Bereavement Leave",       withPay: true,  defaultCredits: 5  },
  { key: "emergency",        label: "Emergency Leave",         withPay: true,  defaultCredits: 3  },
  { key: "others",           label: "Others (Unpaid)",         withPay: false, defaultCredits: 0  },
] as const;

const catalogueByKey = new Map(LEAVE_CATALOGUE.map((c) => [c.key, c]));

const businessDaysBetween = (start: Date, end: Date): number => {
  const s = new Date(start);
  s.setHours(0, 0, 0, 0);
  const e = new Date(end);
  e.setHours(0, 0, 0, 0);
  if (e < s) return 0;
  let days = 0;
  for (
    let d = new Date(s);
    d.getTime() <= e.getTime();
    d.setDate(d.getDate() + 1)
  ) {
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) days += 1; // skip Sat/Sun
  }
  return days;
};

// Get-or-create the credit row for a (user, category, year). Lazily seeds
// the default accrual the first time the user's bucket is touched.
const ensureCredit = async (
  tx: Prisma.TransactionClient,
  userId: string,
  lineId: string | null | undefined,
  category: string,
  year: number,
) => {
  const existing = await tx.leaveCredit.findUnique({
    where: { userId_category_year: { userId, category, year } },
  });
  if (existing) return existing;

  const seed = catalogueByKey.get(category as any)?.defaultCredits ?? 0;
  const created = await tx.leaveCredit.create({
    data: {
      userId,
      lineId: lineId ?? null,
      category,
      year,
      accrued: seed,
      used: 0,
      balance: seed,
    },
  });
  if (seed > 0) {
    await tx.leaveLedger.create({
      data: {
        userId,
        category,
        year,
        delta: seed,
        kind: "accrual",
        note: "Initial annual accrual",
      },
    });
  }
  return created;
};

// ─── Catalogue endpoint ───────────────────────────────────────────────
export const leaveCatalogue = async (
  _req: FastifyRequest,
  res: FastifyReply,
) => res.code(200).send({ list: LEAVE_CATALOGUE });

// ─── Apply for leave ──────────────────────────────────────────────────
export const applyLeave = async (req: FastifyRequest, res: FastifyReply) => {
  const body = req.body as {
    userId: string;
    lineId?: string;
    category: string;
    startDate: string;
    endDate: string;
    reason?: string;
    attachmentUrl?: string;
    attachmentType?: string;
    withPay?: boolean;
  };

  if (!body.userId || !body.category || !body.startDate || !body.endDate) {
    throw new ValidationError("INVALID REQUIRED FIELDS");
  }
  const start = new Date(body.startDate);
  const end = new Date(body.endDate);
  if (isNaN(start.getTime()) || isNaN(end.getTime()) || end < start) {
    throw new ValidationError("INVALID DATE RANGE");
  }

  const days = businessDaysBetween(start, end);
  if (days <= 0) {
    throw new ValidationError("RANGE COVERS NO BUSINESS DAYS");
  }

  const cat = catalogueByKey.get(body.category as any);
  const withPay = body.withPay ?? cat?.withPay ?? true;

  try {
    const created = await prisma.leave.create({
      data: {
        userId: body.userId,
        lineId: body.lineId ?? null,
        type: body.category, // backward-compat
        category: body.category,
        startDate: start,
        endDate: end,
        days,
        withPay,
        reason: body.reason,
        attachmentUrl: body.attachmentUrl,
        attachmentType: body.attachmentType,
        status: "pending",
      },
    });
    return res.code(200).send({ message: "OK", leave: created });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw dbError(error);
    }
    throw error;
  }
};

// ─── List leaves (mine, or for HR across a line) ──────────────────────
export const listLeaves = async (req: FastifyRequest, res: FastifyReply) => {
  const params = req.query as {
    userId?: string;       // when set → "my leaves"
    lineId?: string;       // when set without userId → HR-wide view
    status?: string;       // "pending" | "approved" | "denied" | "cancelled" | "all"
    category?: string;
    lastCursor?: string | null;
    limit?: string;
  };

  try {
    const limit = params.limit ? parseInt(params.limit, 10) : 20;
    const cursor =
      params.lastCursor && params.lastCursor !== "null"
        ? { id: params.lastCursor }
        : undefined;

    const where: Prisma.LeaveWhereInput = {};
    if (params.userId) where.userId = params.userId;
    if (params.lineId) where.lineId = params.lineId;
    if (params.status && params.status !== "all") where.status = params.status;
    if (params.category && params.category !== "all") {
      where.category = params.category;
    }

    const rows = await prisma.leave.findMany({
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
        approver: {
          select: { id: true, firstName: true, lastName: true },
        },
      },
    });
    const lastCursor = rows.length ? rows[rows.length - 1].id : null;
    const hasMore = rows.length === limit;
    return res.code(200).send({ list: rows, lastCursor, hasMore });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw dbError(error);
    }
    throw error;
  }
};

// ─── Decide on a leave (approve / deny) ───────────────────────────────
// When approving a paid leave, debit the user's credit bucket atomically.
// When denying / cancelling an already-approved leave, refund the bucket.
export const decideLeave = async (req: FastifyRequest, res: FastifyReply) => {
  const body = req.body as {
    leaveId: string;
    approverId: string;
    decision: "approved" | "denied";
    remark?: string;
  };
  if (!body.leaveId || !body.approverId || !body.decision) {
    throw new ValidationError("INVALID REQUIRED FIELDS");
  }
  if (body.decision !== "approved" && body.decision !== "denied") {
    throw new ValidationError("INVALID DECISION");
  }

  try {
    const updated = await prisma.$transaction(async (tx) => {
      const leave = await tx.leave.findUnique({ where: { id: body.leaveId } });
      if (!leave) throw new NotFoundError("Leave not found");
      if (leave.status !== "pending") {
        throw new ValidationError(
          `Already ${leave.status} — only pending leaves can be decided.`,
        );
      }

      // If approving a paid leave, debit the credit bucket.
      if (body.decision === "approved" && leave.withPay) {
        const year = leave.startDate.getFullYear();
        const credit = await ensureCredit(
          tx,
          leave.userId,
          leave.lineId,
          leave.category,
          year,
        );
        if (credit.balance < leave.days) {
          throw new ValidationError(
            `Insufficient ${leave.category} credits — balance ${credit.balance}, requested ${leave.days}.`,
          );
        }
        await tx.leaveCredit.update({
          where: { id: credit.id },
          data: {
            used: { increment: leave.days },
            balance: { decrement: leave.days },
          },
        });
        await tx.leaveLedger.create({
          data: {
            userId: leave.userId,
            category: leave.category,
            year,
            delta: -leave.days,
            kind: "usage",
            leaveId: leave.id,
            byUserId: body.approverId,
            note: "Approved leave debit",
          },
        });
      }

      return tx.leave.update({
        where: { id: leave.id },
        data: {
          status: body.decision,
          approverId: body.approverId,
          decidedAt: new Date(),
          decisionRemark: body.remark,
        },
      });
    });

    return res.code(200).send({ message: "OK", leave: updated });
  } catch (error) {
    if (error instanceof NotFoundError) throw error;
    if (error instanceof ValidationError) throw error;
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw dbError(error);
    }
    throw error;
  }
};

// Employee-initiated cancel (only while pending). Approved leaves should
// be voided via decideLeave with a separate "refund" path if needed.
export const cancelLeave = async (req: FastifyRequest, res: FastifyReply) => {
  const body = req.body as { leaveId: string; userId: string };
  if (!body.leaveId || !body.userId) {
    throw new ValidationError("INVALID REQUIRED FIELDS");
  }

  try {
    const leave = await prisma.leave.findUnique({
      where: { id: body.leaveId },
    });
    if (!leave) throw new NotFoundError("Leave not found");
    if (leave.userId !== body.userId) {
      throw new ValidationError("Cannot cancel another user's leave.");
    }
    if (leave.status !== "pending") {
      throw new ValidationError("Only pending leaves can be cancelled.");
    }
    await prisma.leave.update({
      where: { id: leave.id },
      data: { status: "cancelled" },
    });
    return res.code(200).send({ message: "OK" });
  } catch (error) {
    if (error instanceof NotFoundError) throw error;
    if (error instanceof ValidationError) throw error;
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw dbError(error);
    }
    throw error;
  }
};

// ─── Credits view ─────────────────────────────────────────────────────
// Returns the current year's bucket for every catalogue category for a
// user, seeding rows on demand.
export const listLeaveCredits = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const params = req.query as { userId: string; year?: string };
  if (!params.userId) throw new ValidationError("INVALID REQUIRED ID");
  const year = params.year ? parseInt(params.year, 10) : new Date().getFullYear();

  try {
    const credits = await prisma.$transaction(async (tx) => {
      const out: Array<{
        category: string;
        label: string;
        withPay: boolean;
        accrued: number;
        used: number;
        balance: number;
      }> = [];
      for (const c of LEAVE_CATALOGUE) {
        const row = await ensureCredit(tx, params.userId, null, c.key, year);
        out.push({
          category: c.key,
          label: c.label,
          withPay: c.withPay,
          accrued: row.accrued,
          used: row.used,
          balance: row.balance,
        });
      }
      return out;
    });
    return res.code(200).send({ year, list: credits });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw dbError(error);
    }
    throw error;
  }
};

// HR adjustment — credit or debit a bucket with an audit note.
export const adjustLeaveCredit = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const body = req.body as {
    userId: string;
    category: string;
    delta: number;
    note?: string;
    byUserId: string;
    year?: number;
  };
  if (
    !body.userId ||
    !body.category ||
    typeof body.delta !== "number" ||
    !body.byUserId
  ) {
    throw new ValidationError("INVALID REQUIRED FIELDS");
  }

  try {
    const year = body.year ?? new Date().getFullYear();
    await prisma.$transaction(async (tx) => {
      const credit = await ensureCredit(
        tx,
        body.userId,
        null,
        body.category,
        year,
      );
      const newBalance = credit.balance + body.delta;
      if (newBalance < 0) {
        throw new ValidationError(
          "Adjustment would make balance negative.",
        );
      }
      await tx.leaveCredit.update({
        where: { id: credit.id },
        data: {
          balance: newBalance,
          accrued:
            body.delta > 0 ? { increment: body.delta } : credit.accrued,
          used: body.delta < 0 ? { increment: -body.delta } : credit.used,
        },
      });
      await tx.leaveLedger.create({
        data: {
          userId: body.userId,
          category: body.category,
          year,
          delta: body.delta,
          kind: "adjustment",
          byUserId: body.byUserId,
          note: body.note,
        },
      });
    });
    return res.code(200).send({ message: "OK" });
  } catch (error) {
    if (error instanceof ValidationError) throw error;
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw dbError(error);
    }
    throw error;
  }
};

// Per-user audit trail of credit movements.
export const listLeaveLedger = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const params = req.query as { userId: string; year?: string };
  if (!params.userId) throw new ValidationError("INVALID REQUIRED ID");
  const year = params.year ? parseInt(params.year, 10) : new Date().getFullYear();

  try {
    const rows = await prisma.leaveLedger.findMany({
      where: { userId: params.userId, year },
      orderBy: { at: "desc" },
      include: {
        by: { select: { id: true, firstName: true, lastName: true } },
        leave: { select: { id: true, category: true } },
      },
    });
    return res.code(200).send({ year, list: rows });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw dbError(error);
    }
    throw error;
  }
};

// ─── Line users picker (employee search for HR actions) ──────────────
export const listLineUsers = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const params = req.query as { lineId: string; query?: string };
  if (!params.lineId) throw new ValidationError("INVALID REQUIRED ID");
  try {
    const where: Prisma.UserWhereInput = { lineId: params.lineId };
    if (params.query?.trim()) {
      const q = params.query.trim();
      where.OR = [
        { firstName: { contains: q, mode: "insensitive" } },
        { lastName: { contains: q, mode: "insensitive" } },
        { username: { contains: q, mode: "insensitive" } },
      ];
    }
    const rows = await prisma.user.findMany({
      where,
      take: 50,
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
      select: {
        id: true,
        firstName: true,
        lastName: true,
        username: true,
        Position: { select: { name: true } },
        SalaryGrade: { select: { grade: true, amount: true } },
      },
    });
    return res.code(200).send({ list: rows });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw dbError(error);
    }
    throw error;
  }
};
