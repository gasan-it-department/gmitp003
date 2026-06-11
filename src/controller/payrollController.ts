// Payroll period management + payslip computation.
//
// Lifecycle: a period starts as "draft" with no payslips. The HR officer
// triggers `computePayrollPeriod` which iterates over every employee in
// the line, pulls their basic salary (from SalaryGrade) + leave activity
// within the window + any custom deductions, applies the PH calculators
// (`utils/phPayroll`), and upserts one `Payslip` per user. Status flips
// to "computed". A final `releasePayrollPeriod` flips to "released" and
// stamps `releasedAt` on every payslip.

import { FastifyReply, FastifyRequest } from "../barrel/fastify";
import { prisma, Prisma } from "../barrel/prisma";
import { AppError, NotFoundError, ValidationError } from "../errors/errors";
import { computePayslip } from "../utils/phPayroll";

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
    if (dow !== 0 && dow !== 6) days += 1;
  }
  return days;
};

// Sum the business-day overlap between a leave and a period window.
const leaveDaysWithin = (
  leaveStart: Date,
  leaveEnd: Date,
  periodStart: Date,
  periodEnd: Date,
): number => {
  const start = leaveStart > periodStart ? leaveStart : periodStart;
  const end = leaveEnd < periodEnd ? leaveEnd : periodEnd;
  if (end < start) return 0;
  return businessDaysBetween(start, end);
};

// ─── Periods ──────────────────────────────────────────────────────────
export const listPayrollPeriods = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const params = req.query as {
    lineId: string;
    status?: string;
    lastCursor?: string | null;
    limit?: string;
  };
  if (!params.lineId) throw new ValidationError("INVALID REQUIRED ID");

  try {
    const limit = params.limit ? parseInt(params.limit, 10) : 20;
    const cursor =
      params.lastCursor && params.lastCursor !== "null"
        ? { id: params.lastCursor }
        : undefined;
    const where: Prisma.PayrollPeriodWhereInput = { lineId: params.lineId };
    if (params.status && params.status !== "all") where.status = params.status;

    const rows = await prisma.payrollPeriod.findMany({
      where,
      take: limit,
      skip: cursor ? 1 : 0,
      cursor,
      orderBy: { periodStart: "desc" },
      include: {
        _count: { select: { payslips: true } },
        createdBy: {
          select: { id: true, firstName: true, lastName: true },
        },
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

export const createPayrollPeriod = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const body = req.body as {
    lineId: string;
    label: string;
    periodStart: string;
    periodEnd: string;
    userId: string;
  };
  if (!body.lineId || !body.label || !body.periodStart || !body.periodEnd) {
    throw new ValidationError("INVALID REQUIRED FIELDS");
  }
  const start = new Date(body.periodStart);
  const end = new Date(body.periodEnd);
  if (isNaN(start.getTime()) || isNaN(end.getTime()) || end < start) {
    throw new ValidationError("INVALID DATE RANGE");
  }

  try {
    const created = await prisma.payrollPeriod.create({
      data: {
        lineId: body.lineId,
        label: body.label,
        periodStart: start,
        periodEnd: end,
        status: "draft",
        createdByUserId: body.userId,
      },
    });
    return res.code(200).send({ message: "OK", period: created });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
    }
    throw error;
  }
};

export const removePayrollPeriod = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const params = req.query as { id: string };
  if (!params.id) throw new ValidationError("INVALID REQUIRED ID");
  try {
    const period = await prisma.payrollPeriod.findUnique({
      where: { id: params.id },
    });
    if (!period) throw new NotFoundError("Period not found");
    if (period.status === "released") {
      throw new ValidationError("Released periods cannot be removed.");
    }
    await prisma.payrollPeriod.delete({ where: { id: params.id } });
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

// ─── Compute payslips for a period ────────────────────────────────────
// Idempotent — re-running on a draft/computed period rebuilds every
// payslip from current source data. Refuses to run on released periods.
export const computePayrollPeriod = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const body = req.body as { periodId: string };
  if (!body.periodId) throw new ValidationError("INVALID REQUIRED ID");

  try {
    const period = await prisma.payrollPeriod.findUnique({
      where: { id: body.periodId },
    });
    if (!period) throw new NotFoundError("Period not found");
    if (period.status === "released") {
      throw new ValidationError("Released periods cannot be recomputed.");
    }

    // Employees in this line who have a salary grade attached. Users
    // without a salary grade are skipped — payslips need a basic salary.
    const employees = await prisma.user.findMany({
      where: { lineId: period.lineId, salaryGradeId: { not: null } },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        salaryGradeId: true,
        SalaryGrade: { select: { id: true, amount: true } },
      },
    });

    const totalWorkingDays = businessDaysBetween(
      period.periodStart,
      period.periodEnd,
    );

    // Wipe existing payslips for this period; we'll recreate them.
    await prisma.payslip.deleteMany({ where: { periodId: period.id } });

    let computed = 0;
    for (const emp of employees) {
      const basic = emp.SalaryGrade?.amount ?? 0;
      if (!basic) continue;

      // Leaves that overlap this period and are already approved.
      const leaves = await prisma.leave.findMany({
        where: {
          userId: emp.id,
          status: "approved",
          startDate: { lte: period.periodEnd },
          endDate: { gte: period.periodStart },
        },
      });
      let paidLeaveDays = 0;
      let unpaidLeaveDays = 0;
      for (const l of leaves) {
        const d = leaveDaysWithin(
          l.startDate,
          l.endDate,
          period.periodStart,
          period.periodEnd,
        );
        if (l.withPay) paidLeaveDays += d;
        else unpaidLeaveDays += d;
      }

      // Custom deductions: anything period-specific OR recurring.
      const deductions = await prisma.payrollDeduction.findMany({
        where: {
          userId: emp.id,
          OR: [{ periodId: period.id }, { recurring: true }],
        },
      });
      const otherDeductions = deductions.reduce(
        (a, d) => a + (d.amount || 0),
        0,
      );

      const slip = computePayslip({
        basicMonthly: basic,
        workingDays: totalWorkingDays,
        daysAbsent: 0, // attendance integration TBD
        paidLeaveDays,
        unpaidLeaveDays,
        otherDeductions,
      });

      await prisma.payslip.create({
        data: {
          userId: emp.id,
          periodId: period.id,
          lineId: period.lineId,
          salaryGradeId: emp.salaryGradeId,
          basicMonthly: basic,
          workingDays: totalWorkingDays,
          daysAbsent: 0,
          paidLeaveDays,
          unpaidLeaveDays,
          grossPay: slip.grossPay,
          sssEE: slip.sssEE,
          philhealthEE: slip.philhealthEE,
          pagibigEE: slip.pagibigEE,
          withholdingTax: slip.withholdingTax,
          otherDeductions: slip.otherDeductions,
          netPay: slip.netPay,
          breakdown: slip.breakdown,
          status: "computed",
        },
      });
      computed += 1;
    }

    await prisma.payrollPeriod.update({
      where: { id: period.id },
      data: { status: "computed", computedAt: new Date() },
    });

    return res.code(200).send({ message: "OK", computed });
  } catch (error) {
    if (error instanceof NotFoundError) throw error;
    if (error instanceof ValidationError) throw error;
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
    }
    throw error;
  }
};

