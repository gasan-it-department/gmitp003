"use strict";
// Signature management for the e-sign module.
//
// Surface:
//   GET    /document/user/signatures           list paginated
//   POST   /document/user/signatures/upload    multipart (file + title)
//   PATCH  /document/user/signatures/activate  set active (de-activates others)
//   DELETE /document/user/signatures/remove    remove a signature
//
// Active rule: exactly one signature per user can be `active: true`. The
// activate handler flips the chosen row on and clears the others.
//
// SECURITY: every handler here resolves the owner from the BEARER TOKEN and
// ignores any userId supplied by the client. These endpoints previously
// trusted a request-supplied userId, which let any authenticated user read,
// activate, delete and QR-toggle another person's signature — including
// downloading their signature IMAGE. Never reintroduce a client-provided
// owner id here.
//
// Storage: signature blobs live on the Signature.signature `Bytes?`
// column (PNG/JPEG/SVG, ideally a transparent PNG). The list response
// returns each signature as a base64 data URL so the UI can show a
// preview without a second round-trip per row.
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
exports.setSignatureQr = exports.setSignaturePlacement = exports.deleteUserSignature = exports.activateUserSignature = exports.uploadUserSignature = exports.listUserSignatures = void 0;
const prisma_1 = require("../barrel/prisma");
const errors_1 = require("../errors/errors");
const handler_1 = require("../middleware/handler");
const ALLOWED_MIMES = new Set([
    "image/png",
    "image/jpeg",
    "image/jpg",
    "image/webp",
    "image/svg+xml",
]);
// 5MB cap — signatures are tiny by nature.
const MAX_SIGNATURE_BYTES = 5 * 1024 * 1024;
const toDataUrl = (bytes, mime = "image/png") => {
    if (!bytes)
        return null;
    const b = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
    return `data:${mime};base64,${b.toString("base64")}`;
};
/**
 * Heuristic mime detection so a previously-uploaded signature can be
 * served with the right content type even though we don't store mime
 * on the row.
 */
