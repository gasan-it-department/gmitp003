"use strict";
// The Document module's Activity panel.
//
// One request, because the panel is one glance. It answers two questions,
// in the order somebody actually asks them:
//
//   1. What is waiting for ME?                (needsYou)
//   2. What did we send, and where is it now? (outbox)
//
// The Logs tab is the third question — what just happened — and is paged
// separately below.
//
// Everything here is scoped to ONE receiving room: the office the reader
// works in. "Waiting for you" is meaningless without it. The room id comes
// from the query and is checked against the caller's membership before a
// single row is read.
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
exports.documentMyPending = exports.documentActivityLog = exports.documentActivityPanel = void 0;
const prisma_1 = require("../barrel/prisma");
const errors_1 = require("../errors/errors");
const callerScope_1 = require("../service/callerScope");
const copyFurnish_1 = require("../service/copyFurnish");
const roomConfigController_1 = require("./roomConfigController");
/** How many rows of each pile the panel shows before "and N more". */
const PEEK = 6;
/**
 * Midnight, here.
 *
 * The server runs in UTC and the office does not. A "today" counted in UTC
 * is eight hours out: at nine in the morning in Gasan it would still be
 * reporting yesterday's work, which is exactly when somebody looks at it.
 */
const PH_OFFSET_MIN = 8 * 60;
const startOfToday = () => {
    const shifted = new Date(Date.now() + PH_OFFSET_MIN * 60000);
    shifted.setUTCHours(0, 0, 0, 0);
    return new Date(shifted.getTime() - PH_OFFSET_MIN * 60000);
};
const fullName = (u) => { var _a, _b; return (u ? `${(_a = u.firstName) !== null && _a !== void 0 ? _a : ""} ${(_b = u.lastName) !== null && _b !== void 0 ? _b : ""}`.trim() || null : null); };
const documentActivityPanel = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const params = req.query;
    if (!params.roomId)
        throw new errors_1.ValidationError("INVALID REQUIRED ID");
    const member = yield (0, callerScope_1.requireRoomMember)(req, params.roomId);
    const roomId = params.roomId;
    const me = member.actorId;
    // A signatory signs and a receiver receives. Somebody who can do
    // neither should not be handed a pile labelled "waiting for you".
    const canAcknowledge = member.type === roomConfigController_1.ROOM_MEMBER_TYPES.owner ||
        member.type === roomConfigController_1.ROOM_MEMBER_TYPES.receiver;
    try {
        const since = startOfToday();
        /** Rows that have actually reached this office. */
        const delivered = Object.assign({ receivingRoomId: roomId, queueRoom: { is: { status: { gte: 1 } } } }, copyFurnish_1.VISIBLE_TO_ROOM);
        const arrivedRow = {
            id: true,
            timestamp: true,
            releasedAt: true,
            viewedAt: true,
            acknowledgedAt: true,
            copyFurnished: true,
            queueRoom: {
                select: {
                    id: true,
                    title: true,
                    status: true,
                    user: { select: { firstName: true, lastName: true } },
                    fromRoom: { select: { code: true } },
                },
            },
        };
        const [
        // ── 1. Waiting for you ──────────────────────────────────────────
        toSignRows, toSignTotal, unopenedRows, unopenedTotal, unreceivedRows, unreceivedTotal, inboxTotal, 
        // ── 2. What we sent ─────────────────────────────────────────────
        outRows, outCounts, 
        // ── 3. Today ────────────────────────────────────────────────────
        signedToday, openedToday, receiptsToday, startedToday, responseSample,] = yield Promise.all([
            prisma_1.prisma.signatoryArrangement.findMany({
                where: {
                    userId: me,
                    status: 0,
                    signatureQueueRoom: { is: { status: 1 } },
                },
                orderBy: { timestamp: "asc" },
                take: PEEK,
                select: {
                    id: true,
                    index: true,
                    timestamp: true,
                    signatureQueueRoom: {
                        select: {
                            id: true,
                            title: true,
                            timestamp: true,
                            fromRoom: { select: { code: true } },
                            user: { select: { firstName: true, lastName: true } },
                            signatotyArrangement: { select: { status: true } },
                        },
                    },
                },
            }),
            prisma_1.prisma.signatoryArrangement.count({
                where: {
                    userId: me,
                    status: 0,
                    signatureQueueRoom: { is: { status: 1 } },
                },
            }),
            prisma_1.prisma.targetRoom.findMany({
                where: Object.assign(Object.assign({}, delivered), { viewedAt: null }),
                orderBy: { timestamp: "desc" },
                take: PEEK,
                select: arrivedRow,
            }),
            prisma_1.prisma.targetRoom.count({ where: Object.assign(Object.assign({}, delivered), { viewedAt: null }) }),
            prisma_1.prisma.targetRoom.findMany({
                where: Object.assign(Object.assign({}, delivered), { acknowledgedAt: null }),
                orderBy: { timestamp: "asc" }, // the oldest debt first
                take: PEEK,
                select: arrivedRow,
            }),
            prisma_1.prisma.targetRoom.count({ where: Object.assign(Object.assign({}, delivered), { acknowledgedAt: null }) }),
            prisma_1.prisma.targetRoom.count({ where: delivered }),
            prisma_1.prisma.signatureQueueRoom.findMany({
                where: { receivingRoomId: roomId, status: 1 },
                orderBy: { timestamp: "desc" },
                take: PEEK,
                select: {
                    id: true,
                    title: true,
                    timestamp: true,
                    signatotyArrangement: { select: { status: true } },
                    targetRooms: {
                        where: copyFurnish_1.VISIBLE_TO_ROOM,
                        select: {
                            viewedAt: true,
                            acknowledgedAt: true,
                            roomReceiver: { select: { code: true } },
                        },
                    },
                },
            }),
            prisma_1.prisma.signatureQueueRoom.groupBy({
                by: ["status"],
                where: { receivingRoomId: roomId },
                _count: { _all: true },
            }),
            prisma_1.prisma.signatoryArrangement.count({
                where: { userId: me, status: 1, signedAt: { gte: since } },
            }),
            prisma_1.prisma.targetRoom.count({
                where: { receivingRoomId: roomId, viewedAt: { gte: since } },
            }),
            prisma_1.prisma.targetRoom.count({
                where: { receivingRoomId: roomId, acknowledgedAt: { gte: since } },
            }),
            prisma_1.prisma.signatureQueueRoom.count({
                where: { receivingRoomId: roomId, timestamp: { gte: since } },
            }),
            // How long this office takes to sign for what it gets. Real
            // numbers from the last 50 receipts, and shown only once there are
            // enough of them to mean anything.
            prisma_1.prisma.targetRoom.findMany({
                where: { receivingRoomId: roomId, acknowledgedAt: { not: null } },
                orderBy: { acknowledgedAt: "desc" },
                take: 50,
                select: { timestamp: true, releasedAt: true, acknowledgedAt: true },
            }),
        ]);
        // ── Shape 1: signatures with your name on them ────────────────────
        const toSign = toSignRows.map((a) => {
            var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o;
            const slots = (_b = (_a = a.signatureQueueRoom) === null || _a === void 0 ? void 0 : _a.signatotyArrangement) !== null && _b !== void 0 ? _b : [];
            return {
                arrangementId: a.id,
                queueId: (_d = (_c = a.signatureQueueRoom) === null || _c === void 0 ? void 0 : _c.id) !== null && _d !== void 0 ? _d : null,
                title: (_f = (_e = a.signatureQueueRoom) === null || _e === void 0 ? void 0 : _e.title) !== null && _f !== void 0 ? _f : "Untitled routing",
                from: (_l = (_j = (_h = (_g = a.signatureQueueRoom) === null || _g === void 0 ? void 0 : _g.fromRoom) === null || _h === void 0 ? void 0 : _h.code) !== null && _j !== void 0 ? _j : fullName((_k = a.signatureQueueRoom) === null || _k === void 0 ? void 0 : _k.user)) !== null && _l !== void 0 ? _l : "—",
                sentAt: (_o = (_m = a.signatureQueueRoom) === null || _m === void 0 ? void 0 : _m.timestamp) !== null && _o !== void 0 ? _o : a.timestamp,
                // Position on the sheet, and how much of it is already done.
                // Deliberately NOT phrased as "your turn": signing is not
                // order-gated in this system, so saying it was would tell people
                // to wait when they can sign right now.
                position: a.index + 1,
                totalSignatories: slots.length,
                signed: slots.filter((s) => s.status === 1).length,
            };
        });
        const arrived = (r) => {
            var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k;
            return ({
                targetId: r.id,
                queueId: (_b = (_a = r.queueRoom) === null || _a === void 0 ? void 0 : _a.id) !== null && _b !== void 0 ? _b : null,
                title: (_d = (_c = r.queueRoom) === null || _c === void 0 ? void 0 : _c.title) !== null && _d !== void 0 ? _d : "Untitled routing",
                from: (_j = (_g = (_f = (_e = r.queueRoom) === null || _e === void 0 ? void 0 : _e.fromRoom) === null || _f === void 0 ? void 0 : _f.code) !== null && _g !== void 0 ? _g : fullName((_h = r.queueRoom) === null || _h === void 0 ? void 0 : _h.user)) !== null && _j !== void 0 ? _j : "—",
                arrivedAt: (_k = r.releasedAt) !== null && _k !== void 0 ? _k : r.timestamp,
                copyFurnished: r.copyFurnished,
                viewedAt: r.viewedAt,
                acknowledgedAt: r.acknowledgedAt,
            });
        };
        // ── Shape 2: where the things we sent have got to ─────────────────
        const inFlight = outRows.map((q) => {
            var _a;
            const slots = q.signatotyArrangement;
            const targets = q.targetRooms;
            return {
                queueId: q.id,
                title: (_a = q.title) !== null && _a !== void 0 ? _a : "Untitled routing",
                sentAt: q.timestamp,
                signed: slots.filter((s) => s.status === 1).length,
                totalSignatories: slots.length,
                opened: targets.filter((t) => t.viewedAt).length,
                received: targets.filter((t) => t.acknowledgedAt).length,
                totalRecipients: targets.length,
                // The offices still owing you a receipt, by name. A panel that
                // says "3 of 5" and makes you open the routing to find out which
                // two is not saving anybody a phone call.
                waitingOn: targets
                    .filter((t) => !t.acknowledgedAt)
                    .map((t) => { var _a; return (_a = t.roomReceiver) === null || _a === void 0 ? void 0 : _a.code; })
                    .filter((x) => !!x)
                    .slice(0, 4),
            };
        });
        const byStatus = (s) => { var _a, _b; return (_b = (_a = outCounts.find((c) => c.status === s)) === null || _a === void 0 ? void 0 : _a._count._all) !== null && _b !== void 0 ? _b : 0; };
        const gaps = responseSample
            .map((r) => {
            var _a, _b, _c;
            const from = (_b = ((_a = r.releasedAt) !== null && _a !== void 0 ? _a : r.timestamp)) === null || _b === void 0 ? void 0 : _b.getTime();
            const to = (_c = r.acknowledgedAt) === null || _c === void 0 ? void 0 : _c.getTime();
            return from && to && to > from ? to - from : null;
        })
            .filter((x) => x !== null);
        const avgResponseMs = gaps.length >= 3
            ? Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length)
            : null;
        return res.code(200).send({
            room: { id: roomId },
            canAcknowledge,
            needsYou: {
                toSign,
                toSignTotal,
                toOpen: unopenedRows.map(arrived),
                toOpenTotal: unopenedTotal,
                // Only somebody whose job it is gets handed the receipts pile.
                toReceive: canAcknowledge ? unreceivedRows.map(arrived) : [],
                toReceiveTotal: canAcknowledge ? unreceivedTotal : 0,
            },
            inbox: { total: inboxTotal },
            outbox: {
                inFlight,
                draft: byStatus(0),
                active: byStatus(1),
                completed: byStatus(2),
                cancelled: byStatus(3),
            },
            today: {
                signedByYou: signedToday,
                opened: openedToday,
                receipts: receiptsToday,
                started: startedToday,
                avgResponseMs,
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
exports.documentActivityPanel = documentActivityPanel;
/**
 * The Logs tab: what has happened in this municipality's Document module.
 *
 * A municipal audit trail rather than a personal one — the same rows the
 * admin log reads, paged for a narrow panel. Scoped to the caller's line
 * through their room, never through a line id in the query.
 */
const documentActivityLog = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const params = req.query;
    if (!params.roomId)
        throw new errors_1.ValidationError("INVALID REQUIRED ID");
    yield (0, callerScope_1.requireRoomMember)(req, params.roomId);
    try {
        const room = yield prisma_1.prisma.receivingRoom.findUnique({
            where: { id: params.roomId },
            select: { lineId: true },
        });
        if (!(room === null || room === void 0 ? void 0 : room.lineId))
            return res.code(200).send({ list: [], lastCursor: null, hasMore: false });
        const limit = Math.min(params.limit ? parseInt(params.limit, 10) : 20, 50);
        // Axios serialises a null query param as the string "null".
        const cursor = params.lastCursor && params.lastCursor !== "null"
            ? { id: params.lastCursor }
            : undefined;
        const rows = yield prisma_1.prisma.documentActivityLogs.findMany({
            where: { lineId: room.lineId },
            take: limit,
            skip: cursor ? 1 : 0,
            cursor,
            orderBy: { timestamp: "desc" },
            select: {
                id: true,
                title: true,
                desc: true,
                action: true,
                timestamp: true,
                documentId: true,
                user: { select: { id: true, firstName: true, lastName: true } },
            },
        });
        return res.code(200).send({
            list: rows.map((r) => ({
                id: r.id,
                title: r.title,
                desc: r.desc,
                action: r.action,
                timestamp: r.timestamp,
                documentId: r.documentId,
                who: fullName(r.user),
            })),
            lastCursor: rows.length ? rows[rows.length - 1].id : null,
            hasMore: rows.length === limit,
        });
    }
    catch (error) {
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw new errors_1.AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
        }
        throw error;
    }
});
exports.documentActivityLog = documentActivityLog;
/**
 * Everything the CALLER personally owes, across every office they work in.
 *
 * The panel endpoint above is office-shaped: it needs a room id, because
 * "waiting on you" on a desktop means "waiting on this office". A phone
 * has no room picker and its owner does not think in rooms — they think
 * "do I have anything to sign". So this one is person-shaped: it takes no
 * room, walks the caller's memberships itself, and answers that question.
 *
 * It is also what the mobile badge counts, so it stays cheap: two lists
 * capped short, and the true totals alongside them.
 */
