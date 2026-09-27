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
exports.stampedDocument = exports.removeReceiveStampMark = exports.receiveStampMarks = exports.applyReceiveStamp = exports.receiveStampPreview = exports.renderReceiveStamp = exports.deleteReceiveStamp = exports.saveReceiveStamp = exports.uploadReceiveStampImage = exports.receiveStampImage = exports.myReceiveStamp = exports.mmToPt = exports.DEFAULT_H_MM = exports.DEFAULT_W_MM = void 0;
const prisma_1 = require("../barrel/prisma");
const errors_1 = require("../errors/errors");
const callerScope_1 = require("../service/callerScope");
const pdfRaster_1 = require("../service/pdfRaster");
/**
 * The common stamp, and the default — but only the default.
 *
 * A rubber stamp is whatever the shop cut, so the office states its own
 * size before uploading and everything downstream works from that: the
 * shape the artwork is checked against, and the page the render lays out.
 */
exports.DEFAULT_W_MM = 58;
exports.DEFAULT_H_MM = 30;
const MM_PER_PT = 25.4 / 72;
/** Millimetres to PDF points. */
const mmToPt = (mm) => mm / MM_PER_PT;
exports.mmToPt = mmToPt;
/**
 * What a stamp may measure.
 *
 * Small enough that it is still a stamp and not a letterhead; large enough
 * that a two-line date-and-name box fits. A rubber stamp outside this range
 * is somebody typing in centimetres or inches.
 */
