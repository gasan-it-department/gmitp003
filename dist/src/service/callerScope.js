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
exports.requireRoomMember = exports.requireSelf = exports.requireHr = exports.requireHrOrSelf = exports.requireSameLine = exports.callerContext = void 0;
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
/**
 * The person themselves, or HR of the municipality the record belongs to.
 *
 * `requireSameLine` is the right shape for data that belongs to an office:
 * anybody who works there may see it. It is the wrong shape for a record
 * that belongs to ONE PERSON. A Personal Data Sheet holds a colleague's
 * birth date, place of birth, TIN, PhilHealth number, home address and
 * parents' names, and "we work for the same municipality" is not a reason
 * to be handed it.
 *
 * So: you, or someone whose job is personnel records.
 *
 * The module check is deliberately stricter than the ad-hoc one in
 * employee.ts, which matches on userId + moduleName alone:
 *
 *   - `status: 1`, because access is suspended by flipping that column as
 *     well as by deleting the row. Ignoring it keeps a revoked grant
 *     working, which is the opposite of what revoking means.
 *   - the module's own `lineId`, because a Module row is per line. HR in
 *     one municipality is not HR in another.
 *
 * Returns how the caller got in, so the handler can log it: "HR exported
 * someone else's PDS" and "a person exported their own" are different
 * events and should not look identical afterwards.
 */
const requireHrOrSelf = (req_1, subject_1, ...args_1) => __awaiter(void 0, [req_1, subject_1, ...args_1], void 0, function* (req, subject, what = "this record") {
    var _a;
    const caller = yield (0, exports.callerContext)(req);
    // Yourself, always — regardless of line, module, or anything else.
    if (subject.userId && subject.userId === caller.actorId) {
        return { caller, via: "self" };
    }
    if (!subject.lineId || !caller.lineId || caller.lineId !== subject.lineId) {
        console.warn(`[scope] refused: user ${caller.actorId} (line ${caller.lineId}) ` +
            `asked for ${what} in line ${subject.lineId}`);
        throw new errors_1.UnauthorizedError("This is not your municipality's data.");
    }
    /*
      A super-admin managing this line through "Manage HR".
  
      That feature mints a real session for an account of the line, and
      PREFERS an HR one — but falls back to the line admin, or any active
      account, when the line has no HR user at all. Those are exactly the
      lines a super-admin needs to go in and fix, so requiring the module
      here would lock them out of the case the feature exists for.
  
      Deliberately checked after the same-line test above, so a borrowed
      session is still confined to the line it was borrowed for.
    */
    if (req.impersonated) {
        return { caller, via: "hr" };
    }
    const hr = yield prisma_1.prisma.module.findFirst({
        where: {
            userId: caller.actorId,
            lineId: subject.lineId,
            moduleName: "human-resources",
            status: 1,
        },
        select: { id: true },
    });
    if (!hr) {
        console.warn(`[scope] refused: user ${caller.actorId} is not HR and asked for ` +
            `${what} belonging to ${(_a = subject.userId) !== null && _a !== void 0 ? _a : "another person"}`);
        throw new errors_1.UnauthorizedError("Only HR can open another person's records.");
    }
    return { caller, via: "hr" };
});
exports.requireHrOrSelf = requireHrOrSelf;
/**
 * HR of this municipality, and nobody else — not even the subject.
 *
 * `requireHrOrSelf` lets a person through for their OWN record, which is
 * right for reading a payslip or a PDS. It is wrong for an act performed
 * ON somebody: granting a step increment is a decision about pay, and the
 * person it benefits must not be the one who approves it.
 *
 * Same module rules as requireHrOrSelf — active grant, in this line — and
 * the same deliberate exception for a super-admin's borrowed session,
 * checked after the line test so it stays confined to that line.
 */
const requireHr = (req_1, lineId_1, ...args_1) => __awaiter(void 0, [req_1, lineId_1, ...args_1], void 0, function* (req, lineId, what = "this action") {
    const caller = yield (0, exports.callerContext)(req);
    if (!lineId || !caller.lineId || caller.lineId !== lineId) {
        console.warn(`[scope] refused: user ${caller.actorId} (line ${caller.lineId}) ` +
            `attempted ${what} in line ${lineId}`);
        throw new errors_1.UnauthorizedError("This is not your municipality's data.");
    }
    if (req.impersonated) {
        return caller;
    }
    const hr = yield prisma_1.prisma.module.findFirst({
        where: {
            userId: caller.actorId,
            lineId,
            moduleName: "human-resources",
            status: 1,
        },
        select: { id: true },
    });
    if (!hr) {
        console.warn(`[scope] refused: user ${caller.actorId} is not HR and attempted ${what}`);
        throw new errors_1.UnauthorizedError("Only HR can do this.");
    }
    return caller;
});
exports.requireHr = requireHr;
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
