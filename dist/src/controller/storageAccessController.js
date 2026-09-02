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
exports.revokeStorageAccess = exports.grantStorageAccess = exports.storageAccessCandidates = exports.listStorageAccess = void 0;
exports.autoGrantSoleStorageAccess = autoGrantSoleStorageAccess;
exports.allowedStorageIds = allowedStorageIds;
exports.isSuperAdmin = isSuperAdmin;
exports.canWriteStorage = canWriteStorage;
exports.assertStorageAccess = assertStorageAccess;
const prisma_1 = require("../barrel/prisma");
const errors_1 = require("../errors/errors");
/**
 * Per-storage "Dispense Access" (web Medicine > Storage > Dispense Access tab).
 *
 * Rule — LOCKED BY DEFAULT: a user may dispense/restock in a storage ONLY
 * when they hold a MedicineStorageAccess grant on that exact storage. No
 * grant = blocked, for everyone. Enforced server-side on dispense + every
 * stock mutation (web, mobile, and desktop sync pushes), and mirrored to the
 * desktop app via the storage_access sync table.
 */
const fullName = (u) => `${u.lastName}, ${u.firstName}${u.middleName ? " " + u.middleName : ""}`;
/**
 * Self-healing default for mobile scanner users: when a user already holds
 * PharmacyMobileAccess (an admin explicitly let them scan for this line) and
 * the line has EXACTLY ONE active storage, grant them Dispense & Stock
 * Access on it automatically — there is no "wrong" storage to pick, and
 * scanner access is meaningless without it. Ambiguous lines (2+ storages)
 * are never auto-granted; the admin assigns those on the storage's
 * Dispense & Stock Access tab. Best-effort: never throws.
 */
function autoGrantSoleStorageAccess(userId, lineId) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            if (!userId || !lineId)
                return;
            const storages = yield prisma_1.prisma.medicineStorage.findMany({
                where: { lineId, status: { not: 0 } },
                select: { id: true, name: true, refNumber: true },
                take: 2,
            });
            if (storages.length !== 1)
                return; // none, or ambiguous — don't guess
            const sole = storages[0];
            const existing = yield prisma_1.prisma.medicineStorageAccess.findFirst({
                where: { userId, medicineStorageId: sole.id },
                select: { id: true },
            });
            if (existing)
                return;
            const mobile = yield prisma_1.prisma.pharmacyMobileAccess.findUnique({
                where: { lineId_userId: { lineId, userId } },
                select: { id: true },
            });
            if (!mobile)
                return; // only heal users an admin already trusted to scan
            yield prisma_1.prisma.medicineStorageAccess.create({
                data: { userId, medicineStorageId: sole.id },
            });
            yield prisma_1.prisma.medicineLogs.create({
                data: {
                    action: 1,
                    message: `Auto-assigned Dispense & Stock Access on ${sole.name} ` +
                        `(${sole.refNumber}) — the line's only storage — for a mobile scanner user`,
                    userId,
                    lineId,
                },
            });
        }
        catch (e) {
            console.warn("[autoGrantSoleStorageAccess] skipped:", e);
        }
    });
}
/**
 * The storages this user is granted on (possibly empty — empty means the
 * user can't touch ANY storage's stock).
 */
function allowedStorageIds(userId) {
    return __awaiter(this, void 0, void 0, function* () {
        const grants = yield prisma_1.prisma.medicineStorageAccess.findMany({
            where: { userId },
            select: { medicineStorageId: true },
        });
        return new Set(grants.map((g) => g.medicineStorageId));
    });
}
/**
 * A super-admin (User.privilege.super) manages the whole line, so they may
 * write to EVERY storage in it without a per-storage grant — the same people
 * who run the "Dispense & Stock Access" tab shouldn't be locked out of their
 * own storages (especially legacy ones created before creators were tracked,
 * whose createdById is null). Regular staff stay strictly gated.
 */