const MIN_MM = 10;
const MAX_MM = 150;
const clampMm = (v, fallback) => {
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0)
        return fallback;
    return Math.max(MIN_MM, Math.min(MAX_MM, Math.round(n * 10) / 10));
};
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const BP = 10000;
/** Everything except the bytes — the config the editor works on. */
const SHAPE = {
    id: true,
    userId: true,
    lineId: true,
    mime: true,
    widthMm: true,
    heightMm: true,
    imageW: true,
    imageH: true,
    sigX: true,
    sigY: true,
    sigW: true,
    sigH: true,
    nickname: true,
    nameX: true,
    nameY: true,
    nameSizePt: true,
    dateX: true,
    dateY: true,
    dateSizePt: true,
    timestamp: true,
    updatedAt: true,
};
const clampBp = (v, fallback) => {
    const n = Number(v);
    if (!Number.isFinite(n))
        return fallback;
    return Math.max(0, Math.min(BP, Math.round(n)));
};
const clampPt = (v, fallback) => {
    const n = Number(v);
    if (!Number.isFinite(n))
        return fallback;
    // Below 4pt nothing is readable when printed; above 24pt nothing fits.
    return Math.max(4, Math.min(24, Math.round(n * 10) / 10));
};
/** GET /document/receive-stamp — the caller's own stamp setup. */
const myReceiveStamp = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    const { actorId, lineId } = yield (0, callerScope_1.callerContext)(req);
    const row = yield prisma_1.prisma.receiveStamp.findUnique({
        where: { userId: actorId },
        select: Object.assign(Object.assign({}, SHAPE), { image: true }),
    });
    // The signature this stamp will carry. It is the caller's ACTIVE one, the
    // same one their documents are signed with — a receiving stamp signed with
    // a different hand than the signature on file would be worse than useless.
    const signature = yield prisma_1.prisma.signature.findFirst({
        where: { userId: actorId, active: true },
        select: { id: true, title: true, signature: true },
    });
    return res.code(200).send({
        stamp: row
            ? Object.assign(Object.assign({}, row), { image: undefined, hasImage: !!row.image }) : null,
        /**
         * Whether a signature is on file at all. Without one the stamp cannot
         * be completed, and saying so here means the editor can explain that
         * instead of silently rendering an empty box.
         */
        signature: signature
            ? { id: signature.id, title: signature.title, hasImage: !!signature.signature }
            : null,
        // Their own size when they have set one, otherwise the default they
        // will start from.
        stampSize: {
            widthMm: (_a = row === null || row === void 0 ? void 0 : row.widthMm) !== null && _a !== void 0 ? _a : exports.DEFAULT_W_MM,
            heightMm: (_b = row === null || row === void 0 ? void 0 : row.heightMm) !== null && _b !== void 0 ? _b : exports.DEFAULT_H_MM,
        },
        defaultSize: { widthMm: exports.DEFAULT_W_MM, heightMm: exports.DEFAULT_H_MM },
        lineId,
    });
});
exports.myReceiveStamp = myReceiveStamp;
/** GET /document/receive-stamp/image — the raw artwork, for the editor. */
const receiveStampImage = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { actorId } = yield (0, callerScope_1.callerContext)(req);
    const row = yield prisma_1.prisma.receiveStamp.findUnique({
        where: { userId: actorId },
        select: { image: true, mime: true, updatedAt: true },
    });
    if (!(row === null || row === void 0 ? void 0 : row.image))
        throw new errors_1.NotFoundError("No stamp artwork uploaded yet");
    return res
        .header("Content-Type", row.mime || "image/png")
        .header("Cache-Control", "private, max-age=0, must-revalidate")
        .header("ETag", `"${row.updatedAt.getTime()}"`)
        .code(200)
        .send(Buffer.from(row.image));
});
exports.receiveStampImage = receiveStampImage;
/** POST /document/receive-stamp/image — upload the office's artwork. */
const uploadReceiveStampImage = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, e_1, _b, _c, _d, e_2, _e, _f;
    var _g, _h, _j;
    if (!req.isMultipart())
        throw new errors_1.ValidationError("INVALID REQUEST");
    const { actorId, lineId } = yield (0, callerScope_1.callerContext)(req);
    let buf = null;
    let mime = "image/png";
    /**
     * The size can ride along with the upload, so "say the size, then pick
     * the file" is one action rather than two saves the user can get wrong
     * the order of. Falls back to whatever is already stored.
     */
    const fields = {};
    try {
        for (var _k = true, _l = __asyncValues(req.parts()), _m; _m = yield _l.next(), _a = _m.done, !_a; _k = true) {
            _c = _m.value;
            _k = false;
            const part = _c;
            if (part.type === "field") {
                fields[part.fieldname] = String((_g = part.value) !== null && _g !== void 0 ? _g : "");
                continue;
            }
            if (part.type === "file") {
                const chunks = [];
                let total = 0;
                try {
                    for (var _o = true, _p = (e_2 = void 0, __asyncValues(part.file)), _q; _q = yield _p.next(), _d = _q.done, !_d; _o = true) {
                        _f = _q.value;
                        _o = false;
                        const c = _f;
                        total += c.length;
                        if (total > MAX_IMAGE_BYTES) {
                            throw new errors_1.ValidationError("The stamp image must be under 4 MB.");
                        }
                        chunks.push(c);
                    }
                }
                catch (e_2_1) { e_2 = { error: e_2_1 }; }
                finally {
                    try {
                        if (!_o && !_d && (_e = _p.return)) yield _e.call(_p);
                    }
                    finally { if (e_2) throw e_2.error; }
                }
                buf = Buffer.concat(chunks);
                mime = part.mimetype || mime;
            }
        }
    }
    catch (e_1_1) { e_1 = { error: e_1_1 }; }
    finally {
        try {
            if (!_k && !_a && (_b = _l.return)) yield _b.call(_l);
        }
        finally { if (e_1) throw e_1.error; }
    }
    if (!(buf === null || buf === void 0 ? void 0 : buf.length))
        throw new errors_1.ValidationError("No image was uploaded.");
    /**
     * PNG only, and read its real size from the header.
     *
     * A stamp is inked onto paper that already has print on it, so the
     * background has to be transparent — which JPEG cannot do. Rejecting it
     * here is kinder than a stamp that lands as a white box over the text it
     * was supposed to sit beside.
     */
    const isPng = buf.length > 24 &&
        buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    if (!isPng) {
        throw new errors_1.ValidationError("The stamp must be a PNG with a transparent background — a JPEG would print as a white box over the page.");
    }
    const imageW = buf.readUInt32BE(16);
    const imageH = buf.readUInt32BE(20);
    if (!imageW || !imageH)
        throw new errors_1.ValidationError("That PNG could not be read.");
    const existing = yield prisma_1.prisma.receiveStamp.findUnique({
        where: { userId: actorId },
        select: { widthMm: true, heightMm: true },
    });
    const widthMm = clampMm(fields.widthMm, (_h = existing === null || existing === void 0 ? void 0 : existing.widthMm) !== null && _h !== void 0 ? _h : exports.DEFAULT_W_MM);
    const heightMm = clampMm(fields.heightMm, (_j = existing === null || existing === void 0 ? void 0 : existing.heightMm) !== null && _j !== void 0 ? _j : exports.DEFAULT_H_MM);
    /**
     * Shape, not size. The artwork is 58mm x 30mm — a ratio of about 1.93 —
     * and anything markedly different is a different stamp, or a screenshot
     * with the desktop around it. A tolerance because a scan is never exact.
     */
    const ratio = imageW / imageH;
    const want = widthMm / heightMm;
    if (ratio < want * 0.8 || ratio > want * 1.2) {
        throw new errors_1.ValidationError(`You said this stamp is ${widthMm}mm x ${heightMm}mm, which is about ` +
            `${want.toFixed(2)}:1. This image is ${imageW}x${imageH}, which is ` +
            `${ratio.toFixed(2)}:1 — either crop it to the stamp itself, or correct the size above.`);
    }
    const saved = yield prisma_1.prisma.receiveStamp.upsert({
        where: { userId: actorId },
        update: { image: buf, mime, imageW, imageH, widthMm, heightMm, lineId },
        create: {
            userId: actorId, lineId, image: buf, mime, imageW, imageH,
            widthMm, heightMm,
        },
        select: SHAPE,
    });
    return res.code(200).send({ message: "OK", stamp: Object.assign(Object.assign({}, saved), { hasImage: true }) });
});
exports.uploadReceiveStampImage = uploadReceiveStampImage;
/** PATCH /document/receive-stamp — where things sit, and what the name says. */
const saveReceiveStamp = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p;
    const { actorId, lineId } = yield (0, callerScope_1.callerContext)(req);
    const b = req.body;
    const current = yield prisma_1.prisma.receiveStamp.findUnique({
        where: { userId: actorId },
        select: SHAPE,
    });
    const nickname = String((_b = (_a = b.nickname) !== null && _a !== void 0 ? _a : current === null || current === void 0 ? void 0 : current.nickname) !== null && _b !== void 0 ? _b : "").trim().slice(0, 40);
    const data = {
        lineId,
        nickname,
        widthMm: clampMm(b.widthMm, (_c = current === null || current === void 0 ? void 0 : current.widthMm) !== null && _c !== void 0 ? _c : exports.DEFAULT_W_MM),
        heightMm: clampMm(b.heightMm, (_d = current === null || current === void 0 ? void 0 : current.heightMm) !== null && _d !== void 0 ? _d : exports.DEFAULT_H_MM),
        sigX: clampBp(b.sigX, (_e = current === null || current === void 0 ? void 0 : current.sigX) !== null && _e !== void 0 ? _e : 5200),
        sigY: clampBp(b.sigY, (_f = current === null || current === void 0 ? void 0 : current.sigY) !== null && _f !== void 0 ? _f : 6200),
        sigW: clampBp(b.sigW, (_g = current === null || current === void 0 ? void 0 : current.sigW) !== null && _g !== void 0 ? _g : 3600),
        sigH: clampBp(b.sigH, (_h = current === null || current === void 0 ? void 0 : current.sigH) !== null && _h !== void 0 ? _h : 2600),
        nameX: clampBp(b.nameX, (_j = current === null || current === void 0 ? void 0 : current.nameX) !== null && _j !== void 0 ? _j : 2400),
        nameY: clampBp(b.nameY, (_k = current === null || current === void 0 ? void 0 : current.nameY) !== null && _k !== void 0 ? _k : 8600),
        nameSizePt: clampPt(b.nameSizePt, (_l = current === null || current === void 0 ? void 0 : current.nameSizePt) !== null && _l !== void 0 ? _l : 9),
        dateX: clampBp(b.dateX, (_m = current === null || current === void 0 ? void 0 : current.dateX) !== null && _m !== void 0 ? _m : 2400),
        dateY: clampBp(b.dateY, (_o = current === null || current === void 0 ? void 0 : current.dateY) !== null && _o !== void 0 ? _o : 7000),
        dateSizePt: clampPt(b.dateSizePt, (_p = current === null || current === void 0 ? void 0 : current.dateSizePt) !== null && _p !== void 0 ? _p : 9),
    };
    // A box with no area is a box nothing can be drawn in.
    if (data.sigW < 200 || data.sigH < 150) {
        throw new errors_1.ValidationError("The signature area is too small to print into.");
    }
    const saved = yield prisma_1.prisma.receiveStamp.upsert({
        where: { userId: actorId },
        update: data,
        create: Object.assign({ userId: actorId }, data),
        select: SHAPE,
    });
    return res.code(200).send({ message: "OK", stamp: saved });
});
exports.saveReceiveStamp = saveReceiveStamp;
/** DELETE /document/receive-stamp — start again. */
const deleteReceiveStamp = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { actorId } = yield (0, callerScope_1.callerContext)(req);
    const row = yield prisma_1.prisma.receiveStamp.findUnique({
        where: { userId: actorId },
        select: { id: true },
    });
    if (!row)
        throw new errors_1.NotFoundError("Nothing to remove");
    yield prisma_1.prisma.receiveStamp.delete({ where: { id: row.id } });
    return res.code(200).send({ message: "OK" });
});
exports.deleteReceiveStamp = deleteReceiveStamp;
/**
 * Compose the finished stamp.
 *
 * Built as a one-page PDF exactly 58mm x 30mm and then rasterised, rather
 * than by pasting pixels: the placements are physical, the type has to be
 * real type at a real point size, and this project already renders PDFs
 * this way for signed documents. The same pipeline means a stamp previewed
 * on screen and a stamp printed on paper come from one code path.
 *
 * Exported so the receiving flow can call it directly when the time comes
 * to actually apply a stamp to an arriving document.
 */
