"use strict";
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
exports.salaryGradeUsers = exports.salaryGradeHistory = exports.salaryGradeInfo = exports.updateSalaryGrade = exports.saveNewSalaryGrade = exports.salaryGradeList = void 0;
const prisma_1 = require("../barrel/prisma");
//
const errors_1 = require("../errors/errors");
const salaryGradeList = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { lastCursor, limit, id } = req.query;
    if (!id)
        throw new errors_1.ValidationError("BAD_REQUEST");
    try {
        const cursor = lastCursor ? { id: lastCursor } : undefined;
        const take = limit ? parseInt(limit, 10) : 10;
        const response = yield prisma_1.prisma.salaryGrade.findMany({
            where: {
                lineId: id,
            },
            cursor,
            take: take,
            skip: cursor ? 1 : 0,
            orderBy: {
                grade: "asc",
            },
            include: {
                _count: {
                    select: {
                        SalaryGradeHistory: true,
                        users: true,
                    },
                },
            },
        });
        const newLastCursor = response.length > 0 ? response[response.length - 1].id : null;
        const hasMore = response.length === take;
        return res
            .code(200)
            .send({ list: response, lastCursor: newLastCursor, hasMore });
    }
    catch (error) {
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw (0, errors_1.dbError)(error);
        }
        throw error;
    }
});
exports.salaryGradeList = salaryGradeList;
const saveNewSalaryGrade = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const response = yield prisma_1.prisma.salaryGrade.createMany({
            data: Array.from({ length: 33 }).map((_, i) => ({
                grade: i + 1,
                amount: 2.1,
                lineId: "c039c8fd-8058-4e07-820e-7a3f36dc108d",
            })),
            skipDuplicates: true,
        });
        return res.code(200).send({ message: "OK" });
    }
    catch (error) {
        console.log(error);
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw (0, errors_1.dbError)(error);
        }
        throw error;
    }
});
exports.saveNewSalaryGrade = saveNewSalaryGrade;
const updateSalaryGrade = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const body = req.body;
    if (!body.id || !body.amount || !body.lineId || !body.userId) {
        throw new errors_1.ValidationError("BAD_REQUEST");
    }
    try {
        const response = yield prisma_1.prisma.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            const updatedSalaryGrade = yield tx.salaryGrade.update({
                data: {
                    amount: body.amount,
                },
                where: {
                    id: body.id,
                },
            });
            yield tx.salaryGradeHistory.create({
                data: {
                    salaryGradeId: body.id,
                    amount: body.amount,
                    // Record *who* changed the value so the history tab can attribute
                    // each adjustment (previously stored an empty string).
                    userId: body.userId,
                    effectiveDate: new Date(),
                },
            });
            yield tx.humanResourcesLogs.create({
                data: {
                    action: `Updated Salary Grade ${updatedSalaryGrade.grade} to ${updatedSalaryGrade.amount}`,
                    lineId: updatedSalaryGrade.lineId,
                    desc: `Salary Grade ${updatedSalaryGrade.grade} amount updated to ${updatedSalaryGrade.amount}`,
                    userId: body.userId,
                },
            });
            return true;
        }));
        if (!response) {
            throw new errors_1.ValidationError("TRANSACTION FAILED");
        }
        return res.code(200).send({
            message: "OK",
        });
    }
    catch (error) {
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw (0, errors_1.dbError)(error);
        }
        throw error;
    }
});
exports.updateSalaryGrade = updateSalaryGrade;
/**
 * Summary for a single salary grade — powers the detail page header
 * (grade, current amount, when it was created, and how many users /
 * history entries it has).
 */
const salaryGradeInfo = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { id } = req.query;
    if (!id)
        throw new errors_1.ValidationError("BAD_REQUEST");
    try {
        const sg = yield prisma_1.prisma.salaryGrade.findUnique({
            where: { id },
            select: {
                id: true,
                grade: true,
                amount: true,
                createdAt: true,
                lineId: true,
                _count: { select: { users: true, SalaryGradeHistory: true } },
            },
        });
        if (!sg)
            throw new errors_1.ValidationError("Salary grade not found");
        return res.code(200).send(sg);
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
exports.salaryGradeInfo = salaryGradeInfo;
/**
 * Paginated value-change history for a salary grade (newest first).
 * Each row is attributed to the HR user who made the change.
 */
const salaryGradeHistory = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { id, lastCursor, limit } = req.query;
    if (!id)
        throw new errors_1.ValidationError("BAD_REQUEST");
    try {
        const cursor = lastCursor ? { id: lastCursor } : undefined;
        const take = limit ? parseInt(limit, 10) : 20;
        const rows = yield prisma_1.prisma.salaryGradeHistory.findMany({
            where: { salaryGradeId: id },
            cursor,
            take,
            skip: cursor ? 1 : 0,
            orderBy: { createdAt: "desc" },
            select: {
                id: true,
                amount: true,
                effectiveDate: true,
                createdAt: true,
                userId: true,
            },
        });
        // Attach the name of whoever made each change (no FK relation exists on
        // SalaryGradeHistory.userId, so resolve them in a single batched query).
        const userIds = [...new Set(rows.map((r) => r.userId).filter(Boolean))];
        const users = userIds.length
            ? yield prisma_1.prisma.user.findMany({
                where: { id: { in: userIds } },
                select: { id: true, firstName: true, lastName: true, username: true },
            })
            : [];
        const byId = new Map(users.map((u) => [u.id, u]));
        const list = rows.map((r) => {
            var _a;
            return (Object.assign(Object.assign({}, r), { changedBy: (_a = byId.get(r.userId)) !== null && _a !== void 0 ? _a : null }));
        });
        const newLastCursor = rows.length ? rows[rows.length - 1].id : null;
        const hasMore = rows.length === take;
        return res
            .code(200)
            .send({ list, lastCursor: newLastCursor, hasMore });
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
exports.salaryGradeHistory = salaryGradeHistory;
/**
 * Paginated list of users currently assigned to a salary grade, with an
 * optional name/username search.
 */
const salaryGradeUsers = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { id, lastCursor, limit, query } = req.query;
    if (!id)
        throw new errors_1.ValidationError("BAD_REQUEST");
    try {
        const cursor = lastCursor ? { id: lastCursor } : undefined;
        const take = limit ? parseInt(limit, 10) : 20;
        const where = Object.assign({ salaryGradeId: id }, (query && query.trim()
            ? {
                OR: [
                    { firstName: { contains: query, mode: "insensitive" } },
                    { lastName: { contains: query, mode: "insensitive" } },
                    { username: { contains: query, mode: "insensitive" } },
                ],
            }
            : {}));
        const rows = yield prisma_1.prisma.user.findMany({
            where,
            cursor,
            take,
            skip: cursor ? 1 : 0,
            orderBy: { firstName: "asc" },
            select: {
                id: true,
                firstName: true,
                lastName: true,
                username: true,
                profilePicture: true,
                Position: { select: { name: true } },
                department: { select: { name: true } },
            },
        });
        const newLastCursor = rows.length ? rows[rows.length - 1].id : null;
        const hasMore = rows.length === take;
        return res
            .code(200)
            .send({ list: rows, lastCursor: newLastCursor, hasMore });
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
exports.salaryGradeUsers = salaryGradeUsers;
