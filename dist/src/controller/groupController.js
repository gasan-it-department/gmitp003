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
exports.deleteUnit = exports.unitInfo = exports.updateGroup = exports.createGroup = exports.groupList = void 0;
const prisma_1 = require("../barrel/prisma");
const errors_1 = require("../errors/errors");
/**
 * Paginated list of departments (a.k.a. units) for a line.
 *
 * Each row is annotated with `_count.users` so the list page can show
 * a member count without an extra round-trip per row.
 */
const groupList = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const params = req.query;
    if (!params.id)
        throw new errors_1.ValidationError("INVALID_REQUEST");
    try {
        const cursor = params.lastCursor ? { id: params.lastCursor } : undefined;
        const limit = params.limit ? parseInt(params.limit, 10) : 20;
        const where = { lineId: params.id };
        if (params.query && params.query.trim()) {
            const q = params.query.trim();
            where.OR = [
                { name: { contains: q, mode: "insensitive" } },
                { idCode: { contains: q, mode: "insensitive" } },
            ];
        }
        const groups = yield prisma_1.prisma.department.findMany({
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
        const newLastCursorId = groups.length > 0 ? groups[groups.length - 1].id : null;
        const hasMore = groups.length === limit;
        return res
            .code(200)
            .send({ list: groups, lastCursor: newLastCursorId, hasMore });
    }
    catch (error) {
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw (0, errors_1.dbError)(error);
        }
        throw error;
    }
});
exports.groupList = groupList;
/**
 * Create a new department under a line.
 *
 * Refuses duplicates (case-insensitive) within the same line.
 */
const createGroup = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    try {
        const body = req.body;
        if (!body || !body.lineId)
            throw new errors_1.ValidationError("INVALID_REQUEST");
        const name = (_a = body.title) === null || _a === void 0 ? void 0 : _a.trim();
        if (!name)
            throw new errors_1.ValidationError("Unit name is required.");
        if (name.length > 120)
            throw new errors_1.ValidationError("Unit name is too long (max 120 chars).");
        const existing = yield prisma_1.prisma.department.findFirst({
            where: {
                name: { equals: name, mode: "insensitive" },
                lineId: body.lineId,
            },
            select: { id: true },
        });
        if (existing) {
            throw new errors_1.ValidationError("A unit with this name already exists in this line.");
        }
        const created = yield prisma_1.prisma.department.create({
            data: {
                name,
                description: ((_b = body.description) === null || _b === void 0 ? void 0 : _b.trim()) || null,
                lineId: body.lineId,
            },
        });
        // Audit is best-effort and deliberately OUTSIDE the transaction: a bad
        // userId (its column is a User FK) used to roll the whole unit back and
        // surface as an opaque 500, so an audit row could veto real work.
        try {
            yield prisma_1.prisma.humanResourcesLogs.create({
                data: {
                    action: "CREATED UNIT",
                    lineId: body.lineId,
                    userId: body.userId,
                    desc: `Created new unit: ${created.name}`,
                },
            });
        }
        catch (e) {
            console.warn("[createGroup] audit log skipped:", e);
        }
        return res.code(200).send({ message: "OK", id: created.id });
    }
    catch (error) {
        if (error instanceof errors_1.ValidationError)
            throw error;
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            // Keep the Prisma code — "DB_CONNECTION_EROR" told us nothing while
            // this was actually a foreign-key violation.
            console.error("[createGroup] prisma error", error.code, error.meta);
            if (error.code === "P2002")
                throw new errors_1.ValidationError("A unit with this name already exists in this line.");
            if (error.code === "P2003")
                throw new errors_1.ValidationError("Couldn't record this unit against your account. Sign in again and retry.");
            throw new errors_1.AppError(`DB_ERROR (${error.code})`, 500, "DB_FAILED");
        }
        throw error;
    }
});
exports.createGroup = createGroup;
/**
 * Patch a department's editable fields (name, description).
 * Refuses to collide with another unit in the same line.
 */