const renderReceiveStamp = (userId_1, ...args_1) => __awaiter(void 0, [userId_1, ...args_1], void 0, function* (userId, when = new Date(), widthPx = 900) {
    var _a;
    const row = yield prisma_1.prisma.receiveStamp.findUnique({
        where: { userId },
        select: Object.assign(Object.assign({}, SHAPE), { image: true }),
    });
    if (!(row === null || row === void 0 ? void 0 : row.image))
        throw new errors_1.NotFoundError("No stamp artwork uploaded yet");
    const sig = yield prisma_1.prisma.signature.findFirst({
        where: { userId, active: true },
        select: { signature: true },
    });
    const wPt = (0, exports.mmToPt)(row.widthMm);
    const hPt = (0, exports.mmToPt)(row.heightMm);
    const { PDFDocument, StandardFonts, rgb } = yield Promise.resolve().then(() => __importStar(require("pdf-lib")));
    const pdf = yield PDFDocument.create();
    const page = pdf.addPage([wPt, hPt]);
    const font = yield pdf.embedFont(StandardFonts.Helvetica);
    // The artwork fills the page — it IS the page.
    const art = yield pdf.embedPng(Buffer.from(row.image));
    page.drawImage(art, { x: 0, y: 0, width: wPt, height: hPt });
    /**
     * Basis points are measured from the TOP; PDF measures from the bottom.
     * Every placement goes through here so the flip happens exactly once.
     */
    const toPt = (xBp, yBp) => ({
        x: (xBp / BP) * wPt,
        yTop: (yBp / BP) * hPt,
    });
    if ((_a = sig === null || sig === void 0 ? void 0 : sig.signature) === null || _a === void 0 ? void 0 : _a.length) {
        const { x, yTop } = toPt(row.sigX, row.sigY);
        const w = (row.sigW / BP) * wPt;
        const h = (row.sigH / BP) * hPt;
        try {
            const img = yield pdf.embedPng(Buffer.from(sig.signature));
            // Fit inside the box, keeping the writing's own proportions — a
            // stretched signature is not the person's signature.
            const scale = Math.min(w / img.width, h / img.height);
            const dw = img.width * scale;
            const dh = img.height * scale;
            page.drawImage(img, {
                x: x + (w - dw) / 2,
                y: hPt - yTop - h + (h - dh) / 2,
                width: dw,
                height: dh,
            });
        }
        catch (_b) {
            // A signature stored as something other than PNG. The stamp is still
            // worth producing; the rest of it is correct.
        }
    }
    const ink = rgb(0, 0, 0);
    const dateText = when.toLocaleDateString("en-PH", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    });
    const d = toPt(row.dateX, row.dateY);
    page.drawText(dateText, {
        x: d.x,
        y: hPt - d.yTop - row.dateSizePt,
        size: row.dateSizePt,
        font,
        color: ink,
    });
    if (row.nickname) {
        const n = toPt(row.nameX, row.nameY);
        page.drawText(row.nickname, {
            x: n.x,
            y: hPt - n.yTop - row.nameSizePt,
            size: row.nameSizePt,
            font,
            color: ink,
        });
    }
    const bytes = Buffer.from(yield pdf.save());
    const { png } = yield (0, pdfRaster_1.renderPdfPage)(bytes, 1, widthPx);
    return png;
});
exports.renderReceiveStamp = renderReceiveStamp;
/** GET /document/receive-stamp/preview — the finished stamp, as it will print. */
const receiveStampPreview = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { actorId } = yield (0, callerScope_1.callerContext)(req);
    if (!actorId)
        throw new errors_1.UnauthorizedError("Not signed in");
    const q = req.query;
    const width = q.width ? parseInt(q.width, 10) : 900;
    try {
        const png = yield (0, exports.renderReceiveStamp)(actorId, new Date(), width);
        return res
            .header("Content-Type", "image/png")
            .header("Cache-Control", "no-store")
            .code(200)
            .send(png);
    }
    catch (error) {
        if (error instanceof errors_1.NotFoundError || error instanceof errors_1.ValidationError)
            throw error;
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw new errors_1.AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
        }
        throw error;
    }
});
exports.receiveStampPreview = receiveStampPreview;
// ── Stamping a received document ──────────────────────────────────────
/**
 * Put the stamp on a page, at a point the receiver chose.
 *
 * POST /document/receive-stamp/apply { documentId, page, xBp, yBp }
 *
 * The file is NEVER rewritten. A received PDF may carry signatures sealed
 * over a hash of its bytes, so changing those bytes would invalidate the
 * very thing the document is evidence of. What is stored is the position;
 * the office's own copy is composed at download time and the original stays
 * exactly as it arrived.
 */