const sniffMime = (buf) => {
    if (!buf || buf.length < 4)
        return "image/png";
    if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47)
        return "image/png";
    if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff)
        return "image/jpeg";
    if (buf[0] === 0x52 &&
        buf[1] === 0x49 &&
        buf[2] === 0x46 &&
        buf[3] === 0x46 &&
        buf.length >= 12 &&
        buf[8] === 0x57 &&
        buf[9] === 0x45 &&
        buf[10] === 0x42 &&
        buf[11] === 0x50)
        return "image/webp";
    // Quick SVG sniff
    const head = buf.slice(0, 64).toString("utf8").trim().toLowerCase();
    if (head.startsWith("<svg") || head.startsWith("<?xml"))
        return "image/svg+xml";
    return "image/png";
};
const listUserSignatures = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const params = req.query;
    // `params.id` is ignored on purpose — see the SECURITY note above. A user
    // may only ever list their own signatures.
    const ownerId = yield (0, handler_1.callerUserId)(req);
    if (!ownerId)
        throw new errors_1.UnauthorizedError("Not signed in");
    try {
        const cursor = params.lastCursor ? { id: params.lastCursor } : undefined;
        const limit = params.limit ? parseInt(params.limit, 10) : 20;
        const where = { userId: ownerId };
        if (params.query && params.query.trim()) {
            where.title = { contains: params.query.trim(), mode: "insensitive" };
        }
        const rows = yield prisma_1.prisma.signature.findMany({
            where,
            take: limit,
            skip: cursor ? 1 : 0,
            cursor,
            orderBy: [{ active: "desc" }, { timestamp: "desc" }],
        });
        const list = rows.map((r) => {
            var _a;
            const buf = r.signature ? Buffer.from(r.signature) : null;
            const mime = sniffMime(buf);
            return {
                id: r.id,
                title: r.title,
                active: r.active,
                default: r.defalt, // schema field name is `defalt` (typo, preserved)
                forRenew: r.forRenew,
                timestamp: r.timestamp,
                roomAuthorizedUserId: r.roomAuthorizedUserId,
                qrEnabled: r.qrEnabled,
                // How this one stamps: null height means it still fits to whatever
                // box was drawn on the page (the old behaviour).
                inkHeightPt: r.inkHeightPt,
                baselinePct: r.baselinePct,
                ink: r.inkX0 === null || r.inkY0 === null || r.inkX1 === null || r.inkY1 === null
                    ? null
                    : { x0: r.inkX0, y0: r.inkY0, x1: r.inkX1, y1: r.inkY1 },
                // base64 data URL so the UI can <img src={preview}> directly.
                preview: toDataUrl(buf, mime),
                size: (_a = buf === null || buf === void 0 ? void 0 : buf.length) !== null && _a !== void 0 ? _a : 0,
            };
        });
        const lastCursor = list.length > 0 ? list[list.length - 1].id : null;
        const hasMore = list.length === limit;
        return res.code(200).send({ list, lastCursor, hasMore });
    }
    catch (error) {
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw new errors_1.AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
        }
        throw error;
    }
});
exports.listUserSignatures = listUserSignatures;
const uploadUserSignature = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, e_1, _b, _c;
    var _d;
    if (!req.isMultipart())
        throw new errors_1.ValidationError("Missing multipart payload");
    try {
        let fileBuffer = null;
        let filename = "";
        let mimetype = "";
        let title = "";
        let userId = "";
        let setActive = false;
        let ink = "";
        try {
            for (var _e = true, _f = __asyncValues(req.parts()), _g; _g = yield _f.next(), _a = _g.done, !_a; _e = true) {
                _c = _g.value;
                _e = false;
                const part = _c;
                if (part.type === "file") {
                    if (fileBuffer)
                        continue; // only first file
                    fileBuffer = yield part.toBuffer();
                    filename = part.filename;
                    mimetype = part.mimetype;
                }
                else {
                    const v = String((_d = part.value) !== null && _d !== void 0 ? _d : "");
                    if (part.fieldname === "title")
                        title = v;
                    else if (part.fieldname === "userId")
                        userId = v;
                    else if (part.fieldname === "active")
                        setActive = v === "true";
                    // The browser already decoded the image to show a preview, so it
                    // measures where the ink actually is and sends it along. The server
                    // has no image decoder and does not need one for this; the value is
                    // cosmetic geometry, and it is clamped before it is stored.
                    else if (part.fieldname === "ink")
                        ink = v;
                }
            }
        }
        catch (e_1_1) { e_1 = { error: e_1_1 }; }
        finally {
            try {
                if (!_e && !_a && (_b = _f.return)) yield _b.call(_f);
            }
            finally { if (e_1) throw e_1.error; }
        }
        // The multipart `userId` field is ignored — a signature always belongs to
        // whoever is signed in, never to whoever the form claims.
        const ownerId = yield (0, handler_1.callerUserId)(req);
        if (!ownerId)
            throw new errors_1.UnauthorizedError("Not signed in");
        userId = ownerId;
        if (!fileBuffer)
            throw new errors_1.ValidationError("No signature file uploaded");
        if (fileBuffer.length > MAX_SIGNATURE_BYTES) {
            throw new errors_1.ValidationError(`Signature file too large (max ${MAX_SIGNATURE_BYTES / 1024 / 1024}MB).`);
        }
        // Accept by mime first, fall back to sniff (camera uploads can lie).
        const finalMime = ALLOWED_MIMES.has(mimetype)
            ? mimetype
            : sniffMime(fileBuffer);
        if (!ALLOWED_MIMES.has(finalMime)) {
            throw new errors_1.ValidationError("Only PNG, JPEG, WEBP, or SVG signatures are supported.");
        }
        const finalTitle = title.trim() ||
            (filename === null || filename === void 0 ? void 0 : filename.replace(/\.[^.]+$/, "").slice(0, 40)) ||
            "My Signature";
        const created = yield prisma_1.prisma.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            // If the user asked for this one to be active, clear the others.
            if (setActive) {
                yield tx.signature.updateMany({
                    where: { userId, active: true },
                    data: { active: false },
                });
            }
            // If the user has no signature yet, the first one is active by default.
            let shouldBeActive = setActive;
            if (!shouldBeActive) {
                const existing = yield tx.signature.count({ where: { userId } });
                if (existing === 0)
                    shouldBeActive = true;
            }
            return tx.signature.create({
                data: Object.assign({ userId, title: finalTitle, signature: fileBuffer, active: shouldBeActive }, inkFields(ink)),
                select: {
                    id: true,
                    title: true,
                    active: true,
                    timestamp: true,
                },
            });
        }));
        return res.code(200).send({ message: "OK", signature: created });
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
exports.uploadUserSignature = uploadUserSignature;
const activateUserSignature = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const body = req.body;
    if (!body.id)
        throw new errors_1.ValidationError("INVALID REQUIRED ID");
    const ownerId = yield (0, handler_1.callerUserId)(req);
    if (!ownerId)
        throw new errors_1.UnauthorizedError("Not signed in");
    try {
        yield prisma_1.prisma.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            const target = yield tx.signature.findFirst({
                where: { id: body.id, userId: ownerId },
            });
            if (!target)
                throw new errors_1.NotFoundError("Signature not found");
            // Single-active invariant.
            yield tx.signature.updateMany({
                where: { userId: ownerId, active: true, NOT: { id: body.id } },
                data: { active: false },
            });
            yield tx.signature.update({
                where: { id: body.id },
                data: { active: true },
            });
        }));
        return res.code(200).send({ message: "OK", id: body.id, active: true });
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
exports.activateUserSignature = activateUserSignature;
const deleteUserSignature = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const params = req.query;
    const ownerId = yield (0, handler_1.callerUserId)(req);
    if (!ownerId)
        throw new errors_1.UnauthorizedError("Not signed in");
    if (!params.id) {
        throw new errors_1.ValidationError("INVALID REQUIRED ID");
    }
    try {
        const target = yield prisma_1.prisma.signature.findFirst({
            where: { id: params.id, userId: ownerId },
        });
        if (!target)
            throw new errors_1.NotFoundError("Signature not found");
        const wasActive = target.active;
        yield prisma_1.prisma.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            yield tx.signature.delete({ where: { id: target.id } });
            // If we just removed the active one, promote the most-recent
            // remaining signature so the user still has something to sign with.
            if (wasActive) {
                const next = yield tx.signature.findFirst({
                    where: { userId: ownerId },
                    orderBy: { timestamp: "desc" },
                });
                if (next) {
                    yield tx.signature.update({
                        where: { id: next.id },
                        data: { active: true },
                    });
                }
            }
        }));
        return res.code(200).send({ message: "OK", id: params.id });
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
exports.deleteUserSignature = deleteUserSignature;
// ─── Per-signature QR toggle ──────────────────────────────────────────
// Each Signature row carries its own `qrEnabled` flag — users can keep
// QR ON for their formal signature and OFF for a casual one.
/** 0-1, or undefined when the value is missing or nonsense. */
const frac = (v) => {
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 && n <= 1 ? n : undefined;
};
/**
 * `{"x0":..,"y0":..,"x1":..,"y1":..}` → columns, or nothing.
 *
 * A box that is inverted or smaller than 1% of the file is thrown away
 * rather than stored: stamping divides by its height, and "the whole file"
 * is a safe answer where a broken measurement is not.
 */