function isSuperAdmin(userId) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        if (!userId)
            return false;
        const u = yield prisma_1.prisma.user.findUnique({
            where: { id: userId },
            select: { privilege: { select: { super: true } } },
        });
        return !!((_a = u === null || u === void 0 ? void 0 : u.privilege) === null || _a === void 0 ? void 0 : _a.super);
    });
}
/**
 * Non-throwing counterpart to {@link assertStorageAccess} for ONE storage:
 * true when `userId` may write there — i.e. they are a super-admin, they
 * created the storage, OR they hold a Dispense & Stock Access grant on it.
 * Used to tell the UI whether to show the write controls (the mutation
 * endpoints still re-check server-side).
 */
function canWriteStorage(userId, storageId) {
    return __awaiter(this, void 0, void 0, function* () {
        if (!userId || !storageId)
            return false;
        const [grant, created, sup] = yield Promise.all([
            prisma_1.prisma.medicineStorageAccess.findFirst({
                where: { userId, medicineStorageId: storageId },
                select: { id: true },
            }),
            prisma_1.prisma.medicineStorage.findFirst({
                where: { id: storageId, createdById: userId },
                select: { id: true },
            }),
            isSuperAdmin(userId),
        ]);
        return !!grant || !!created || sup;
    });
}
/**
 * LOCKED BY DEFAULT: throw a ValidationError unless `userId` holds a grant on
 * EVERY storage in `storageIds`. Call before mutating stock or dispensing.
 * (Batches with no storage location fall outside the storage system and are
 * not blocked; null/undefined entries are skipped.)
 */