const applyReceiveStamp = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    const b = req.body;
    if (!b.documentId)
        throw new errors_1.ValidationError("INVALID REQUIRED ID");
    const { actorId, lineId } = yield (0, callerScope_1.callerContext)(req);
    // You may only stamp what you are allowed to see.
    const { requireCanSeeDocument } = yield Promise.resolve().then(() => __importStar(require("./disseminationController")));
    yield requireCanSeeDocument(req, b.documentId);
    const stamp = yield prisma_1.prisma.receiveStamp.findUnique({
        where: { userId: actorId },
        select: { image: true },
    });
    if (!(stamp === null || stamp === void 0 ? void 0 : stamp.image)) {
        throw new errors_1.ValidationError("Set up your receiving stamp first — Document module, Manage Receive Stamp.");
    }
    const file = yield prisma_1.prisma.decodedFile.findFirst({
        where: { documentId: b.documentId },
        select: { fileDecoded: true },
    });
    if (!(file === null || file === void 0 ? void 0 : file.fileDecoded))
        throw new errors_1.NotFoundError("Document file not found");
    const { pdfPageSizes } = yield Promise.resolve().then(() => __importStar(require("../service/pdfRaster")));
    const sizes = yield pdfPageSizes(Buffer.from(file.fileDecoded));
    const page = Math.max(1, Math.round(Number((_a = b.page) !== null && _a !== void 0 ? _a : 1) || 1));
    if (page > sizes.length) {
        throw new errors_1.ValidationError(`That document has ${sizes.length} page${sizes.length === 1 ? "" : "s"}.`);
    }
    const mark = yield prisma_1.prisma.receiveStampMark.upsert({
        where: { documentId_userId: { documentId: b.documentId, userId: actorId } },
        update: { page, xBp: clampBp(b.xBp, 0), yBp: clampBp(b.yBp, 0), lineId },
        create: {
            documentId: b.documentId,
            userId: actorId,
            lineId,
            page,
            xBp: clampBp(b.xBp, 0),
            yBp: clampBp(b.yBp, 0),
        },
        select: { id: true, page: true, xBp: true, yBp: true, stampedAt: true },
    });
    return res.code(200).send({ message: "OK", mark, pages: sizes.length });
});
exports.applyReceiveStamp = applyReceiveStamp;
/** GET /document/receive-stamp/marks?documentId= — what is on this document. */
const receiveStampMarks = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    const q = req.query;
    if (!q.documentId)
        throw new errors_1.ValidationError("INVALID REQUIRED ID");
    const { actorId } = yield (0, callerScope_1.callerContext)(req);
    const { requireCanSeeDocument } = yield Promise.resolve().then(() => __importStar(require("./disseminationController")));
    yield requireCanSeeDocument(req, q.documentId);
    const marks = yield prisma_1.prisma.receiveStampMark.findMany({
        where: { documentId: q.documentId },
        orderBy: { stampedAt: "asc" },
        select: {
            id: true, page: true, xBp: true, yBp: true, stampedAt: true, userId: true,
            user: { select: { firstName: true, lastName: true } },
        },
    });
    return res
        .code(200)
        .send({ marks, mine: (_a = marks.find((m) => m.userId === actorId)) !== null && _a !== void 0 ? _a : null });
});
exports.receiveStampMarks = receiveStampMarks;
/** DELETE /document/receive-stamp/mark?documentId= — take my stamp off again. */
const removeReceiveStampMark = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const q = req.query;
    if (!q.documentId)
        throw new errors_1.ValidationError("INVALID REQUIRED ID");
    const { actorId } = yield (0, callerScope_1.callerContext)(req);
    // Your own stamp only — a stamp is somebody's signature that they took
    // delivery, and removing another office's is not yours to do.
    const existing = yield prisma_1.prisma.receiveStampMark.findUnique({
        where: { documentId_userId: { documentId: q.documentId, userId: actorId } },
        select: { id: true },
    });
    if (!existing)
        throw new errors_1.NotFoundError("You have not stamped this document");
    yield prisma_1.prisma.receiveStampMark.delete({ where: { id: existing.id } });
    return res.code(200).send({ message: "OK" });
});
exports.removeReceiveStampMark = removeReceiveStampMark;
/**
 * GET /document/receive-stamp/stamped?documentId= — the office's copy.
 *
 * The document as it arrived, with every receiving stamp composed onto it
 * at its true physical size. Generated on demand and never stored, so the
 * original bytes — and any seal over them — remain untouched.
 */
