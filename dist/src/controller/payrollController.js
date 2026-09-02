"use strict";
// Payroll period management + payslip computation.
//
// Lifecycle: a period starts as "draft" with no payslips. The HR officer
// triggers `computePayrollPeriod` which iterates over every employee in
// the line, pulls their basic salary (from SalaryGrade) + leave activity
// within the window + any custom deductions, applies the PH calculators
// (`utils/phPayroll`), and upserts one `Payslip` per user. Status flips
// to "computed". A final `releasePayrollPeriod` flips to "released" and
// stamps `releasedAt` on every payslip.
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.removeDeduction = exports.upsertDeduction = exports.listDeductions = exports.getPayslip = exports.listPayslips = exports.releasePayrollPeriod = exports.computePayrollPeriod = exports.removePayrollPeriod = exports.createPayrollPeriod = exports.listPayrollPeriods = void 0;
const prisma_1 = require("../barrel/prisma");
const errors_1 = require("../errors/errors");
const phPayroll_1 = require("../utils/phPayroll");
const businessDaysBetween = (start, end) => {
    const s = new Date(start);
    s.setHours(0, 0, 0, 0);
    const e = new Date(end);
    e.setHours(0, 0, 0, 0);
    if (e < s)
        return 0;
    let days = 0;
    for (let d = new Date(s); d.getTime() <= e.getTime(); d.setDate(d.getDate() + 1)) {
        const dow = d.getDay();
        if (dow !== 0 && dow !== 6)
            days += 1;
    }
    return days;
};
// Sum the business-day overlap between a leave and a period window.
const leaveDaysWithin = (leaveStart, leaveEnd, periodStart, periodEnd) => {
    const start = leaveStart > periodStart ? leaveStart : periodStart;
    const end = leaveEnd < periodEnd ? leaveEnd : periodEnd;
    if (end < start)
        return 0;
    return businessDaysBetween(start, end);
};
// ─── Periods ──────────────────────────────────────────────────────────
const listPayrollPeriods = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const params = req.query;
    if (!params.lineId)
        throw new errors_1.ValidationError("INVALID REQUIRED ID");
    try {
        const limit = params.limit ? parseInt(params.limit, 10) : 20;
        const cursor = params.lastCursor && params.lastCursor !== "null"
            ? { id: params.lastCursor }
            : undefined;
        const where = { lineId: params.lineId };
        if (params.status && params.status !== "all")
            where.status = params.status;
        const rows = yield prisma_1.prisma.payrollPeriod.findMany({
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
    }
    catch (error) {
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw new errors_1.AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
        }
        throw error;
    }
});
exports.listPayrollPeriods = listPayrollPeriods;
const createPayrollPeriod = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const body = req.body;
    if (!body.lineId || !body.label || !body.periodStart || !body.periodEnd) {
        throw new errors_1.ValidationError("INVALID REQUIRED FIELDS");
    }
    const start = new Date(body.periodStart);
    const end = new Date(body.periodEnd);
    if (isNaN(start.getTime()) || isNaN(end.getTime()) || end < start) {
        throw new errors_1.ValidationError("INVALID DATE RANGE");
    }
    try {
        const created = yield prisma_1.prisma.payrollPeriod.create({
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
    }
    catch (error) {
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw new errors_1.AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
        }
        throw error;
    }
});
exports.createPayrollPeriod = createPayrollPeriod;
const removePayrollPeriod = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const params = req.query;
    if (!params.id)
        throw new errors_1.ValidationError("INVALID REQUIRED ID");
    try {
        const period = yield prisma_1.prisma.payrollPeriod.findUnique({
            where: { id: params.id },
        });
        if (!period)
            throw new errors_1.NotFoundError("Period not found");
        if (period.status === "released") {
            throw new errors_1.ValidationError("Released periods cannot be removed.");
        }
        yield prisma_1.prisma.payrollPeriod.delete({ where: { id: params.id } });
        return res.code(200).send({ message: "OK" });
    }
    catch (error) {
        if (error instanceof errors_1.NotFoundError)
            throw error;
        if (error instanceof errors_1.ValidationError)
            throw error;
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw new errors_1.AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
        }
        throw error;
    }
});
exports.removePayrollPeriod = removePayrollPeriod;
// ─── Compute payslips for a period ────────────────────────────────────
// Idempotent — re-running on a draft/computed period rebuilds every
// payslip from current source data. Refuses to run on released periods.
const computePayrollPeriod = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    const body = req.body;
    if (!body.periodId)
        throw new errors_1.ValidationError("INVALID REQUIRED ID");
    try {
        const period = yield prisma_1.prisma.payrollPeriod.findUnique({
            where: { id: body.periodId },
        });
        if (!period)
            throw new errors_1.NotFoundError("Period not found");
        if (period.status === "released") {
            throw new errors_1.ValidationError("Released periods cannot be recomputed.");
        }
        // Employees in this line who have a salary grade attached. Users
        // without a salary grade are skipped — payslips need a basic salary.
        const employees = yield prisma_1.prisma.user.findMany({
            where: { lineId: period.lineId, salaryGradeId: { not: null } },
            select: {
                id: true,
                firstName: true,
                lastName: true,
                salaryGradeId: true,
                SalaryGrade: { select: { id: true, amount: true } },
            },
        });
        const totalWorkingDays = businessDaysBetween(period.periodStart, period.periodEnd);
        // Wipe existing payslips for this period; we'll recreate them.
        yield prisma_1.prisma.payslip.deleteMany({ where: { periodId: period.id } });
        let computed = 0;
        for (const emp of employees) {
            const basic = (_b = (_a = emp.SalaryGrade) === null || _a === void 0 ? void 0 : _a.amount) !== null && _b !== void 0 ? _b : 0;
            if (!basic)
                continue;
            // Leaves that overlap this period and are already approved.
            const leaves = yield prisma_1.prisma.leave.findMany({
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
                const d = leaveDaysWithin(l.startDate, l.endDate, period.periodStart, period.periodEnd);
                if (l.withPay)
                    paidLeaveDays += d;
                else
                    unpaidLeaveDays += d;
            }
            // Custom deductions: anything period-specific OR recurring.
            const deductions = yield prisma_1.prisma.payrollDeduction.findMany({
                where: {
                    userId: emp.id,
                    OR: [{ periodId: period.id }, { recurring: true }],
                },
            });
            const otherDeductions = deductions.reduce((a, d) => a + (d.amount || 0), 0);
            const slip = (0, phPayroll_1.computePayslip)({
                basicMonthly: basic,
                workingDays: totalWorkingDays,
                daysAbsent: 0, // attendance integration TBD
                paidLeaveDays,
                unpaidLeaveDays,
                otherDeductions,
            });
            yield prisma_1.prisma.payslip.create({
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
        yield prisma_1.prisma.payrollPeriod.update({
            where: { id: period.id },
            data: { status: "computed", computedAt: new Date() },
        });
        return res.code(200).send({ message: "OK", computed });
    }
    catch (error) {
        if (error instanceof errors_1.NotFoundError)
            throw error;
        if (error instanceof errors_1.ValidationError)
            throw error;
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw new errors_1.AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
        }
        throw error;
    }
});
exports.computePayrollPeriod = computePayrollPeriod;
const releasePayrollPeriod = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const body = req.body;
    if (!body.periodId)
        throw new errors_1.ValidationError("INVALID REQUIRED ID");
    try {
        const period = yield prisma_1.prisma.payrollPeriod.findUnique({
            where: { id: body.periodId },
        });
        if (!period)
            throw new errors_1.NotFoundError("Period not found");
        if (period.status !== "computed") {
            throw new errors_1.ValidationError("Only computed periods can be released. Run compute first.");
        }
        const now = new Date();
        yield prisma_1.prisma.$transaction([
            prisma_1.prisma.payrollPeriod.update({
                where: { id: period.id },
                data: { status: "released", releasedAt: now },
            }),
            prisma_1.prisma.payslip.updateMany({
                where: { periodId: period.id },
                data: { status: "released", releasedAt: now },
            }),
        ]);
        return res.code(200).send({ message: "OK" });
    }
    catch (error) {
        if (error instanceof errors_1.NotFoundError)
            throw error;
        if (error instanceof errors_1.ValidationError)
            throw error;
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw new errors_1.AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
        }
        throw error;
    }
});
exports.releasePayrollPeriod = releasePayrollPeriod;
// ─── Payslip read endpoints ───────────────────────────────────────────
const listPayslips = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const params = req.query;
    if (!params.periodId && !params.userId) {
        throw new errors_1.ValidationError("Provide periodId or userId");
    }
    try {
        const limit = params.limit ? parseInt(params.limit, 10) : 50;
        const cursor = params.lastCursor && params.lastCursor !== "null"
            ? { id: params.lastCursor }
            : undefined;
        const where = {};
        if (params.periodId)
            where.periodId = params.periodId;
        if (params.userId)
            where.userId = params.userId;
        if (params.lineId)
            where.lineId = params.lineId;
        const rows = yield prisma_1.prisma.payslip.findMany({
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
    }
    catch (error) {
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw new errors_1.AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
        }
        throw error;
    }
});
exports.listPayslips = listPayslips;
const getPayslip = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const params = req.query;
    if (!params.id)
        throw new errors_1.ValidationError("INVALID REQUIRED ID");
    try {
        const slip = yield prisma_1.prisma.payslip.findUnique({
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
        if (!slip)
            throw new errors_1.NotFoundError("Payslip not found");
        return res.code(200).send(slip);
    }
    catch (error) {
        if (error instanceof errors_1.NotFoundError)
            throw error;
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw new errors_1.AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
        }
        throw error;
    }
});
exports.getPayslip = getPayslip;
// ─── Custom deductions ────────────────────────────────────────────────
const listDeductions = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const params = req.query;
    try {
        const where = {};
        if (params.userId)
            where.userId = params.userId;
        if (params.lineId)
            where.lineId = params.lineId;
        const rows = yield prisma_1.prisma.payrollDeduction.findMany({
            where,
            orderBy: { createdAt: "desc" },
            include: {
                user: { select: { firstName: true, lastName: true } },
            },
        });
        return res.code(200).send({ list: rows });
    }
    catch (error) {
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw new errors_1.AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
        }
        throw error;
    }
});
exports.listDeductions = listDeductions;
const upsertDeduction = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const body = req.body;
    if (!body.userId || !body.lineId || !body.label || typeof body.amount !== "number") {
        throw new errors_1.ValidationError("INVALID REQUIRED FIELDS");
    }
    try {
        const row = body.id
            ? yield prisma_1.prisma.payrollDeduction.update({
                where: { id: body.id },
                data: {
                    label: body.label,
                    amount: body.amount,
                    recurring: !!body.recurring,
                    periodId: body.periodId,
                },
            })
            : yield prisma_1.prisma.payrollDeduction.create({
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
    }
    catch (error) {
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw new errors_1.AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
        }
        throw error;
    }
});
exports.upsertDeduction = upsertDeduction;
const removeDeduction = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const params = req.query;
    if (!params.id)
        throw new errors_1.ValidationError("INVALID REQUIRED ID");
    try {
        yield prisma_1.prisma.payrollDeduction.delete({ where: { id: params.id } });
        return res.code(200).send({ message: "OK" });
    }
    catch (error) {
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw new errors_1.AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
        }
        throw error;
    }
});
exports.removeDeduction = removeDeduction;