const PENDING_PEEK = 25;
const documentMyPending = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { actorId } = yield (0, callerScope_1.callerContext)(req);
    try {
        // The offices this person actually works in, and in which role. Only
        // an owner or a receiver can sign for a document, so only their rooms
        // contribute to the "to receive" pile — showing a signatory a receipt
        // they are not allowed to make is worse than showing them nothing.
        const memberships = yield prisma_1.prisma.roomAuthorizedUser.findMany({
            where: { userId: actorId, status: 1 },
            select: { receivingRoomId: true, type: true },
        });
        const receiptRoomIds = memberships
            .filter((m) => m.type === roomConfigController_1.ROOM_MEMBER_TYPES.owner ||
            m.type === roomConfigController_1.ROOM_MEMBER_TYPES.receiver)
            .map((m) => m.receivingRoomId)
            .filter((x) => !!x);
        const owedHere = Object.assign({ receivingRoomId: { in: receiptRoomIds }, queueRoom: { is: { status: { gte: 1 } } }, acknowledgedAt: null }, copyFurnish_1.VISIBLE_TO_ROOM);
        const mineToSign = {
            userId: actorId,
            status: 0,
            signatureQueueRoom: { is: { status: 1 } },
        };
        const [signRows, signTotal, recvRows, recvTotal] = yield Promise.all([
            prisma_1.prisma.signatoryArrangement.findMany({
                where: mineToSign,
                orderBy: { timestamp: "asc" },
                take: PENDING_PEEK,
                select: {
                    id: true,
                    index: true,
                    timestamp: true,
                    signatureQueueRoom: {
                        select: {
                            id: true,
                            title: true,
                            timestamp: true,
                            fromRoom: { select: { code: true } },
                            user: { select: { firstName: true, lastName: true } },
                            signatotyArrangement: { select: { status: true } },
                            _count: { select: { documents: true } },
                        },
                    },
                },
            }),
            prisma_1.prisma.signatoryArrangement.count({ where: mineToSign }),
            receiptRoomIds.length
                ? prisma_1.prisma.targetRoom.findMany({
                    where: owedHere,
                    orderBy: { timestamp: "asc" },
                    take: PENDING_PEEK,
                    select: {
                        id: true,
                        timestamp: true,
                        releasedAt: true,
                        viewedAt: true,
                        copyFurnished: true,
                        roomReceiver: { select: { id: true, code: true } },
                        queueRoom: {
                            select: {
                                id: true,
                                title: true,
                                user: { select: { firstName: true, lastName: true } },
                                fromRoom: { select: { code: true } },
                                _count: { select: { documents: true } },
                            },
                        },
                    },
                })
                : Promise.resolve([]),
            receiptRoomIds.length
                ? prisma_1.prisma.targetRoom.count({ where: owedHere })
                : Promise.resolve(0),
        ]);
        const toSign = signRows.map((a) => {
            var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q;
            const slots = (_b = (_a = a.signatureQueueRoom) === null || _a === void 0 ? void 0 : _a.signatotyArrangement) !== null && _b !== void 0 ? _b : [];
            return {
                arrangementId: a.id,
                queueId: (_d = (_c = a.signatureQueueRoom) === null || _c === void 0 ? void 0 : _c.id) !== null && _d !== void 0 ? _d : null,
                title: (_f = (_e = a.signatureQueueRoom) === null || _e === void 0 ? void 0 : _e.title) !== null && _f !== void 0 ? _f : "Untitled routing",
                from: (_l = (_j = (_h = (_g = a.signatureQueueRoom) === null || _g === void 0 ? void 0 : _g.fromRoom) === null || _h === void 0 ? void 0 : _h.code) !== null && _j !== void 0 ? _j : fullName((_k = a.signatureQueueRoom) === null || _k === void 0 ? void 0 : _k.user)) !== null && _l !== void 0 ? _l : "—",
                sentAt: (_o = (_m = a.signatureQueueRoom) === null || _m === void 0 ? void 0 : _m.timestamp) !== null && _o !== void 0 ? _o : a.timestamp,
                position: a.index + 1,
                totalSignatories: slots.length,
                signed: slots.filter((s) => s.status === 1).length,
                files: (_q = (_p = a.signatureQueueRoom) === null || _p === void 0 ? void 0 : _p._count.documents) !== null && _q !== void 0 ? _q : 0,
            };
        });
        const toReceive = recvRows.map((r) => {
            var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p;
            return ({
                targetId: r.id,
                queueId: (_b = (_a = r.queueRoom) === null || _a === void 0 ? void 0 : _a.id) !== null && _b !== void 0 ? _b : null,
                title: (_d = (_c = r.queueRoom) === null || _c === void 0 ? void 0 : _c.title) !== null && _d !== void 0 ? _d : "Untitled routing",
                from: (_j = (_g = (_f = (_e = r.queueRoom) === null || _e === void 0 ? void 0 : _e.fromRoom) === null || _f === void 0 ? void 0 : _f.code) !== null && _g !== void 0 ? _g : fullName((_h = r.queueRoom) === null || _h === void 0 ? void 0 : _h.user)) !== null && _j !== void 0 ? _j : "—",
                // Which of your offices owes this one. Somebody who sits in two
                // rooms cannot act on the list without being told.
                office: (_l = (_k = r.roomReceiver) === null || _k === void 0 ? void 0 : _k.code) !== null && _l !== void 0 ? _l : null,
                arrivedAt: (_m = r.releasedAt) !== null && _m !== void 0 ? _m : r.timestamp,
                copyFurnished: r.copyFurnished,
                opened: r.viewedAt !== null,
                files: (_p = (_o = r.queueRoom) === null || _o === void 0 ? void 0 : _o._count.documents) !== null && _p !== void 0 ? _p : 0,
            });
        });
        return res.code(200).send({
            toSign,
            toReceive,
            counts: {
                toSign: signTotal,
                toReceive: recvTotal,
                total: signTotal + recvTotal,
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
exports.documentMyPending = documentMyPending;
