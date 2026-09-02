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
exports.VISIBLE_TO_ROOM = exports.releaseCopyFurnished = exports.isHeld = void 0;
const notificationEvents_1 = require("./notificationEvents");
/**
 * Copy furnished: the offices that get the document once it is SIGNED.
 *
 * On paper this is the "Copy furnished:" line at the foot of a memo — the
 * offices that need the finished, signed thing for their records, as opposed
 * to the addressee who has to act on it. The distinction matters here for one
 * reason: a copy-furnished office must not see a draft. It receives nothing
 * at all until the last signature is in, then receives it automatically.
 *
 * So a copy-furnish destination is an ordinary TargetRoom row carrying
 * `copyFurnished`, created when the sender configures the dissemination so
 * the intent is on record from the start, and held — invisible to that room —
 * until `releasedAt` is stamped.
 *
 * Releasing is exactly-once by construction: the update is conditional on
 * `releasedAt: null`, so a re-sign, a repair, or two signatures landing at
 * the same instant cannot deliver twice. Prisma returns how many rows the
 * update actually touched, and only those get notified.
 */
/** A copy-furnished row is invisible to its room until this is stamped. */
const isHeld = (t) => t.copyFurnished && t.releasedAt === null;
exports.isHeld = isHeld;
/**
 * Hand the signed document to every copy-furnished office on this queue.
 *
 * Call it inside the signing transaction the moment the queue completes.
 * Safe to call again: rooms already released are skipped, so nothing is
 * delivered twice and the second call reports 0.
 */
const releaseCopyFurnished = (tx, queueRoomId, actorUserId) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    const held = yield tx.targetRoom.findMany({
        where: {
            signatureQueueRoomId: queueRoomId,
            copyFurnished: true,
            releasedAt: null,
        },
        select: {
            id: true,
            receivingRoomId: true,
            roomReceiver: { select: { id: true, code: true } },
        },
    });
    if (held.length === 0)
        return { released: 0, rooms: [] };
    const now = new Date();
    // Conditional on releasedAt still being null: whoever gets here first wins
    // and the loser updates nothing, which is what makes this exactly-once.
    const done = yield tx.targetRoom.updateMany({
        where: { id: { in: held.map((h) => h.id) }, releasedAt: null },
        data: { releasedAt: now, receivedAt: now, status: 1 },
    });
    if (done.count === 0)
        return { released: 0, rooms: [] };
    const queue = yield tx.signatureQueueRoom.findUnique({
        where: { id: queueRoomId },
        select: { title: true },
    });
    const title = (_a = queue === null || queue === void 0 ? void 0 : queue.title) !== null && _a !== void 0 ? _a : "a document";
    // Tell the people in each copy-furnished room that it has landed. Their
    // room membership is how they see it, so that is who is told.
    const roomIds = held
        .map((h) => h.receivingRoomId)
        .filter((x) => !!x);
    if (roomIds.length) {
        const members = yield tx.roomAuthorizedUser.findMany({
            where: { receivingRoomId: { in: roomIds }, status: 1, userId: { not: null } },
            select: { userId: true },
        });
        const told = new Set();
        for (const m of members) {
            if (!m.userId || told.has(m.userId))
                continue;
            told.add(m.userId);
            yield (0, notificationEvents_1.createUserNotification)(tx, {
                recipientId: m.userId,
                senderId: actorUserId,
                title: "Copy furnished",
                content: `"${title}" has been fully signed and copy furnished to your office.`,
                path: `documents/dissemination?tab=inbox`,
            });
        }
    }
    return {
        released: done.count,
        rooms: held.map((h) => { var _a, _b; return (_b = (_a = h.roomReceiver) === null || _a === void 0 ? void 0 : _a.code) !== null && _b !== void 0 ? _b : "a room"; }),
    };
});
exports.releaseCopyFurnished = releaseCopyFurnished;
/**
 * The Prisma filter for "target rows this room is allowed to see".
 *
 * A copy-furnished row exists from the moment the sender configures the
 * dissemination, but the room it names must not learn the document exists
 * until it is signed and released. Every query that answers "what has my
 * room received" has to carry this, or the draft leaks: an inbox row, a
 * badge count, even a cancellation notice for a document the office was
 * never given.
 */
exports.VISIBLE_TO_ROOM = {
    OR: [{ copyFurnished: false }, { releasedAt: { not: null } }],
};