export const releasePayrollPeriod = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const body = req.body as { periodId: string };
  if (!body.periodId) throw new ValidationError("INVALID REQUIRED ID");

  try {
    const period = await prisma.payrollPeriod.findUnique({
      where: { id: body.periodId },
    });
    if (!period) throw new NotFoundError("Period not found");
    if (period.status !== "computed") {
      throw new ValidationError(
        "Only computed periods can be released. Run compute first.",
      );
    }
    const now = new Date();
    await prisma.$transaction([
      prisma.payrollPeriod.update({
        where: { id: period.id },
        data: { status: "released", releasedAt: now },
      }),
      prisma.payslip.updateMany({
        where: { periodId: period.id },
        data: { status: "released", releasedAt: now },
      }),
    ]);
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

// ─── Payslip read endpoints ───────────────────────────────────────────
export const listPayslips = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const params = req.query as {
    periodId?: string;
    userId?: string;
    lineId?: string;
    lastCursor?: string | null;
    limit?: string;
  };
  if (!params.periodId && !params.userId) {
    throw new ValidationError("Provide periodId or userId");
  }
  try {
    const limit = params.limit ? parseInt(params.limit, 10) : 50;
    const cursor =
      params.lastCursor && params.lastCursor !== "null"
        ? { id: params.lastCursor }
        : undefined;
    const where: Prisma.PayslipWhereInput = {};
    if (params.periodId) where.periodId = params.periodId;
    if (params.userId) where.userId = params.userId;
    if (params.lineId) where.lineId = params.lineId;

    const rows = await prisma.payslip.findMany({
      where,
      take: limit,
      skip: cursor ? 1 : 0,
      cursor,
      orderBy: { computedAt: "desc" },
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            Position: { select: { name: true } },
          },
        },
        salaryGrade: { select: { grade: true, amount: true } },
        period: { select: { label: true, periodStart: true, periodEnd: true } },
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

export const getPayslip = async (req: FastifyRequest, res: FastifyReply) => {
  const params = req.query as { id: string };
  if (!params.id) throw new ValidationError("INVALID REQUIRED ID");
  try {
    const slip = await prisma.payslip.findUnique({
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
        salaryGrade: true,
        period: true,
      },
    });
    if (!slip) throw new NotFoundError("Payslip not found");
    return res.code(200).send(slip);
  } catch (error) {
    if (error instanceof NotFoundError) throw error;
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
    }
    throw error;
  }
};

// ─── Custom deductions ────────────────────────────────────────────────
export const listDeductions = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const params = req.query as { userId?: string; lineId?: string };
  try {
    const where: Prisma.PayrollDeductionWhereInput = {};
    if (params.userId) where.userId = params.userId;
    if (params.lineId) where.lineId = params.lineId;
    const rows = await prisma.payrollDeduction.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: {
        user: { select: { firstName: true, lastName: true } },
      },
    });
    return res.code(200).send({ list: rows });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
    }
    throw error;
  }
};

export const upsertDeduction = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const body = req.body as {
    id?: string;
    userId: string;
    lineId: string;
    label: string;
    amount: number;
    recurring?: boolean;
    periodId?: string;
  };
  if (!body.userId || !body.lineId || !body.label || typeof body.amount !== "number") {
    throw new ValidationError("INVALID REQUIRED FIELDS");
  }
  try {
    const row = body.id
      ? await prisma.payrollDeduction.update({
          where: { id: body.id },
          data: {
            label: body.label,
            amount: body.amount,
            recurring: !!body.recurring,
            periodId: body.periodId,
          },
        })
      : await prisma.payrollDeduction.create({
          data: {
            userId: body.userId,
            lineId: body.lineId,
            label: body.label,
            amount: body.amount,
            recurring: !!body.recurring,
            periodId: body.periodId,
          },
        });
    return res.code(200).send({ message: "OK", deduction: row });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
    }
    throw error;
  }
};

export const removeDeduction = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const params = req.query as { id: string };
  if (!params.id) throw new ValidationError("INVALID REQUIRED ID");
  try {
    await prisma.payrollDeduction.delete({ where: { id: params.id } });
    return res.code(200).send({ message: "OK" });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
    }
    throw error;
  }
};
