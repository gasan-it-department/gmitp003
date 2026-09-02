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
exports.openLineHrSession = void 0;
const prisma_1 = require("../barrel/prisma");
/**
 * POST /admin/line/:lineId/hr-session  (adminAuthenticated)
 *
 * Mints a REAL line Account session token so the super-admin can drive the
 * existing HR module for that line. The token is an ordinary Account JWT
 * (so it passes `authenticated` and `req.user.id` resolves to a real account on
 * the line) plus `imp:true`/`impLineId` markers. HR data endpoints need no
 * change — they scope by the `lineId` passed in the request; the `imp` flag only
 * short-circuits the per-user module-access check (see userModuleAccess).
 */
const openLineHrSession = (req, reply) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c;
    const { lineId } = req.params;
    if (!lineId)
        return reply.code(400).send({ message: "Missing lineId" });
    const line = yield prisma_1.prisma.line.findUnique({
        where: { id: lineId },
        select: { id: true, name: true, status: true },
    });
    if (!line)
        return reply.code(404).send({ message: "Line not found" });
    if (line.status !== 1)
        return reply.code(400).send({ message: "Line is inactive" });
    // Resolve a real Account on this line to carry req.user.id. Prefer an HR user
    // (so any req.user-based HR logic resolves to a legit HR account); fall back
    // to the line admin, then any active account.
    let accountId = null;
    let username = "";
    let userId = null;
    const hrModule = yield prisma_1.prisma.module.findFirst({
        where: { lineId, status: 1, moduleName: "human-resources" },
        select: { userId: true },
    });
    if (hrModule === null || hrModule === void 0 ? void 0 : hrModule.userId) {
        const u = yield prisma_1.prisma.user.findUnique({
            where: { id: hrModule.userId },
            select: { id: true, accountId: true, username: true },
        });
        if (u === null || u === void 0 ? void 0 : u.accountId) {
            accountId = u.accountId;
            username = u.username;
            userId = u.id;
        }
    }
    if (!accountId) {
        // The account MUST have a User row: the HR screens stamp `userId` on every
        // audit log (HumanResourcesLogs.userId is a User FK), so an account without
        // one makes each write fail with a foreign-key error.
        const acc = (_a = (yield prisma_1.prisma.account.findFirst({
            where: { lineId, role: "admin", active: true, status: 1, User: { isNot: null } },
            select: { id: true, username: true, User: { select: { id: true } } },
        }))) !== null && _a !== void 0 ? _a : (yield prisma_1.prisma.account.findFirst({
            where: { lineId, active: true, status: 1, User: { isNot: null } },
            select: { id: true, username: true, User: { select: { id: true } } },
        }));
        if (acc) {
            accountId = acc.id;
            username = acc.username;
            userId = (_c = (_b = acc.User) === null || _b === void 0 ? void 0 : _b.id) !== null && _c !== void 0 ? _c : null;
        }
    }
    if (!accountId || !userId)
        return reply.code(409).send({
            message: "This line has no staff account to manage HR as yet. Add a user to the line first.",
        });
    // best-effort audit on the line's activity feed (ActivityLogs.userId is a User FK)
    if (userId) {
        try {
            const admin = req.user;
            yield prisma_1.prisma.activityLogs.create({
                data: {
                    userId,
                    lineId,
                    action: 0,
                    desc: `HR session opened by super-admin${(admin === null || admin === void 0 ? void 0 : admin.id) ? ` (${admin.id})` : ""}`,
                },
            });
        }
        catch (e) {
            console.warn("[admin hr-session] audit log failed:", e);
        }
    }
    const token = yield reply.jwtSign({
        id: accountId,
        username,
        imp: true,
        impLineId: lineId,
    });
    // `userId` is the User behind the account. The web keys its session on it and
    // sends it as `userId` on every write — the audit rows are FKs to User, so
    // handing back the ACCOUNT id here made every HR save fail (500 / P2003).
    return reply
        .code(200)
        .send({ token, accountId, userId, lineId, lineName: line.name });
});
exports.openLineHrSession = openLineHrSession;
