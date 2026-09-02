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
exports.myMobileAccess = exports.revokeMobileAccess = exports.grantMobileAccess = exports.mobileAccessCandidates = exports.listMobileAccess = void 0;
const prisma_1 = require("../barrel/prisma");
const errors_1 = require("../errors/errors");
/**
 * "Mobile Access" for the Pharmacy module (web Medicine > Config > Mobile Access
 * tab). Grants/revokes a user's line-wide access to the MOBILE pharmacy features
 * (scanner + add-stock + sync). Enforced server-side by `pharmacyMobileAuth`
 * on the mobile-only endpoints, so ungranted users can't modify medicine data.
 */
const fullName = (u) => `${u.lastName}, ${u.firstName}${u.middleName ? " " + u.middleName : ""}`;
// GET /medicine/mobile-access?lineId — users granted mobile pharmacy access
const listMobileAccess = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    const { lineId } = req.query;
    if (!lineId)
        throw new errors_1.ValidationError("lineId is required");
    try {
        const rows = yield prisma_1.prisma.pharmacyMobileAccess.findMany({
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
        const lineStorages = yield prisma_1.prisma.medicineStorage.findMany({
            where: { lineId, status: { not: 0 } },
            select: { id: true, name: true, refNumber: true },
        });
        const storageName = new Map(lineStorages.map((s) => [s.id, s.refNumber || s.name || s.id]));
        const grants = rows.length
            ? yield prisma_1.prisma.medicineStorageAccess.findMany({
                where: {
                    userId: { in: rows.map((r) => r.userId) },
                    medicineStorageId: { in: lineStorages.map((s) => s.id) },
                },
                select: { userId: true, medicineStorageId: true },
            })
            : [];
        const byUser = new Map();
        for (const g of grants) {
            const label = storageName.get(g.medicineStorageId);
            if (!label)
                continue;
            const arr = (_a = byUser.get(g.userId)) !== null && _a !== void 0 ? _a : [];
            arr.push(label);
            byUser.set(g.userId, arr);
        }
        const list = rows.map((r) => {
            var _a, _b, _c;
            return ({
                id: r.id,
                userId: r.userId,
                name: fullName(r.user),
                username: r.user.username,
                department: (_b = (_a = r.user.department) === null || _a === void 0 ? void 0 : _a.name) !== null && _b !== void 0 ? _b : null,
                grantedAt: r.timestamp,
                grantedBy: r.grantedBy ? `${r.grantedBy.lastName}, ${r.grantedBy.firstName}` : null,
                storages: (_c = byUser.get(r.userId)) !== null && _c !== void 0 ? _c : [],
            });
        });
        return res.code(200).send({ list, lineStorageCount: lineStorages.length });
    }
    catch (error) {
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError)
            throw (0, errors_1.dbError)(error);
        throw error;
    }
});
exports.listMobileAccess = listMobileAccess;
// GET /medicine/mobile-access/candidates?lineId&query — line users NOT yet granted
const mobileAccessCandidates = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { lineId, query } = req.query;
    if (!lineId)
        throw new errors_1.ValidationError("lineId is required");
    try {
        const granted = yield prisma_1.prisma.pharmacyMobileAccess.findMany({
            where: { lineId },
            select: { userId: true },
        });
        const grantedIds = granted.map((g) => g.userId);
        const term = (query !== null && query !== void 0 ? query : "").trim();
        const where = Object.assign(Object.assign({ lineId, active: 1 }, (grantedIds.length ? { id: { notIn: grantedIds } } : {})), (term
            ? {
                OR: [
                    { firstName: { contains: term, mode: "insensitive" } },
                    { lastName: { contains: term, mode: "insensitive" } },
                    { username: { contains: term, mode: "insensitive" } },
                ],
            }
            : {}));
        const users = yield prisma_1.prisma.user.findMany({
            where,
            take: 20,
            orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
            select: {
                id: true, firstName: true, lastName: true, middleName: true,
                username: true, department: { select: { name: true } },
            },
        });
        const list = users.map((u) => {
            var _a, _b;
            return ({
                id: u.id,
                name: fullName(u),
                username: u.username,
                department: (_b = (_a = u.department) === null || _a === void 0 ? void 0 : _a.name) !== null && _b !== void 0 ? _b : null,
            });
        });
        return res.code(200).send({ list });
    }
    catch (error) {
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError)
            throw (0, errors_1.dbError)(error);
        throw error;
    }
});
exports.mobileAccessCandidates = mobileAccessCandidates;
// POST /medicine/mobile-access { lineId, userId, grantedById } — grant (idempotent)
const grantMobileAccess = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    const body = req.body;
    if (!body.lineId || !body.userId)
        throw new errors_1.ValidationError("lineId and userId are required");
    try {
        const user = yield prisma_1.prisma.user.findFirst({
            where: { id: body.userId, lineId: body.lineId },
            select: { id: true, firstName: true, lastName: true },
        });
        if (!user)
            throw new errors_1.ValidationError("USER_NOT_IN_LINE");
        yield prisma_1.prisma.pharmacyMobileAccess.upsert({
            where: { lineId_userId: { lineId: body.lineId, userId: body.userId } },
            create: { lineId: body.lineId, userId: body.userId, grantedById: (_a = body.grantedById) !== null && _a !== void 0 ? _a : null },
            update: {},
        });
        // audit (best-effort) — only when we know who granted it
        if (body.grantedById) {
            try {
                yield prisma_1.prisma.medicineLogs.create({
                    data: {
                        action: 1,
                        lineId: body.lineId,
                        userId: body.grantedById,
                        message: `Granted mobile pharmacy access to ${user.lastName}, ${user.firstName}.`,
                    },
                });
            }
            catch (_b) {
                /* audit is best-effort */
            }
        }
        return res.code(200).send({ message: "OK" });
    }
    catch (error) {
        if (error instanceof errors_1.ValidationError)
            throw error;
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError)
            throw (0, errors_1.dbError)(error);
        throw error;
    }
});
exports.grantMobileAccess = grantMobileAccess;
// DELETE /medicine/mobile-access { lineId, userId, revokedById } — revoke
const revokeMobileAccess = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const body = req.body;
    if (!body.lineId || !body.userId)
        throw new errors_1.ValidationError("lineId and userId are required");
    try {
        const user = yield prisma_1.prisma.user.findUnique({
            where: { id: body.userId },
            select: { firstName: true, lastName: true },
        });
        yield prisma_1.prisma.pharmacyMobileAccess.deleteMany({
            where: { lineId: body.lineId, userId: body.userId },
        });
        if (body.revokedById && user) {
            try {
                yield prisma_1.prisma.medicineLogs.create({
                    data: {
                        action: 0,
                        lineId: body.lineId,
                        userId: body.revokedById,
                        message: `Revoked mobile pharmacy access from ${user.lastName}, ${user.firstName}.`,
                    },
                });
            }
            catch (_a) {
                /* audit is best-effort */
            }
        }
        return res.code(200).send({ message: "OK" });
    }
    catch (error) {
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError)
            throw (0, errors_1.dbError)(error);
        throw error;
    }
});
exports.revokeMobileAccess = revokeMobileAccess;
// GET /medicine/mobile-access/me — the mobile app's self-check (uses the token)
const myMobileAccess = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d;
    try {
        const accountId = (_a = req.user) === null || _a === void 0 ? void 0 : _a.id;
        if (!accountId)
            return res.code(200).send({ granted: false });
        const account = yield prisma_1.prisma.account.findUnique({
            where: { id: accountId },
            select: { lineId: true, User: { select: { id: true } } },
        });
        const lineId = (_b = account === null || account === void 0 ? void 0 : account.lineId) !== null && _b !== void 0 ? _b : null;
        const userId = (_d = (_c = account === null || account === void 0 ? void 0 : account.User) === null || _c === void 0 ? void 0 : _c.id) !== null && _d !== void 0 ? _d : null;
        if (!lineId || !userId)
            return res.code(200).send({ granted: false, reason: "no-user-or-line" });
        const access = yield prisma_1.prisma.pharmacyMobileAccess.findUnique({
            where: { lineId_userId: { lineId, userId } },
            select: { id: true },
        });
        return res.code(200).send({ granted: !!access });
    }
    catch (error) {
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError)
            throw (0, errors_1.dbError)(error);
        throw error;
    }
});
exports.myMobileAccess = myMobileAccess;