const inkFields = (raw) => {
    if (!raw)
        return {};
    try {
        const o = JSON.parse(raw);
        const x0 = frac(o.x0), y0 = frac(o.y0), x1 = frac(o.x1), y1 = frac(o.y1);
        if (x0 === undefined || y0 === undefined || x1 === undefined || y1 === undefined)
            return {};
        if (x1 - x0 < 0.01 || y1 - y0 < 0.01)
            return {};
        return { inkX0: x0, inkY0: y0, inkX1: x1, inkY1: y1 };
    }
    catch (_a) {
        return {};
    }
};
/**
 * POST /document/user/signatures/placement
 * { id, inkHeightPt, baselinePct, ink? }
 *
 * How big this signature prints and where its writing line is. Sending a
 * null/0 height puts it back to fitting whatever box was drawn on the page.
 */
const setSignaturePlacement = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const body = req.body;
    if (!body.id)
        throw new errors_1.ValidationError("INVALID REQUIRED FIELDS");
    const ownerId = yield (0, handler_1.callerUserId)(req);
    if (!ownerId)
        throw new errors_1.UnauthorizedError("Not signed in");
    const target = yield prisma_1.prisma.signature.findFirst({
        where: { id: body.id, userId: ownerId },
        select: { id: true },
    });
    if (!target)
        throw new errors_1.NotFoundError("Signature not found");
    // A signature taller than a page, or a hairline, is a typo rather than an
    // intention. 4pt-288pt covers everything from an initial to a full page-
    // width flourish.
    const h = Number(body.inkHeightPt);
    const inkHeightPt = body.inkHeightPt === null || !Number.isFinite(h) || h <= 0
        ? null
        : Math.min(288, Math.max(4, h));
    const b = Number(body.baselinePct);
    const baselinePct = Number.isFinite(b)
        ? Math.min(100, Math.max(0, Math.round(b)))
        : 100;
    const updated = yield prisma_1.prisma.signature.update({
        where: { id: body.id },
        data: Object.assign({ inkHeightPt,
            baselinePct }, (body.ink ? inkFields(JSON.stringify(body.ink)) : {})),
        select: {
            id: true,
            inkHeightPt: true,
            baselinePct: true,
            inkX0: true,
            inkY0: true,
            inkX1: true,
            inkY1: true,
        },
    });
    return res.code(200).send({ message: "OK", signature: updated });
});
exports.setSignaturePlacement = setSignaturePlacement;
const setSignatureQr = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const body = req.body;
    if (!body.id || typeof body.qrEnabled !== "boolean") {
        throw new errors_1.ValidationError("INVALID REQUIRED FIELDS");
    }
    const ownerId = yield (0, handler_1.callerUserId)(req);
    if (!ownerId)
        throw new errors_1.UnauthorizedError("Not signed in");
    try {
        const target = yield prisma_1.prisma.signature.findFirst({
            where: { id: body.id, userId: ownerId },
            select: { id: true },
        });
        if (!target)
            throw new errors_1.NotFoundError("Signature not found");
        yield prisma_1.prisma.signature.update({
            where: { id: body.id },
            data: { qrEnabled: body.qrEnabled },
        });
        return res
            .code(200)
            .send({ message: "OK", id: body.id, qrEnabled: body.qrEnabled });
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
exports.setSignatureQr = setSignatureQr;
