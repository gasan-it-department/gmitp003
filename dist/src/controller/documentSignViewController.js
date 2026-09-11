"use strict";
// Seeing a document before signing it.
//
// The phone could already sign — one call flips every slot carrying your
// name — but it could not SHOW you the thing first, which makes the whole
// feature indefensible. A signature you applied to a document you never
// read is not a signature anybody should be able to collect.
//
// Two endpoints:
//
//   sign-sheet  — what the routing is, who else is on it, how many areas
//                 carry YOUR name and exactly where they sit on the page.
//   page-image  — one page as a PNG, rendered server-side.
//
// The placement maths is the easy part and worth stating: SignatureCoor
// stores basis points, 0-10000 of the page's width and height with the
// origin top-left. That is resolution-independent, so the phone draws its
// overlay at x/100 % of whatever size it renders the image and the boxes
// land exactly where the final PDF will stamp them. No coordinate
// translation, no drift between preview and product.
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
exports.routingPageImage = exports.routingSignSheet = void 0;
const prisma_1 = require("../barrel/prisma");
const errors_1 = require("../errors/errors");
const handler_1 = require("../middleware/handler");
const disseminationController_1 = require("./disseminationController");
const pdfRaster_1 = require("../service/pdfRaster");
const fullName = (u) => { var _a, _b; return (u ? `${(_a = u.firstName) !== null && _a !== void 0 ? _a : ""} ${(_b = u.lastName) !== null && _b !== void 0 ? _b : ""}`.trim() || null : null); };
/**
 * Everything needed to render "here is the document, here is where you
 * sign" — for whoever may see the routing, not only its signatories.
 *
 * A recipient opening this gets the pages and `mySlots: 0`, which is the
 * honest answer: they may read it, there is nothing here for them to sign.
 */
