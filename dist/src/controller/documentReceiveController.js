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
exports.documentReceiveDisseminate = exports.documentReceivePageServe = exports.documentReceivePageUpload = exports.myDocMobileAccess = exports.revokeDocMobileAccess = exports.grantDocMobileAccess = exports.docMobileAccessCandidates = exports.listDocMobileAccess = exports.documentReceiveList = exports.documentReceiveCreate = exports.documentReceiveFind = exports.documentReceiveSync = void 0;
const prisma_1 = require("../barrel/prisma");
const errors_1 = require("../errors/errors");
const callerScope_1 = require("../service/callerScope");
/**
 * Document Receiving — barcode-stickered physical documents logged by the
 * office/unit receiving personnel.
 *
 *   sync  : incremental download for the mobile offline mirror (since=ms)
 *   find  : online lookup of one barcode (mobile fallback when not local)
 *   create: idempotent register (client id + [lineId,barcode] unique — a
 *           replay or a race with another device returns the existing row)
 *   list  : paged/searchable registry for the web tool
 */
const shape = (r) => {
    var _a, _b, _c, _d, _e, _f;
    return ({
        id: r.id,
        lineId: r.lineId,
        barcode: r.barcode,
        title: r.title,
        senderUnitId: (_a = r.senderUnitId) !== null && _a !== void 0 ? _a : null,
        senderUnitName: (_b = r.senderUnitName) !== null && _b !== void 0 ? _b : null,
        senderName: (_c = r.senderName) !== null && _c !== void 0 ? _c : null,
        receivedById: (_d = r.receivedById) !== null && _d !== void 0 ? _d : null,
        receivedByName: (_e = r.receivedByName) !== null && _e !== void 0 ? _e : null,
        direction: r.direction === "out" ? "out" : "in",
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
        deletedAt: (_f = r.deletedAt) !== null && _f !== void 0 ? _f : null,
    });
};
// GET /document/receive/sync?lineId=&since=<ms>
const documentReceiveSync = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const q = req.query;
    if (!q.lineId)
        throw new errors_1.ValidationError("BAD_REQUEST: lineId required");
    // And the offline sync feed behind the mobile scanner.
    yield (0, callerScope_1.requireSameLine)(req, req.query.lineId);
    const sinceMs = q.since ? parseInt(q.since, 10) : 0;
    const sinceDate = sinceMs > 0 ? new Date(sinceMs) : undefined;
    const rows = yield prisma_1.prisma.documentReceiveRecord.findMany({
        where: Object.assign({ lineId: q.lineId }, (sinceDate ? { updatedAt: { gt: sinceDate } } : {})),
        orderBy: { updatedAt: "asc" },
        take: 2000,
    });
    const pageMap = yield pagesFor(rows.map((r) => r.id));
    return res.code(200).send({
        list: rows.map((r) => { var _a; return (Object.assign(Object.assign({}, shape(r)), { pages: (_a = pageMap[r.id]) !== null && _a !== void 0 ? _a : [] })); }),
        now: Date.now(),
    });
});
exports.documentReceiveSync = documentReceiveSync;
// GET /document/receive/find?lineId=&barcode=
const documentReceiveFind = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    const q = req.query;
    if (!q.lineId || !q.barcode)
        throw new errors_1.ValidationError("BAD_REQUEST");
    // Including looking one up by barcode.
    yield (0, callerScope_1.requireSameLine)(req, req.query.lineId);
    const row = yield prisma_1.prisma.documentReceiveRecord.findUnique({
        where: { lineId_barcode: { lineId: q.lineId, barcode: q.barcode.trim() } },
    });
    if (!row || row.deletedAt)
        return res.code(200).send({ record: null });
    const pageMap = yield pagesFor([row.id]);
    return res
        .code(200)
        .send({ record: Object.assign(Object.assign({}, shape(row)), { pages: (_a = pageMap[row.id]) !== null && _a !== void 0 ? _a : [] }) });
});
exports.documentReceiveFind = documentReceiveFind;
// POST /document/receive
// { id?, lineId, barcode, title, senderUnitId?, senderUnitName?, senderName?, userId? }
const documentReceiveCreate = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j;
    const b = req.body;
    const lineId = ((_a = b.lineId) !== null && _a !== void 0 ? _a : "").trim();
    const barcode = ((_b = b.barcode) !== null && _b !== void 0 ? _b : "").trim();
    const title = ((_c = b.title) !== null && _c !== void 0 ? _c : "").trim();
    if (!lineId || !barcode || !title)
        throw new errors_1.ValidationError("BAD_REQUEST: lineId, barcode and title required");
    // Logging an arrival onto somebody else's line.
    yield (0, callerScope_1.requireSameLine)(req, b.lineId);
    // Replay of the same offline op → return what it created.
    if (b.id) {
        const byId = yield prisma_1.prisma.documentReceiveRecord.findUnique({
            where: { id: b.id },
        });
        if (byId)
            return res.code(200).send({ record: shape(byId), existing: true });
    }
    // Barcode already registered on this line (e.g. another device won) → return it.
    const byCode = yield prisma_1.prisma.documentReceiveRecord.findUnique({
        where: { lineId_barcode: { lineId, barcode } },
    });
    if (byCode)
        return res.code(200).send({ record: shape(byCode), existing: true });
    // Denormalise names so mobile/offline lists render without joins.
    let senderUnitName = ((_d = b.senderUnitName) !== null && _d !== void 0 ? _d : "").trim() || null;
    const senderUnitId = ((_e = b.senderUnitId) !== null && _e !== void 0 ? _e : "").trim() || null;
    if (senderUnitId && !senderUnitName) {
        const dep = yield prisma_1.prisma.department.findUnique({
            where: { id: senderUnitId },
            select: { name: true },
        });
        senderUnitName = (_f = dep === null || dep === void 0 ? void 0 : dep.name) !== null && _f !== void 0 ? _f : null;
    }
    let receivedByName = null;
    const receivedById = ((_g = b.userId) !== null && _g !== void 0 ? _g : "").trim() || null;
    if (receivedById) {
        const u = yield prisma_1.prisma.user.findUnique({
            where: { id: receivedById },
            select: { firstName: true, lastName: true },
        });
        if (u)
            receivedByName =
                [u.firstName, u.lastName].filter(Boolean).join(" ").trim() || null;
    }
    const direction = b.direction === "out" ? "out" : "in";
    const created = yield prisma_1.prisma.documentReceiveRecord.create({
        data: Object.assign(Object.assign({}, (b.id ? { id: b.id } : {})), { lineId,
            barcode,
            title,
            senderUnitId,
            senderUnitName, senderName: ((_h = b.senderName) !== null && _h !== void 0 ? _h : "").trim() || null, direction,
            receivedById,
            receivedByName, clientOpId: (_j = b.id) !== null && _j !== void 0 ? _j : null }),
    });
    return res.code(200).send({ record: shape(created), existing: false });
});
exports.documentReceiveCreate = documentReceiveCreate;
// GET /document/receive/list?lineId=&cursor=&limit=&query=  (web registry)
const documentReceiveList = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    const q = req.query;
    if (!q.lineId)
        throw new errors_1.ValidationError("BAD_REQUEST: lineId required");
    // A municipality's receiving log is its own.
    yield (0, callerScope_1.requireSameLine)(req, req.query.lineId);
    const take = Math.min(parseInt((_a = q.limit) !== null && _a !== void 0 ? _a : "20", 10) || 20, 100);
    const where = { lineId: q.lineId, deletedAt: null };
    if (q.direction === "in" || q.direction === "out")
        where.direction = q.direction;
    if (q.query && q.query.trim()) {
        const s = q.query.trim();
        where.OR = [
            { barcode: { contains: s, mode: "insensitive" } },
            { title: { contains: s, mode: "insensitive" } },
            { senderUnitName: { contains: s, mode: "insensitive" } },
            { senderName: { contains: s, mode: "insensitive" } },
            { receivedByName: { contains: s, mode: "insensitive" } },
        ];
    }
    const rows = yield prisma_1.prisma.documentReceiveRecord.findMany(Object.assign(Object.assign({ where,
        take, skip: q.cursor ? 1 : 0 }, (q.cursor ? { cursor: { id: q.cursor } } : {})), { orderBy: { createdAt: "desc" } }));
    const pageMap = yield pagesFor(rows.map((r) => r.id));
    return res.code(200).send({
        list: rows.map((r) => { var _a; return (Object.assign(Object.assign({}, shape(r)), { pages: (_a = pageMap[r.id]) !== null && _a !== void 0 ? _a : [] })); }),
        hasMore: rows.length === take,
        lastCursor: rows.length > 0 ? rows[rows.length - 1].id : null,
    });
});
exports.documentReceiveList = documentReceiveList;
// ═══════════════ Mobile Access (who may use the mobile doc scanner) ═══════
const fullName = (u) => `${u.lastName}, ${u.firstName}${u.middleName ? " " + u.middleName : ""}`;
// GET /document/mobile-access?lineId — users granted mobile document access
const listDocMobileAccess = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { lineId } = req.query;
    if (!lineId)
        throw new errors_1.ValidationError("lineId is required");
    // Who may scan on mobile, for this municipality.
    yield (0, callerScope_1.requireSameLine)(req, req.query.lineId);
    const rows = yield prisma_1.prisma.documentMobileAccess.findMany({
        where: { lineId },
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
            grantedBy: { select: { firstName: true, lastName: true } },
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
            grantedBy: r.grantedBy
                ? `${r.grantedBy.lastName}, ${r.grantedBy.firstName}`
                : null,
        });
    });
    return res.code(200).send({ list });
});
exports.listDocMobileAccess = listDocMobileAccess;
// GET /document/mobile-access/candidates?lineId&query — line users not yet granted
const docMobileAccessCandidates = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { lineId, query } = req.query;
    if (!lineId)
        throw new errors_1.ValidationError("lineId is required");
    // And who could be given it.
    yield (0, callerScope_1.requireSameLine)(req, req.query.lineId);
    const granted = yield prisma_1.prisma.documentMobileAccess.findMany({
        where: { lineId },
        select: { userId: true },
    });
    const grantedIds = granted.map((g) => g.userId);
    const term = (query !== null && query !== void 0 ? query : "").trim();
    const users = yield prisma_1.prisma.user.findMany({
        where: Object.assign(Object.assign({ lineId, active: 1 }, (grantedIds.length ? { id: { notIn: grantedIds } } : {})), (term
            ? {
                OR: [
                    { firstName: { contains: term, mode: "insensitive" } },
                    { lastName: { contains: term, mode: "insensitive" } },
                    { username: { contains: term, mode: "insensitive" } },
                ],
            }
            : {})),
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
    return res.code(200).send({
        list: users.map((u) => {
            var _a, _b;
            return ({
                id: u.id,
                name: fullName(u),
                username: u.username,
                department: (_b = (_a = u.department) === null || _a === void 0 ? void 0 : _a.name) !== null && _b !== void 0 ? _b : null,
            });
        }),
    });
});
exports.docMobileAccessCandidates = docMobileAccessCandidates;
// POST /document/mobile-access { lineId, userId, grantedById } — grant (idempotent)
const grantDocMobileAccess = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const body = req.body;
    if (!body.lineId || !body.userId)
        throw new errors_1.ValidationError("lineId and userId are required");
    // Handing somebody mobile access is a privilege grant, and it was open
    // to anyone signed in. The granter is the token's user, never a name
    // supplied in the body — an audit trail you can forge is not one.
    const { actorId } = yield (0, callerScope_1.requireSameLine)(req, body.lineId);
    const user = yield prisma_1.prisma.user.findFirst({
        where: { id: body.userId, lineId: body.lineId },
        select: { id: true },
    });
    if (!user)
        throw new errors_1.ValidationError("USER_NOT_IN_LINE");
    yield prisma_1.prisma.documentMobileAccess.upsert({
        where: { lineId_userId: { lineId: body.lineId, userId: body.userId } },
        create: {
            lineId: body.lineId,
            userId: body.userId,
            grantedById: actorId,
        },
        update: {},
    });
    return res.code(200).send({ message: "OK" });
});
exports.grantDocMobileAccess = grantDocMobileAccess;
// DELETE /document/mobile-access { lineId, userId } — revoke
const revokeDocMobileAccess = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const body = req.body;
    if (!body.lineId || !body.userId)
        throw new errors_1.ValidationError("lineId and userId are required");
    // Taking access away is as much a privilege as giving it.
    yield (0, callerScope_1.requireSameLine)(req, body.lineId);
    yield prisma_1.prisma.documentMobileAccess.deleteMany({
        where: { lineId: body.lineId, userId: body.userId },
    });
    return res.code(200).send({ message: "OK" });
});
exports.revokeDocMobileAccess = revokeDocMobileAccess;
// GET /document/mobile-access/me — the mobile app's self-check (uses the token)
const myDocMobileAccess = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d, _e, _f;
    const accountId = (_a = req.user) === null || _a === void 0 ? void 0 : _a.id;
    if (!accountId)
        return res.code(200).send({ granted: false });
    const account = yield prisma_1.prisma.account.findUnique({
        where: { id: accountId },
        select: { lineId: true, User: { select: { id: true, lineId: true } } },
    });
    const lineId = (_d = (_b = account === null || account === void 0 ? void 0 : account.lineId) !== null && _b !== void 0 ? _b : (_c = account === null || account === void 0 ? void 0 : account.User) === null || _c === void 0 ? void 0 : _c.lineId) !== null && _d !== void 0 ? _d : null;
    const userId = (_f = (_e = account === null || account === void 0 ? void 0 : account.User) === null || _e === void 0 ? void 0 : _e.id) !== null && _f !== void 0 ? _f : null;
    if (!lineId || !userId)
        return res.code(200).send({ granted: false, reason: "no-user-or-line" });
    const access = yield prisma_1.prisma.documentMobileAccess.findUnique({
        where: { lineId_userId: { lineId, userId } },
        select: { id: true },
    });
    return res.code(200).send({ granted: !!access });
});
exports.myDocMobileAccess = myDocMobileAccess;
// ═══════════════ Scanned pages (mobile document scanner) ══════════════════
const pageUrl = (req, id) => {
    const proto = req.headers["x-forwarded-proto"] || req.protocol || "http";
    const host = req.headers["x-forwarded-host"] || req.headers.host;
    return `${proto}://${host}/document/receive/page/${id}`;
};
/** pages per record (id + page number), for list/find/sync responses. */
const pagesFor = (recordIds) => __awaiter(void 0, void 0, void 0, function* () {
    if (recordIds.length === 0)
        return {};
    const rows = yield prisma_1.prisma.documentReceivePage.findMany({
        where: { recordId: { in: recordIds } },
        select: { id: true, recordId: true, page: true },
        orderBy: { page: "asc" },
    });
    const map = {};
    for (const r of rows) {
        if (!map[r.recordId])
            map[r.recordId] = [];
        map[r.recordId].push({ id: r.id, page: r.page });
    }
    return map;
});
// POST /document/receive/page — multipart: fields id, recordId, page + file.
// Idempotent by client-supplied id (offline queue replays are no-ops).
const documentReceivePageUpload = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, e_1, _b, _c, _d, e_2, _e, _f;
    var _g, _h, _j, _k;
    if (!req.isMultipart())
        throw new errors_1.ValidationError("NOT_MULTIPART");
    let file = null;
    const fields = {};
    try {
        for (var _l = true, _m = __asyncValues(req.parts()), _o; _o = yield _m.next(), _a = _o.done, !_a; _l = true) {
            _c = _o.value;
            _l = false;
            const part = _c;
            if (part.type === "file") {
                const chunks = [];
                try {
                    for (var _p = true, _q = (e_2 = void 0, __asyncValues(part.file)), _r; _r = yield _q.next(), _d = _r.done, !_d; _p = true) {
                        _f = _r.value;
                        _p = false;
                        const chunk = _f;
                        chunks.push(chunk);
                    }
                }
                catch (e_2_1) { e_2 = { error: e_2_1 }; }
                finally {
                    try {
                        if (!_p && !_d && (_e = _q.return)) yield _e.call(_q);
                    }
                    finally { if (e_2) throw e_2.error; }
                }
                file = { mimetype: part.mimetype, buffer: Buffer.concat(chunks) };
            }
            else if (part.type === "field") {
                fields[part.fieldname] = String((_g = part.value) !== null && _g !== void 0 ? _g : "");
            }
        }
    }
    catch (e_1_1) { e_1 = { error: e_1_1 }; }
    finally {
        try {
            if (!_l && !_a && (_b = _m.return)) yield _b.call(_m);
        }
        finally { if (e_1) throw e_1.error; }
    }
    const id = ((_h = fields.id) !== null && _h !== void 0 ? _h : "").trim();
    const recordId = ((_j = fields.recordId) !== null && _j !== void 0 ? _j : "").trim();
    const page = Math.max(1, parseInt((_k = fields.page) !== null && _k !== void 0 ? _k : "1", 10) || 1);
    if (!recordId)
        throw new errors_1.ValidationError("BAD_REQUEST: recordId required");
    // The record says which municipality this page belongs to. Read it
    // off the record: the id in the form is not a permission.
    {
        const rec = yield prisma_1.prisma.documentReceiveRecord.findUnique({
            where: { id: recordId },
            select: { lineId: true },
        });
        if (!rec)
            throw new errors_1.ValidationError("NOT_FOUND");
        yield (0, callerScope_1.requireSameLine)(req, rec.lineId);
    }
    // Replay of the same offline op → succeed without duplicating.
    if (id) {
        const existing = yield prisma_1.prisma.documentReceivePage.findUnique({
            where: { id },
            select: { id: true, page: true },
        });
        if (existing)
            return res.code(200).send({
                pageId: existing.id,
                page: existing.page,
                url: pageUrl(req, existing.id),
                existing: true,
            });
    }
    const record = yield prisma_1.prisma.documentReceiveRecord.findUnique({
        where: { id: recordId },
        select: { id: true },
    });
    if (!record)
        throw new errors_1.ValidationError("RECORD_NOT_FOUND");
    if (!file)
        throw new errors_1.ValidationError("MISSING_FILE");
    if (!file.mimetype.startsWith("image/"))
        throw new errors_1.ValidationError("FILE_MUST_BE_AN_IMAGE");
    if (file.buffer.length > 10 * 1024 * 1024)
        throw new errors_1.ValidationError("IMAGE_TOO_LARGE");
    const saved = yield prisma_1.prisma.documentReceivePage.create({
        data: Object.assign(Object.assign({}, (id ? { id } : {})), { recordId,
            page, mime: file.mimetype, bytes: file.buffer }),
        select: { id: true, page: true },
    });
    return res.code(200).send({
        pageId: saved.id,
        page: saved.page,
        url: pageUrl(req, saved.id),
        existing: false,
    });
});
exports.documentReceivePageUpload = documentReceivePageUpload;
// GET /document/receive/page/:id — serve the image (uuid-obscured, like chat).
const documentReceivePageServe = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { id } = req.params;
    if (!id)
        throw new errors_1.ValidationError("BAD_REQUEST");
    const img = yield prisma_1.prisma.documentReceivePage.findUnique({
        where: { id },
        select: { bytes: true, mime: true },
    });
    if (!img)
        return res.code(404).send({ message: "Not found" });
    res.header("Content-Type", img.mime);
    res.header("Cache-Control", "private, max-age=31536000, immutable");
    return res.send(Buffer.from(img.bytes));
});
exports.documentReceivePageServe = documentReceivePageServe;
// ─── Send a received document on to other offices ──────────────────────
//
// A document arrives at the receiving desk, gets a barcode sticker and a
// row in the log. Sending it onward means handing it to Document Routing,
// which needs an actual file to route — and the only file a received
// document has is the scan.
//
// So the rule is not a policy bolted on top: a record with no pages has
// nothing to send. Until somebody has scanned it the barcode is a promise
// that a piece of paper exists somewhere, and routing that promise to five
// offices would give each of them a title and no document.
const documentReceiveDisseminate = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    const body = req.body;
    if (!body.recordId || !body.roomId) {
        throw new errors_1.ValidationError("BAD_REQUEST: recordId and roomId required");
    }
    // The routing is sent FROM a room, so it has to be your room.
    const { actorId } = yield (0, callerScope_1.requireRoomMember)(req, body.roomId);
    const record = yield prisma_1.prisma.documentReceiveRecord.findUnique({
        where: { id: body.recordId },
        select: {
            id: true,
            lineId: true,
            barcode: true,
            title: true,
            senderUnitName: true,
            senderName: true,
            deletedAt: true,
        },
    });
    if (!record || record.deletedAt)
        throw new errors_1.ValidationError("NOT_FOUND");
    // …and the record has to be on your line, read off the record itself.
    yield (0, callerScope_1.requireSameLine)(req, record.lineId);
    const pages = yield prisma_1.prisma.documentReceivePage.findMany({
        where: { recordId: record.id },
        orderBy: { page: "asc" },
        select: { id: true, page: true, mime: true, bytes: true },
    });
    if (pages.length === 0) {
        throw new errors_1.ValidationError("This document has not been scanned yet. Scan it with the mobile " +
            "app first — there is nothing to send until it has pages.");
    }
    // The scanned pages become one PDF, which is what Document Routing
    // signs and delivers. Each page is sized to its own image rather than
    // forced onto A4, so nothing is cropped or letterboxed.
    const { PDFDocument } = yield Promise.resolve().then(() => __importStar(require("pdf-lib")));
    const pdf = yield PDFDocument.create();
    for (const p of pages) {
        const buf = Buffer.from(p.bytes);
        let img;
        try {
            img = /png/i.test(p.mime)
                ? yield pdf.embedPng(buf)
                : yield pdf.embedJpg(buf);
        }
        catch (_c) {
            // A mime can lie, or a scanner can relabel. Try the other one before
            // giving up on the page.
            try {
                img = /png/i.test(p.mime)
                    ? yield pdf.embedJpg(buf)
                    : yield pdf.embedPng(buf);
            }
            catch (_d) {
                throw new errors_1.ValidationError(`Page ${p.page} of this scan is not a readable image.`);
            }
        }
        const page = pdf.addPage([img.width, img.height]);
        page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
    }
    const pdfBytes = Buffer.from(yield pdf.save());
    const from = (_b = (_a = record.senderUnitName) !== null && _a !== void 0 ? _a : record.senderName) !== null && _b !== void 0 ? _b : "an external sender";
    const title = record.title || record.barcode;
    const created = yield prisma_1.prisma.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
        const queue = yield tx.signatureQueueRoom.create({
            data: {
                title,
                userId: actorId,
                receivingRoomId: body.roomId,
                status: 0,
                step: 0,
            },
            select: { id: true },
        });
        const doc = yield tx.document.create({
            data: {
                title,
                lineId: record.lineId,
                userId: actorId,
                signatureQueueRoomId: queue.id,
                original: 1,
            },
            select: { id: true },
        });
        yield tx.decodedFile.create({
            data: {
                documentId: doc.id,
                fileName: `${record.barcode}.pdf`,
                fileSize: String(pdfBytes.length),
                fileType: "application/pdf",
                fileDecoded: pdfBytes,
            },
        });
        yield tx.documentActivityLogs.create({
            data: {
                userId: actorId,
                lineId: record.lineId,
                title: "Routed a received document",
                desc: `Barcode ${record.barcode} ("${title}") from ${from}, ` +
                    `${pages.length} scanned page${pages.length === 1 ? "" : "s"}.`,
                action: 1,
            },
        });
        return { queueRoomId: queue.id, documentId: doc.id };
    }));
    return res.code(200).send(Object.assign(Object.assign({ message: "OK" }, created), { pages: pages.length }));
});
exports.documentReceiveDisseminate = documentReceiveDisseminate;
