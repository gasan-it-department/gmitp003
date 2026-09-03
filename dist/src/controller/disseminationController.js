"use strict";
// Document Dissemination — the routing/approval pipeline.
//
// Entities involved:
//   - SignatureQueueRoom: the dissemination room (1 per "send-out").
//     • receivingRoomId   = the "from" room (where the disseminator works)
//     • status:  0 draft · 1 active · 2 completed · 3 cancelled
//     • step:    0 setup · 1 dispatched (in-flight)
//   - TargetRoom: receivers (which rooms the docs land in).
//   - SignatoryArrangement: ordered list of signatories that must sign.
//     • Carries an explicit `index` so we control the signing order.
//     • status: 0 pending · 1 signed · 2 rejected
//
// All writes are scoped to the room the disseminator belongs to (the
// front-end passes the room id from DocumentRoomProvider).
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __asyncValues = (this && this.__asyncValues) || function (o) {
    if (!Symbol.asyncIterator) throw new TypeError("Symbol.asyncIterator is not defined.");
    var m = o[Symbol.asyncIterator], i;
    return m ? m.call(o) : (o = typeof __values === "function" ? __values(o) : o[Symbol.iterator](), i = {}, verb("next"), verb("throw"), verb("return"), i[Symbol.asyncIterator] = function () { return this; }, i);
    function verb(n) { i[n] = o[n] && function (v) { return new Promise(function (resolve, reject) { v = o[n](v), settle(resolve, reject, v.done, v.value); }); }; }
    function settle(resolve, reject, d, v) { Promise.resolve(v).then(function(v) { resolve({ value: v, done: d }); }, reject); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.acknowledgeReceipt = exports.verifySignatureData = exports.verifySignaturePage = exports.cancelDispatchedDissemination = exports.downloadSignedDocument = exports.archiveDissemination = exports.claimSignatorySlot = exports.signMine = exports.viewDissemination = exports.resetRoomMembership = exports.documentOverview = exports.repairRoomMembership = exports.removeDisseminationDocument = exports.uploadDisseminationDocument = exports.saveSignaturePlacements = exports.streamDocumentFile = exports.disseminationDocuments = exports.signatoryCandidates = exports.targetRoomCandidates = exports.removeDissemination = exports.finalizeDissemination = exports.setSignatoryArrangement = exports.setTargetRooms = exports.disseminationDetail = exports.disseminationInbox = exports.disseminationOutbox = void 0;
const prisma_1 = require("../barrel/prisma");
const errors_1 = require("../errors/errors");
const notificationEvents_1 = require("../service/notificationEvents");
const documentSeal_1 = require("../service/documentSeal");
const url_1 = require("../service/url");
const handler_1 = require("../middleware/handler");
const roomConfigController_1 = require("./roomConfigController");
const callerScope_1 = require("../service/callerScope");
const signaturePlacement_1 = require("../service/signaturePlacement");
const copyFurnish_1 = require("../service/copyFurnish");
/**
 * Somebody who can actually open what lands in a room.
 *
 * A removed member keeps their row with status 0, and a placeholder row can
 * carry no user at all. Neither is a person, so neither makes a room able to
 * receive a document.
 */
const ACTIVE_MEMBER = { status: 1, userId: { not: null } };
/**
 * Who may READ one routing — its detail, its recipients, its files.
 *
 * Three ways in, and all three are real doors people walk through:
 *
 *  - a signatory on it, who may belong to neither room;
 *  - somebody in the sending room, who reaches it from the Outbox;
 *  - somebody in a room it actually reached, from the Inbox. A held
 *    copy-furnished row does not count, because that office has not been
 *    given the document yet and must not learn it exists.
 *
 * An UNASSIGNED signatory slot grants nothing. A third of the slots in
 * the wild have no user on them, and treating "nobody holds this slot" as
 * "anybody may look" would be the widest hole of the lot; those documents
 * are reached through a room, which is what the other two doors are for.
 */
const canSeeRouting = (actorId, queueId) => __awaiter(void 0, void 0, void 0, function* () {
    const queue = yield prisma_1.prisma.signatureQueueRoom.findUnique({
        where: { id: queueId },
        select: {
            receivingRoomId: true,
            targetRooms: {
                where: copyFurnish_1.VISIBLE_TO_ROOM,
                select: { receivingRoomId: true },
            },
        },
    });
    if (!queue)
        return false;
    const signs = yield prisma_1.prisma.signatoryArrangement.count({
        where: { signatureQueueRoomId: queueId, userId: actorId },
    });
    if (signs > 0)
        return true;
    const rooms = [
        queue.receivingRoomId,
        ...queue.targetRooms.map((t) => t.receivingRoomId),
    ].filter((x) => !!x);
    if (!rooms.length)
        return false;
    return !!(yield prisma_1.prisma.roomAuthorizedUser.findFirst({
        where: { receivingRoomId: { in: rooms }, userId: actorId, status: 1 },
        select: { id: true },
    }));
});
/** Read gate. Refuses without confirming the routing exists. */
const requireCanSeeRouting = (req, queueId) => __awaiter(void 0, void 0, void 0, function* () {
    const actorId = yield (0, handler_1.callerUserId)(req);
    if (!actorId)
        throw new errors_1.UnauthorizedError("Not signed in");
    if (!(yield canSeeRouting(actorId, queueId))) {
        console.warn(`[routing] refused: user ${actorId} asked for ${queueId}`);
        throw new errors_1.NotFoundError("Not found");
    }
    return actorId;
});
/**
 * Who may CHANGE a routing — attach a file, remove one, move the
 * signature boxes. Only the office that is sending it. A recipient being
 * able to delete the sender's attachment is a different bug entirely.
 */
const requireOwnsRouting = (req, queueId) => __awaiter(void 0, void 0, void 0, function* () {
    const actorId = yield (0, handler_1.callerUserId)(req);
    if (!actorId)
        throw new errors_1.UnauthorizedError("Not signed in");
    const queue = yield prisma_1.prisma.signatureQueueRoom.findUnique({
        where: { id: queueId },
        select: { receivingRoomId: true },
    });
    if (!(queue === null || queue === void 0 ? void 0 : queue.receivingRoomId))
        throw new errors_1.NotFoundError("Not found");
    const member = yield prisma_1.prisma.roomAuthorizedUser.findFirst({
        where: {
            receivingRoomId: queue.receivingRoomId,
            userId: actorId,
            status: 1,
        },
        select: { id: true },
    });
    if (!member) {
        console.warn(`[routing] write refused: user ${actorId} on ${queueId}`);
        throw new errors_1.UnauthorizedError("Only the sending office can change this.");
    }
    return actorId;
});
/**
 * The same question for a file, which is addressed by document id.
 *
 * A document either belongs to a routing or it does not. If it does, the
 * routing decides. If it does not it is somebody's own upload — a Self
 * Sign file — and only they may fetch it. That second branch closes a
 * hole of its own: this endpoint is shared with Self Sign, so every
 * private upload in the municipality was one id away from anybody.
 */
const requireCanSeeDocument = (req, documentId) => __awaiter(void 0, void 0, void 0, function* () {
    const doc = yield prisma_1.prisma.document.findUnique({
        where: { id: documentId },
        select: { userId: true, signatureQueueRoomId: true },
    });
    if (!doc)
        throw new errors_1.NotFoundError("Not found");
    if (doc.signatureQueueRoomId) {
        return requireCanSeeRouting(req, doc.signatureQueueRoomId);
    }
    const actorId = yield (0, handler_1.callerUserId)(req);
    if (!actorId)
        throw new errors_1.UnauthorizedError("Not signed in");
    if (doc.userId !== actorId) {
        console.warn(`[routing] file refused: user ${actorId} on doc ${documentId}`);
        throw new errors_1.NotFoundError("Not found");
    }
    return actorId;
});
// ── Outbox: disseminations created BY this room ────────────────────────
const disseminationOutbox = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    const params = req.query;
    if (!params.fromRoomId)
        throw new errors_1.ValidationError("INVALID REQUIRED ID");
    // Before a single row is read: this has to be your own room.
    yield (0, callerScope_1.requireRoomMember)(req, params.fromRoomId);
    try {
        const limit = params.limit ? parseInt(params.limit, 10) : 20;
        // Axios serializes null query params as the literal string "null".
        // Guard against that here so Prisma doesn't get { id: "null" } and
        // return an empty page.
        const cursor = params.lastCursor && params.lastCursor !== "null"
            ? { id: params.lastCursor }
            : undefined;
        const statusMap = {
            draft: 0,
            active: 1,
            completed: 2,
            cancelled: 3,
        };
        const where = { receivingRoomId: params.fromRoomId };
        if (params.status && params.status !== "all") {
            const s = statusMap[params.status];
            if (typeof s === "number")
                where.status = s;
        }
        if ((_a = params.query) === null || _a === void 0 ? void 0 : _a.trim()) {
            where.title = {
                contains: params.query.trim(),
                mode: "insensitive",
            };
        }
        const rows = yield prisma_1.prisma.signatureQueueRoom.findMany({
            where,
            take: limit,
            skip: cursor ? 1 : 0,
            cursor,
            orderBy: { timestamp: "desc" },
            include: {
                _count: {
                    select: {
                        documents: true,
                        signatotyArrangement: true,
                        targetRooms: true,
                    },
                },
                targetRooms: {
                    select: {
                        id: true,
                        copyFurnished: true,
                        releasedAt: true,
                        acknowledgedAt: true,
                        roomReceiver: { select: { id: true, code: true, address: true } },
                    },
                },
                signatotyArrangement: {
                    orderBy: { index: "asc" },
                    select: { id: true, index: true, status: true },
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
exports.disseminationOutbox = disseminationOutbox;
// ── Inbox: disseminations targeting this room ──────────────────────────
const disseminationInbox = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const params = req.query;
    if (!params.toRoomId)
        throw new errors_1.ValidationError("INVALID REQUIRED ID");
    // Before a single row is read: this has to be your own room.
    const member = yield (0, callerScope_1.requireRoomMember)(req, params.toRoomId);
    try {
        const limit = params.limit ? parseInt(params.limit, 10) : 20;
        // Axios serializes null query params as the literal string "null".
        // Guard against that here so Prisma doesn't get { id: "null" } and
        // return an empty page.
        const cursor = params.lastCursor && params.lastCursor !== "null"
            ? { id: params.lastCursor }
            : undefined;
        // Diagnostic snapshot of every TargetRoom that matches this room id
        // (regardless of dispatch state). Surfaced in the response so the
        // empty-inbox screen can show what the data actually looks like.
        const rawTargets = yield prisma_1.prisma.targetRoom.findMany({
            where: Object.assign({ receivingRoomId: params.toRoomId }, copyFurnish_1.VISIBLE_TO_ROOM),
            orderBy: { timestamp: "desc" },
            take: 10,
            select: {
                id: true,
                status: true,
                signatureQueueRoomId: true,
                queueRoom: {
                    select: { id: true, title: true, status: true, step: true },
                },
            },
        });
        const dispatchedCount = rawTargets.filter((t) => { var _a, _b; return ((_b = (_a = t.queueRoom) === null || _a === void 0 ? void 0 : _a.status) !== null && _b !== void 0 ? _b : 0) >= 1; }).length;
        const rows = yield prisma_1.prisma.targetRoom.findMany({
            where: Object.assign({ receivingRoomId: params.toRoomId, queueRoom: { is: { status: { gte: 1 } } } }, copyFurnish_1.VISIBLE_TO_ROOM),
            take: limit,
            skip: cursor ? 1 : 0,
            cursor,
            orderBy: { timestamp: "desc" },
            include: {
                acknowledgedBy: {
                    select: { id: true, firstName: true, lastName: true },
                },
                queueRoom: {
                    select: {
                        id: true,
                        title: true,
                        status: true,
                        step: true,
                        timestamp: true,
                        user: { select: { id: true, firstName: true, lastName: true } },
                        fromRoom: {
                            select: { id: true, code: true, address: true },
                        },
                        _count: { select: { documents: true } },
                    },
                },
            },
        });
        // Whether the person reading this inbox may mark things received.
        // Sent once for the page rather than per row, because it is a property
        // of the reader and the room, not of any one document. The role came
        // back from the gate above, so this costs nothing.
        const canAcknowledge = member.type === roomConfigController_1.ROOM_MEMBER_TYPES.owner ||
            member.type === roomConfigController_1.ROOM_MEMBER_TYPES.receiver;
        const lastCursor = rows.length ? rows[rows.length - 1].id : null;
        const hasMore = rows.length === limit;
        return res.code(200).send({
            list: rows,
            canAcknowledge,
            lastCursor,
            hasMore,
            debug: {
                toRoomId: params.toRoomId,
                rawCount: rawTargets.length,
                dispatchedCount,
                sample: rawTargets,
            },
        });
    }
    catch (error) {
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw new errors_1.AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
        }
        throw error;
    }
});
exports.disseminationInbox = disseminationInbox;
// ── Detail ─────────────────────────────────────────────────────────────
const disseminationDetail = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const params = req.query;
    if (!params.id)
        throw new errors_1.ValidationError("INVALID REQUIRED ID");
    // Only the people this routing actually involves.
    yield requireCanSeeRouting(req, params.id);
    try {
        const row = yield prisma_1.prisma.signatureQueueRoom.findUnique({
            where: { id: params.id },
            include: {
                fromRoom: {
                    select: { id: true, code: true, address: true, lineId: true },
                },
                targetRooms: {
                    select: {
                        id: true,
                        receivingRoomId: true,
                        copyFurnished: true,
                        releasedAt: true,
                        acknowledgedAt: true,
                        acknowledgedNote: true,
                        acknowledgedBy: {
                            select: { id: true, firstName: true, lastName: true },
                        },
                        roomReceiver: {
                            select: { id: true, code: true, address: true },
                        },
                    },
                },
                documents: {
                    select: { id: true, title: true, timestamp: true },
                },
                signatotyArrangement: {
                    orderBy: { index: "asc" },
                    select: {
                        id: true,
                        index: true,
                        status: true,
                        signedAt: true,
                        timestamp: true,
                    },
                },
                user: { select: { id: true, firstName: true, lastName: true } },
            },
        });
        if (!row)
            throw new errors_1.NotFoundError("ROUTING NOT FOUND");
        return res.code(200).send(row);
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
exports.disseminationDetail = disseminationDetail;
// ── Set target rooms (replace) ─────────────────────────────────────────
const setTargetRooms = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    const body = req.body;
    if (!body.queueRoomId || !Array.isArray(body.targetRoomIds)) {
        throw new errors_1.ValidationError("INVALID REQUIRED FIELDS");
    }
    // Only the office sending it decides who it goes to.
    yield requireOwnsRouting(req, body.queueRoomId);
    // An addressee already receives the document, so copy-furnishing them as
    // well is a no-op that would only produce a duplicate row and a second
    // notification. Being an addressee wins.
    const direct = [...new Set(body.targetRoomIds)];
    const furnished = [...new Set((_a = body.copyFurnishedRoomIds) !== null && _a !== void 0 ? _a : [])].filter((id) => !direct.includes(id));
    // A room with no members cannot open anything sent to it, so targeting one
    // silently loses the document. The picker greys these out, but a list is a
    // hint and this is the rule.
    const asked = [...direct, ...furnished];
    if (asked.length) {
        const withMembers = yield prisma_1.prisma.roomAuthorizedUser.findMany({
            where: Object.assign({ receivingRoomId: { in: asked } }, ACTIVE_MEMBER),
            select: { receivingRoomId: true },
            distinct: ["receivingRoomId"],
        });
        const ok = new Set(withMembers.map((m) => m.receivingRoomId));
        const empty = asked.filter((id) => !ok.has(id));
        if (empty.length) {
            const named = yield prisma_1.prisma.receivingRoom.findMany({
                where: { id: { in: empty } },
                select: { code: true },
            });
            const codes = named.map((n) => n.code).join(", ") || "one of them";
            throw new errors_1.ValidationError(`No one has been added to ${codes} yet, so nothing sent there could ` +
                `be opened. Add a member in Document Rooms first, or drop it.`);
        }
    }
    try {
        yield prisma_1.prisma.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            const queue = yield tx.signatureQueueRoom.findUnique({
                where: { id: body.queueRoomId },
            });
            if (!queue)
                throw new errors_1.NotFoundError("Routing not found");
            if (queue.status !== 0) {
                throw new errors_1.ValidationError("Cannot change recipients after the routing has been dispatched.");
            }
            // Replace strategy: drop existing target rows for this queue, recreate.
            yield tx.targetRoom.deleteMany({
                where: { signatureQueueRoomId: body.queueRoomId },
            });
            console.log("[setTargets] queueRoomId:", body.queueRoomId);
            console.log("[setTargets] targetRoomIds:", body.targetRoomIds);
            if (direct.length > 0) {
                const created = yield tx.targetRoom.createMany({
                    data: direct.map((rid) => ({
                        signatureQueueRoomId: body.queueRoomId,
                        receivingRoomId: rid,
                        status: 0,
                    })),
                });
                console.log("[setTargets] created count:", created.count);
            }
            // Copy-furnished rows are written now so the intent is on record and
            // auditable from the start, but they stay held (releasedAt null) and
            // the room sees nothing until the last signature lands.
            if (furnished.length > 0) {
                yield tx.targetRoom.createMany({
                    data: furnished.map((rid) => ({
                        signatureQueueRoomId: body.queueRoomId,
                        receivingRoomId: rid,
                        status: 0,
                        copyFurnished: true,
                    })),
                });
                console.log("[setTargets] copy furnished:", furnished.length);
            }
            if (body.userId) {
                yield tx.documentActivityLogs.create({
                    data: {
                        userId: body.userId,
                        lineId: body.lineId,
                        title: "Updated routing recipients",
                        desc: `Set ${direct.length} target room` +
                            `${direct.length === 1 ? "" : "s"}` +
                            (furnished.length
                                ? ` and ${furnished.length} copy furnished`
                                : "") +
                            ` on queue ${body.queueRoomId}`,
                        action: 2,
                    },
                });
            }
        }));
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
exports.setTargetRooms = setTargetRooms;
// ── Set signatories with order (replace) ───────────────────────────────
const setSignatoryArrangement = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const body = req.body;
    if (!body.queueRoomId || !Array.isArray(body.signatories)) {
        throw new errors_1.ValidationError("INVALID REQUIRED FIELDS");
    }
    // Only the sending office decides who signs it.
    yield requireOwnsRouting(req, body.queueRoomId);
    try {
        yield prisma_1.prisma.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            var _a;
            const queue = yield tx.signatureQueueRoom.findUnique({
                where: { id: body.queueRoomId },
            });
            if (!queue)
                throw new errors_1.NotFoundError("Routing not found");
            if (queue.status !== 0) {
                throw new errors_1.ValidationError("Cannot change signatories after the routing has been dispatched.");
            }
            // Resolve each RoomAuthorizedUser.id → its underlying User.id so
            // we can persist who actually owns each signing slot. Signers later
            // identify themselves by User.id when auto-signing.
            console.log("[setSignatories] incoming:", {
                queueRoomId: body.queueRoomId,
                count: body.signatories.length,
                ids: body.signatories.map((s) => s.roomAuthorizedUserId),
            });
            const authUsers = yield tx.roomAuthorizedUser.findMany({
                where: {
                    id: { in: body.signatories.map((s) => s.roomAuthorizedUserId) },
                },
                select: { id: true, userId: true },
            });
            console.log("[setSignatories] resolved auth users:", authUsers);
            const authToUserId = new Map(authUsers.map((r) => [r.id, r.userId]));
            // Upsert by index — preserve existing arrangement rows (boxes drawn
            // during the Documents step are bound to these by index, so we can't
            // just delete them). Also (re)assign the user at each slot.
            const existing = yield tx.signatoryArrangement.findMany({
                where: { signatureQueueRoomId: body.queueRoomId },
                select: { id: true, index: true },
            });
            const byIndex = new Map(existing.map((r) => [r.index, r.id]));
            for (let i = 0; i < body.signatories.length; i++) {
                const userIdForSlot = (_a = authToUserId.get(body.signatories[i].roomAuthorizedUserId)) !== null && _a !== void 0 ? _a : null;
                const arrId = byIndex.get(i);
                console.log("[setSignatories] slot", i, {
                    roomAuthUserId: body.signatories[i].roomAuthorizedUserId,
                    userIdForSlot,
                    existingArrId: arrId,
                });
                if (!arrId) {
                    yield tx.signatoryArrangement.create({
                        data: {
                            signatureQueueRoomId: body.queueRoomId,
                            index: i,
                            status: 0,
                            userId: userIdForSlot,
                        },
                    });
                }
                else {
                    // Update assignment if it changed.
                    yield tx.signatoryArrangement.update({
                        where: { id: arrId },
                        data: { userId: userIdForSlot },
                    });
                }
            }
            // Drop any rows beyond the new count — placements bound to those
            // slots become orphaned (signCoor.signatoryArrangementId = NULL via
            // optional FK), which the editor surfaces so the user can re-assign.
            const drop = existing
                .filter((r) => r.index >= body.signatories.length)
                .map((r) => r.id);
            if (drop.length > 0) {
                yield tx.signatoryArrangement.deleteMany({
                    where: { id: { in: drop } },
                });
            }
            if (body.userId) {
                yield tx.documentActivityLogs.create({
                    data: {
                        userId: body.userId,
                        lineId: body.lineId,
                        title: "Updated signatory arrangement",
                        desc: `Set ${body.signatories.length} signator` +
                            `${body.signatories.length === 1 ? "y" : "ies"} on queue ${body.queueRoomId}`,
                        action: 2,
                    },
                });
            }
        }));
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
exports.setSignatoryArrangement = setSignatoryArrangement;
// ── Finalize: flip status from draft (0) → active (1) ──────────────────
const finalizeDissemination = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const body = req.body;
    if (!body.queueRoomId)
        throw new errors_1.ValidationError("INVALID REQUIRED ID");
    // Dispatching is the sending office's act, not anybody's.
    yield requireOwnsRouting(req, body.queueRoomId);
    try {
        const result = yield prisma_1.prisma.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            var _a, _b, _c, _d, _e, _f, _g;
            const queue = yield tx.signatureQueueRoom.findUnique({
                where: { id: body.queueRoomId },
                include: {
                    _count: { select: { targetRooms: true, documents: true } },
                },
            });
            if (!queue)
                throw new errors_1.NotFoundError("Routing not found");
            if (queue.status !== 0) {
                throw new errors_1.ValidationError("Already dispatched. Only drafts can be finalized.");
            }
            if (((_b = (_a = queue._count) === null || _a === void 0 ? void 0 : _a.targetRooms) !== null && _b !== void 0 ? _b : 0) === 0) {
                throw new errors_1.ValidationError("Add at least one recipient first.");
            }
            if (((_d = (_c = queue._count) === null || _c === void 0 ? void 0 : _c.documents) !== null && _d !== void 0 ? _d : 0) === 0) {
                throw new errors_1.ValidationError("Attach at least one document first.");
            }
            const updated = yield tx.signatureQueueRoom.update({
                where: { id: body.queueRoomId },
                data: { status: 1, step: 1 },
            });
            console.log("[finalize] queue updated:", {
                id: updated.id,
                status: updated.status,
                step: updated.step,
            });
            // Mark every addressee row as delivered. Copy-furnished rows are
            // deliberately left alone: they are delivered by releaseCopyFurnished
            // when the last signature lands, not when the document is dispatched.
            const targetUpdate = yield tx.targetRoom.updateMany({
                where: { signatureQueueRoomId: body.queueRoomId, copyFurnished: false },
                data: { status: 1, receivedAt: new Date() },
            });
            console.log("[finalize] target rows updated:", targetUpdate.count);
            // Diagnostic: what target rows actually exist for this queue?
            const targetsAfter = yield tx.targetRoom.findMany({
                where: { signatureQueueRoomId: body.queueRoomId },
                select: { id: true, receivingRoomId: true, status: true },
            });
            console.log("[finalize] target rows present:", targetsAfter);
            // A dissemination with no signatories is routed without e-sign, so
            // it is final the moment it is dispatched. "Once it is signed" with
            // nothing to sign means now — otherwise the copy-furnished offices
            // would wait on a signature that is never coming.
            const willBeSigned = yield tx.signatoryArrangement.count({
                where: { signatureQueueRoomId: body.queueRoomId },
            });
            if (willBeSigned === 0) {
                const early = yield (0, copyFurnish_1.releaseCopyFurnished)(tx, body.queueRoomId, (_e = body.userId) !== null && _e !== void 0 ? _e : null);
                if (early.released > 0) {
                    console.log("[finalize] no signatories — copy furnished immediately to:", early.rooms.join(", "));
                }
            }
            if (body.userId) {
                yield tx.documentActivityLogs.create({
                    data: {
                        userId: body.userId,
                        lineId: body.lineId,
                        title: "Dispatched routing",
                        desc: `Routing "${(_f = queue.title) !== null && _f !== void 0 ? _f : body.queueRoomId}" finalized and dispatched.`,
                        action: 1,
                    },
                });
            }
            // Real-time notifications to every signatory so they know they
            // have something to sign. We use the User.id from the arrangement
            // (set during the wizard's Signatories step).
            const signatories = yield tx.signatoryArrangement.findMany({
                where: {
                    signatureQueueRoomId: body.queueRoomId,
                    userId: { not: null },
                },
                select: { userId: true },
            });
            const seen = new Set();
            for (const s of signatories) {
                if (!s.userId || seen.has(s.userId))
                    continue;
                seen.add(s.userId);
                yield (0, notificationEvents_1.createUserNotification)(tx, {
                    recipientId: s.userId,
                    senderId: body.userId,
                    title: "Signature requested",
                    content: `You're a signatory on "${(_g = queue.title) !== null && _g !== void 0 ? _g : "a document"}". Open it from your Inbox to sign.`,
                    path: `documents/dissemination?tab=inbox`,
                });
            }
            return updated;
        }));
        return res.code(200).send({ message: "OK", id: result.id });
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
exports.finalizeDissemination = finalizeDissemination;
// ── Remove (drafts only) ───────────────────────────────────────────────
const removeDissemination = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const params = req.query;
    if (!params.id)
        throw new errors_1.ValidationError("INVALID REQUIRED ID");
    // Only the sending office may throw away its own draft.
    yield requireOwnsRouting(req, params.id);
    try {
        yield prisma_1.prisma.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            var _a;
            const queue = yield tx.signatureQueueRoom.findUnique({
                where: { id: params.id },
            });
            if (!queue)
                throw new errors_1.NotFoundError("Routing not found");
            if (queue.status !== 0) {
                throw new errors_1.ValidationError("Only draft routings can be removed.");
            }
            yield tx.signatureQueueRoom.delete({ where: { id: queue.id } });
            if (params.userId) {
                yield tx.documentActivityLogs.create({
                    data: {
                        userId: params.userId,
                        lineId: params.lineId,
                        title: "Removed routing",
                        desc: `Removed draft routing ${(_a = queue.title) !== null && _a !== void 0 ? _a : queue.id}`,
                        action: 0,
                    },
                });
            }
        }));
        return res.code(200).send({ message: "OK", id: params.id });
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
exports.removeDissemination = removeDissemination;
// ── Helper: list candidate target rooms for the disseminator ───────────
// Returns receiving rooms in the same line, excluding the from-room.
const targetRoomCandidates = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    const params = req.query;
    if (!params.lineId)
        throw new errors_1.ValidationError("INVALID REQUIRED ID");
    // Every office in a municipality, which is that municipality's list.
    yield (0, callerScope_1.requireSameLine)(req, params.lineId);
    try {
        const limit = params.limit ? parseInt(params.limit, 10) : 200;
        // Every room in the line, including the ones nobody can open yet.
        //
        // This used to filter to `authorizedUser: { some: {} }`, because a room
        // with no members is a room where a dispatch lands and is never seen.
        // That protection was right; hiding the room was not. An office that
        // exists in Document Rooms but is missing from this list looks like the
        // system lost it, and the sender has no way to find out why — you can
        // sit there seeing one office out of a dozen and nothing tells you the
        // other eleven are simply empty.
        //
        // So they all come back now, each carrying whether it can actually
        // receive anything. The picker greys out the ones that cannot and says
        // what to do about it, and setTargetRooms refuses them outright, so the
        // dispatch is still protected — the sender just knows why.
        const where = {
            lineId: params.lineId,
        };
        if (params.excludeRoomId)
            where.NOT = { id: params.excludeRoomId };
        if ((_a = params.query) === null || _a === void 0 ? void 0 : _a.trim()) {
            const q = params.query.trim();
            where.OR = [
                { address: { contains: q, mode: "insensitive" } },
                { code: { contains: q, mode: "insensitive" } },
            ];
        }
        const rows = yield prisma_1.prisma.receivingRoom.findMany({
            where,
            take: limit,
            orderBy: { timestamp: "desc" },
            select: {
                id: true,
                code: true,
                address: true,
                status: true,
                _count: { select: { authorizedUser: true } },
            },
        });
        // Only an ACTIVE membership held by a real user counts: a removed member
        // (status 0) and a placeholder row with no user are both nobody, and a
        // room holding only those is as empty as one holding nothing. That is a
        // different tally from the _count above, which is every row ever.
        const active = yield prisma_1.prisma.roomAuthorizedUser.groupBy({
            by: ["receivingRoomId"],
            where: Object.assign({ receivingRoomId: { in: rows.map((r) => r.id) } }, ACTIVE_MEMBER),
            _count: { _all: true },
        });
        const memberOf = new Map(active.map((a) => { var _a; return [(_a = a.receivingRoomId) !== null && _a !== void 0 ? _a : "", a._count._all]; }));
        const list = rows.map((r) => {
            var _a;
            const memberCount = (_a = memberOf.get(r.id)) !== null && _a !== void 0 ? _a : 0;
            return Object.assign(Object.assign({}, r), { memberCount, 
                /** False = the document would land where nobody can open it. */
                receivable: memberCount > 0 });
        });
        return res.code(200).send({
            list,
            // So the picker can explain a short list instead of just being short.
            summary: {
                total: list.length,
                receivable: list.filter((r) => r.receivable).length,
                needMembers: list.filter((r) => !r.receivable).length,
            },
        });
    }
    catch (error) {
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw new errors_1.AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
        }
        throw error;
    }
});
exports.targetRoomCandidates = targetRoomCandidates;
// ── Helper: list candidate signatories (room authorized users) ─────────
const signatoryCandidates = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    const params = req.query;
    if (!params.lineId)
        throw new errors_1.ValidationError("INVALID REQUIRED ID");
    // And everybody who could sign in it.
    yield (0, callerScope_1.requireSameLine)(req, params.lineId);
    try {
        const limit = params.limit ? parseInt(params.limit, 10) : 50;
        const where = {
            receivingRoom: { lineId: params.lineId },
        };
        if ((_a = params.query) === null || _a === void 0 ? void 0 : _a.trim()) {
            const q = params.query.trim();
            where.user = {
                OR: [
                    { firstName: { contains: q, mode: "insensitive" } },
                    { lastName: { contains: q, mode: "insensitive" } },
                    { username: { contains: q, mode: "insensitive" } },
                ],
            };
        }
        const rows = yield prisma_1.prisma.roomAuthorizedUser.findMany({
            where,
            take: limit,
            orderBy: { timestamp: "desc" },
            select: {
                id: true,
                type: true,
                user: {
                    select: {
                        id: true,
                        firstName: true,
                        lastName: true,
                        username: true,
                        Position: { select: { name: true } },
                    },
                },
                receivingRoom: {
                    select: { id: true, code: true, address: true },
                },
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
exports.signatoryCandidates = signatoryCandidates;
// ── Documents in a queue (for the placement editor) ────────────────────
// Returns the docs attached to a dissemination, including each page already
// known to us and any existing SignatureCoor placements (so the editor can
// hydrate when the user re-enters).
const disseminationDocuments = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const params = req.query;
    if (!params.queueRoomId)
        throw new errors_1.ValidationError("INVALID REQUIRED ID");
    // Only the people this routing actually involves.
    yield requireCanSeeRouting(req, params.queueRoomId);
    try {
        const docs = yield prisma_1.prisma.document.findMany({
            where: { signatureQueueRoomId: params.queueRoomId },
            orderBy: { timestamp: "asc" },
            select: {
                id: true,
                title: true,
                size: true,
                timestamp: true,
                file: { select: { fileName: true, fileType: true, fileSize: true } },
                pages: {
                    select: {
                        id: true,
                        page: true,
                        signCoor: {
                            select: {
                                id: true,
                                xAxis: true,
                                yAxis: true,
                                width: true,
                                height: true,
                                signatoryArrangementId: true,
                            },
                        },
                    },
                    orderBy: { page: "asc" },
                },
            },
        });
        const signatories = yield prisma_1.prisma.signatoryArrangement.findMany({
            where: { signatureQueueRoomId: params.queueRoomId },
            orderBy: { index: "asc" },
            select: { id: true, index: true, status: true },
        });
        return res.code(200).send({ documents: docs, signatories });
    }
    catch (error) {
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw new errors_1.AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
        }
        throw error;
    }
});
exports.disseminationDocuments = disseminationDocuments;
// ── Stream the raw document bytes (for the PDF viewer) ─────────────────
const streamDocumentFile = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const params = req.query;
    if (!params.id)
        throw new errors_1.ValidationError("INVALID REQUIRED ID");
    // Routing file or a private Self Sign upload — the document decides.
    yield requireCanSeeDocument(req, params.id);
    try {
        const file = yield prisma_1.prisma.decodedFile.findFirst({
            where: { documentId: params.id },
        });
        if (!file || !file.fileDecoded) {
            throw new errors_1.NotFoundError("FILE NOT FOUND");
        }
        const buf = Buffer.from(file.fileDecoded);
        res.header("Content-Type", file.fileType || "application/octet-stream");
        res.header("Content-Disposition", `inline; filename="${file.fileName || "document.pdf"}"`);
        res.header("Content-Length", buf.length.toString());
        return res.code(200).send(buf);
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
exports.streamDocumentFile = streamDocumentFile;
// ── Save signature placements (per document, replace strategy) ─────────
// Each placement is anchored to a page number. We create the DocumentPage
// row lazily if it doesn't exist yet. Coordinates are basis points (0-10000)
// of the rendered page so they remain resolution-independent.
const saveSignaturePlacements = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const body = req.body;
    if (!body.queueRoomId || !body.documentId || !Array.isArray(body.placements)) {
        throw new errors_1.ValidationError("INVALID REQUIRED FIELDS");
    }
    // Only the office sending it may move the signature boxes.
    yield requireOwnsRouting(req, body.queueRoomId);
    try {
        yield prisma_1.prisma.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            const queue = yield tx.signatureQueueRoom.findUnique({
                where: { id: body.queueRoomId },
            });
            if (!queue)
                throw new errors_1.NotFoundError("Routing not found");
            if (queue.status !== 0) {
                throw new errors_1.ValidationError("Cannot edit placements after dispatch.");
            }
            const doc = yield tx.document.findUnique({
                where: { id: body.documentId },
                select: { id: true, signatureQueueRoomId: true },
            });
            if (!doc || doc.signatureQueueRoomId !== body.queueRoomId) {
                throw new errors_1.ValidationError("Document does not belong to this queue.");
            }
            // Group placements by page, ensure DocumentPage rows exist.
            const pages = Array.from(new Set(body.placements.map((p) => p.page))).filter((n) => Number.isFinite(n) && n > 0);
            const existing = yield tx.documentPage.findMany({
                where: { documentId: body.documentId, page: { in: pages } },
                select: { id: true, page: true },
            });
            const byPage = new Map(existing.map((p) => [p.page, p.id]));
            for (const p of pages) {
                if (!byPage.has(p)) {
                    const created = yield tx.documentPage.create({
                        data: { documentId: body.documentId, page: p, content: "" },
                        select: { id: true, page: true },
                    });
                    byPage.set(p, created.id);
                }
            }
            // Drop all existing placements for this document, then recreate.
            const allPagesForDoc = yield tx.documentPage.findMany({
                where: { documentId: body.documentId },
                select: { id: true },
            });
            const allPageIds = allPagesForDoc.map((p) => p.id);
            if (allPageIds.length > 0) {
                yield tx.signatureCoor.deleteMany({
                    where: { documentPageId: { in: allPageIds } },
                });
            }
            // Resolve slot indexes to SignatoryArrangement rows (creating any
            // that don't exist yet on this queue).
            const slots = Array.from(new Set(body.placements.map((p) => p.slotIndex))).filter((n) => Number.isFinite(n) && n >= 1);
            const slotToArrId = new Map();
            if (slots.length > 0) {
                const arr = yield tx.signatoryArrangement.findMany({
                    where: {
                        signatureQueueRoomId: body.queueRoomId,
                        index: { in: slots.map((s) => s - 1) },
                    },
                    select: { id: true, index: true },
                });
                for (const r of arr)
                    slotToArrId.set(r.index + 1, r.id);
                for (const s of slots) {
                    if (!slotToArrId.has(s)) {
                        const created = yield tx.signatoryArrangement.create({
                            data: {
                                signatureQueueRoomId: body.queueRoomId,
                                index: s - 1,
                                status: 0,
                            },
                            select: { id: true },
                        });
                        slotToArrId.set(s, created.id);
                    }
                }
            }
            if (body.placements.length > 0) {
                yield tx.signatureCoor.createMany({
                    data: body.placements.map((p) => ({
                        documentPageId: byPage.get(p.page),
                        signatoryArrangementId: slotToArrId.get(p.slotIndex),
                        xAxis: Math.round(p.xAxis),
                        yAxis: Math.round(p.yAxis),
                        width: Math.round(p.width),
                        height: Math.round(p.height),
                    })),
                });
            }
            if (body.userId) {
                yield tx.documentActivityLogs.create({
                    data: {
                        userId: body.userId,
                        lineId: body.lineId,
                        title: "Updated signature placements",
                        desc: `Saved ${body.placements.length} placement` +
                            `${body.placements.length === 1 ? "" : "s"} for document ${body.documentId}`,
                        action: 2,
                    },
                });
            }
        }));
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
exports.saveSignaturePlacements = saveSignaturePlacements;
// ── Upload a document to a queue (draft-only) ──────────────────────────
const ALLOWED_DOC_MIMES = new Set([
    "application/pdf",
]);
const MAX_DOC_BYTES = 25 * 1024 * 1024; // 25 MB
const uploadDisseminationDocument = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, e_1, _b, _c, _d, e_2, _e, _f;
    if (!req.isMultipart())
        throw new errors_1.ValidationError("INVALID REQUEST");
    try {
        const parts = req.parts();
        const formData = {};
        let upload = null;
        try {
            for (var _g = true, parts_1 = __asyncValues(parts), parts_1_1; parts_1_1 = yield parts_1.next(), _a = parts_1_1.done, !_a; _g = true) {
                _c = parts_1_1.value;
                _g = false;
                const part = _c;
                if (part.type === "file") {
                    const chunks = [];
                    try {
                        for (var _h = true, _j = (e_2 = void 0, __asyncValues(part.file)), _k; _k = yield _j.next(), _d = _k.done, !_d; _h = true) {
                            _f = _k.value;
                            _h = false;
                            const chunk = _f;
                            chunks.push(chunk);
                        }
                    }
                    catch (e_2_1) { e_2 = { error: e_2_1 }; }
                    finally {
                        try {
                            if (!_h && !_d && (_e = _j.return)) yield _e.call(_j);
                        }
                        finally { if (e_2) throw e_2.error; }
                    }
                    upload = {
                        filename: part.filename,
                        mimetype: part.mimetype,
                        buffer: Buffer.concat(chunks),
                    };
                }
                else {
                    formData[part.fieldname] = String(part.value);
                }
            }
        }
        catch (e_1_1) { e_1 = { error: e_1_1 }; }
        finally {
            try {
                if (!_g && !_a && (_b = parts_1.return)) yield _b.call(parts_1);
            }
            finally { if (e_1) throw e_1.error; }
        }
        if (!upload)
            throw new errors_1.ValidationError("FILE REQUIRED");
        if (!ALLOWED_DOC_MIMES.has(upload.mimetype)) {
            throw new errors_1.ValidationError("ONLY PDF FILES ARE ALLOWED");
        }
        if (upload.buffer.length > MAX_DOC_BYTES) {
            throw new errors_1.ValidationError("FILE EXCEEDS 25MB LIMIT");
        }
        const { queueRoomId, userId, lineId, title } = formData;
        // Only the sending office may attach to this routing. The check has to
        // sit here rather than at the top: queueRoomId arrives as a form field,
        // so it is not known until the multipart body has been read.
        if (!queueRoomId)
            throw new errors_1.ValidationError("INVALID REQUIRED ID");
        yield requireOwnsRouting(req, queueRoomId);
        if (!queueRoomId || !lineId) {
            throw new errors_1.ValidationError("INVALID REQUIRED FIELDS");
        }
        const queue = yield prisma_1.prisma.signatureQueueRoom.findUnique({
            where: { id: queueRoomId },
            select: { id: true, status: true, receivingRoomId: true },
        });
        if (!queue)
            throw new errors_1.NotFoundError("Routing not found");
        if (queue.status !== 0) {
            throw new errors_1.ValidationError("Cannot attach documents after dispatch.");
        }
        const created = yield prisma_1.prisma.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            const doc = yield tx.document.create({
                data: {
                    title: title || upload.filename,
                    size: upload.buffer.length,
                    lineId,
                    userId: userId || undefined,
                    signatureQueueRoomId: queueRoomId,
                    receivingRoomId: queue.receivingRoomId,
                    docType: 0,
                    type: 0,
                    original: 1,
                },
                select: { id: true, title: true, size: true, timestamp: true },
            });
            yield tx.decodedFile.create({
                data: {
                    documentId: doc.id,
                    fileName: upload.filename,
                    fileSize: String(upload.buffer.length),
                    fileType: upload.mimetype,
                    fileDecoded: upload.buffer,
                },
            });
            if (userId) {
                yield tx.documentActivityLogs.create({
                    data: {
                        userId,
                        lineId,
                        title: "Attached document",
                        desc: `Attached ${upload.filename} to routing ${queueRoomId}`,
                        action: 1,
                    },
                });
            }
            return doc;
        }));
        return res.code(200).send({ message: "OK", document: created });
    }
    catch (error) {
        if (error instanceof errors_1.ValidationError)
            throw error;
        if (error instanceof errors_1.NotFoundError)
            throw error;
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw new errors_1.AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
        }
        throw error;
    }
});
exports.uploadDisseminationDocument = uploadDisseminationDocument;
// ── Remove a queue document (draft-only) ───────────────────────────────
const removeDisseminationDocument = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const params = req.query;
    if (!params.id || !params.queueRoomId) {
        throw new errors_1.ValidationError("INVALID REQUIRED ID");
    }
    // Only the sending office may detach a document.
    yield requireOwnsRouting(req, params.queueRoomId);
    try {
        yield prisma_1.prisma.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            var _a;
            const queue = yield tx.signatureQueueRoom.findUnique({
                where: { id: params.queueRoomId },
                select: { id: true, status: true },
            });
            if (!queue)
                throw new errors_1.NotFoundError("Routing not found");
            if (queue.status !== 0) {
                throw new errors_1.ValidationError("Cannot remove documents after dispatch.");
            }
            const doc = yield tx.document.findUnique({
                where: { id: params.id },
                select: { id: true, signatureQueueRoomId: true, title: true },
            });
            if (!doc || doc.signatureQueueRoomId !== params.queueRoomId) {
                throw new errors_1.ValidationError("Document does not belong to this queue.");
            }
            yield tx.document.delete({ where: { id: doc.id } });
            if (params.userId) {
                yield tx.documentActivityLogs.create({
                    data: {
                        userId: params.userId,
                        lineId: params.lineId || "",
                        title: "Removed document",
                        desc: `Removed ${(_a = doc.title) !== null && _a !== void 0 ? _a : doc.id} from routing ${params.queueRoomId}`,
                        action: 0,
                    },
                });
            }
        }));
        return res.code(200).send({ message: "OK", id: params.id });
    }
    catch (error) {
        if (error instanceof errors_1.ValidationError)
            throw error;
        if (error instanceof errors_1.NotFoundError)
            throw error;
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw new errors_1.AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
        }
        throw error;
    }
});
exports.removeDisseminationDocument = removeDisseminationDocument;
// ── Self-repair: ensure the current user has a ReceivingRoom membership ─
// Plug for the historical approval bug where requesters whose own
// roomRegistration was approved never got a RoomAuthorizedUser row.
// Idempotent: if they're already in a room, returns it.
const repairRoomMembership = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const body = req.body;
    if (!body.userId)
        throw new errors_1.ValidationError("INVALID REQUIRED ID");
    // Repairing a person's room membership is something you do to
    // yourself. It mints rooms and moves people between them.
    yield (0, callerScope_1.requireSelf)(req, body.userId);
    try {
        const result = yield prisma_1.prisma.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            // Already a member somewhere? Nothing to do.
            const existing = yield tx.receivingRoom.findFirst({
                where: { authorizedUser: { some: { userId: body.userId } } },
                select: { id: true, code: true },
            });
            if (existing)
                return { action: "noop", room: existing };
            // Find their most recent approved registration.
            const reg = yield tx.roomRegistration.findFirst({
                where: { userId: body.userId, status: 1 },
                orderBy: { dateApproved: "desc" },
                include: { authorizedUser: true },
            });
            if (!reg) {
                throw new errors_1.ValidationError("No approved room registration found for this user.");
            }
            // Always mint a fresh ReceivingRoom for this user — sharing rooms
            // across registrations by lineId+address caused two recipients to
            // resolve to the same room id (Room 1 dispatches to Room 2 but
            // Room 2's user landed in Room 1's record). Each registration
            // approval owns exactly one room.
            const created = yield tx.receivingRoom.create({
                data: {
                    address: reg.address,
                    code: `RM-${Math.random().toString(36).slice(2, 9).toUpperCase()}`,
                    lineId: reg.lineId,
                },
                select: { id: true, code: true },
            });
            const room = created;
            // Build the membership list (requester + co-signatories), dedupe.
            const members = [
                { userId: reg.userId, type: 0 },
                ...reg.authorizedUser.map((u) => ({ userId: u.userId, type: u.type })),
            ];
            const seen = new Set();
            const unique = members.filter((m) => {
                if (seen.has(m.userId))
                    return false;
                seen.add(m.userId);
                return true;
            });
            // Only insert the ones not already linked to this room.
            const already = yield tx.roomAuthorizedUser.findMany({
                where: {
                    receivingRoomId: room.id,
                    userId: { in: unique.map((u) => u.userId) },
                },
                select: { userId: true },
            });
            const linked = new Set(already.map((r) => r.userId));
            const toInsert = unique.filter((u) => !linked.has(u.userId));
            if (toInsert.length > 0) {
                yield tx.roomAuthorizedUser.createMany({
                    data: toInsert.map((m) => ({
                        userId: m.userId,
                        type: m.type,
                        receivingRoomId: room.id,
                    })),
                });
            }
            return { action: "repaired", room, inserted: toInsert.length };
        }));
        return res.code(200).send(result);
    }
    catch (error) {
        if (error instanceof errors_1.ValidationError)
            throw error;
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw new errors_1.AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
        }
        throw error;
    }
});
exports.repairRoomMembership = repairRoomMembership;
// ─── Document module overview (panel stats) ────────────────────────────
// Backs the home panel of the Document module. Numbers are live, scoped
// by line (and the active user's receiving room for inbox/outbox counts).
const documentOverview = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d, _e, _f;
    const params = req.query;
    if (!params.lineId)
        throw new errors_1.ValidationError("INVALID REQUIRED ID");
    // These are all "my" numbers, so they come from the token, not the URL.
    // The userId in the query used to be trusted, which meant anyone could
    // read another person's inbox count, outbox count and signature count by
    // typing their id. It is ignored now.
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
    // The line is likewise the caller's own. It is still taken from the
    // request because the caller's own record does not always carry one, but
    // it has to agree with what the account says, or these are somebody
    // else's totals.
    const ownLine = (_e = (_d = (_c = account === null || account === void 0 ? void 0 : account.User) === null || _c === void 0 ? void 0 : _c.lineId) !== null && _d !== void 0 ? _d : account === null || account === void 0 ? void 0 : account.lineId) !== null && _e !== void 0 ? _e : null;
    if (!ownLine || ownLine !== params.lineId) {
        console.warn(`[overview] refused: account ${accountId} asked for line ${params.lineId}`);
        throw new errors_1.UnauthorizedError("This is not your municipality's data.");
    }
    try {
        // The caller's own receiving room, for the inbox and outbox tiles.
        // Membership has to be ACTIVE: a room somebody was removed from is not
        // theirs any more, and its counts are not theirs to see.
        const room = yield prisma_1.prisma.receivingRoom.findFirst({
            where: {
                lineId: params.lineId,
                authorizedUser: { some: { userId: actorId, status: 1 } },
            },
            select: { id: true },
        });
        const roomId = (_f = room === null || room === void 0 ? void 0 : room.id) !== null && _f !== void 0 ? _f : null;
        const [archiveTotal, disseminationDraft, disseminationActive, disseminationCompleted, inboxTotal, outboxTotal, pendingForMe, signaturesTotal,] = yield Promise.all([
            prisma_1.prisma.archiveDocument.count({ where: { lineId: params.lineId } }),
            prisma_1.prisma.signatureQueueRoom.count({
                where: { fromRoom: { lineId: params.lineId }, status: 0 },
            }),
            prisma_1.prisma.signatureQueueRoom.count({
                where: { fromRoom: { lineId: params.lineId }, status: 1 },
            }),
            prisma_1.prisma.signatureQueueRoom.count({
                where: { fromRoom: { lineId: params.lineId }, status: 2 },
            }),
            roomId
                ? prisma_1.prisma.targetRoom.count({
                    where: Object.assign({ receivingRoomId: roomId, queueRoom: { is: { status: { gte: 1 } } } }, copyFurnish_1.VISIBLE_TO_ROOM),
                })
                : Promise.resolve(0),
            roomId
                ? prisma_1.prisma.signatureQueueRoom.count({
                    where: { receivingRoomId: roomId, status: { gte: 1 } },
                })
                : Promise.resolve(0),
            // "Pending my signature" had no userId filter and no line filter,
            // so it counted every unsigned slot in the database and showed the
            // same number to everybody — 47 here, on every dashboard. It is the
            // caller's own slots now, on their own line.
            prisma_1.prisma.signatoryArrangement.count({
                where: {
                    userId: actorId,
                    status: 0,
                    signatureQueueRoom: {
                        status: 1,
                        fromRoom: { lineId: params.lineId },
                    },
                },
            }),
            prisma_1.prisma.signature.count({ where: { userId: actorId } }),
        ]);
        return res.code(200).send({
            archive: { total: archiveTotal },
            dissemination: {
                draft: disseminationDraft,
                active: disseminationActive,
                completed: disseminationCompleted,
            },
            myRoom: { id: roomId, inbox: inboxTotal, outbox: outboxTotal },
            signatures: { mine: signaturesTotal, pendingForMe },
        });
    }
    catch (error) {
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw new errors_1.AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
        }
        throw error;
    }
});
exports.documentOverview = documentOverview;
// ─── Reset membership: peel the user off whatever room they're in and ──
// mint a brand new ReceivingRoom for them. Cleans up the cross-linked
// state caused by an earlier buggy repair that matched rooms by
// (lineId, address) and ended up sharing a single room across multiple
// registrations.
const resetRoomMembership = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const body = req.body;
    if (!body.userId)
        throw new errors_1.ValidationError("INVALID REQUIRED ID");
    // Same: this peels somebody off their room and mints them a new
    // one, which is how an outbox appears to vanish.
    yield (0, callerScope_1.requireSelf)(req, body.userId);
    try {
        const result = yield prisma_1.prisma.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            const reg = yield tx.roomRegistration.findFirst({
                where: { userId: body.userId, status: 1 },
                orderBy: { dateApproved: "desc" },
                include: { authorizedUser: true },
            });
            if (!reg) {
                throw new errors_1.ValidationError("No approved room registration found for this user.");
            }
            // Snapshot the rooms this user belongs to BEFORE we unlink them,
            // so we can clean up any that become orphaned by the reset.
            const beforeRooms = yield tx.roomAuthorizedUser.findMany({
                where: { userId: body.userId },
                select: { receivingRoomId: true },
            });
            const beforeRoomIds = Array.from(new Set(beforeRooms
                .map((r) => r.receivingRoomId)
                .filter((id) => !!id)));
            // Drop every existing membership row for this user.
            yield tx.roomAuthorizedUser.deleteMany({
                where: { userId: body.userId },
            });
            // For each old room: if no other user is still linked AND no
            // dissemination has been dispatched from/to it, delete it.
            // Otherwise leave it alone (active data).
            for (const oldId of beforeRoomIds) {
                const stillLinked = yield tx.roomAuthorizedUser.count({
                    where: { receivingRoomId: oldId },
                });
                if (stillLinked > 0)
                    continue;
                const sentFrom = yield tx.signatureQueueRoom.count({
                    where: { receivingRoomId: oldId },
                });
                const targetedTo = yield tx.targetRoom.count({
                    where: { receivingRoomId: oldId },
                });
                if (sentFrom === 0 && targetedTo === 0) {
                    yield tx.receivingRoom.delete({ where: { id: oldId } });
                }
            }
            // Mint a fresh, dedicated ReceivingRoom.
            const room = yield tx.receivingRoom.create({
                data: {
                    address: reg.address,
                    code: `RM-${Math.random().toString(36).slice(2, 9).toUpperCase()}`,
                    lineId: reg.lineId,
                },
                select: { id: true, code: true },
            });
            // Insert the new owner-membership row.
            yield tx.roomAuthorizedUser.create({
                data: {
                    userId: body.userId,
                    type: 0,
                    receivingRoomId: room.id,
                },
            });
            // Pull in co-signatories from the registration — but only if they
            // aren't already members of some other room (don't yank them out).
            for (const u of reg.authorizedUser) {
                if (u.userId === body.userId)
                    continue;
                const linked = yield tx.roomAuthorizedUser.findFirst({
                    where: { userId: u.userId },
                    select: { id: true },
                });
                if (!linked) {
                    yield tx.roomAuthorizedUser.create({
                        data: {
                            userId: u.userId,
                            type: u.type,
                            receivingRoomId: room.id,
                        },
                    });
                }
            }
            return { room };
        }));
        return res.code(200).send(Object.assign({ message: "OK" }, result));
    }
    catch (error) {
        if (error instanceof errors_1.ValidationError)
            throw error;
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw new errors_1.AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
        }
        throw error;
    }
});
exports.resetRoomMembership = resetRoomMembership;
// ─── View a dispatched dissemination (signing page) ────────────────────
// Returns the full queue with documents, page placements, every
// SignatoryArrangement (with its user + signed-at signature image when
// applicable). The frontend uses this to render docs with overlays
// showing whose-signed-what.
const viewDissemination = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    const params = req.query;
    if (!params.id)
        throw new errors_1.ValidationError("INVALID REQUIRED ID");
    // Only the people this routing actually involves.
    yield requireCanSeeRouting(req, params.id);
    try {
        const row = yield prisma_1.prisma.signatureQueueRoom.findUnique({
            where: { id: params.id },
            include: {
                fromRoom: { select: { id: true, code: true, address: true } },
                targetRooms: {
                    select: {
                        id: true,
                        status: true,
                        receivedAt: true,
                        copyFurnished: true,
                        releasedAt: true,
                        acknowledgedAt: true,
                        acknowledgedNote: true,
                        acknowledgedBy: {
                            select: { id: true, firstName: true, lastName: true },
                        },
                        roomReceiver: { select: { id: true, code: true } },
                    },
                },
                documents: {
                    select: {
                        id: true,
                        title: true,
                        size: true,
                        timestamp: true,
                        file: { select: { fileName: true, fileType: true } },
                        pages: {
                            orderBy: { page: "asc" },
                            select: {
                                id: true,
                                page: true,
                                signCoor: {
                                    select: {
                                        id: true,
                                        xAxis: true,
                                        yAxis: true,
                                        width: true,
                                        height: true,
                                        signatoryArrangementId: true,
                                    },
                                },
                            },
                        },
                    },
                },
                signatotyArrangement: {
                    orderBy: { index: "asc" },
                    select: {
                        id: true,
                        index: true,
                        status: true,
                        signedAt: true,
                        userId: true,
                        user: {
                            select: {
                                id: true,
                                firstName: true,
                                lastName: true,
                                username: true,
                                Position: { select: { name: true } },
                            },
                        },
                    },
                },
                user: {
                    select: {
                        id: true,
                        firstName: true,
                        lastName: true,
                        Position: { select: { name: true } },
                    },
                },
            },
        });
        if (!row)
            throw new errors_1.NotFoundError("Routing not found");
        // Pull each signer's active signature image (base64) so the renderer
        // can stamp it inside the SignatureCoor boxes without an extra fetch.
        const signedUserIds = Array.from(new Set(row.signatotyArrangement
            .filter((a) => a.status === 1 && a.userId)
            .map((a) => a.userId)));
        let signaturesByUser = {};
        console.log("[view] signedUserIds:", signedUserIds);
        if (signedUserIds.length > 0) {
            // Prefer active signatures, fall back to the user's most recent
            // signature if no active flag is set. Either way every signed
            // arrangement gets an image we can stamp into the box.
            let sigs = yield prisma_1.prisma.signature.findMany({
                where: { userId: { in: signedUserIds }, active: true },
                select: {
                    id: true,
                    userId: true,
                    title: true,
                    signature: true,
                    inkHeightPt: true,
                    baselinePct: true,
                    inkX0: true,
                    inkY0: true,
                    inkX1: true,
                    inkY1: true,
                },
            });
            console.log("[view] active sigs found:", sigs.length);
            const usersWithSig = new Set(sigs.map((s) => s.userId));
            const missing = signedUserIds.filter((id) => !usersWithSig.has(id));
            if (missing.length > 0) {
                const fallback = yield prisma_1.prisma.signature.findMany({
                    where: { userId: { in: missing } },
                    orderBy: { timestamp: "desc" },
                    select: {
                        id: true,
                        userId: true,
                        title: true,
                        signature: true,
                        inkHeightPt: true,
                        baselinePct: true,
                        inkX0: true,
                        inkY0: true,
                        inkX1: true,
                        inkY1: true,
                    },
                });
                console.log("[view] fallback sigs for missing users:", fallback.map((s) => ({ userId: s.userId, hasBytes: !!s.signature })));
                const seen = new Set();
                for (const s of fallback) {
                    if (!s.userId || seen.has(s.userId))
                        continue;
                    seen.add(s.userId);
                    sigs.push(s);
                }
            }
            for (const s of sigs) {
                if (!s.signature || !s.userId) {
                    console.log("[view] SKIPPING sig — userId:", s.userId, "hasBytes:", !!s.signature);
                    continue;
                }
                const buf = Buffer.from(s.signature);
                console.log("[view] encoding sig — userId:", s.userId, "bytes:", buf.length, "first4:", [buf[0], buf[1], buf[2], buf[3]]);
                // Three possible storage formats observed in the wild:
                //   1. Raw image bytes (PNG/JPEG/WebP/SVG magic bytes at offset 0).
                //   2. A base64-encoded string of those bytes.
                //   3. A full `data:image/...;base64,...` data URL string.
                // Handle all three so the UI always gets a working data URL.
                let dataUrl;
                let mime = "image/png";
                // PNG magic bytes
                const isPng = buf.length >= 4 &&
                    buf[0] === 0x89 &&
                    buf[1] === 0x50 &&
                    buf[2] === 0x4e &&
                    buf[3] === 0x47;
                const isJpeg = buf.length >= 3 &&
                    buf[0] === 0xff &&
                    buf[1] === 0xd8 &&
                    buf[2] === 0xff;
                const isWebp = buf.length >= 12 &&
                    buf[0] === 0x52 &&
                    buf[1] === 0x49 &&
                    buf[2] === 0x46 &&
                    buf[3] === 0x46 &&
                    buf[8] === 0x57 &&
                    buf[9] === 0x45 &&
                    buf[10] === 0x42 &&
                    buf[11] === 0x50;
                if (isPng || isJpeg || isWebp) {
                    mime = isPng ? "image/png" : isJpeg ? "image/jpeg" : "image/webp";
                    dataUrl = `data:${mime};base64,${buf.toString("base64")}`;
                }
                else {
                    // Try treating it as a string (case 2 or 3).
                    const asText = buf.toString("utf8").trim();
                    if (asText.startsWith("data:image/")) {
                        // Case 3: already a data URL.
                        dataUrl = asText;
                        const m = asText.match(/^data:([^;]+);/);
                        if (m)
                            mime = m[1];
                    }
                    else if (asText.startsWith("<svg") || asText.startsWith("<?xml")) {
                        mime = "image/svg+xml";
                        dataUrl = `data:${mime};base64,${Buffer.from(asText, "utf8").toString("base64")}`;
                    }
                    else if (/^[A-Za-z0-9+/=\r\n]+$/.test(asText.slice(0, 200))) {
                        // Case 2: base64 string. Assume PNG (most common).
                        dataUrl = `data:image/png;base64,${asText.replace(/\s+/g, "")}`;
                    }
                    else {
                        // Unknown shape — last resort, encode whatever's there as PNG.
                        dataUrl = `data:image/png;base64,${buf.toString("base64")}`;
                    }
                }
                signaturesByUser[s.userId] = {
                    id: s.id,
                    title: (_a = s.title) !== null && _a !== void 0 ? _a : null,
                    mime,
                    dataUrl,
                    placement: {
                        inkHeightPt: s.inkHeightPt,
                        baselinePct: s.baselinePct,
                        ink: s.inkX0 === null || s.inkY0 === null || s.inkX1 === null || s.inkY1 === null
                            ? null
                            : { x0: s.inkX0, y0: s.inkY0, x1: s.inkX1, y1: s.inkY1 },
                    },
                };
            }
        }
        console.log("[view] signaturesByUser keys returned:", Object.keys(signaturesByUser));
        return res.code(200).send({ queue: row, signaturesByUser });
    }
    catch (error) {
        if (error instanceof errors_1.NotFoundError)
            throw error;
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw new errors_1.AppError(error.message, 500, error.code);
        }
        throw error;
    }
});
exports.viewDissemination = viewDissemination;
// ─── Sign every pending slot assigned to the current user ──────────────
// One click → flips every SignatoryArrangement where
// (userId = me, signatureQueueRoomId = queue, status = 0) to status=1.
// If every arrangement on the queue is now signed, the queue also rolls
// from "active" (1) → "completed" (2).
const signMine = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const body = req.body;
    if (!body.queueRoomId) {
        throw new errors_1.ValidationError("INVALID REQUIRED FIELDS");
    }
    // SECURITY: the actor is whoever holds the token — never whoever the body
    // claims. This previously trusted `body.userId`, so any authenticated user
    // could name someone else's id and act as them. For signing in particular
    // that meant applying ANOTHER PERSON'S signature to a document, which is the
    // single worst thing an e-signature system can permit. A mismatch is refused
    // outright rather than quietly corrected, so misuse is visible in the logs.
    const actorId = yield (0, handler_1.callerUserId)(req);
    if (!actorId)
        throw new errors_1.UnauthorizedError("Not signed in");
    if (body.userId && body.userId !== actorId) {
        console.warn(`[signMine] refused: user ${actorId} attempted to act as ${body.userId}`);
        throw new errors_1.UnauthorizedError("You can only act on your own behalf.");
    }
    body.userId = actorId;
    try {
        const result = yield prisma_1.prisma.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            var _a, _b, _c, _d, _e, _f, _g, _h, _j;
            // Pull the queue WITH its from-room so we can grab the real lineId
            // for activity logging. Earlier this used `queue.receivingRoomId`
            // (a ReceivingRoom id, not a Line id) which violated the FK and
            // made the whole tx fail with DB_CONNECTION_FAILED.
            const queue = yield tx.signatureQueueRoom.findUnique({
                where: { id: body.queueRoomId },
                include: { fromRoom: { select: { lineId: true } } },
            });
            if (!queue)
                throw new errors_1.NotFoundError("Routing not found");
            if (queue.status !== 1) {
                throw new errors_1.ValidationError("Only active (dispatched) routings can be signed.");
            }
            // Confirm the user has an active signature on file — refusing to
            // sign without one prevents a "signed but invisible" state.
            const sig = yield tx.signature.findFirst({
                where: { userId: body.userId, active: true },
                select: { id: true },
            });
            if (!sig) {
                throw new errors_1.ValidationError("You don't have an active signature on file. Upload and activate one in Signature Management first.");
            }
            // Sign every pending slot either assigned to this user OR currently
            // unassigned. Auto-binding the unassigned ones to the signer means
            // the signing flow works on old dispatches (created before the
            // userId column existed) without a separate Claim step.
            const pending = yield tx.signatoryArrangement.findMany({
                where: {
                    signatureQueueRoomId: body.queueRoomId,
                    status: 0,
                    OR: [{ userId: body.userId }, { userId: null }],
                },
                select: { id: true, userId: true, index: true },
            });
            console.log("[signMine] pending matches:", pending);
            if (pending.length === 0) {
                return { signed: 0, completed: false };
            }
            const now = new Date();
            // Stamp signedAt + status + userId + geolocation in one updateMany
            // so unassigned slots end up owned by the signer and the geo lands
            // alongside the signing event for the verification QR.
            yield tx.signatoryArrangement.updateMany({
                where: { id: { in: pending.map((p) => p.id) } },
                data: {
                    status: 1,
                    signedAt: now,
                    userId: body.userId,
                    signedLat: (_b = (_a = body.geo) === null || _a === void 0 ? void 0 : _a.lat) !== null && _b !== void 0 ? _b : null,
                    signedLng: (_d = (_c = body.geo) === null || _c === void 0 ? void 0 : _c.lng) !== null && _d !== void 0 ? _d : null,
                    signedAccuracy: (_f = (_e = body.geo) === null || _e === void 0 ? void 0 : _e.accuracy) !== null && _f !== void 0 ? _f : null,
                },
            });
            // If every arrangement on the queue is now status >= 1, mark the
            // queue completed.
            const remaining = yield tx.signatoryArrangement.count({
                where: { signatureQueueRoomId: body.queueRoomId, status: 0 },
            });
            let completed = false;
            if (remaining === 0) {
                yield tx.signatureQueueRoom.update({
                    where: { id: body.queueRoomId },
                    data: { status: 2 },
                });
                completed = true;
            }
            // Only write the activity log when we have a real lineId — the FK
            // is optional, so passing undefined skips the constraint cleanly.
            const realLineId = (_h = (_g = queue.fromRoom) === null || _g === void 0 ? void 0 : _g.lineId) !== null && _h !== void 0 ? _h : undefined;
            if (realLineId) {
                yield tx.documentActivityLogs.create({
                    data: {
                        userId: body.userId,
                        lineId: realLineId,
                        title: completed
                            ? "Signed and completed routing"
                            : "Signed routing slots",
                        desc: `Signed ${pending.length} slot${pending.length === 1 ? "" : "s"} on queue ${body.queueRoomId}` +
                            (completed ? " (queue completed)" : ""),
                        action: 1,
                    },
                });
            }
            // Every signature is in, so the copy-furnished offices get it now.
            // Inside the same transaction as the signature that completed the
            // queue: if the signature is rolled back the release goes with it,
            // and nobody is copy furnished on a document that was never signed.
            let furnished = { released: 0, rooms: [] };
            if (completed) {
                furnished = yield (0, copyFurnish_1.releaseCopyFurnished)(tx, body.queueRoomId, body.userId);
                if (furnished.released > 0) {
                    console.log("[signMine] copy furnished to:", furnished.rooms.join(", "));
                }
            }
            // Notify the disseminator that someone signed, and notify everyone
            // if this was the last signature (queue now concluded).
            const everyone = yield tx.signatoryArrangement.findMany({
                where: {
                    signatureQueueRoomId: body.queueRoomId,
                    userId: { not: null },
                },
                select: { userId: true },
            });
            const recipients = new Set();
            // include the disseminator
            const queueOwner = yield tx.signatureQueueRoom.findUnique({
                where: { id: body.queueRoomId },
                select: { userId: true, title: true },
            });
            if (queueOwner === null || queueOwner === void 0 ? void 0 : queueOwner.userId)
                recipients.add(queueOwner.userId);
            for (const e of everyone)
                if (e.userId)
                    recipients.add(e.userId);
            // don't ping the signer themselves
            recipients.delete(body.userId);
            const title = (_j = queueOwner === null || queueOwner === void 0 ? void 0 : queueOwner.title) !== null && _j !== void 0 ? _j : "a document";
            for (const rid of recipients) {
                yield (0, notificationEvents_1.createUserNotification)(tx, {
                    recipientId: rid,
                    senderId: body.userId,
                    title: completed ? "Routing concluded" : "Routing signed",
                    content: completed
                        ? `All signatures collected on "${title}". The routing is now concluded.`
                        : `Someone signed on "${title}".`,
                    path: `documents/dissemination?tab=inbox`,
                });
            }
            return {
                signed: pending.length,
                completed,
                signedAt: now,
                copyFurnished: furnished.released,
            };
        }));
        // Cryptographic attestation runs AFTER the transaction commits, and is
        // best-effort by design: the signature the user just made must never be
        // rolled back because sealing had a problem. A missing attestation only
        // degrades later verification to "unknown", which is honest — losing the
        // signature itself would not be.
        // `signedAt` is absent on the "nothing was pending" path — there is no
        // signing event to attest to in that case.
        const attested = result.signedAt
            ? yield (0, documentSeal_1.attestQueue)(body.queueRoomId, body.userId, result.signedAt, body.geo)
            : 0;
        return res.code(200).send(Object.assign(Object.assign({ message: "OK" }, result), { attested }));
    }
    catch (error) {
        if (error instanceof errors_1.NotFoundError)
            throw error;
        if (error instanceof errors_1.ValidationError)
            throw error;
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            // Surface the actual Prisma message so we don't keep masking
            // real constraint failures as a generic "DB_CONNECTION_FAILED".
            throw new errors_1.AppError(error.message, 500, error.code);
        }
        throw error;
    }
});
exports.signMine = signMine;
// ─── Claim an unassigned slot ──────────────────────────────────────────
// Salvage path for arrangements that were created before SignatoryArrangement
// carried a userId. Any room user can claim a still-pending, still-unassigned
// slot — they become its signer.
const claimSignatorySlot = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const body = req.body;
    if (!body.arrangementId)
        throw new errors_1.ValidationError("INVALID REQUIRED FIELDS");
    // You claim a slot for yourself. The userId in the body used to say who
    // was being bound, which meant anybody could make anybody else the
    // signatory on anybody's document.
    const { actorId } = yield (0, callerScope_1.requireSelf)(req, body.userId);
    // And the routing has to be one you can already see. Note the order:
    // claiming makes you a signatory, and being a signatory is one of the
    // three things that GRANTS sight of a routing — so checking after the
    // claim would let anyone bootstrap their way into any document by
    // claiming a slot on it first.
    const slot = yield prisma_1.prisma.signatoryArrangement.findUnique({
        where: { id: body.arrangementId },
        select: { signatureQueueRoomId: true },
    });
    if (!(slot === null || slot === void 0 ? void 0 : slot.signatureQueueRoomId))
        throw new errors_1.NotFoundError("Not found");
    yield requireCanSeeRouting(req, slot.signatureQueueRoomId);
    try {
        const result = yield prisma_1.prisma.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            const arr = yield tx.signatoryArrangement.findUnique({
                where: { id: body.arrangementId },
                select: { id: true, userId: true, status: true },
            });
            if (!arr)
                throw new errors_1.NotFoundError("Arrangement not found");
            if (arr.userId && arr.userId !== actorId) {
                throw new errors_1.ValidationError("This slot is already assigned.");
            }
            if (arr.status !== 0) {
                throw new errors_1.ValidationError("This slot is no longer pending.");
            }
            const updated = yield tx.signatoryArrangement.update({
                where: { id: arr.id },
                data: { userId: actorId },
            });
            return updated;
        }));
        return res.code(200).send({ message: "OK", arrangement: result });
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
exports.claimSignatorySlot = claimSignatorySlot;
// ─── Archive a concluded dissemination's documents into the line ───────
// Only callable when the queue's status === 2 (completed). Each Document
// in the queue is wrapped in an ArchiveDocument row (or skipped if it
// already has one — the @unique constraint on documentId prevents dupes).
const archiveDissemination = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const body = req.body;
    if (!body.queueRoomId) {
        throw new errors_1.ValidationError("INVALID REQUIRED FIELDS");
    }
    // SECURITY: the actor is whoever holds the token — never whoever the body
    // claims. This previously trusted `body.userId`, so any authenticated user
    // could name someone else's id and act as them. For signing in particular
    // that meant applying ANOTHER PERSON'S signature to a document, which is the
    // single worst thing an e-signature system can permit. A mismatch is refused
    // outright rather than quietly corrected, so misuse is visible in the logs.
    const actorId = yield (0, handler_1.callerUserId)(req);
    if (!actorId)
        throw new errors_1.UnauthorizedError("Not signed in");
    if (body.userId && body.userId !== actorId) {
        console.warn(`[archiveDissemination] refused: user ${actorId} attempted to act as ${body.userId}`);
        throw new errors_1.UnauthorizedError("You can only act on your own behalf.");
    }
    body.userId = actorId;
    try {
        const result = yield prisma_1.prisma.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            var _a, _b;
            const queue = yield tx.signatureQueueRoom.findUnique({
                where: { id: body.queueRoomId },
                include: {
                    documents: { select: { id: true } },
                    fromRoom: { select: { id: true, lineId: true } },
                },
            });
            if (!queue)
                throw new errors_1.NotFoundError("Routing not found");
            if (queue.status !== 2) {
                throw new errors_1.ValidationError("Only concluded routings (all signatures collected) can be archived.");
            }
            const lineId = (_a = queue.fromRoom) === null || _a === void 0 ? void 0 : _a.lineId;
            const receivingRoomId = (_b = queue.fromRoom) === null || _b === void 0 ? void 0 : _b.id;
            let created = 0;
            let skipped = 0;
            for (const doc of queue.documents) {
                const existing = yield tx.archiveDocument.findUnique({
                    where: { documentId: doc.id },
                });
                if (existing) {
                    skipped += 1;
                    continue;
                }
                yield tx.archiveDocument.create({
                    data: {
                        documentId: doc.id,
                        lineId: lineId !== null && lineId !== void 0 ? lineId : undefined,
                        receivingRoomId: receivingRoomId !== null && receivingRoomId !== void 0 ? receivingRoomId : undefined,
                        status: 1,
                    },
                });
                created += 1;
            }
            if (lineId) {
                yield tx.documentActivityLogs.create({
                    data: {
                        userId: body.userId,
                        lineId,
                        title: "Archived concluded routing",
                        desc: `Archived ${created} document${created === 1 ? "" : "s"} from queue ${body.queueRoomId} (${skipped} already archived)`,
                        action: 1,
                    },
                });
            }
            return { created, skipped };
        }));
        return res.code(200).send(Object.assign({ message: "OK" }, result));
    }
    catch (error) {
        if (error instanceof errors_1.NotFoundError)
            throw error;
        if (error instanceof errors_1.ValidationError)
            throw error;
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw new errors_1.AppError(error.message, 500, error.code);
        }
        throw error;
    }
});
exports.archiveDissemination = archiveDissemination;
// (will be appended)
// ─── Download a document with signatures burned in ─────────────────────
// Loads the document's PDF, walks every SignatureCoor whose arrangement
// is signed, and stamps the signer's signature image directly onto the
// page at the recorded coordinates. The returned PDF is flattened — the
// signature is part of the page graphics, not a removable image layer,
// so you can't lift it out by reopening the file in a viewer.
//
// The raw signature bytes are NEVER exposed by this endpoint. Only the
// signer themselves can fetch their own raw signature via the existing
// /document/user/signatures route (which is ACL'd to userId === self).
const downloadSignedDocument = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j;
    const params = req.query;
    if (!params.documentId)
        throw new errors_1.ValidationError("INVALID REQUIRED ID");
    yield requireCanSeeDocument(req, params.documentId);
    try {
        const doc = yield prisma_1.prisma.document.findUnique({
            where: { id: params.documentId },
            include: {
                file: { select: { fileName: true, fileType: true, fileDecoded: true } },
                pages: {
                    select: {
                        page: true,
                        signCoor: {
                            select: {
                                xAxis: true,
                                yAxis: true,
                                width: true,
                                height: true,
                                signatoryArrangement: {
                                    select: {
                                        id: true,
                                        status: true,
                                        signedAt: true,
                                        userId: true,
                                        index: true,
                                        signatureId: true,
                                    },
                                },
                            },
                        },
                    },
                },
            },
        });
        if (!doc || !((_a = doc.file) === null || _a === void 0 ? void 0 : _a.fileDecoded)) {
            throw new errors_1.NotFoundError("Document file not found");
        }
        const stamps = [];
        for (const p of doc.pages) {
            for (const c of p.signCoor) {
                const arr = c.signatoryArrangement;
                if (!arr || arr.status !== 1 || !arr.userId)
                    continue;
                stamps.push({
                    page: p.page,
                    xBp: c.xAxis,
                    yBp: c.yAxis,
                    wBp: c.width,
                    hBp: c.height,
                    userId: arr.userId,
                    signedAt: arr.signedAt,
                    slot: arr.index + 1,
                    arrangementId: arr.id,
                    signatureId: (_b = arr.signatureId) !== null && _b !== void 0 ? _b : null,
                });
            }
        }
        const signerIds = Array.from(new Set(stamps.map((s) => s.userId)));
        // Single fetch — we pull `qrEnabled` and bytes from the SAME row so
        // the "stamp QR for this signer?" decision can never disagree with
        // the signature that actually got embedded.
        const sigRows = signerIds.length
            ? yield prisma_1.prisma.signature.findMany({
                where: { userId: { in: signerIds } },
                orderBy: [{ active: "desc" }, { timestamp: "desc" }],
                select: {
                    id: true,
                    userId: true,
                    signature: true,
                    qrEnabled: true,
                    active: true,
                    // How the owner wants this one stamped.
                    inkHeightPt: true,
                    baselinePct: true,
                    inkX0: true,
                    inkY0: true,
                    inkX1: true,
                    inkY1: true,
                },
            })
            : [];
        // Raw signature bytes may be a data URL, bare base64, or binary —
        // normalize to image bytes for pdf-lib.
        const decodeSigBytes = (input) => {
            const raw = Buffer.from(input);
            const text = raw.toString("utf8").trim();
            if (text.startsWith("data:image/")) {
                const comma = text.indexOf(",");
                return comma > 0 ? Buffer.from(text.slice(comma + 1), "base64") : raw;
            }
            if (/^[A-Za-z0-9+/=\r\n]+$/.test(text.slice(0, 200)) &&
                !looksLikeBinary(raw)) {
                return Buffer.from(text.replace(/\s+/g, ""), "base64");
            }
            return raw;
        };
        const placementOf = (r) => ({
            inkHeightPt: r.inkHeightPt,
            baselinePct: r.baselinePct,
            ink: { x0: r.inkX0, y0: r.inkY0, x1: r.inkX1, y1: r.inkY1 },
        });
        const sigByUser = new Map();
        const sigQrByUser = new Map();
        const sigPlaceByUser = new Map();
        const sigIdByUser = new Map(); // for logging
        for (const r of sigRows) {
            if (!r.userId || !r.signature)
                continue;
            if (sigByUser.has(r.userId))
                continue;
            sigByUser.set(r.userId, decodeSigBytes(r.signature));
            sigQrByUser.set(r.userId, !!r.qrEnabled);
            sigPlaceByUser.set(r.userId, placementOf(r));
            sigIdByUser.set(r.userId, r.id);
        }
        // Signatures explicitly chosen at sign time (self-sign dropdown).
        // These override the per-user active pick for their arrangement.
        const chosenIds = Array.from(new Set(stamps.map((s) => s.signatureId).filter((x) => !!x)));
        const sigById = new Map();
        const sigQrById = new Map();
        const sigPlaceById = new Map();
        if (chosenIds.length > 0) {
            const chosenRows = yield prisma_1.prisma.signature.findMany({
                where: { id: { in: chosenIds } },
                select: {
                    id: true,
                    signature: true,
                    qrEnabled: true,
                    inkHeightPt: true,
                    baselinePct: true,
                    inkX0: true,
                    inkY0: true,
                    inkX1: true,
                    inkY1: true,
                },
            });
            for (const r of chosenRows) {
                if (!r.signature)
                    continue;
                sigById.set(r.id, decodeSigBytes(r.signature));
                sigQrById.set(r.id, !!r.qrEnabled);
                sigPlaceById.set(r.id, placementOf(r));
            }
        }
        console.log("[signedDoc] picked sig per user:", Array.from(sigIdByUser.entries()).map(([uid, sid]) => ({
            userId: uid,
            sigId: sid,
            qrEnabled: sigQrByUser.get(uid),
        })));
        const { PDFDocument, rgb, StandardFonts } = yield Promise.resolve().then(() => __importStar(require("pdf-lib")));
        const pdfDoc = yield PDFDocument.load(Buffer.from(doc.file.fileDecoded));
        const font = yield pdfDoc.embedFont(StandardFonts.HelveticaBold);
        const dateFont = yield pdfDoc.embedFont(StandardFonts.Helvetica);
        const embeddedByUser = new Map();
        // Key the embed cache by the actual source: explicit signature id when
        // chosen (and found), otherwise the signer's user id (active pick).
        const embedSig = (s) => __awaiter(void 0, void 0, void 0, function* () {
            const useChosen = !!(s.signatureId && sigById.has(s.signatureId));
            const cacheKey = useChosen ? `sig:${s.signatureId}` : `user:${s.userId}`;
            if (embeddedByUser.has(cacheKey))
                return embeddedByUser.get(cacheKey);
            const buf = useChosen
                ? sigById.get(s.signatureId)
                : sigByUser.get(s.userId);
            if (!buf || buf.length === 0)
                return null;
            let img = null;
            try {
                if (buf[0] === 0x89 &&
                    buf[1] === 0x50 &&
                    buf[2] === 0x4e &&
                    buf[3] === 0x47) {
                    img = yield pdfDoc.embedPng(buf);
                }
                else if (buf[0] === 0xff && buf[1] === 0xd8) {
                    img = yield pdfDoc.embedJpg(buf);
                }
                else {
                    try {
                        img = yield pdfDoc.embedPng(buf);
                    }
                    catch (_a) {
                        img = yield pdfDoc.embedJpg(buf);
                    }
                }
            }
            catch (e) {
                console.warn("[signedDoc] failed to embed signature for", cacheKey, e);
            }
            embeddedByUser.set(cacheKey, img);
            return img;
        });
        console.log("[signedDoc] stamps to draw:", stamps.length);
        // Cache the embedded QR image per stamp (one QR per placement since
        // coordinates and time differ). qrcode is required lazily so non-QR
        // downloads don't pay for the module load.
        let qrcodeMod = null;
        const embedQr = (payload) => __awaiter(void 0, void 0, void 0, function* () {
            if (!qrcodeMod)
                qrcodeMod = yield Promise.resolve().then(() => __importStar(require("qrcode")));
            const pngBuf = yield qrcodeMod.toBuffer(payload, {
                errorCorrectionLevel: "M",
                margin: 1,
                scale: 4,
                type: "png",
            });
            return pdfDoc.embedPng(pngBuf);
        });
        const pages = pdfDoc.getPages();
        for (const s of stamps) {
            const pageIdx = s.page - 1;
            if (pageIdx < 0 || pageIdx >= pages.length)
                continue;
            const page = pages[pageIdx];
            const { width: pw, height: ph } = page.getSize();
            // basis-points (0-10000) → PDF user units (origin = bottom-left).
            const boxW = (s.wBp / 10000) * pw;
            const boxH = (s.hBp / 10000) * ph;
            const boxX = (s.xBp / 10000) * pw;
            const boxYTop = (s.yBp / 10000) * ph;
            const boxY = ph - boxYTop - boxH;
            const sig = yield embedSig(s);
            if (sig) {
                // Where the owner said this signature should sit. Without a chosen
                // size this returns the old fit-and-centre rect, so signatures
                // nobody has configured stamp exactly as they always did.
                const useChosen = !!(s.signatureId && sigById.has(s.signatureId));
                const place = (_c = (useChosen
                    ? sigPlaceById.get(s.signatureId)
                    : sigPlaceByUser.get(s.userId))) !== null && _c !== void 0 ? _c : null;
                const rect = (0, signaturePlacement_1.placeSignature)({ x: boxX, y: boxY, width: boxW, height: boxH }, sig.width, sig.height, {
                    inkHeightPt: (_d = place === null || place === void 0 ? void 0 : place.inkHeightPt) !== null && _d !== void 0 ? _d : null,
                    baselinePct: (_e = place === null || place === void 0 ? void 0 : place.baselinePct) !== null && _e !== void 0 ? _e : null,
                    ink: (_f = place === null || place === void 0 ? void 0 : place.ink) !== null && _f !== void 0 ? _f : null,
                });
                page.drawImage(sig, {
                    x: rect.x,
                    y: rect.y,
                    width: rect.width,
                    height: rect.height,
                });
            }
            else {
                page.drawRectangle({
                    x: boxX,
                    y: boxY,
                    width: boxW,
                    height: boxH,
                    borderColor: rgb(0.06, 0.73, 0.51),
                    borderWidth: 0.8,
                });
                page.drawText("SIGNED", {
                    x: boxX + 4,
                    y: boxY + boxH / 2 - 4,
                    size: Math.min(10, boxH * 0.4),
                    font,
                    color: rgb(0.06, 0.73, 0.51),
                });
            }
            // No signed-at caption under the box. The date belongs in the audit
            // trail and on the verification page, not printed across a document
            // that already has its own dateline — and it landed right where the
            // signature's tail hangs, which is exactly where it is least welcome.
            // Verification QR — opt-in per signature. Encodes a URL pointing
            // at the readable HTML verify page on this API. Scanning opens the
            // page directly in the user's browser; no app needed.
            // QR flag follows the signature that was actually stamped.
            const qrOn = s.signatureId && sigQrById.has(s.signatureId)
                ? sigQrById.get(s.signatureId)
                : sigQrByUser.get(s.userId);
            console.log("[signedDoc] stamp", {
                userId: s.userId,
                page: s.page,
                slot: s.slot,
                qrOn,
                arrangementId: s.arrangementId,
            });
            if (qrOn && s.arrangementId) {
                // QR opens a frontend page (not the API HTML). We derive the FE
                // base from the request's Origin / Referer — that's where the
                // download was triggered from. Falls back to an env var, then
                // localhost for dev.
                const fromHeader = (h) => Array.isArray(h) ? h[0] : h;
                const origin = fromHeader(req.headers.origin) ||
                    (fromHeader(req.headers.referer)
                        ? new URL(fromHeader(req.headers.referer)).origin
                        : undefined) ||
                    process.env.PUBLIC_WEB_URL ||
                    "http://localhost:5173";
                const verifyUrl = `${origin.replace(/\/$/, "")}/verify/${s.arrangementId}`;
                try {
                    const qrImg = yield embedQr(verifyUrl);
                    // Smaller QR — caps at 28pt, scales down with tiny boxes.
                    const qrSize = Math.max(18, Math.min(boxH, 28));
                    // The signature image is drawn vertically centered in its box,
                    // so center the QR on the same axis for the side placements —
                    // bottom-aligning it (y: boxY) made it sit visibly lower than
                    // the signature.
                    const qrCenteredY = boxY + (boxH - qrSize) / 2;
                    // Place the QR FLUSH against the signature box (1pt gap).
                    // Try right → below → left → above → page corner as fallbacks.
                    const candidates = [
                        { x: boxX + boxW + 1, y: qrCenteredY },
                        { x: boxX, y: Math.max(2, boxY - qrSize - 1) },
                        { x: Math.max(2, boxX - qrSize - 1), y: qrCenteredY },
                        { x: boxX, y: Math.min(ph - qrSize - 2, boxY + boxH + 1) },
                        { x: pw - qrSize - 4, y: ph - qrSize - 4 },
                    ];
                    let placed = false;
                    for (const c of candidates) {
                        if (c.x >= 0 &&
                            c.y >= 0 &&
                            c.x + qrSize <= pw &&
                            c.y + qrSize <= ph) {
                            page.drawImage(qrImg, {
                                x: c.x,
                                y: c.y,
                                width: qrSize,
                                height: qrSize,
                            });
                            console.log("[signedDoc] QR drawn", { at: c, size: qrSize, url: verifyUrl });
                            placed = true;
                            break;
                        }
                    }
                    if (!placed) {
                        console.warn("[signedDoc] QR could not be placed", {
                            userId: s.userId,
                            boxX,
                            boxY,
                            boxW,
                            boxH,
                            pw,
                            ph,
                        });
                    }
                }
                catch (e) {
                    console.warn("[signedDoc] QR embed failed:", e);
                }
            }
        }
        // ── Verification footer ────────────────────────────────────────────
        // Stamped BEFORE save() so the serial is inside the bytes we hash —
        // adding it afterwards would change the file and invalidate its own seal.
        const serial = (0, documentSeal_1.newSerial)();
        try {
            const base = ((0, url_1.tempURL)() || "").replace(/\/+$/, "");
            const footer = `Verify at ${base}/verify-document  ·  ${serial}`;
            for (const pg of pdfDoc.getPages()) {
                const { width } = pg.getSize();
                const size = 6.5;
                const w = dateFont.widthOfTextAtSize(footer, size);
                pg.drawText(footer, {
                    x: Math.max(8, (width - w) / 2),
                    y: 8,
                    size,
                    font: dateFont,
                    color: rgb(0.45, 0.45, 0.45),
                });
            }
        }
        catch (e) {
            console.warn("[signedDoc] verification footer failed:", e);
        }
        const out = yield pdfDoc.save({ useObjectStreams: true });
        const bytes = Buffer.from(out);
        // Seal the EXACT bytes being sent. Hashing anything else would make every
        // later verification report a false TAMPERED.
        try {
            const accountId = (_g = req.user) === null || _g === void 0 ? void 0 : _g.id;
            const acct = accountId
                ? yield prisma_1.prisma.account.findUnique({
                    where: { id: accountId },
                    select: { User: { select: { id: true } } },
                })
                : null;
            yield (0, documentSeal_1.seal)(doc.id, bytes, serial, (_j = (_h = acct === null || acct === void 0 ? void 0 : acct.User) === null || _h === void 0 ? void 0 : _h.id) !== null && _j !== void 0 ? _j : null);
        }
        catch (e) {
            // Never block a download over sealing — the user still needs the file.
            // It just won't be verifiable, which the verifier reports as UNKNOWN.
            console.error("[signedDoc] sealing failed; document issued UNSEALED:", e instanceof Error ? e.message : e);
        }
        const filename = (doc.title || doc.file.fileName || "document")
            .replace(/[^a-zA-Z0-9._-]/g, "_")
            .replace(/\.pdf$/i, "") + "-signed.pdf";
        res.header("Content-Type", "application/pdf");
        res.header("Content-Disposition", `attachment; filename="${filename}"`);
        res.header("Content-Length", bytes.length.toString());
        res.header("X-Document-Serial", serial);
        res.header("Access-Control-Expose-Headers", "X-Document-Serial");
        return res.code(200).send(bytes);
    }
    catch (error) {
        if (error instanceof errors_1.NotFoundError)
            throw error;
        if (error instanceof errors_1.ValidationError)
            throw error;
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw new errors_1.AppError(error.message, 500, error.code);
        }
        throw error;
    }
});
exports.downloadSignedDocument = downloadSignedDocument;
// Treat input as binary if >10% of the leading bytes are non-printable.
function looksLikeBinary(buf) {
    const sample = buf.slice(0, Math.min(200, buf.length));
    let nonPrintable = 0;
    for (let i = 0; i < sample.length; i++) {
        const b = sample[i];
        if (b < 9 || (b > 13 && b < 32) || b === 127)
            nonPrintable++;
    }
    return nonPrintable / sample.length > 0.1;
}
// ─── Cancel a dispatched dissemination ─────────────────────────────────
// Sender-only. Only active (status=1) queues can be cancelled. Flips
// queue → 3, target rows → 3, and notifies every signatory + target
// room owner so they know to stop signing.
const cancelDispatchedDissemination = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const body = req.body;
    if (!body.queueRoomId) {
        throw new errors_1.ValidationError("INVALID REQUIRED FIELDS");
    }
    // SECURITY: the actor is whoever holds the token — never whoever the body
    // claims. This previously trusted `body.userId`, so any authenticated user
    // could name someone else's id and act as them. For signing in particular
    // that meant applying ANOTHER PERSON'S signature to a document, which is the
    // single worst thing an e-signature system can permit. A mismatch is refused
    // outright rather than quietly corrected, so misuse is visible in the logs.
    const actorId = yield (0, handler_1.callerUserId)(req);
    if (!actorId)
        throw new errors_1.UnauthorizedError("Not signed in");
    if (body.userId && body.userId !== actorId) {
        console.warn(`[cancelDispatchedDissemination] refused: user ${actorId} attempted to act as ${body.userId}`);
        throw new errors_1.UnauthorizedError("You can only act on your own behalf.");
    }
    body.userId = actorId;
    try {
        const result = yield prisma_1.prisma.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            var _a, _b, _c, _d, _e, _f;
            const queue = yield tx.signatureQueueRoom.findUnique({
                where: { id: body.queueRoomId },
                include: {
                    fromRoom: { select: { lineId: true } },
                },
            });
            if (!queue)
                throw new errors_1.NotFoundError("Routing not found");
            if (queue.userId && queue.userId !== body.userId) {
                throw new errors_1.ValidationError("Only the sender can cancel.");
            }
            if (queue.status === 0) {
                throw new errors_1.ValidationError("This routing is still a draft — remove it instead.");
            }
            if (queue.status >= 2) {
                throw new errors_1.ValidationError("Already concluded or cancelled — nothing to do.");
            }
            yield tx.signatureQueueRoom.update({
                where: { id: queue.id },
                data: { status: 3 },
            });
            yield tx.targetRoom.updateMany({
                where: { signatureQueueRoomId: queue.id },
                data: { status: 3 },
            });
            const realLineId = (_b = (_a = queue.fromRoom) === null || _a === void 0 ? void 0 : _a.lineId) !== null && _b !== void 0 ? _b : undefined;
            if (realLineId) {
                yield tx.documentActivityLogs.create({
                    data: {
                        userId: body.userId,
                        lineId: realLineId,
                        title: "Cancelled dispatched routing",
                        desc: `Cancelled "${(_c = queue.title) !== null && _c !== void 0 ? _c : queue.id}"` +
                            (body.reason ? ` — reason: ${body.reason}` : ""),
                        action: 0,
                    },
                });
            }
            // Notify every signatory + the from-room user (themselves get
            // skipped because the sender is the one doing this).
            const signatories = yield tx.signatoryArrangement.findMany({
                where: {
                    signatureQueueRoomId: queue.id,
                    userId: { not: null },
                },
                select: { userId: true },
            });
            const recipients = new Set();
            for (const s of signatories)
                if (s.userId)
                    recipients.add(s.userId);
            // Also notify all members of target rooms — they might be tracking
            // the dispatch in their inbox even if they're not signers.
            // Only rooms that actually received it. Telling a copy-furnished
            // office that a document was cancelled would be the first they ever
            // heard of it.
            const targetRooms = yield tx.targetRoom.findMany({
                where: Object.assign({ signatureQueueRoomId: queue.id }, copyFurnish_1.VISIBLE_TO_ROOM),
                select: {
                    roomReceiver: {
                        select: { authorizedUser: { select: { userId: true } } },
                    },
                },
            });
            for (const t of targetRooms) {
                for (const a of (_e = (_d = t.roomReceiver) === null || _d === void 0 ? void 0 : _d.authorizedUser) !== null && _e !== void 0 ? _e : []) {
                    if (a.userId)
                        recipients.add(a.userId);
                }
            }
            recipients.delete(body.userId);
            for (const rid of recipients) {
                yield (0, notificationEvents_1.createUserNotification)(tx, {
                    recipientId: rid,
                    senderId: body.userId,
                    title: "Routing cancelled",
                    content: `"${(_f = queue.title) !== null && _f !== void 0 ? _f : "A document"}" was cancelled by the sender.` +
                        (body.reason ? ` Reason: ${body.reason}` : ""),
                    path: `documents/dissemination?tab=inbox`,
                });
            }
            return { recipientsNotified: recipients.size };
        }));
        return res.code(200).send(Object.assign({ message: "OK" }, result));
    }
    catch (error) {
        if (error instanceof errors_1.NotFoundError)
            throw error;
        if (error instanceof errors_1.ValidationError)
            throw error;
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw new errors_1.AppError(error.message, 500, error.code);
        }
        throw error;
    }
});
exports.cancelDispatchedDissemination = cancelDispatchedDissemination;
// ─── Public-ish verification page (HTML) ───────────────────────────────
// The verification QR encodes a URL to this endpoint. A scanner opens the
// link → server returns a readable HTML page with signer + signed-at +
// geolocation (with a Google Maps link). Auth is not enforced because
// the URL itself is unguessable (arrangement UUID) and the page only
// exposes what's already on the signed PDF.
const verifySignaturePage = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k;
    const params = req.params;
    if (!params.id) {
        return res
            .code(400)
            .type("text/html")
            .send("<h1>Missing arrangement id</h1>");
    }
    try {
        const arr = yield prisma_1.prisma.signatoryArrangement.findUnique({
            where: { id: params.id },
            select: {
                id: true,
                index: true,
                status: true,
                signedAt: true,
                signedLat: true,
                signedLng: true,
                signedAccuracy: true,
                signatureQueueRoom: {
                    select: { id: true, title: true, status: true },
                },
                user: {
                    select: {
                        firstName: true,
                        lastName: true,
                        username: true,
                        email: true,
                        Position: { select: { name: true } },
                    },
                },
            },
        });
        if (!arr) {
            return res
                .code(404)
                .type("text/html")
                .send(renderVerifyShell({
                title: "Not Found",
                bodyHtml: `<p class="muted">No signature record matches this code.</p>`,
            }));
        }
        const escape = (s) => String(s !== null && s !== void 0 ? s : "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;");
        const fullName = `${(_b = (_a = arr.user) === null || _a === void 0 ? void 0 : _a.firstName) !== null && _b !== void 0 ? _b : ""} ${(_d = (_c = arr.user) === null || _c === void 0 ? void 0 : _c.lastName) !== null && _d !== void 0 ? _d : ""}`.trim() ||
            ((_e = arr.user) === null || _e === void 0 ? void 0 : _e.username) ||
            "—";
        const position = (_h = (_g = (_f = arr.user) === null || _f === void 0 ? void 0 : _f.Position) === null || _g === void 0 ? void 0 : _g.name) !== null && _h !== void 0 ? _h : "—";
        const signedAt = arr.signedAt
            ? new Date(arr.signedAt).toLocaleString("en-PH", {
                weekday: "short",
                year: "numeric",
                month: "long",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
                timeZoneName: "short",
            })
            : "—";
        const queueTitle = (_k = (_j = arr.signatureQueueRoom) === null || _j === void 0 ? void 0 : _j.title) !== null && _k !== void 0 ? _k : "—";
        const statusLabel = arr.status === 1 ? "✅ Signed" : arr.status === 2 ? "❌ Rejected" : "⏳ Pending";
        const hasGeo = arr.signedLat != null && arr.signedLng != null;
        const mapsLink = hasGeo
            ? `https://www.google.com/maps?q=${arr.signedLat},${arr.signedLng}`
            : null;
        const rows = [
            ["Signer", escape(fullName)],
            ["Position", escape(position)],
            ["Document", escape(queueTitle)],
            ["Slot #", String(arr.index + 1)],
            ["Status", statusLabel],
            ["Signed at", escape(signedAt)],
        ];
        if (hasGeo) {
            const acc = arr.signedAccuracy
                ? ` (±${Math.round(arr.signedAccuracy)}m)`
                : "";
            rows.push([
                "Signing location",
                `<a href="${escape(mapsLink)}" target="_blank" rel="noopener">
           ${escape(arr.signedLat.toFixed(6))}, ${escape(arr.signedLng.toFixed(6))}${escape(acc)}
           <br><small>Open in Google Maps ↗</small>
         </a>`,
            ]);
        }
        else {
            rows.push([
                "Signing location",
                `<span class="muted">Not captured</span>`,
            ]);
        }
        const bodyHtml = `
      <div class="card">
        <div class="badge ${arr.status === 1 ? "ok" : "warn"}">
          ${statusLabel}
        </div>
        <table>
          ${rows
            .map(([k, v]) => `<tr><th>${escape(k)}</th><td>${v}</td></tr>`)
            .join("")}
        </table>
        <p class="muted small">
          Verification id: <code>${escape(arr.id)}</code>
        </p>
      </div>`;
        return res
            .code(200)
            .type("text/html; charset=utf-8")
            .send(renderVerifyShell({ title: "Signature Verification", bodyHtml }));
    }
    catch (error) {
        console.error("[verify] error:", error);
        return res
            .code(500)
            .type("text/html")
            .send(renderVerifyShell({
            title: "Error",
            bodyHtml: `<p class="muted">Something went wrong while loading this record.</p>`,
        }));
    }
});
exports.verifySignaturePage = verifySignaturePage;
// Minimal styled shell — no framework, no JS. Renders the same on any
// scanner browser (mobile included).
function renderVerifyShell(args) {
    return `<!doctype html><html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${args.title}</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    margin: 0; background: #f7fafc; color: #1a202c;
  }
  .wrap { max-width: 560px; margin: 24px auto; padding: 0 16px; }
  h1 { font-size: 18px; margin: 8px 0 16px; }
  .card {
    background: #fff; border: 1px solid #e2e8f0; border-radius: 12px;
    padding: 16px; box-shadow: 0 1px 3px rgba(0,0,0,0.04);
  }
  .badge {
    display: inline-block; padding: 4px 10px; border-radius: 999px;
    font-size: 12px; font-weight: 600; margin-bottom: 12px;
  }
  .badge.ok { background: #d1fae5; color: #065f46; }
  .badge.warn { background: #fef3c7; color: #92400e; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th, td { text-align: left; padding: 8px 0; border-top: 1px solid #edf2f7; vertical-align: top; }
  th { color: #4a5568; font-weight: 500; width: 38%; }
  td { color: #1a202c; }
  td a { color: #2563eb; text-decoration: none; }
  td a:hover { text-decoration: underline; }
  .muted { color: #718096; }
  .small { font-size: 11px; margin-top: 12px; }
  code { background: #edf2f7; padding: 2px 6px; border-radius: 4px; font-size: 11px; }
  .head {
    display: flex; align-items: center; gap: 8px; margin-bottom: 8px;
  }
  .logo {
    width: 28px; height: 28px; border-radius: 6px; background: #2563eb;
    color: #fff; display: flex; align-items: center; justify-content: center;
    font-weight: 700; font-size: 12px;
  }
</style></head><body>
<div class="wrap">
  <div class="head">
    <div class="logo">✓</div>
    <h1 style="margin:0;">${args.title}</h1>
  </div>
  ${args.bodyHtml}
</div>
</body></html>`;
}
// ─── Public verify data (JSON) — consumed by the FE /verify page ───────
const verifySignatureData = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c;
    const params = req.params;
    if (!params.id)
        throw new errors_1.ValidationError("INVALID REQUIRED ID");
    try {
        const arr = yield prisma_1.prisma.signatoryArrangement.findUnique({
            where: { id: params.id },
            select: {
                id: true,
                index: true,
                status: true,
                signedAt: true,
                signedLat: true,
                signedLng: true,
                signedAccuracy: true,
                signatureQueueRoom: {
                    select: { id: true, title: true, status: true },
                },
                user: {
                    select: {
                        firstName: true,
                        lastName: true,
                        username: true,
                        Position: { select: { name: true } },
                    },
                },
            },
        });
        if (!arr)
            throw new errors_1.NotFoundError("Not found");
        return res.code(200).send({
            id: arr.id,
            slot: arr.index + 1,
            status: arr.status,
            signedAt: arr.signedAt,
            geo: arr.signedLat != null && arr.signedLng != null
                ? {
                    lat: arr.signedLat,
                    lng: arr.signedLng,
                    accuracy: (_a = arr.signedAccuracy) !== null && _a !== void 0 ? _a : null,
                }
                : null,
            queue: arr.signatureQueueRoom
                ? {
                    id: arr.signatureQueueRoom.id,
                    title: arr.signatureQueueRoom.title,
                    status: arr.signatureQueueRoom.status,
                }
                : null,
            user: arr.user
                ? {
                    firstName: arr.user.firstName,
                    lastName: arr.user.lastName,
                    username: arr.user.username,
                    position: (_c = (_b = arr.user.Position) === null || _b === void 0 ? void 0 : _b.name) !== null && _c !== void 0 ? _c : null,
                }
                : null,
        });
    }
    catch (error) {
        if (error instanceof errors_1.NotFoundError)
            throw error;
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw new errors_1.AppError(error.message, 500, error.code);
        }
        throw error;
    }
});
exports.verifySignatureData = verifySignatureData;
// ─── Receipt: an office confirming the document is in hand ─────────────
//
// Delivery and receipt are two different facts. The system stamps
// `receivedAt` the moment it drops a document into a room, which proves
// only that the system did its part. Whether anyone in that office
// actually has it is a question only a person in that office can answer,
// and it is the question that gets asked when something goes missing.
//
// So a receiver marks it received, their name goes on it, and the sender
// can stop phoning to ask. They can correct it afterwards too — marking
// the wrong row is exactly the mistake a busy front desk makes, and an
// acknowledgement nobody can take back is worse than none.
const acknowledgeReceipt = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d;
    const body = req.body;
    if (!body.targetRoomId)
        throw new errors_1.ValidationError("INVALID REQUIRED ID");
    const actorId = yield (0, handler_1.callerUserId)(req);
    if (!actorId)
        throw new errors_1.UnauthorizedError("Not signed in");
    const received = body.received !== false;
    const note = ((_a = body.note) !== null && _a !== void 0 ? _a : "").trim().slice(0, 300) || null;
    try {
        const target = yield prisma_1.prisma.targetRoom.findUnique({
            where: { id: body.targetRoomId },
            select: {
                id: true,
                receivingRoomId: true,
                copyFurnished: true,
                releasedAt: true,
                acknowledgedAt: true,
                acknowledgedById: true,
                roomReceiver: { select: { id: true, code: true, lineId: true } },
                queueRoom: {
                    select: { id: true, title: true, status: true, userId: true },
                },
            },
        });
        if (!target)
            throw new errors_1.NotFoundError("Not found in your inbox");
        // Nothing to acknowledge until it has actually been sent, and a
        // copy-furnished room that is still held has not been given anything
        // at all — it cannot even see the document yet.
        if (((_c = (_b = target.queueRoom) === null || _b === void 0 ? void 0 : _b.status) !== null && _c !== void 0 ? _c : 0) < 1) {
            throw new errors_1.ValidationError("This has not been dispatched yet.");
        }
        if (target.copyFurnished && target.releasedAt === null) {
            throw new errors_1.NotFoundError("Not found in your inbox");
        }
        // Only somebody who actually works in the receiving office, and only
        // in a role whose job this is. A signatory signs; a receiver receives.
        const membership = yield prisma_1.prisma.roomAuthorizedUser.findFirst({
            where: {
                receivingRoomId: (_d = target.receivingRoomId) !== null && _d !== void 0 ? _d : "",
                userId: actorId,
                status: 1,
                type: { in: [roomConfigController_1.ROOM_MEMBER_TYPES.owner, roomConfigController_1.ROOM_MEMBER_TYPES.receiver] },
            },
            select: { id: true, type: true },
        });
        if (!membership) {
            console.warn(`[receipt] refused: user ${actorId} on room ${target.receivingRoomId}`);
            throw new errors_1.UnauthorizedError("Only a receiver or the owner of this office can mark it received.");
        }
        const now = new Date();
        const updated = yield prisma_1.prisma.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r;
            const row = yield tx.targetRoom.update({
                where: { id: target.id },
                data: received
                    ? {
                        acknowledgedAt: (_a = target.acknowledgedAt) !== null && _a !== void 0 ? _a : now,
                        acknowledgedById: actorId,
                        acknowledgedNote: note,
                    }
                    : {
                        acknowledgedAt: null,
                        acknowledgedById: null,
                        acknowledgedNote: null,
                    },
                select: {
                    id: true,
                    acknowledgedAt: true,
                    acknowledgedNote: true,
                    acknowledgedBy: {
                        select: { id: true, firstName: true, lastName: true },
                    },
                },
            });
            const lineId = (_b = target.roomReceiver) === null || _b === void 0 ? void 0 : _b.lineId;
            if (lineId) {
                yield tx.documentActivityLogs.create({
                    data: {
                        userId: actorId,
                        lineId,
                        title: received ? "Marked received" : "Undid a receipt",
                        desc: `${(_d = (_c = target.roomReceiver) === null || _c === void 0 ? void 0 : _c.code) !== null && _d !== void 0 ? _d : "An office"} ` +
                            (received ? "received " : "un-marked ") +
                            `"${(_f = (_e = target.queueRoom) === null || _e === void 0 ? void 0 : _e.title) !== null && _f !== void 0 ? _f : (_g = target.queueRoom) === null || _g === void 0 ? void 0 : _g.id}"` +
                            (received && note ? ` — ${note}` : ""),
                        action: received ? 1 : 0,
                    },
                });
            }
            // The whole point is that the sender stops having to ask. Tell them
            // about a correction too: they are relying on this record either way.
            const sender = (_h = target.queueRoom) === null || _h === void 0 ? void 0 : _h.userId;
            if (sender && sender !== actorId) {
                yield (0, notificationEvents_1.createUserNotification)(tx, {
                    recipientId: sender,
                    senderId: actorId,
                    title: received ? "Document received" : "Receipt withdrawn",
                    content: received
                        ? `${(_k = (_j = target.roomReceiver) === null || _j === void 0 ? void 0 : _j.code) !== null && _k !== void 0 ? _k : "An office"} marked ` +
                            `"${(_m = (_l = target.queueRoom) === null || _l === void 0 ? void 0 : _l.title) !== null && _m !== void 0 ? _m : "your document"}" as received.` +
                            (note ? ` Note: ${note}` : "")
                        : `${(_p = (_o = target.roomReceiver) === null || _o === void 0 ? void 0 : _o.code) !== null && _p !== void 0 ? _p : "An office"} withdrew its ` +
                            `receipt of "${(_r = (_q = target.queueRoom) === null || _q === void 0 ? void 0 : _q.title) !== null && _r !== void 0 ? _r : "your document"}".`,
                    path: `documents/dissemination?tab=outbox`,
                });
            }
            return row;
        }));
        return res.code(200).send({ message: "OK", target: updated });
    }
    catch (error) {
        if (error instanceof errors_1.NotFoundError)
            throw error;
        if (error instanceof errors_1.ValidationError)
            throw error;
        if (error instanceof errors_1.UnauthorizedError)
            throw error;
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw new errors_1.AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
        }
        throw error;
    }
});
exports.acknowledgeReceipt = acknowledgeReceipt;
