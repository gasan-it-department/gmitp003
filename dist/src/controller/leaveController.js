"use strict";
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
exports.listLineUsers = exports.listLeaveLedger = exports.adjustLeaveCredit = exports.listLeaveCredits = exports.cancelLeave = exports.decideLeave = exports.listLeaves = exports.applyLeave = exports.leaveCatalogue = exports.LEAVE_CATALOGUE = void 0;
const prisma_1 = require("../barrel/prisma");
const errors_1 = require("../errors/errors");
// ─── Catalogue ────────────────────────────────────────────────────────
// Defaults follow CSC's mandatory minimums for regular gov employees.
exports.LEAVE_CATALOGUE = [
    { key: "vacation", label: "Vacation Leave", withPay: true, defaultCredits: 15 },
    { key: "sick", label: "Sick Leave", withPay: true, defaultCredits: 15 },
    { key: "mandatory", label: "Mandatory/Forced Leave", withPay: true, defaultCredits: 5 },
    { key: "maternity", label: "Maternity Leave", withPay: true, defaultCredits: 105 },
    { key: "paternity", label: "Paternity Leave", withPay: true, defaultCredits: 7 },
    { key: "soloParent", label: "Solo Parent Leave", withPay: true, defaultCredits: 7 },
    { key: "specialPrivilege", label: "Special Privilege Leave", withPay: true, defaultCredits: 3 },
    { key: "bereavement", label: "Bereavement Leave", withPay: true, defaultCredits: 5 },
    { key: "emergency", label: "Emergency Leave", withPay: true, defaultCredits: 3 },
    { key: "others", label: "Others (Unpaid)", withPay: false, defaultCredits: 0 },
];
const catalogueByKey = new Map(exports.LEAVE_CATALOGUE.map((c) => [c.key, c]));
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
            days += 1; // skip Sat/Sun
    }
    return days;
};
// Get-or-create the credit row for a (user, category, year). Lazily seeds
// the default accrual the first time the user's bucket is touched.
const ensureCredit = (tx, userId, lineId, category, year) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    const existing = yield tx.leaveCredit.findUnique({
        where: { userId_category_year: { userId, category, year } },
    });
    if (existing)
        return existing;
    const seed = (_b = (_a = catalogueByKey.get(category)) === null || _a === void 0 ? void 0 : _a.defaultCredits) !== null && _b !== void 0 ? _b : 0;
    const created = yield tx.leaveCredit.create({
        data: {
            userId,
            lineId: lineId !== null && lineId !== void 0 ? lineId : null,
            category,
            year,
            accrued: seed,
            used: 0,
            balance: seed,
        },
    });
    if (seed > 0) {
        yield tx.leaveLedger.create({
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
});
// ─── Catalogue endpoint ───────────────────────────────────────────────
const leaveCatalogue = (_req, res) => __awaiter(void 0, void 0, void 0, function* () { return res.code(200).send({ list: exports.LEAVE_CATALOGUE }); });
exports.leaveCatalogue = leaveCatalogue;
// ─── Apply for leave ──────────────────────────────────────────────────
const applyLeave = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c;
    const body = req.body;
    if (!body.userId || !body.category || !body.startDate || !body.endDate) {
        throw new errors_1.ValidationError("INVALID REQUIRED FIELDS");
    }
    const start = new Date(body.startDate);
    const end = new Date(body.endDate);
    if (isNaN(start.getTime()) || isNaN(end.getTime()) || end < start) {
        throw new errors_1.ValidationError("INVALID DATE RANGE");
    }
    const days = businessDaysBetween(start, end);
    if (days <= 0) {
        throw new errors_1.ValidationError("RANGE COVERS NO BUSINESS DAYS");
    }
    const cat = catalogueByKey.get(body.category);
    const withPay = (_b = (_a = body.withPay) !== null && _a !== void 0 ? _a : cat === null || cat === void 0 ? void 0 : cat.withPay) !== null && _b !== void 0 ? _b : true;
    try {
        const created = yield prisma_1.prisma.leave.create({
            data: {
                userId: body.userId,
                lineId: (_c = body.lineId) !== null && _c !== void 0 ? _c : null,
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
    }
    catch (error) {
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw (0, errors_1.dbError)(error);
        }
        throw error;
    }
});
exports.applyLeave = applyLeave;
// ─── List leaves (mine, or for HR across a line) ──────────────────────
const listLeaves = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const params = req.query;
    try {
        const limit = params.limit ? parseInt(params.limit, 10) : 20;
        const cursor = params.lastCursor && params.lastCursor !== "null"
            ? { id: params.lastCursor }
            : undefined;
        const where = {};
        if (params.userId)
            where.userId = params.userId;
        if (params.lineId)
            where.lineId = params.lineId;
        if (params.status && params.status !== "all")
            where.status = params.status;
        if (params.category && params.category !== "all") {
            where.category = params.category;
        }
        const rows = yield prisma_1.prisma.leave.findMany({
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
    }
    catch (error) {
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw (0, errors_1.dbError)(error);
        }
        throw error;
    }
});
exports.listLeaves = listLeaves;
// ─── Decide on a leave (approve / deny) ───────────────────────────────
// When approving a paid leave, debit the user's credit bucket atomically.
// When denying / cancelling an already-approved leave, refund the bucket.
const decideLeave = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const body = req.body;
    if (!body.leaveId || !body.approverId || !body.decision) {
        throw new errors_1.ValidationError("INVALID REQUIRED FIELDS");
    }
    if (body.decision !== "approved" && body.decision !== "denied") {
        throw new errors_1.ValidationError("INVALID DECISION");
    }
    try {
        const updated = yield prisma_1.prisma.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            const leave = yield tx.leave.findUnique({ where: { id: body.leaveId } });
            if (!leave)
                throw new errors_1.NotFoundError("Leave not found");
            if (leave.status !== "pending") {
                throw new errors_1.ValidationError(`Already ${leave.status} — only pending leaves can be decided.`);
            }
            // If approving a paid leave, debit the credit bucket.
            if (body.decision === "approved" && leave.withPay) {
                const year = leave.startDate.getFullYear();
                const credit = yield ensureCredit(tx, leave.userId, leave.lineId, leave.category, year);
                if (credit.balance < leave.days) {
                    throw new errors_1.ValidationError(`Insufficient ${leave.category} credits — balance ${credit.balance}, requested ${leave.days}.`);
                }
                yield tx.leaveCredit.update({
                    where: { id: credit.id },
                    data: {
                        used: { increment: leave.days },
                        balance: { decrement: leave.days },
                    },
                });
                yield tx.leaveLedger.create({
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
        }));
        return res.code(200).send({ message: "OK", leave: updated });
    }
    catch (error) {
        if (error instanceof errors_1.NotFoundError)
            throw error;
        if (error instanceof errors_1.ValidationError)
            throw error;
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw (0, errors_1.dbError)(error);
        }
        throw error;
    }
});
exports.decideLeave = decideLeave;
// Employee-initiated cancel (only while pending). Approved leaves should
// be voided via decideLeave with a separate "refund" path if needed.
const cancelLeave = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const body = req.body;
    if (!body.leaveId || !body.userId) {
        throw new errors_1.ValidationError("INVALID REQUIRED FIELDS");
    }
    try {
        const leave = yield prisma_1.prisma.leave.findUnique({
            where: { id: body.leaveId },
        });
        if (!leave)
            throw new errors_1.NotFoundError("Leave not found");
        if (leave.userId !== body.userId) {
            throw new errors_1.ValidationError("Cannot cancel another user's leave.");
        }
        if (leave.status !== "pending") {
            throw new errors_1.ValidationError("Only pending leaves can be cancelled.");
        }
        yield prisma_1.prisma.leave.update({
            where: { id: leave.id },
            data: { status: "cancelled" },
        });
        return res.code(200).send({ message: "OK" });
    }
    catch (error) {
        if (error instanceof errors_1.NotFoundError)
            throw error;
        if (error instanceof errors_1.ValidationError)
            throw error;
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw (0, errors_1.dbError)(error);
        }
        throw error;
    }
});
exports.cancelLeave = cancelLeave;
// ─── Credits view ─────────────────────────────────────────────────────
// Returns the current year's bucket for every catalogue category for a
// user, seeding rows on demand.
const listLeaveCredits = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const params = req.query;
    if (!params.userId)
        throw new errors_1.ValidationError("INVALID REQUIRED ID");
    const year = params.year ? parseInt(params.year, 10) : new Date().getFullYear();
    try {
        const credits = yield prisma_1.prisma.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            const out = [];
            for (const c of exports.LEAVE_CATALOGUE) {
                const row = yield ensureCredit(tx, params.userId, null, c.key, year);
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
        }));
        return res.code(200).send({ year, list: credits });
    }
    catch (error) {
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw (0, errors_1.dbError)(error);
        }
        throw error;
    }
});
exports.listLeaveCredits = listLeaveCredits;
// HR adjustment — credit or debit a bucket with an audit note.
const adjustLeaveCredit = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    const body = req.body;
    if (!body.userId ||
        !body.category ||
        typeof body.delta !== "number" ||
        !body.byUserId) {
        throw new errors_1.ValidationError("INVALID REQUIRED FIELDS");
    }
    try {
        const year = (_a = body.year) !== null && _a !== void 0 ? _a : new Date().getFullYear();
        yield prisma_1.prisma.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            const credit = yield ensureCredit(tx, body.userId, null, body.category, year);
            const newBalance = credit.balance + body.delta;
            if (newBalance < 0) {
                throw new errors_1.ValidationError("Adjustment would make balance negative.");
            }
            yield tx.leaveCredit.update({
                where: { id: credit.id },
                data: {
                    balance: newBalance,
                    accrued: body.delta > 0 ? { increment: body.delta } : credit.accrued,
                    used: body.delta < 0 ? { increment: -body.delta } : credit.used,
                },
            });
            yield tx.leaveLedger.create({
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
        }));
        return res.code(200).send({ message: "OK" });
    }
    catch (error) {
        if (error instanceof errors_1.ValidationError)
            throw error;
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw (0, errors_1.dbError)(error);
        }
        throw error;
    }
});
exports.adjustLeaveCredit = adjustLeaveCredit;
// Per-user audit trail of credit movements.
const listLeaveLedger = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const params = req.query;
    if (!params.userId)
        throw new errors_1.ValidationError("INVALID REQUIRED ID");
    const year = params.year ? parseInt(params.year, 10) : new Date().getFullYear();
    try {
        const rows = yield prisma_1.prisma.leaveLedger.findMany({
            where: { userId: params.userId, year },
            orderBy: { at: "desc" },
            include: {
                by: { select: { id: true, firstName: true, lastName: true } },
                leave: { select: { id: true, category: true } },
            },
        });
        return res.code(200).send({ year, list: rows });
    }
    catch (error) {
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw (0, errors_1.dbError)(error);
        }
        throw error;
    }
});
exports.listLeaveLedger = listLeaveLedger;
// ─── Line users picker (employee search for HR actions) ──────────────
const listLineUsers = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    const params = req.query;
    if (!params.lineId)
        throw new errors_1.ValidationError("INVALID REQUIRED ID");
    try {
        const where = { lineId: params.lineId };
        if ((_a = params.query) === null || _a === void 0 ? void 0 : _a.trim()) {
            const q = params.query.trim();
            where.OR = [
                { firstName: { contains: q, mode: "insensitive" } },
                { lastName: { contains: q, mode: "insensitive" } },
                { username: { contains: q, mode: "insensitive" } },
            ];
        }
        const rows = yield prisma_1.prisma.user.findMany({
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
    }
    catch (error) {
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw (0, errors_1.dbError)(error);
        }
        throw error;
    }
});
exports.listLineUsers = listLineUsers;