const routingSignSheet = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d, _e, _f, _g;
    const params = req.query;
    if (!params.queueId)
        throw new errors_1.ValidationError("INVALID REQUIRED ID");
    yield (0, disseminationController_1.requireCanSeeRouting)(req, params.queueId);
    const actorId = yield (0, handler_1.callerUserId)(req);
    try {
        const queue = yield prisma_1.prisma.signatureQueueRoom.findUnique({
            where: { id: params.queueId },
            select: {
                id: true,
                title: true,
                status: true,
                timestamp: true,
                fromRoom: { select: { code: true } },
                user: { select: { firstName: true, lastName: true } },
                signatotyArrangement: {
                    orderBy: { index: "asc" },
                    select: {
                        id: true,
                        index: true,
                        status: true,
                        signedAt: true,
                        userId: true,
                        user: {
                            select: { firstName: true, lastName: true,
                                Position: { select: { name: true } } },
                        },
                    },
                },
                documents: {
                    orderBy: { timestamp: "asc" },
                    select: {
                        id: true,
                        title: true,
                        file: { select: { fileName: true, fileType: true } },
                        pages: {
                            orderBy: { page: "asc" },
                            select: {
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
            },
        });
        if (!queue)
            throw new errors_1.NotFoundError("Routing not found");
        // Which arrangements are mine, and which of those still need signing.
        const mineIds = new Set(queue.signatotyArrangement
            .filter((a) => a.userId && a.userId === actorId)
            .map((a) => a.id));
        const minePending = new Set(queue.signatotyArrangement
            .filter((a) => a.userId === actorId && a.status === 0)
            .map((a) => a.id));
        // Page sizes come from the PDF itself, not from DocumentPage: a row
        // there only exists for a page somebody dropped a box on, so a
        // three-page memo with one signature block has one row. The phone
        // needs every page, and it needs the aspect ratio before the image
        // arrives or the overlay slides around as each one loads.
        const documents = [];
        let totalPages = 0;
        for (const doc of queue.documents) {
            const boxesByPage = new Map();
            for (const p of doc.pages)
                boxesByPage.set(p.page, p.signCoor);
            let sizes = [];
            try {
                const file = yield prisma_1.prisma.decodedFile.findFirst({
                    where: { documentId: doc.id },
                    select: { fileDecoded: true },
                });
                if (file === null || file === void 0 ? void 0 : file.fileDecoded) {
                    sizes = yield (0, pdfRaster_1.pdfPageSizes)(Buffer.from(file.fileDecoded));
                }
            }
            catch (e) {
                // A file we cannot open must not take the whole screen down; the
                // page list falls back to whatever placements tell us exists.
                console.warn(`[sign-sheet] could not read ${doc.id}:`, e);
            }
            if (sizes.length === 0) {
                sizes = [...boxesByPage.keys()]
                    .sort((a, b) => a - b)
                    .map((page) => ({ page, widthPt: 612, heightPt: 792 }));
            }
            documents.push({
                id: doc.id,
                title: (_c = (_a = doc.title) !== null && _a !== void 0 ? _a : (_b = doc.file) === null || _b === void 0 ? void 0 : _b.fileName) !== null && _c !== void 0 ? _c : "Document",
                pageCount: sizes.length,
                pages: sizes.map((s) => {
                    var _a;
                    const boxes = (_a = boxesByPage.get(s.page)) !== null && _a !== void 0 ? _a : [];
                    return {
                        page: s.page,
                        widthPt: s.widthPt,
                        heightPt: s.heightPt,
                        /** Boxes that carry the caller's name, in basis points. */
                        mine: boxes
                            .filter((b) => b.signatoryArrangementId &&
                            mineIds.has(b.signatoryArrangementId))
                            .map((b) => ({
                            id: b.id,
                            xBp: b.xAxis,
                            yBp: b.yAxis,
                            wBp: b.width,
                            hBp: b.height,
                            pending: minePending.has(b.signatoryArrangementId),
                        })),
                        /** How many belong to other people — shown, not placed. */
                        others: boxes.filter((b) => !b.signatoryArrangementId ||
                            !mineIds.has(b.signatoryArrangementId)).length,
                    };
                }),
            });
            totalPages += sizes.length;
        }
        const myAreas = documents.reduce((n, d) => n + d.pages.reduce((m, p) => m + p.mine.filter((b) => b.pending).length, 0), 0);
        return res.code(200).send({
            queueId: queue.id,
            title: (_d = queue.title) !== null && _d !== void 0 ? _d : "Untitled routing",
            from: (_g = (_f = (_e = queue.fromRoom) === null || _e === void 0 ? void 0 : _e.code) !== null && _f !== void 0 ? _f : fullName(queue.user)) !== null && _g !== void 0 ? _g : "—",
            sentAt: queue.timestamp,
            status: queue.status,
            signatories: queue.signatotyArrangement.map((a) => {
                var _a, _b, _c, _d;
                return ({
                    position: a.index + 1,
                    name: (_a = fullName(a.user)) !== null && _a !== void 0 ? _a : "Unassigned",
                    position_title: (_d = (_c = (_b = a.user) === null || _b === void 0 ? void 0 : _b.Position) === null || _c === void 0 ? void 0 : _c.name) !== null && _d !== void 0 ? _d : null,
                    signed: a.status === 1,
                    signedAt: a.signedAt,
                    isMe: !!a.userId && a.userId === actorId,
                });
            }),
            /** How many pending areas one tap would sign. 0 = nothing for you. */
            myAreas,
            /** True when there is something here for the caller to sign. */
            canSign: myAreas > 0 && queue.status === 1,
            totalPages,
            documents,
        });
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
exports.routingSignSheet = routingSignSheet;
/**
 * One page of one document, as a PNG.
 *
 * Gated by the same rule as downloading the file — if you may not have the
 * PDF you may not have a picture of it either.
 */
const routingPageImage = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    const params = req.query;
    if (!params.documentId)
        throw new errors_1.ValidationError("INVALID REQUIRED ID");
    yield (0, disseminationController_1.requireCanSeeDocument)(req, params.documentId);
    const page = Math.max(1, parseInt((_a = params.page) !== null && _a !== void 0 ? _a : "1", 10) || 1);
    const width = parseInt((_b = params.w) !== null && _b !== void 0 ? _b : "", 10) || pdfRaster_1.DEFAULT_RENDER_PX;
    try {
        const file = yield prisma_1.prisma.decodedFile.findFirst({
            where: { documentId: params.documentId },
            select: { fileDecoded: true, fileSize: true },
        });
        if (!(file === null || file === void 0 ? void 0 : file.fileDecoded))
            throw new errors_1.NotFoundError("FILE NOT FOUND");
        // The source PDF cannot change once a routing is dispatched, so the
        // rendered page is safe to cache on the device. Keyed on the file's
        // own size as well as the request, so re-uploading in draft busts it.
        const etag = `"pg-${params.documentId}-${page}-${width}-${file.fileSize}"`;
        if (req.headers["if-none-match"] === etag) {
            return res.code(304).send();
        }
        const { png, widthPx, heightPx } = yield (0, pdfRaster_1.renderPdfPage)(Buffer.from(file.fileDecoded), page, width);
        res.header("Content-Type", "image/png");
        res.header("Content-Length", png.length.toString());
        res.header("Cache-Control", "private, max-age=86400");
        res.header("ETag", etag);
        res.header("X-Page-Width", String(widthPx));
        res.header("X-Page-Height", String(heightPx));
        return res.code(200).send(png);
    }
    catch (error) {
        if (error instanceof errors_1.NotFoundError)
            throw error;
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw new errors_1.AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
        }
        // A page number past the end, or a file mupdf cannot parse.
        console.warn("[page-image] render failed:", error);
        throw new errors_1.NotFoundError("Page not available");
    }
});
exports.routingPageImage = routingPageImage;
