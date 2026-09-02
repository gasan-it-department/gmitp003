"use strict";
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
exports.chatServeFile = exports.chatUploadFile = exports.chatServeImage = exports.chatUploadImage = exports.chatReads = exports.chatPresence = exports.chatReport = exports.chatMute = exports.chatMarkRead = exports.chatSend = exports.chatDelete = exports.chatEdit = exports.chatReact = exports.chatMessages = exports.chatRooms = void 0;
const prisma_1 = require("../barrel/prisma");
const errors_1 = require("../errors/errors");
const expoPush_1 = require("../service/expoPush");
/**
 * Employee chat — three fixed rooms per line:
 *   community : everyone in the line can post + read (group chat)
 *   hr        : only HR-module users post; everyone reads
 *   mayor     : only `super`-privilege users post; everyone reads
 *
 * Realtime: on send we emit `chat:message` to the line room (`line-<lineId>`),
 * which every signed-in client already joins. Push: mentions always notify the
 * mentioned users; the two announcement channels notify the whole line; the
 * community channel only pushes to mentioned users (to avoid spamming everyone).
 */
const ROOMS = ["community", "hr", "mayor"];
const ROOM_TITLE = {
    community: "Community",
    hr: "HR to Employee",
    mayor: "Mayor's Notice",
};
const isRoom = (r) => ROOMS.includes(r);
// Resolve the caller (account id from the token) → their User + line + role.
function resolveCtx(req) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c, _d;
        const accountId = (_a = req.user) === null || _a === void 0 ? void 0 : _a.id;
        if (!accountId)
            return null;
        const account = yield prisma_1.prisma.account.findUnique({
            where: { id: accountId },
            select: {
                lineId: true,
                User: {
                    select: {
                        id: true,
                        lineId: true,
                        firstName: true,
                        lastName: true,
                        privilege: { select: { humanResources: true, super: true } },
                    },
                },
            },
        });
        const u = account === null || account === void 0 ? void 0 : account.User;
        if (!u)
            return null;
        // The line lives on the ACCOUNT; the User row's lineId is often null. Use the
        // account's line (fall back to the User's) so chat isn't wrongly gated off.
        const lineId = account.lineId || u.lineId;
        if (!lineId)
            return null;
        return {
            userId: u.id,
            lineId,
            name: [u.firstName, u.lastName].filter(Boolean).join(" ").trim() || "Employee",
            isHr: !!((_b = u.privilege) === null || _b === void 0 ? void 0 : _b.humanResources) || !!((_c = u.privilege) === null || _c === void 0 ? void 0 : _c.super),
            isSuper: !!((_d = u.privilege) === null || _d === void 0 ? void 0 : _d.super),
        };
    });
}
function canPost(ctx, room) {
    if (room === "community")
        return true;
    if (room === "hr")
        return ctx.isHr;
    if (room === "mayor")
        return ctx.isSuper;
    return false;
}
// ── Community safety: light rate limiting + profanity mask ──────────────
// In-memory sliding window (per process). Community is the open, all-employee
// room so it's the abuse surface; the two announcement rooms are already gated.
const RATE_WINDOW_MS = 10000;
const RATE_MAX = 6; // messages per window per user
const rateHits = new Map();
function rateLimited(userId) {
    var _a;
    const now = Date.now();
    const arr = ((_a = rateHits.get(userId)) !== null && _a !== void 0 ? _a : []).filter((t) => now - t < RATE_WINDOW_MS);
    arr.push(now);
    rateHits.set(userId, arr);
    return arr.length > RATE_MAX;
}
// Common English + Filipino profanity; matched words are masked (first letter
// kept, rest → asterisks) so the message still posts but stays civil.
const PROFANITY = [
    "fuck", "fucking", "shit", "bitch", "asshole", "bastard", "dick", "pussy",
    "cunt", "motherfucker", "slut", "whore", "nigger", "faggot", "retard",
    "putangina", "putang ina", "tangina", "gago", "gaga", "ulol", "tarantado",
    "punyeta", "pakyu", "leche", "hayop ka", "bwiset", "buwisit",
];
const profanityRe = new RegExp(`\\b(${PROFANITY.map((w) => w.replace(/ /g, "\\s+")).join("|")})\\b`, "gi");
function maskProfanity(text) {
    return text.replace(profanityRe, (w) => w[0] + "*".repeat(Math.max(1, w.length - 1)));
}
// ── Link previews (Open Graph) ──────────────────────────────────────────
const URL_RE = /(https?:\/\/[^\s<>"']+)/i;
function firstUrl(text) {
    if (!text)
        return null;
    const m = URL_RE.exec(text);
    return m ? m[1] : null;
}
function decodeEntities(s) {
    return s
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#0?39;/g, "'")
        .replace(/&#x27;/gi, "'");
}
// Best-effort Open Graph fetch. SSRF-guarded: http/https only, no private
// hosts, short timeout, size-capped, text/html only. Never throws.
function fetchLinkPreview(url) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b;
        try {
            const u = new URL(url);
            if (u.protocol !== "http:" && u.protocol !== "https:")
                return null;
            const host = u.hostname;
            if (host === "localhost" ||
                host === "127.0.0.1" ||
                host === "::1" ||
                host.endsWith(".local") ||
                /^10\./.test(host) ||
                /^192\.168\./.test(host) ||
                /^172\.(1[6-9]|2\d|3[01])\./.test(host))
                return null;
            const ctrl = new AbortController();
            const timer = setTimeout(() => ctrl.abort(), 6000);
            let resp;
            try {
                resp = yield fetch(url, {
                    signal: ctrl.signal,
                    redirect: "follow",
                    headers: { "user-agent": "gasan-lgu-linkbot/1.0", accept: "text/html" },
                });
            }
            finally {
                clearTimeout(timer);
            }
            if (!resp.ok)
                return null;
            const ctype = (_a = resp.headers.get("content-type")) !== null && _a !== void 0 ? _a : "";
            if (!ctype.includes("text/html"))
                return null;
            const html = (yield resp.text()).slice(0, 200000);
            const pick = (prop) => {
                var _a;
                const a = new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]*content=["']([^"']+)["']`, "i").exec(html);
                const b = new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["']${prop}["']`, "i").exec(html);
                const hit = (_a = (a || b)) === null || _a === void 0 ? void 0 : _a[1];
                return hit ? decodeEntities(hit) : undefined;
            };
            const titleTag = (_b = /<title[^>]*>([^<]+)<\/title>/i.exec(html)) === null || _b === void 0 ? void 0 : _b[1];
            const title = pick("og:title") || (titleTag ? decodeEntities(titleTag) : undefined);
            const desc = pick("og:description") || pick("description");
            let image = pick("og:image") || pick("og:image:url");
            if (image && image.startsWith("//"))
                image = `${u.protocol}${image}`;
            else if (image && image.startsWith("/"))
                image = `${u.origin}${image}`;
            if (!title && !desc && !image)
                return null;
            return {
                title: title === null || title === void 0 ? void 0 : title.slice(0, 160),
                desc: desc === null || desc === void 0 ? void 0 : desc.slice(0, 240),
                image: image === null || image === void 0 ? void 0 : image.slice(0, 500),
            };
        }
        catch (_c) {
            return null;
        }
    });
}
// Fetch a preview asynchronously (after the message is already delivered) and,
// if found, patch the message + push a live update so the card fills in.
function enrichLinkPreview(req, lineId, messageId, url) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c;
        try {
            const p = yield fetchLinkPreview(url);
            if (!p || (!p.title && !p.desc && !p.image))
                return;
            const updated = yield prisma_1.prisma.chatMessage
                .update({
                where: { id: messageId },
                data: {
                    linkTitle: (_a = p.title) !== null && _a !== void 0 ? _a : null,
                    linkDesc: (_b = p.desc) !== null && _b !== void 0 ? _b : null,
                    linkImage: (_c = p.image) !== null && _c !== void 0 ? _c : null,
                },
            })
                .catch(() => null);
            if (!updated || updated.deletedAt)
                return;
            yield emitMessageUpdate(lineId, shape(req, updated));
        }
        catch (e) {
            console.warn("[chat] link preview failed", e);
        }
    });
}
// HR/super members of a line (via the account's line) — used to notify admins
// of a report and to authorise moderation.
function lineAdminUserIds(lineId) {
    return __awaiter(this, void 0, void 0, function* () {
        const accounts = yield prisma_1.prisma.account.findMany({
            where: { lineId },
            select: {
                User: {
                    select: {
                        id: true,
                        privilege: { select: { humanResources: true, super: true } },
                    },
                },
            },
        });
        return accounts
            .filter((a) => { var _a, _b; return a.User && (((_a = a.User.privilege) === null || _a === void 0 ? void 0 : _a.humanResources) || ((_b = a.User.privilege) === null || _b === void 0 ? void 0 : _b.super)); })
            .map((a) => a.User.id);
    });
}
const imageUrl = (req, imageId) => imageId ? `${selfBase(req)}/chat/image/${imageId}` : null;
const fileUrl = (req, fileId) => fileId ? `${selfBase(req)}/chat/file/${fileId}` : null;
function selfBase(req) {
    const proto = req.headers["x-forwarded-proto"] || req.protocol || "http";
    const host = req.headers["x-forwarded-host"] || req.headers.host;
    return `${proto}://${host}`;
}
function shape(req, m) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m;
    const deleted = !!m.deletedAt;
    return {
        id: m.id,
        room: m.room,
        senderId: m.senderId,
        senderName: m.senderName,
        body: deleted ? null : m.body,
        imageUrl: deleted ? null : imageUrl(req, m.imageId),
        fileUrl: deleted ? null : fileUrl(req, m.fileId),
        fileName: deleted ? null : (_a = m.fileName) !== null && _a !== void 0 ? _a : null,
        fileSize: deleted ? null : (_b = m.fileSize) !== null && _b !== void 0 ? _b : null,
        linkUrl: deleted ? null : m.linkUrl,
        linkTitle: deleted ? null : (_c = m.linkTitle) !== null && _c !== void 0 ? _c : null,
        linkDesc: deleted ? null : (_d = m.linkDesc) !== null && _d !== void 0 ? _d : null,
        linkImage: deleted ? null : (_e = m.linkImage) !== null && _e !== void 0 ? _e : null,
        mentionUserIds: deleted ? [] : (_f = m.mentionUserIds) !== null && _f !== void 0 ? _f : [],
        mentionNames: deleted ? [] : (_g = m.mentionNames) !== null && _g !== void 0 ? _g : [],
        replyToId: deleted ? null : (_h = m.replyToId) !== null && _h !== void 0 ? _h : null,
        replyToName: deleted ? null : (_j = m.replyToName) !== null && _j !== void 0 ? _j : null,
        replyToPreview: deleted ? null : (_k = m.replyToPreview) !== null && _k !== void 0 ? _k : null,
        clientOpId: (_l = m.clientOpId) !== null && _l !== void 0 ? _l : null,
        deleted,
        editedAt: (_m = m.editedAt) !== null && _m !== void 0 ? _m : null,
        createdAt: m.createdAt,
    };
}
// Push an edited/deleted message to everyone on the line so they replace it.
function emitMessageUpdate(lineId, payload) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const { notificationSocket } = yield Promise.resolve().then(() => __importStar(require("..")));
            notificationSocket.io.to(`line-${lineId}`).emit("chat:message-update", payload);
        }
        catch (e) {
            console.warn("[chat] message-update emit failed", e);
        }
    });
}
// GET /chat/rooms — the 3 rooms for the caller's line with last message,
// unread count and whether the caller may post.
const chatRooms = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const ctx = yield resolveCtx(req);
    if (!ctx)
        throw new errors_1.ValidationError("NO_LINKED_USER");
    const reads = yield prisma_1.prisma.chatReadState.findMany({
        where: { userId: ctx.userId, lineId: ctx.lineId },
    });
    const readMap = new Map(reads.map((r) => [r.room, r.lastReadAt]));
    const mutedMap = new Map(reads.map((r) => [r.room, r.muted]));
    const rooms = yield Promise.all(ROOMS.map((room) => __awaiter(void 0, void 0, void 0, function* () {
        const last = yield prisma_1.prisma.chatMessage.findFirst({
            where: { lineId: ctx.lineId, room },
            orderBy: { createdAt: "desc" },
        });
        const lastReadAt = readMap.get(room);
        const unread = yield prisma_1.prisma.chatMessage.count({
            where: Object.assign({ lineId: ctx.lineId, room, senderId: { not: ctx.userId } }, (lastReadAt ? { createdAt: { gt: lastReadAt } } : {})),
        });
        return {
            key: room,
            title: ROOM_TITLE[room],
            canPost: canPost(ctx, room),
            unread,
            muted: !!mutedMap.get(room),
            lastMessage: last ? shape(req, last) : null,
        };
    })));
    return res.code(200).send({ rooms });
});
exports.chatRooms = chatRooms;
// Aggregate reactions for a set of messages → { messageId: [{emoji,count,userIds}] }.
function aggregateReactions(messageIds) {
    return __awaiter(this, void 0, void 0, function* () {
        if (messageIds.length === 0)
            return {};
        const rows = yield prisma_1.prisma.chatReaction.findMany({
            where: { messageId: { in: messageIds } },
            select: { messageId: true, emoji: true, userId: true },
        });
        const byMsg = {};
        for (const r of rows) {
            if (!byMsg[r.messageId])
                byMsg[r.messageId] = {};
            if (!byMsg[r.messageId][r.emoji])
                byMsg[r.messageId][r.emoji] = [];
            byMsg[r.messageId][r.emoji].push(r.userId);
        }
        const out = {};
        for (const mid of Object.keys(byMsg)) {
            out[mid] = Object.entries(byMsg[mid]).map(([emoji, userIds]) => ({
                emoji,
                count: userIds.length,
                userIds,
            }));
        }
        return out;
    });
}
// GET /chat/messages?room=&cursor=&limit=  — newest-first, paginated.
const chatMessages = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    const ctx = yield resolveCtx(req);
    if (!ctx)
        throw new errors_1.ValidationError("NO_LINKED_USER");
    const q = req.query;
    if (!isRoom(q.room))
        throw new errors_1.ValidationError("BAD_ROOM");
    const take = Math.min(parseInt((_a = q.limit) !== null && _a !== void 0 ? _a : "30", 10) || 30, 100);
    const where = { lineId: ctx.lineId, room: q.room };
    if (q.query && q.query.trim()) {
        where.body = { contains: q.query.trim(), mode: "insensitive" };
    }
    const cursor = q.cursor ? { id: q.cursor } : undefined;
    const rows = yield prisma_1.prisma.chatMessage.findMany({
        where,
        take,
        skip: cursor ? 1 : 0,
        cursor,
        orderBy: { createdAt: "desc" },
    });
    const nextCursor = rows.length === take ? rows[rows.length - 1].id : null;
    const agg = yield aggregateReactions(rows.map((r) => r.id));
    return res.code(200).send({
        list: rows.map((m) => { var _a; return (Object.assign(Object.assign({}, shape(req, m)), { reactions: (_a = agg[m.id]) !== null && _a !== void 0 ? _a : [] })); }),
        lastCursor: nextCursor,
        hasMore: rows.length === take,
        canPost: canPost(ctx, q.room),
    });
});
exports.chatMessages = chatMessages;
// POST /chat/react  { messageId, emoji }  — toggle a reaction (Messenger-style).
const chatReact = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    const ctx = yield resolveCtx(req);
    if (!ctx)
        throw new errors_1.ValidationError("NO_LINKED_USER");
    const b = req.body;
    if (!b.messageId || !b.emoji)
        throw new errors_1.ValidationError("BAD_REQUEST");
    const emoji = String(b.emoji).slice(0, 8);
    const msg = yield prisma_1.prisma.chatMessage.findUnique({
        where: { id: b.messageId },
        select: { id: true, lineId: true, room: true },
    });
    if (!msg || msg.lineId !== ctx.lineId)
        throw new errors_1.ValidationError("MESSAGE_NOT_FOUND");
    const key = { messageId_userId: { messageId: msg.id, userId: ctx.userId } };
    const existing = yield prisma_1.prisma.chatReaction.findUnique({ where: key });
    if (existing && existing.emoji === emoji) {
        yield prisma_1.prisma.chatReaction.delete({ where: key }); // toggle off
    }
    else if (existing) {
        yield prisma_1.prisma.chatReaction.update({ where: key, data: { emoji } }); // change
    }
    else {
        yield prisma_1.prisma.chatReaction.create({
            data: { messageId: msg.id, userId: ctx.userId, emoji },
        });
    }
    const reactions = (_a = (yield aggregateReactions([msg.id]))[msg.id]) !== null && _a !== void 0 ? _a : [];
    try {
        const { notificationSocket } = yield Promise.resolve().then(() => __importStar(require("..")));
        notificationSocket.io
            .to(`line-${ctx.lineId}`)
            .emit("chat:reaction", { messageId: msg.id, room: msg.room, reactions });
    }
    catch (e) {
        console.warn("[chat] reaction emit failed", e);
    }
    return res.code(200).send({ messageId: msg.id, reactions });
});
exports.chatReact = chatReact;
// PATCH /chat/message  { messageId, body }  — edit your own message's text.
const chatEdit = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    const ctx = yield resolveCtx(req);
    if (!ctx)
        throw new errors_1.ValidationError("NO_LINKED_USER");
    const b = req.body;
    if (!b.messageId)
        throw new errors_1.ValidationError("BAD_REQUEST");
    const text = ((_a = b.body) !== null && _a !== void 0 ? _a : "").trim();
    const msg = yield prisma_1.prisma.chatMessage.findUnique({ where: { id: b.messageId } });
    if (!msg || msg.lineId !== ctx.lineId)
        throw new errors_1.ValidationError("MESSAGE_NOT_FOUND");
    if (msg.senderId !== ctx.userId)
        return res.code(403).send({ message: "You can only edit your own messages." });
    if (msg.deletedAt)
        return res.code(400).send({ message: "This message was deleted." });
    if (!text && !msg.imageId && !msg.linkUrl)
        throw new errors_1.ValidationError("EMPTY_MESSAGE");
    const updated = yield prisma_1.prisma.chatMessage.update({
        where: { id: msg.id },
        data: { body: text || null, editedAt: new Date() },
    });
    const payload = shape(req, updated);
    yield emitMessageUpdate(ctx.lineId, payload);
    return res.code(200).send({ message: payload });
});
exports.chatEdit = chatEdit;
// DELETE /chat/message?messageId=  — delete for everyone (sender only).
const chatDelete = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    const ctx = yield resolveCtx(req);
    if (!ctx)
        throw new errors_1.ValidationError("NO_LINKED_USER");
    const q = req.query;
    const bodyId = (_a = req.body) === null || _a === void 0 ? void 0 : _a.messageId;
    const messageId = q.messageId || bodyId;
    if (!messageId)
        throw new errors_1.ValidationError("BAD_REQUEST");
    const msg = yield prisma_1.prisma.chatMessage.findUnique({ where: { id: messageId } });
    if (!msg || msg.lineId !== ctx.lineId)
        throw new errors_1.ValidationError("MESSAGE_NOT_FOUND");
    // Sender can always delete their own; HR/super can moderate anyone's message.
    const isAdmin = ctx.isHr || ctx.isSuper;
    if (msg.senderId !== ctx.userId && !isAdmin)
        return res.code(403).send({ message: "You can only delete your own messages." });
    const updated = yield prisma_1.prisma.chatMessage.update({
        where: { id: msg.id },
        data: {
            deletedAt: new Date(),
            body: null,
            imageId: null,
            fileId: null,
            fileName: null,
            fileSize: null,
            linkUrl: null,
            linkTitle: null,
            linkDesc: null,
            linkImage: null,
            replyToName: null,
            replyToPreview: null,
            mentionUserIds: [],
            mentionNames: [],
        },
    });
    yield prisma_1.prisma.chatReaction.deleteMany({ where: { messageId: msg.id } }).catch(() => { });
    const payload = shape(req, updated);
    yield emitMessageUpdate(ctx.lineId, payload);
    return res.code(200).send({ message: payload });
});
exports.chatDelete = chatDelete;
// POST /chat/message  { room, body?, imageId?, linkUrl?, mentions?, clientOpId? }
const chatSend = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c;
    const ctx = yield resolveCtx(req);
    if (!ctx)
        throw new errors_1.ValidationError("NO_LINKED_USER");
    const body = req.body;
    if (!isRoom(body.room))
        throw new errors_1.ValidationError("BAD_ROOM");
    const room = body.room;
    if (!canPost(ctx, room)) {
        return res.code(403).send({ message: "You can't post in this channel." });
    }
    let text = ((_a = body.body) !== null && _a !== void 0 ? _a : "").trim();
    if (!text && !body.imageId && !body.linkUrl && !body.fileId) {
        throw new errors_1.ValidationError("EMPTY_MESSAGE");
    }
    // Idempotent replay (offline resend): return the existing message.
    if (body.clientOpId) {
        const existing = yield prisma_1.prisma.chatMessage.findUnique({
            where: { clientOpId: body.clientOpId },
        });
        if (existing)
            return res.code(200).send({ message: shape(req, existing) });
    }
    // Community safety: rate-limit + mask profanity (open, all-employee room).
    if (room === "community") {
        if (rateLimited(ctx.userId)) {
            return res
                .code(429)
                .send({ message: "You're sending messages too fast — wait a few seconds." });
        }
        if (text)
            text = maskProfanity(text);
    }
    // Reply/quote: resolve the parent (same line) and denormalise a preview.
    let replyToId = null;
    let replyToName = null;
    let replyToPreview = null;
    if (body.replyToId) {
        const parent = yield prisma_1.prisma.chatMessage.findUnique({
            where: { id: body.replyToId },
            select: {
                id: true,
                lineId: true,
                senderName: true,
                body: true,
                deletedAt: true,
                imageId: true,
                fileName: true,
                linkUrl: true,
            },
        });
        if (parent && parent.lineId === ctx.lineId) {
            replyToId = parent.id;
            replyToName = (_b = parent.senderName) !== null && _b !== void 0 ? _b : "Employee";
            replyToPreview = parent.deletedAt
                ? "Deleted message"
                : ((_c = parent.body) === null || _c === void 0 ? void 0 : _c.slice(0, 120)) ||
                    (parent.imageId
                        ? "📷 Photo"
                        : parent.fileName
                            ? `📎 ${parent.fileName}`
                            : parent.linkUrl
                                ? "🔗 Link"
                                : "Message");
        }
    }
    const mentions = Array.isArray(body.mentions)
        ? Array.from(new Set(body.mentions.filter((x) => typeof x === "string" && x)))
        : [];
    const mentionNames = Array.isArray(body.mentionNames)
        ? body.mentionNames.filter((x) => typeof x === "string" && x).slice(0, mentions.length || undefined)
        : [];
    const created = yield prisma_1.prisma.chatMessage.create({
        data: {
            lineId: ctx.lineId,
            room,
            senderId: ctx.userId,
            senderName: ctx.name,
            body: text || null,
            imageId: body.imageId || null,
            fileId: body.fileId || null,
            fileName: body.fileName || null,
            fileSize: typeof body.fileSize === "number" ? body.fileSize : null,
            linkUrl: body.linkUrl || null,
            mentionUserIds: mentions,
            mentionNames,
            replyToId,
            replyToName,
            replyToPreview,
            clientOpId: body.clientOpId || null,
        },
    });
    const payload = shape(req, created);
    // Sender has implicitly read up to their own message.
    yield prisma_1.prisma.chatReadState
        .upsert({
        where: { userId_lineId_room: { userId: ctx.userId, lineId: ctx.lineId, room } },
        update: { lastReadAt: created.createdAt },
        create: { userId: ctx.userId, lineId: ctx.lineId, room, lastReadAt: created.createdAt },
    })
        .catch(() => { });
    // Realtime fan-out to everyone on the line.
    try {
        const { notificationSocket } = yield Promise.resolve().then(() => __importStar(require("..")));
        notificationSocket.io.to(`line-${ctx.lineId}`).emit("chat:message", payload);
    }
    catch (e) {
        console.warn("[chat] realtime emit failed", e);
    }
    // Push: work out who to notify, then fire (best-effort, non-blocking).
    void notifyRecipients(ctx, room, payload, mentions);
    // Link preview (best-effort, async): fetch OG tags then patch + push update.
    const previewUrl = body.linkUrl || firstUrl(text);
    if (previewUrl)
        void enrichLinkPreview(req, ctx.lineId, created.id, previewUrl);
    return res.code(200).send({ message: payload });
});
exports.chatSend = chatSend;
// Every User in the line — resolved via the ACCOUNT's line (User.lineId is
// often null, so a `user.where({lineId})` query would miss most people).
function lineMemberUserIds(lineId) {
    return __awaiter(this, void 0, void 0, function* () {
        const accounts = yield prisma_1.prisma.account.findMany({
            where: { lineId },
            select: { User: { select: { id: true } } },
        });
        return accounts
            .map((a) => { var _a; return (_a = a.User) === null || _a === void 0 ? void 0 : _a.id; })
            .filter((x) => typeof x === "string" && !!x);
    });
}
function notifyRecipients(ctx, room, payload, mentions) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        try {
            const title = room === "mayor"
                ? "Mayor's Notice"
                : room === "hr"
                    ? "HR to Employee"
                    : "Community";
            const preview = ((_a = payload.body) === null || _a === void 0 ? void 0 : _a.slice(0, 140)) ||
                (payload.imageUrl
                    ? "📷 Photo"
                    : payload.fileUrl
                        ? "📎 File"
                        : payload.linkUrl
                            ? "🔗 Link"
                            : "New message");
            const data = { path: `/chat/${room}`, room };
            // All three rooms notify everyone on the line (Community is a group chat,
            // so every member is pinged like Messenger).
            const recipientIds = yield lineMemberUserIds(ctx.lineId);
            for (const m of mentions)
                if (!recipientIds.includes(m))
                    recipientIds.push(m);
            // Users who muted this room get no push — unless they were @mentioned.
            const mutedRows = yield prisma_1.prisma.chatReadState.findMany({
                where: { lineId: ctx.lineId, room, muted: true },
                select: { userId: true },
            });
            const mutedSet = new Set(mutedRows.map((m) => m.userId));
            const targets = recipientIds.filter((id) => id && id !== ctx.userId && (mentions.includes(id) || !mutedSet.has(id)));
            yield Promise.all(targets.map((id) => (0, expoPush_1.sendPushToUser)(id, {
                title,
                // For Community, prefix the sender's name like a group chat does.
                body: mentions.includes(id)
                    ? `${ctx.name} mentioned you: ${preview}`
                    : room === "community"
                        ? `${ctx.name}: ${preview}`
                        : preview,
                data,
            })));
        }
        catch (e) {
            console.warn("[chat] push notify failed", e);
        }
    });
}
// POST /chat/read  { room }
const chatMarkRead = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const ctx = yield resolveCtx(req);
    if (!ctx)
        throw new errors_1.ValidationError("NO_LINKED_USER");
    const b = req.body;
    if (!isRoom(b.room))
        throw new errors_1.ValidationError("BAD_ROOM");
    const now = new Date();
    yield prisma_1.prisma.chatReadState.upsert({
        where: { userId_lineId_room: { userId: ctx.userId, lineId: ctx.lineId, room: b.room } },
        update: { lastReadAt: now },
        create: { userId: ctx.userId, lineId: ctx.lineId, room: b.room, lastReadAt: now },
    });
    // Realtime read receipt: tell the line who read up to when, so senders can
    // update their "Seen by …" live.
    try {
        const { notificationSocket } = yield Promise.resolve().then(() => __importStar(require("..")));
        notificationSocket.io.to(`line-${ctx.lineId}`).emit("chat:read", {
            room: b.room,
            userId: ctx.userId,
            name: ctx.name,
            lastReadAt: now.toISOString(),
        });
    }
    catch (e) {
        console.warn("[chat] read emit failed", e);
    }
    return res.code(200).send({ message: "OK" });
});
exports.chatMarkRead = chatMarkRead;
// POST /chat/mute  { room, muted }  — silence/unsilence a room's push for me.
const chatMute = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const ctx = yield resolveCtx(req);
    if (!ctx)
        throw new errors_1.ValidationError("NO_LINKED_USER");
    const b = req.body;
    if (!isRoom(b.room))
        throw new errors_1.ValidationError("BAD_ROOM");
    const muted = !!b.muted;
    yield prisma_1.prisma.chatReadState.upsert({
        where: { userId_lineId_room: { userId: ctx.userId, lineId: ctx.lineId, room: b.room } },
        update: { muted },
        create: { userId: ctx.userId, lineId: ctx.lineId, room: b.room, muted },
    });
    return res.code(200).send({ room: b.room, muted });
});
exports.chatMute = chatMute;
// POST /chat/report  { messageId, reason? } — flag a message; notify admins.
const chatReport = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    const ctx = yield resolveCtx(req);
    if (!ctx)
        throw new errors_1.ValidationError("NO_LINKED_USER");
    const b = req.body;
    if (!b.messageId)
        throw new errors_1.ValidationError("BAD_REQUEST");
    const msg = yield prisma_1.prisma.chatMessage.findUnique({
        where: { id: b.messageId },
        select: { id: true, lineId: true, room: true },
    });
    if (!msg || msg.lineId !== ctx.lineId)
        throw new errors_1.ValidationError("MESSAGE_NOT_FOUND");
    yield prisma_1.prisma.chatReport.create({
        data: {
            lineId: ctx.lineId,
            room: msg.room,
            messageId: msg.id,
            reporterId: ctx.userId,
            reporterName: ctx.name,
            reason: ((_a = b.reason) !== null && _a !== void 0 ? _a : "").slice(0, 300) || null,
        },
    });
    // Tell the line's HR/super (best-effort, non-blocking).
    void (() => __awaiter(void 0, void 0, void 0, function* () {
        var _a;
        try {
            const admins = yield lineAdminUserIds(ctx.lineId);
            const roomTitle = (_a = ROOM_TITLE[msg.room]) !== null && _a !== void 0 ? _a : msg.room;
            yield Promise.all(admins
                .filter((id) => id && id !== ctx.userId)
                .map((id) => (0, expoPush_1.sendPushToUser)(id, {
                title: "Message reported",
                body: `${ctx.name} reported a message in ${roomTitle}.`,
                data: { path: `/chat/${msg.room}`, room: msg.room },
            })));
        }
        catch (e) {
            console.warn("[chat] report notify failed", e);
        }
    }))();
    return res.code(200).send({ ok: true });
});
exports.chatReport = chatReport;
// GET /chat/presence — who on the line is online now + everyone's last-seen.
const chatPresence = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const ctx = yield resolveCtx(req);
    if (!ctx)
        throw new errors_1.ValidationError("NO_LINKED_USER");
    let online = [];
    try {
        const { notificationSocket } = yield Promise.resolve().then(() => __importStar(require("..")));
        online = notificationSocket.getOnlineUserIds(ctx.lineId);
    }
    catch (_a) {
        /* socket not ready — treat everyone as offline */
    }
    const rows = yield prisma_1.prisma.chatPresence.findMany({
        where: { lineId: ctx.lineId },
        select: { userId: true, lastSeenAt: true },
    });
    const lastSeen = {};
    for (const r of rows)
        lastSeen[r.userId] = r.lastSeenAt.toISOString();
    return res.code(200).send({ online, lastSeen });
});
exports.chatPresence = chatPresence;
// GET /chat/reads?room=  — everyone's last-read time in this room (for "Seen by").
const chatReads = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const ctx = yield resolveCtx(req);
    if (!ctx)
        throw new errors_1.ValidationError("NO_LINKED_USER");
    const q = req.query;
    if (!isRoom(q.room))
        throw new errors_1.ValidationError("BAD_ROOM");
    const reads = yield prisma_1.prisma.chatReadState.findMany({
        where: { lineId: ctx.lineId, room: q.room },
        select: { userId: true, lastReadAt: true },
    });
    const users = yield prisma_1.prisma.user.findMany({
        where: { id: { in: reads.map((r) => r.userId) } },
        select: { id: true, firstName: true, lastName: true },
    });
    const nameById = new Map(users.map((u) => [
        u.id,
        [u.firstName, u.lastName].filter(Boolean).join(" ").trim() || "Employee",
    ]));
    return res.code(200).send({
        reads: reads.map((r) => {
            var _a;
            return ({
                userId: r.userId,
                name: (_a = nameById.get(r.userId)) !== null && _a !== void 0 ? _a : "Employee",
                lastReadAt: r.lastReadAt,
            });
        }),
    });
});
exports.chatReads = chatReads;
// POST /chat/image  (multipart, field "file") → { imageId }
const chatUploadImage = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, e_1, _b, _c, _d, e_2, _e, _f;
    const ctx = yield resolveCtx(req);
    if (!ctx)
        throw new errors_1.ValidationError("NO_LINKED_USER");
    if (!req.isMultipart())
        throw new errors_1.ValidationError("NOT_MULTIPART");
    let file = null;
    try {
        for (var _g = true, _h = __asyncValues(req.parts()), _j; _j = yield _h.next(), _a = _j.done, !_a; _g = true) {
            _c = _j.value;
            _g = false;
            const part = _c;
            if (part.type === "file") {
                const chunks = [];
                try {
                    for (var _k = true, _l = (e_2 = void 0, __asyncValues(part.file)), _m; _m = yield _l.next(), _d = _m.done, !_d; _k = true) {
                        _f = _m.value;
                        _k = false;
                        const chunk = _f;
                        chunks.push(chunk);
                    }
                }
                catch (e_2_1) { e_2 = { error: e_2_1 }; }
                finally {
                    try {
                        if (!_k && !_d && (_e = _l.return)) yield _e.call(_l);
                    }
                    finally { if (e_2) throw e_2.error; }
                }
                file = { mimetype: part.mimetype, buffer: Buffer.concat(chunks) };
            }
        }
    }
    catch (e_1_1) { e_1 = { error: e_1_1 }; }
    finally {
        try {
            if (!_g && !_a && (_b = _h.return)) yield _b.call(_h);
        }
        finally { if (e_1) throw e_1.error; }
    }
    if (!file)
        throw new errors_1.ValidationError("MISSING_FILE");
    if (!file.mimetype.startsWith("image/"))
        throw new errors_1.ValidationError("FILE_MUST_BE_AN_IMAGE");
    if (file.buffer.length > 8 * 1024 * 1024)
        throw new errors_1.ValidationError("IMAGE_TOO_LARGE");
    const saved = yield prisma_1.prisma.chatImage.create({
        data: { mime: file.mimetype, bytes: file.buffer },
        select: { id: true },
    });
    return res.code(200).send({ imageId: saved.id, url: imageUrl(req, saved.id) });
});
exports.chatUploadImage = chatUploadImage;
// GET /chat/image/:id  (PUBLIC — loaded via <Image src>)
const chatServeImage = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { id } = req.params;
    if (!id)
        throw new errors_1.ValidationError("BAD_REQUEST");
    const img = yield prisma_1.prisma.chatImage.findUnique({
        where: { id },
        select: { bytes: true, mime: true },
    });
    if (!(img === null || img === void 0 ? void 0 : img.bytes))
        return res.code(404).send({ message: "No image" });
    return res
        .header("Content-Type", img.mime || "image/jpeg")
        .header("Cache-Control", "public, max-age=31536000, immutable")
        .send(Buffer.from(img.bytes));
});
exports.chatServeImage = chatServeImage;
// POST /chat/file  (multipart, field "file") → { fileId, name, size, url }
const chatUploadFile = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, e_3, _b, _c, _d, e_4, _e, _f;
    const ctx = yield resolveCtx(req);
    if (!ctx)
        throw new errors_1.ValidationError("NO_LINKED_USER");
    if (!req.isMultipart())
        throw new errors_1.ValidationError("NOT_MULTIPART");
    let file = null;
    try {
        for (var _g = true, _h = __asyncValues(req.parts()), _j; _j = yield _h.next(), _a = _j.done, !_a; _g = true) {
            _c = _j.value;
            _g = false;
            const part = _c;
            if (part.type === "file") {
                const chunks = [];
                try {
                    for (var _k = true, _l = (e_4 = void 0, __asyncValues(part.file)), _m; _m = yield _l.next(), _d = _m.done, !_d; _k = true) {
                        _f = _m.value;
                        _k = false;
                        const chunk = _f;
                        chunks.push(chunk);
                    }
                }
                catch (e_4_1) { e_4 = { error: e_4_1 }; }
                finally {
                    try {
                        if (!_k && !_d && (_e = _l.return)) yield _e.call(_l);
                    }
                    finally { if (e_4) throw e_4.error; }
                }
                file = {
                    filename: part.filename || "file",
                    mimetype: part.mimetype || "application/octet-stream",
                    buffer: Buffer.concat(chunks),
                };
            }
        }
    }
    catch (e_3_1) { e_3 = { error: e_3_1 }; }
    finally {
        try {
            if (!_g && !_a && (_b = _h.return)) yield _b.call(_h);
        }
        finally { if (e_3) throw e_3.error; }
    }
    if (!file)
        throw new errors_1.ValidationError("MISSING_FILE");
    if (file.buffer.length > 20 * 1024 * 1024)
        throw new errors_1.ValidationError("FILE_TOO_LARGE");
    const saved = yield prisma_1.prisma.chatFile.create({
        data: {
            name: file.filename.slice(0, 200),
            mime: file.mimetype,
            size: file.buffer.length,
            bytes: file.buffer,
        },
        select: { id: true, name: true, size: true },
    });
    return res.code(200).send({
        fileId: saved.id,
        name: saved.name,
        size: saved.size,
        url: fileUrl(req, saved.id),
    });
});
exports.chatUploadFile = chatUploadFile;
// GET /chat/file/:id  (PUBLIC — opened/downloaded via the message link)
const chatServeFile = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { id } = req.params;
    if (!id)
        throw new errors_1.ValidationError("BAD_REQUEST");
    const f = yield prisma_1.prisma.chatFile.findUnique({
        where: { id },
        select: { bytes: true, mime: true, name: true },
    });
    if (!(f === null || f === void 0 ? void 0 : f.bytes))
        return res.code(404).send({ message: "No file" });
    const safeName = (f.name || "file").replace(/["\r\n]/g, "");
    return res
        .header("Content-Type", f.mime || "application/octet-stream")
        .header("Content-Disposition", `inline; filename="${safeName}"`)
        .header("Cache-Control", "public, max-age=31536000, immutable")
        .send(Buffer.from(f.bytes));
});
exports.chatServeFile = chatServeFile;
