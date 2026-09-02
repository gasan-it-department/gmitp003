"use strict";
// Personal self-sign tool — a user uploads their OWN document, drops
// signature placeholder boxes on it, then signs every box in one click.
// No dissemination, no targets, no other signatories. The same image-stamp
// + flatten machinery used for dispatched disseminations is reused for
// the final download.
//
// Data model reuse:
//   - Document               (file holder, userId = owner, queueRoomId = null)
//   - DocumentPage           (lazy, one per page that has placements)
//   - SignatureCoor          (placement boxes)
//   - SignatoryArrangement   (single row per document, queueRoomId = null,
//                             userId = owner; status 0=pending, 1=signed)
//   - ArchiveDocument        (for the optional "store in room archive")
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
exports.selfSignRemove = exports.selfSignArchive = exports.selfSignDetail = exports.selfSignList = exports.selfSignUnsign = exports.selfSignAll = exports.selfSignSavePlacements = exports.selfSignUpload = void 0;
const prisma_1 = require("../barrel/prisma");
const errors_1 = require("../errors/errors");
const MAX_DOC_BYTES = 25 * 1024 * 1024; // 25 MB
// ─── Upload ────────────────────────────────────────────────────────────
const selfSignUpload = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, e_1, _b, _c, _d, e_2, _e, _f;
    if (!req.isMultipart())
        throw new errors_1.ValidationError("INVALID REQUEST");
    let upload = null;
    const fields = {};
    try {
        const parts = req.parts();
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
                        fileName: part.filename,
                        mimetype: part.mimetype,
                        buffer: Buffer.concat(chunks),
                    };
                }
                else {
                    fields[part.fieldname] = String(part.value);
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
        if (upload.mimetype !== "application/pdf") {
            throw new errors_1.ValidationError("ONLY PDF FILES ARE ALLOWED");
        }
        if (upload.buffer.length > MAX_DOC_BYTES) {
            throw new errors_1.ValidationError("FILE EXCEEDS 25MB LIMIT");
        }
        const { userId, lineId, title } = fields;
        if (!userId || !lineId) {
            throw new errors_1.ValidationError("INVALID REQUIRED FIELDS");
        }
        const result = yield prisma_1.prisma.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            const doc = yield tx.document.create({
                data: {
                    title: title || upload.fileName.replace(/\.pdf$/i, ""),
                    size: upload.buffer.length,
                    lineId,
                    userId,
                    docType: 0,
                    type: 9, // 9 = self-sign (distinct from dissemination docs)
                    original: 1,
                },
                select: { id: true, title: true, timestamp: true },
            });
            yield tx.decodedFile.create({
                data: {
                    documentId: doc.id,
                    fileName: upload.fileName,
                    fileSize: String(upload.buffer.length),
                    fileType: upload.mimetype,
                    fileDecoded: upload.buffer,
                },
            });
            // One arrangement per self-sign doc (no queue). The placements
            // bind to this so the existing signed-PDF endpoint works.
            const arr = yield tx.signatoryArrangement.create({
                data: {
                    signatureQueueRoomId: null,
                    index: 0,
                    status: 0,
                    userId,
                },
                select: { id: true },
            });
            return { doc, arrangementId: arr.id };
        }));
        return res.code(200).send({
            message: "OK",
            document: result.doc,
            arrangementId: result.arrangementId,
        });
    }
    catch (error) {
        if (error instanceof errors_1.ValidationError)
            throw error;
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw new errors_1.AppError(error.message, 500, error.code);
        }
        throw error;
    }
});
exports.selfSignUpload = selfSignUpload;
// ─── Save placements ───────────────────────────────────────────────────
// Replace strategy: every save call wipes existing SignatureCoor rows on
// the document and recreates them from the payload. Auto-saved by the
// frontend on every box change.
const selfSignSavePlacements = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const body = req.body;
    if (!body.documentId ||
        !body.arrangementId ||
        !Array.isArray(body.placements)) {
        throw new errors_1.ValidationError("INVALID REQUIRED FIELDS");
    }
    try {
        yield prisma_1.prisma.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            const doc = yield tx.document.findUnique({
                where: { id: body.documentId },
                select: { id: true, userId: true },
            });
            if (!doc)
                throw new errors_1.NotFoundError("Document not found");
            if (doc.userId !== body.userId) {
                throw new errors_1.ValidationError("Not the document owner.");
            }
            const arr = yield tx.signatoryArrangement.findUnique({
                where: { id: body.arrangementId },
                select: { id: true, userId: true, status: true },
            });
            if (!arr)
                throw new errors_1.NotFoundError("Arrangement not found");
            if (arr.userId !== body.userId) {
                throw new errors_1.ValidationError("Not the arrangement owner.");
            }
            if (arr.status !== 0) {
                throw new errors_1.ValidationError("Document already signed — placements are frozen.");
            }
            // Group by page; ensure DocumentPage rows exist.
            const pageNums = Array.from(new Set(body.placements.map((p) => p.page))).filter((n) => Number.isFinite(n) && n > 0);
            const existing = yield tx.documentPage.findMany({
                where: { documentId: body.documentId, page: { in: pageNums } },
                select: { id: true, page: true },
            });
            const byPage = new Map(existing.map((p) => [p.page, p.id]));
            for (const p of pageNums) {
                if (!byPage.has(p)) {
                    const created = yield tx.documentPage.create({
                        data: { documentId: body.documentId, page: p, content: "" },
                        select: { id: true, page: true },
                    });
                    byPage.set(p, created.id);
                }
            }
            // Drop existing placements on this document, recreate.
            const allPages = yield tx.documentPage.findMany({
                where: { documentId: body.documentId },
                select: { id: true },
            });
            if (allPages.length > 0) {
                yield tx.signatureCoor.deleteMany({
                    where: { documentPageId: { in: allPages.map((p) => p.id) } },
                });
            }
            if (body.placements.length > 0) {
                yield tx.signatureCoor.createMany({
                    data: body.placements.map((p) => ({
                        documentPageId: byPage.get(p.page),
                        signatoryArrangementId: body.arrangementId,
                        xAxis: Math.round(p.xAxis),
                        yAxis: Math.round(p.yAxis),
                        width: Math.round(p.width),
                        height: Math.round(p.height),
                    })),
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
            throw new errors_1.AppError(error.message, 500, error.code);
        }
        throw error;
    }
});
exports.selfSignSavePlacements = selfSignSavePlacements;
// ─── Sign all in one click ─────────────────────────────────────────────
const selfSignAll = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const body = req.body;
    if (!body.arrangementId || !body.userId) {
        throw new errors_1.ValidationError("INVALID REQUIRED FIELDS");
    }
    try {
        const result = yield prisma_1.prisma.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            var _a, _b, _c, _d, _e, _f;
            const arr = yield tx.signatoryArrangement.findUnique({
                where: { id: body.arrangementId },
                select: { id: true, userId: true, status: true, sign: { select: { id: true } } },
            });
            if (!arr)
                throw new errors_1.NotFoundError("Arrangement not found");
            if (arr.userId !== body.userId) {
                throw new errors_1.ValidationError("Not your arrangement.");
            }
            if (arr.status !== 0) {
                throw new errors_1.ValidationError("Already signed.");
            }
            if (arr.sign.length === 0) {
                throw new errors_1.ValidationError("Draw at least one signature placeholder before signing.");
            }
            // Resolve which signature stamps this document. Explicit choice
            // wins (must be the caller's own); otherwise the active one.
            let sig = null;
            if (body.signatureId) {
                sig = yield tx.signature.findFirst({
                    where: { id: body.signatureId, userId: body.userId },
                    select: { id: true },
                });
                if (!sig) {
                    throw new errors_1.ValidationError("The selected signature was not found in your account.");
                }
            }
            else {
                sig = yield tx.signature.findFirst({
                    where: { userId: body.userId, active: true },
                    select: { id: true },
                });
                if (!sig) {
                    throw new errors_1.ValidationError("You don't have an active signature on file. Upload and activate one in Signature Management first.");
                }
            }
            const now = new Date();
            const updated = yield tx.signatoryArrangement.update({
                where: { id: arr.id },
                data: {
                    status: 1,
                    signedAt: now,
                    signatureId: sig.id,
                    signedLat: (_b = (_a = body.geo) === null || _a === void 0 ? void 0 : _a.lat) !== null && _b !== void 0 ? _b : null,
                    signedLng: (_d = (_c = body.geo) === null || _c === void 0 ? void 0 : _c.lng) !== null && _d !== void 0 ? _d : null,
                    signedAccuracy: (_f = (_e = body.geo) === null || _e === void 0 ? void 0 : _e.accuracy) !== null && _f !== void 0 ? _f : null,
                },
                select: { id: true, status: true, signedAt: true },
            });
            return { boxes: arr.sign.length, signedAt: updated.signedAt };
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
exports.selfSignAll = selfSignAll;
// ─── Undo / revert a signature ─────────────────────────────────────────
// Signing only flips the arrangement to status=1 (the PDF is stamped at
// download time), so reverting is safe: status back to 0 and the signed
// metadata cleared. Blocked once the doc is archived — the archive entry
// asserts "this doc is signed", so it must be removed first.
const selfSignUnsign = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const body = req.body;
    if (!body.arrangementId || !body.userId) {
        throw new errors_1.ValidationError("INVALID REQUIRED FIELDS");
    }
    try {
        yield prisma_1.prisma.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            const arr = yield tx.signatoryArrangement.findUnique({
                where: { id: body.arrangementId },
                select: {
                    id: true,
                    userId: true,
                    status: true,
                    sign: { select: { documentPage: { select: { documentId: true } } } },
                },
            });
            if (!arr)
                throw new errors_1.NotFoundError("Arrangement not found");
            if (arr.userId !== body.userId) {
                throw new errors_1.ValidationError("Not your arrangement.");
            }
            if (arr.status !== 1) {
                throw new errors_1.ValidationError("Document is not signed — nothing to undo.");
            }
            const documentId = arr.sign
                .map((c) => { var _a; return (_a = c.documentPage) === null || _a === void 0 ? void 0 : _a.documentId; })
                .find((id) => !!id);
            if (documentId) {
                const archived = yield tx.archiveDocument.findFirst({
                    where: { documentId, status: { not: 0 } },
                    select: { id: true },
                });
                if (archived) {
                    throw new errors_1.ValidationError("This document is already archived. Remove it from the archive before undoing the signature.");
                }
            }
            yield tx.signatoryArrangement.update({
                where: { id: arr.id },
                data: {
                    status: 0,
                    signedAt: null,
                    signatureId: null,
                    signedLat: null,
                    signedLng: null,
                    signedAccuracy: null,
                },
            });
        }));
        return res.code(200).send({ message: "OK" });
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
exports.selfSignUnsign = selfSignUnsign;
// ─── List self-signed docs (history) ───────────────────────────────────
const selfSignList = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const params = req.query;
    if (!params.userId || !params.lineId) {
        throw new errors_1.ValidationError("INVALID REQUIRED FIELDS");
    }
    try {
        const limit = params.limit ? parseInt(params.limit, 10) : 20;
        const cursor = params.lastCursor && params.lastCursor !== "null"
            ? { id: params.lastCursor }
            : undefined;
        const rows = yield prisma_1.prisma.document.findMany({
            where: {
                userId: params.userId,
                lineId: params.lineId,
                signatureQueueRoomId: null,
                type: 9,
            },
            take: limit,
            skip: cursor ? 1 : 0,
            cursor,
            orderBy: { timestamp: "desc" },
            include: {
                file: { select: { fileName: true, fileType: true } },
                pages: {
                    select: {
                        signCoor: {
                            select: {
                                signatoryArrangement: {
                                    select: { id: true, status: true, signedAt: true },
                                },
                            },
                        },
                    },
                },
                archiveDocuments: { select: { id: true } },
            },
        });
        // Flatten: each doc gets its single arrangement (the self-sign one).
        const list = rows.map((d) => {
            var _a;
            const arr = (_a = d.pages
                .flatMap((p) => p.signCoor)
                .map((c) => c.signatoryArrangement)
                .find((a) => a && a.id)) !== null && _a !== void 0 ? _a : null;
            const boxCount = d.pages.reduce((a, p) => a + p.signCoor.length, 0);
            return {
                id: d.id,
                title: d.title,
                size: d.size,
                timestamp: d.timestamp,
                file: d.file,
                arrangement: arr,
                boxCount,
                archived: !!d.archiveDocuments,
            };
        });
        const lastCursor = rows.length ? rows[rows.length - 1].id : null;
        const hasMore = rows.length === limit;
        return res.code(200).send({ list, lastCursor, hasMore });
    }
    catch (error) {
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw new errors_1.AppError(error.message, 500, error.code);
        }
        throw error;
    }
});
exports.selfSignList = selfSignList;
// ─── Get a single self-sign doc (for the editor) ───────────────────────
const selfSignDetail = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const params = req.query;
    if (!params.id || !params.userId) {
        throw new errors_1.ValidationError("INVALID REQUIRED FIELDS");
    }
    try {
        const doc = yield prisma_1.prisma.document.findUnique({
            where: { id: params.id },
            include: {
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
        });
        if (!doc)
            throw new errors_1.NotFoundError("Document not found");
        if (doc.userId !== params.userId) {
            throw new errors_1.ValidationError("Not the document owner.");
        }
        // Pull the single self-sign arrangement (placements bind to it).
        const arrIds = Array.from(new Set(doc.pages.flatMap((p) => p.signCoor
            .map((c) => c.signatoryArrangementId)
            .filter((x) => !!x))));
        let arrangement = null;
        if (arrIds.length > 0) {
            const row = yield prisma_1.prisma.signatoryArrangement.findFirst({
                where: { id: { in: arrIds }, userId: params.userId },
                select: { id: true, status: true, signedAt: true, signatureId: true },
            });
            arrangement = row !== null && row !== void 0 ? row : null;
        }
        if (!arrangement) {
            // Fallback: find the user's own arrangement for this doc even when
            // no placements exist yet (just-uploaded state).
            arrangement = yield prisma_1.prisma.signatoryArrangement.findFirst({
                where: { userId: params.userId, signatureQueueRoomId: null },
                orderBy: { timestamp: "desc" },
                select: { id: true, status: true, signedAt: true, signatureId: true },
            });
        }
        // Always return the caller's signature image as a data URL so the
        // editor can render the stamp inside signed boxes without an extra
        // round-trip. The signature chosen at sign time wins; otherwise
        // active preferred, falling back to most recent.
        let signatureDataUrl = null;
        // The editor draws the stamp inside signed boxes on screen. Without the
        // owner's boundary and size it draws them the OLD way — the whole file
        // squeezed into the box — so the preview and the downloaded PDF end up
        // showing two different things. Same row, same numbers, both places.
        let sigRow = null;
        if (arrangement === null || arrangement === void 0 ? void 0 : arrangement.signatureId) {
            sigRow = yield prisma_1.prisma.signature.findFirst({
                where: { id: arrangement.signatureId, userId: params.userId },
                select: {
                    signature: true,
                    inkHeightPt: true,
                    baselinePct: true,
                    inkX0: true,
                    inkY0: true,
                    inkX1: true,
                    inkY1: true,
                },
            });
        }
        if (!sigRow) {
            sigRow = yield prisma_1.prisma.signature.findFirst({
                where: { userId: params.userId },
                orderBy: [{ active: "desc" }, { timestamp: "desc" }],
                select: {
                    signature: true,
                    inkHeightPt: true,
                    baselinePct: true,
                    inkX0: true,
                    inkY0: true,
                    inkX1: true,
                    inkY1: true,
                },
            });
        }
        if (sigRow === null || sigRow === void 0 ? void 0 : sigRow.signature) {
            const buf = Buffer.from(sigRow.signature);
            const text = buf.toString("utf8").trim();
            if (text.startsWith("data:image/")) {
                signatureDataUrl = text;
            }
            else if (/^[A-Za-z0-9+/=\r\n]+$/.test(text.slice(0, 200)) &&
                !looksLikeBinary(buf)) {
                signatureDataUrl = `data:image/png;base64,${text.replace(/\s+/g, "")}`;
            }
            else {
                let mime = "image/png";
                if (buf.length >= 4 &&
                    buf[0] === 0x89 &&
                    buf[1] === 0x50 &&
                    buf[2] === 0x4e &&
                    buf[3] === 0x47) {
                    mime = "image/png";
                }
                else if (buf.length >= 3 &&
                    buf[0] === 0xff &&
                    buf[1] === 0xd8 &&
                    buf[2] === 0xff) {
                    mime = "image/jpeg";
                }
                signatureDataUrl = `data:${mime};base64,${buf.toString("base64")}`;
            }
        }
        return res
            .code(200)
            .send({
            document: doc,
            arrangement,
            signatureDataUrl,
            signaturePlacement: sigRow
                ? {
                    inkHeightPt: sigRow.inkHeightPt,
                    baselinePct: sigRow.baselinePct,
                    ink: sigRow.inkX0 === null ||
                        sigRow.inkY0 === null ||
                        sigRow.inkX1 === null ||
                        sigRow.inkY1 === null
                        ? null
                        : {
                            x0: sigRow.inkX0,
                            y0: sigRow.inkY0,
                            x1: sigRow.inkX1,
                            y1: sigRow.inkY1,
                        },
                }
                : null,
        });
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
exports.selfSignDetail = selfSignDetail;
// ─── Archive a signed self-sign doc to the room archive ────────────────
const selfSignArchive = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const body = req.body;
    if (!body.documentId || !body.userId) {
        throw new errors_1.ValidationError("INVALID REQUIRED FIELDS");
    }
    try {
        const result = yield prisma_1.prisma.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            var _a;
            const doc = yield tx.document.findUnique({
                where: { id: body.documentId },
                select: {
                    id: true,
                    userId: true,
                    lineId: true,
                    pages: {
                        select: {
                            signCoor: {
                                select: {
                                    signatoryArrangement: {
                                        select: { status: true },
                                    },
                                },
                            },
                        },
                    },
                    archiveDocuments: { select: { id: true } },
                },
            });
            if (!doc)
                throw new errors_1.NotFoundError("Document not found");
            if (doc.userId !== body.userId) {
                throw new errors_1.ValidationError("Not the document owner.");
            }
            // Must have at least one signed arrangement attached.
            const signed = doc.pages
                .flatMap((p) => p.signCoor)
                .some((c) => { var _a; return ((_a = c.signatoryArrangement) === null || _a === void 0 ? void 0 : _a.status) === 1; });
            if (!signed) {
                throw new errors_1.ValidationError("Sign the document before archiving it.");
            }
            if (doc.archiveDocuments) {
                return { existed: true, archiveId: doc.archiveDocuments.id };
            }
            const room = yield tx.receivingRoom.findFirst({
                where: {
                    lineId: doc.lineId,
                    authorizedUser: { some: { userId: body.userId } },
                },
                select: { id: true },
            });
            const created = yield tx.archiveDocument.create({
                data: {
                    documentId: doc.id,
                    lineId: doc.lineId,
                    receivingRoomId: (_a = room === null || room === void 0 ? void 0 : room.id) !== null && _a !== void 0 ? _a : undefined,
                    status: 1,
                },
                select: { id: true },
            });
            return { existed: false, archiveId: created.id };
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
exports.selfSignArchive = selfSignArchive;
// ─── Remove (only while unsigned) ──────────────────────────────────────
const selfSignRemove = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const params = req.query;
    if (!params.id || !params.userId) {
        throw new errors_1.ValidationError("INVALID REQUIRED FIELDS");
    }
    try {
        const doc = yield prisma_1.prisma.document.findUnique({
            where: { id: params.id },
            include: {
                pages: {
                    select: {
                        signCoor: {
                            select: {
                                signatoryArrangement: { select: { status: true } },
                            },
                        },
                    },
                },
            },
        });
        if (!doc)
            throw new errors_1.NotFoundError("Document not found");
        if (doc.userId !== params.userId) {
            throw new errors_1.ValidationError("Not the document owner.");
        }
        const isSigned = doc.pages
            .flatMap((p) => p.signCoor)
            .some((c) => { var _a; return ((_a = c.signatoryArrangement) === null || _a === void 0 ? void 0 : _a.status) === 1; });
        if (isSigned) {
            throw new errors_1.ValidationError("Signed documents can't be removed. Archive them instead.");
        }
        yield prisma_1.prisma.document.delete({ where: { id: doc.id } });
        return res.code(200).send({ message: "OK" });
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
exports.selfSignRemove = selfSignRemove;
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