const updateGroup = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    const body = req.body;
    if (!body.id || !body.lineId)
        throw new errors_1.ValidationError("INVALID_REQUEST");
    try {
        const existing = yield prisma_1.prisma.department.findUnique({
            where: { id: body.id },
        });
        if (!existing)
            throw new errors_1.NotFoundError("UNIT_NOT_FOUND");
        const data = {};
        if (typeof body.name === "string") {
            const next = body.name.trim();
            if (!next)
                throw new errors_1.ValidationError("Name cannot be empty.");
            if (next.toLowerCase() !== ((_a = existing.name) !== null && _a !== void 0 ? _a : "").toLowerCase()) {
                const clash = yield prisma_1.prisma.department.findFirst({
                    where: {
                        name: { equals: next, mode: "insensitive" },
                        lineId: body.lineId,
                        id: { not: body.id },
                    },
                    select: { id: true },
                });
                if (clash) {
                    throw new errors_1.ValidationError("Another unit in this line already uses that name.");
                }
            }
            data.name = next;
        }
        if (body.description !== undefined) {
            data.description = ((_b = body.description) === null || _b === void 0 ? void 0 : _b.toString().trim()) || null;
        }
        const updated = yield prisma_1.prisma.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            var _a, _b;
            const row = yield tx.department.update({
                where: { id: body.id },
                data,
            });
            yield tx.humanResourcesLogs.create({
                data: {
                    action: "UPDATED UNIT",
                    userId: body.userId,
                    lineId: body.lineId,
                    desc: `Updated unit ${(_a = existing.name) !== null && _a !== void 0 ? _a : ""} → ${(_b = row.name) !== null && _b !== void 0 ? _b : ""}`,
                },
            });
            return row;
        }));
        return res.code(200).send({ message: "OK", id: updated.id });
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
exports.updateGroup = updateGroup;
const unitInfo = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const params = req.query;
    if (!params.id)
        throw new errors_1.ValidationError("INVALID_REQUEST");
    try {
        const unit = yield prisma_1.prisma.department.findUnique({
            where: { id: params.id },
            include: {
                _count: { select: { users: true } },
                head: {
                    select: { id: true, firstName: true, lastName: true, email: true },
                },
                line: { select: { id: true, name: true } },
            },
        });
        if (!unit)
            throw new errors_1.NotFoundError("UNIT_NOT_FOUND");
        return res.code(200).send(unit);
    }
    catch (error) {
        if (error instanceof errors_1.NotFoundError)
            throw error;
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw (0, errors_1.dbError)(error);
        }
        throw error;
    }
});
exports.unitInfo = unitInfo;
/**
 * Hard-delete a department.
 *
 * Refuses to delete a unit that still has users assigned to it — the
 * cascade would orphan or null out user.departmentId across the board.
 */
const deleteUnit = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    const params = req.query;
    if (!params.id || !params.lineId || !params.userId) {
        throw new errors_1.ValidationError("INVALID REQUIRED ID");
    }
    try {
        const unit = yield prisma_1.prisma.department.findUnique({
            where: { id: params.id },
            include: { _count: { select: { users: true } } },
        });
        if (!unit)
            throw new errors_1.NotFoundError("UNIT_NOT_FOUND");
        if (((_b = (_a = unit._count) === null || _a === void 0 ? void 0 : _a.users) !== null && _b !== void 0 ? _b : 0) > 0) {
            throw new errors_1.ValidationError(`This unit still has ${unit._count.users} user${unit._count.users === 1 ? "" : "s"} assigned. Reassign them first.`);
        }
        yield prisma_1.prisma.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            var _a;
            yield tx.department.delete({ where: { id: params.id } });
            yield tx.humanResourcesLogs.create({
                data: {
                    userId: params.userId,
                    lineId: params.lineId,
                    action: "REMOVE",
                    desc: `REMOVE UNIT: ${(_a = unit.name) !== null && _a !== void 0 ? _a : ""}`,
                },
            });
        }));
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
exports.deleteUnit = deleteUnit;