const stampedDocument = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    const q = req.query;
    if (!q.documentId)
        throw new errors_1.ValidationError("INVALID REQUIRED ID");
    const { requireCanSeeDocument } = yield Promise.resolve().then(() => __importStar(require("./disseminationController")));
    yield requireCanSeeDocument(req, q.documentId);
    const doc = yield prisma_1.prisma.document.findUnique({
        where: { id: q.documentId },
        select: { title: true, file: { select: { fileDecoded: true, fileName: true } } },
    });
    if (!((_a = doc === null || doc === void 0 ? void 0 : doc.file) === null || _a === void 0 ? void 0 : _a.fileDecoded))
        throw new errors_1.NotFoundError("Document file not found");
    const marks = yield prisma_1.prisma.receiveStampMark.findMany({
        where: { documentId: q.documentId },
        orderBy: { stampedAt: "asc" },
        select: { userId: true, page: true, xBp: true, yBp: true, stampedAt: true },
    });
    const { PDFDocument } = yield Promise.resolve().then(() => __importStar(require("pdf-lib")));
    const pdf = yield PDFDocument.load(Buffer.from(doc.file.fileDecoded));
    const pages = pdf.getPages();
    for (const m of marks) {
        const cfg = yield prisma_1.prisma.receiveStamp.findUnique({
            where: { userId: m.userId },
            select: { widthMm: true, heightMm: true },
        });
        if (!cfg)
            continue;
        const target = pages[m.page - 1];
        if (!target)
            continue;
        let png;
        try {
            // Composed with the date it was STAMPED, not today — the stamp
            // records when the office took delivery, and reprinting it later
            // must not quietly move that date.
            png = yield (0, exports.renderReceiveStamp)(m.userId, m.stampedAt, 1200);
        }
        catch (_b) {
            continue;
        }
        const img = yield pdf.embedPng(png);
        const wPt = (0, exports.mmToPt)(cfg.widthMm);
        const hPt = (0, exports.mmToPt)(cfg.heightMm);
        const { width: pw, height: ph } = target.getSize();
        const x = (m.xBp / BP) * pw;
        const yTop = (m.yBp / BP) * ph;
        target.drawImage(img, {
            x,
            // Basis points measure from the top; PDF from the bottom.
            y: ph - yTop - hPt,
            width: wPt,
            height: hPt,
        });
    }
    const out = Buffer.from(yield pdf.save());
    const base = (doc.file.fileName || doc.title || "document").replace(/\.pdf$/i, "");
    return res
        .header("Content-Type", "application/pdf")
        .header("Content-Disposition", `attachment; filename="${base}-received.pdf"`)
        .header("Cache-Control", "no-store")
        .code(200)
        .send(out);
});
exports.stampedDocument = stampedDocument;