function assertStorageAccess(userId, storageIds, action) {
    return __awaiter(this, void 0, void 0, function* () {
        if (!userId)
            return; // no identity on this call — token auth still applies
        const wanted = [...new Set(storageIds.filter(Boolean))];
        if (wanted.length === 0)
            return;
        const [grants, createdByMe, sup] = yield Promise.all([
            prisma_1.prisma.medicineStorageAccess.findMany({
                where: { userId, medicineStorageId: { in: wanted } },
                select: { medicineStorageId: true },
            }),
            // The storage CREATOR is implicitly allowed in their own storage,
            // alongside explicit Dispense & Stock Access grants.
            prisma_1.prisma.medicineStorage.findMany({
                where: { id: { in: wanted }, createdById: userId },
                select: { id: true },
            }),
            // A super-admin runs the whole line and manages every storage in it.
            isSuperAdmin(userId),
        ]);
        if (sup)
            return; // super-admins are never blocked on their line's storages
        const have = new Set([
            ...grants.map((g) => g.medicineStorageId),
            ...createdByMe.map((s) => s.id),
        ]);
        const blocked = wanted.filter((id) => !have.has(id));
        if (blocked.length === 0)
            return;
        const names = yield prisma_1.prisma.medicineStorage.findMany({
            where: { id: { in: blocked } },
            select: { name: true, refNumber: true },
        });
        const label = names.map((n) => `${n.name} (${n.refNumber})`).join(", ") ||
            "this storage";
        throw new errors_1.ValidationError(`No storage access: only users granted Dispense & Stock Access on ${label} ` +
            `can ${action} there. Ask your admin to add you ` +
            `(Pharmacy > Storage > Dispense & Stock Access).`);
    });
}
// GET /medicine/storage-access?storageId — users granted on this storage
const listStorageAccess = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { storageId } = req.query;
    if (!storageId)
        throw new errors_1.ValidationError("storageId is required");
    try {
        const rows = yield prisma_1.prisma.medicineStorageAccess.findMany({
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
        const list = rows.map((r) => {
            var _a, _b;
            return ({
                id: r.id,
                userId: r.userId,
                name: fullName(r.user),
                username: r.user.username,
                department: (_b = (_a = r.user.department) === null || _a === void 0 ? void 0 : _a.name) !== null && _b !== void 0 ? _b : null,
                grantedAt: r.timestamp,
                grantedBy: null, // model has no grantedBy — audit is in MedicineLogs
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
exports.listStorageAccess = listStorageAccess;
// GET /medicine/storage-access/candidates?storageId&lineId&query
const storageAccessCandidates = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { storageId, lineId, query } = req.query;
    if (!storageId || !lineId)
        throw new errors_1.ValidationError("storageId and lineId are required");
    try {
        const granted = yield prisma_1.prisma.medicineStorageAccess.findMany({
            where: { medicineStorageId: storageId },
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
                id: true,
                firstName: true,
                lastName: true,
                middleName: true,
                username: true,
                department: { select: { name: true } },
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
exports.storageAccessCandidates = storageAccessCandidates;
// POST /medicine/storage-access { storageId, lineId, userId, grantedById }
const grantStorageAccess = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const body = req.body;
    if (!body.storageId || !body.lineId || !body.userId)
        throw new errors_1.ValidationError("storageId, lineId and userId are required");
    try {
        const [user, storage] = yield Promise.all([
            prisma_1.prisma.user.findFirst({
                where: { id: body.userId, lineId: body.lineId },
                select: { id: true, firstName: true, lastName: true },
            }),
            prisma_1.prisma.medicineStorage.findFirst({
                where: { id: body.storageId, lineId: body.lineId },
                select: { id: true, name: true, refNumber: true },
            }),
        ]);
        if (!user)
            throw new errors_1.ValidationError("USER_NOT_IN_LINE");
        if (!storage)
            throw new errors_1.ValidationError("STORAGE_NOT_FOUND");
        // no unique constraint on (storage,user) — check-then-create, idempotent
        const dup = yield prisma_1.prisma.medicineStorageAccess.findFirst({
            where: { medicineStorageId: body.storageId, userId: body.userId },
            select: { id: true },
        });
        if (!dup) {
            yield prisma_1.prisma.medicineStorageAccess.create({
                data: {
                    medicineStorageId: body.storageId,
                    userId: body.userId,
                    previlege: 1,
                },
            });
        }
        if (body.grantedById) {
            try {
                yield prisma_1.prisma.medicineLogs.create({
                    data: {
                        action: 1,
                        lineId: body.lineId,
                        userId: body.grantedById,
                        message: `Granted dispense access on storage ${storage.name} ` +
                            `(${storage.refNumber}) to ${user.lastName}, ${user.firstName}.`,
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
        if (error instanceof errors_1.ValidationError)
            throw error;
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError)
            throw (0, errors_1.dbError)(error);
        throw error;
    }
});
exports.grantStorageAccess = grantStorageAccess;
// DELETE /medicine/storage-access { storageId, lineId, userId, revokedById }
const revokeStorageAccess = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    const body = req.body;
    if (!body.storageId || !body.userId)
        throw new errors_1.ValidationError("storageId and userId are required");
    try {
        const [user, storage] = yield Promise.all([
            prisma_1.prisma.user.findUnique({
                where: { id: body.userId },
                select: { firstName: true, lastName: true },
            }),
            prisma_1.prisma.medicineStorage.findUnique({
                where: { id: body.storageId },
                select: { name: true, refNumber: true },
            }),
        ]);
        yield prisma_1.prisma.medicineStorageAccess.deleteMany({
            where: { medicineStorageId: body.storageId, userId: body.userId },
        });
        if (body.revokedById && user && storage) {
            try {
                yield prisma_1.prisma.medicineLogs.create({
                    data: {
                        action: 0,
                        lineId: (_a = body.lineId) !== null && _a !== void 0 ? _a : null,
                        userId: body.revokedById,
                        message: `Revoked dispense access on storage ${storage.name} ` +
                            `(${storage.refNumber}) from ${user.lastName}, ${user.firstName}.`,
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
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError)
            throw (0, errors_1.dbError)(error);
        throw error;
    }
});
exports.revokeStorageAccess = revokeStorageAccess;
