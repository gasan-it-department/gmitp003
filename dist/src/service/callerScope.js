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
exports.requireRoomMember = exports.requireSelf = exports.requireSameLine = exports.callerContext = void 0;
const prisma_1 = require("../barrel/prisma");
const errors_1 = require("../errors/errors");
const callerContext = (req) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d, _e;
    const accountId = (_a = req.user) === null || _a === void 0 ? void 0 : _a.id;
    if (!accountId)
        throw new errors_1.UnauthorizedError("Not signed in");
    const account = yield prisma_1.prisma.account.findUnique({
        where: { id: accountId },
        select: { lineId: true, User: { select: { id: true, lineId: true } } },
    });
    const actorId = (_b = account === null || account === void 0 ? void 0 : account.User) === null || _b === void 0 ? void 0 : _b.id;
    if (!actorId)
        throw new errors_1.UnauthorizedError("Not signed in");
    return { actorId, lineId: (_e = (_d = (_c = account.User) === null || _c === void 0 ? void 0 : _c.lineId) !== null && _d !== void 0 ? _d : account.lineId) !== null && _e !== void 0 ? _e : null };
});
exports.callerContext = callerContext;
/**
 * The caller, and a promise that they belong to the municipality they are
 * asking about.
 *
 * This is a ceiling, not a fence: it stops another municipality's staff
 * and it stops an id typed at random, but any colleague on the same line
 * still passes. Tightening it further needs the module-permission system
 * to reach the server, which it does not yet — the UI decides who sees
 * these screens and the API has never been told. Worth doing; a different
 * job from closing the door on everybody else.
 */
const requireSameLine = (req, lineId) => __awaiter(void 0, void 0, void 0, function* () {
    const caller = yield (0, exports.callerContext)(req);
    if (!lineId || !caller.lineId || caller.lineId !== lineId) {
        console.warn(`[scope] refused: user ${caller.actorId} (line ${caller.lineId}) ` +
            `asked for line ${lineId}`);
        throw new errors_1.UnauthorizedError("This is not your municipality's data.");
    }
    return caller;
});
exports.requireSameLine = requireSameLine;
/** Acting on a person: it has to be yourself. */
const requireSelf = (req, userId) => __awaiter(void 0, void 0, void 0, function* () {
    const caller = yield (0, exports.callerContext)(req);
    if (userId && userId !== caller.actorId) {
        console.warn(`[scope] refused: user ${caller.actorId} attempted to act as ${userId}`);
        throw new errors_1.UnauthorizedError("You can only act on your own behalf.");
    }
    return caller;
});
exports.requireSelf = requireSelf;
/**
 * A room's business belongs to the people who work in that room.
 *
 * Any of the three roles counts — an owner, a signatory and a receiver all
 * genuinely work there. A REMOVED member keeps their row at status 0 and
 * is refused by it, which is the point of removing someone.
 *
 * Returns the role so a caller that also needs it does not pay for a
 * second query.
 */
const requireRoomMember = (req, roomId) => __awaiter(void 0, void 0, void 0, function* () {
    const { actorId } = yield (0, exports.callerContext)(req);
    const member = yield prisma_1.prisma.roomAuthorizedUser.findFirst({
        where: { receivingRoomId: roomId, userId: actorId, status: 1 },
        select: { type: true },
    });
    if (!member) {
        console.warn(`[scope] refused: user ${actorId} asked for room ${roomId}`);
        throw new errors_1.UnauthorizedError("This is not your office.");
    }
    return { actorId, type: member.type };
});
exports.requireRoomMember = requireRoomMember;
