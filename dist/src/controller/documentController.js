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
var __asyncValues = (this && this.__asyncValues) || function (o) {
    if (!Symbol.asyncIterator) throw new TypeError("Symbol.asyncIterator is not defined.");
    var m = o[Symbol.asyncIterator], i;
    return m ? m.call(o) : (o = typeof __values === "function" ? __values(o) : o[Symbol.iterator](), i = {}, verb("next"), verb("throw"), verb("return"), i[Symbol.asyncIterator] = function () { return this; }, i);
    function verb(n) { i[n] = o[n] && function (v) { return new Promise(function (resolve, reject) { v = o[n](v), settle(resolve, reject, v.done, v.value); }); }; }
    function settle(resolve, reject, d, v) { Promise.resolve(v).then(function(v) { resolve({ value: v, done: d }); }, reject); }
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateAbstract = exports.routerInfo = exports.createDocumentRoute = exports.downloadArchiveFile = exports.removeArchive = exports.archiveDetail = exports.updateRoomStatus = exports.removeRoom = exports.room = exports.rooms = exports.archiveFile = exports.searchArchiveDocs = exports.searchArchiveDocsAI = exports.archives = exports.roomRequestDetails = exports.deleteRoomRequest = exports.updateStatus = exports.roomRequest = exports.signatoryRegistry = exports.roomRegister = exports.authorizedUsers = exports.addDocument = void 0;
const prisma_1 = require("../barrel/prisma");
const errors_1 = require("../errors/errors");
const Embedding_1 = require("../service/Embedding");
const notificationEvents_1 = require("../service/notificationEvents");
const addDocument = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, e_1, _b, _c, _d, e_2, _e, _f;
    if (!req.isMultipart()) {
        throw new errors_1.ValidationError("INVALID REQUEST");
    }
    try {
        const parts = req.parts();
        const files = [];
        const formData = {};
        try {
            for (var _g = true, parts_1 = __asyncValues(parts), parts_1_1; parts_1_1 = yield parts_1.next(), _a = parts_1_1.done, !_a; _g = true) {
                _c = parts_1_1.value;
                _g = false;
                const part = _c;
                if (part.type === "file") {
                    const buffers = [];
                    try {
                        for (var _h = true, _j = (e_2 = void 0, __asyncValues(part.file)), _k; _k = yield _j.next(), _d = _k.done, !_d; _h = true) {
                            _f = _k.value;
                            _h = false;
                            const chunk = _f;
                            buffers.push(chunk);
                        }
                    }
                    catch (e_2_1) { e_2 = { error: e_2_1 }; }
                    finally {
                        try {
                            if (!_h && !_d && (_e = _j.return)) yield _e.call(_j);
                        }
                        finally { if (e_2) throw e_2.error; }
                    }
                    files.push({
                        fieldname: part.fieldname,
                        filename: part.filename,
                        mimetype: part.mimetype,
                        buffer: Buffer.concat(buffers),
                    });
                }
                else {
                    formData[part.fieldname] = part.value;
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
    }
    catch (error) {
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw new errors_1.AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
        }
        throw error;
    }
});
exports.addDocument = addDocument;
const pdf2json_1 = __importDefault(require("pdf2json"));
const document_1 = require("../utils/document");
const helper_1 = require("../utils/helper");
function parsePdfWithPdf2Json(buffer) {
    return __awaiter(this, void 0, void 0, function* () {
        return new Promise((resolve, reject) => {
            const pdfParser = new pdf2json_1.default();
            pdfParser.on("pdfParser_dataError", (errData) => {
                reject(new Error(errData.parserError));
            });
            pdfParser.on("pdfParser_dataReady", (pdfData) => {
                const pages = [];
                let fullText = "";
                if (pdfData.Pages) {
                    pdfData.Pages.forEach((page, index) => {
                        let pageText = "";
                        if (page.Texts) {
                            page.Texts.forEach((textItem) => {
                                // Decode the text (it might be encoded)
                                const decodedText = decodeURIComponent(textItem.R[0].T);
                                pageText += decodedText + " ";
                            });
                        }
                        pages.push({
                            pageNumber: index + 1,
                            text: pageText.trim(),
                            charCount: pageText.length,
                        });
                        fullText += pageText + "\n";
                    });
                }
                resolve({
                    numPages: pages.length,
                    text: fullText.trim(),
                    pages,
                    metadata: pdfData.Meta || {},
                    textStats: {
                        totalCharacters: fullText.length,
                        totalWords: fullText.split(/\s+/).filter((word) => word.length > 0)
                            .length,
                    },
                });
            });
            // Parse the buffer
            pdfParser.parseBuffer(buffer);
        });
    });
}
const authorizedUsers = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const params = req.query;
    if (!params.query) {
        return res.code(200).send({ list: [], lastCursor: null, hasMore: false });
    }
    if (!params.type && typeof params.type != "number") {
        throw new errors_1.ValidationError("INVALID TYPE");
    }
    try {
        const cursor = params.lastCursor ? { id: params.lastCursor } : undefined;
        const limit = params.limit ? parseInt(params.limit) : 10;
        const response = yield prisma_1.prisma.roomAuthorizedUser.findMany({
            where: {
                user: {
                    firstName: { contains: params.query, mode: "insensitive" },
                    lastName: { contains: params.query, mode: "insensitive" },
                },
                type: params.type,
            },
            skip: cursor ? 1 : 0,
            take: limit,
            cursor: cursor,
            orderBy: { user: { lastName: "desc", firstName: "desc" } },
            include: {
                receivingRoom: {
                    select: {
                        address: true,
                        code: true,
                    },
                },
                user: {
                    select: {
                        firstName: true,
                        lastName: true,
                        middleName: true,
                        userProfilePictures: {
                            select: {
                                file_name: true,
                                file_url: true,
                                file_size: true,
                            },
                        },
                    },
                },
            },
        });
        const newLastCursorId = response.length > 0 ? response[response.length - 1].id : null;
        const hasMore = response.length === limit;
        return res.code(200).send({
            list: response,
            lastCursor: newLastCursorId,
            hasMore: hasMore,
        });
    }
    catch (error) {
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw new errors_1.AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
        }
        throw error;
    }
});
exports.authorizedUsers = authorizedUsers;
const roomRegister = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    // Check if it's multipart request
    const body = req.body;
    if (!body.address ||
        !body.lineId ||
        !body.userId ||
        body.authorizedUser.length === 0) {
        throw new errors_1.ValidationError("INVALID REQUIRED ID");
    }
    try {
        const response = yield prisma_1.prisma.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            const checkUser = yield tx.roomAuthorizedUser.findMany({
                where: {
                    userId: {
                        in: body.authorizedUser.map((item) => item.userId),
                    },
                },
            });
            if (checkUser.length > 0) {
                return {
                    status: 1,
                    existedUserId: [...checkUser.map((item) => item.userId)],
                };
            }
            const request = yield tx.roomRegistration.create({
                data: {
                    address: body.address,
                    authorizedUser: {
                        createMany: {
                            data: body.authorizedUser.map((user) => {
                                return {
                                    userId: user.userId,
                                    type: parseInt(user.type, 10),
                                };
                            }),
                        },
                    },
                    lineId: body.lineId,
                    userId: body.userId,
                },
            });
            return { status: 0, existedUserId: [], requestId: request.id };
        }));
        return res.code(200).send(response);
    }
    catch (error) {
        console.log(error);
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            if (error.code === "P2002") {
                throw new errors_1.ValidationError("DUPLICATE_ENTRY");
            }
            throw new errors_1.AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
        }
        // Re-throw validation errors
        if (error instanceof errors_1.ValidationError || error instanceof errors_1.AppError) {
            throw error;
        }
        throw new errors_1.AppError("INTERNAL_SERVER_ERROR", 500, "An unexpected error occurred");
    }
});
exports.roomRegister = roomRegister;
const signatoryRegistry = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const params = req.query;
    if (!params.userId) {
        throw new errors_1.ValidationError("MISSING_USER_ID");
    }
    try {
        const [roomRegistration, signatory, room] = yield prisma_1.prisma.$transaction([
            prisma_1.prisma.roomRegistration.findFirst({
                where: {
                    userId: params.userId,
                },
            }),
            prisma_1.prisma.roomAuthorizedUser.findFirst({
                where: {
                    userId: params.userId,
                },
                include: {
                    signature: {
                        select: {
                            active: true,
                            title: true,
                            signature: true,
                        },
                    },
                },
            }),
            prisma_1.prisma.receivingRoom.findFirst({
                where: {
                    authorizedUser: {
                        some: {
                            userId: params.userId,
                        },
                    },
                },
            }),
        ]);
        return res.code(200).send({ roomRegistration, signatory, room });
    }
    catch (error) {
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw new errors_1.AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
        }
        throw error;
    }
});
exports.signatoryRegistry = signatoryRegistry;
const roomRequest = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const params = req.query;
    if (!params.id) {
        throw new errors_1.ValidationError("INVALID REQUIRED ID");
    }
    try {
        // Bug fix: was `{ id: params.id }` (the lineId), so pagination would
        // restart at the first row on every page. The cursor must be the
        // last row id from the previous page.
        const cursor = params.lastCursor ? { id: params.lastCursor } : undefined;
        const limit = params.limit ? parseInt(params.limit, 10) : 20;
        const filter = { lineId: params.id };
        if (params.status &&
            typeof params.status === "string" &&
            params.status !== "all") {
            filter.status = parseInt(params.status, 10);
        }
        if (params.query && params.query.trim()) {
            const q = params.query.trim();
            // Search across user fields AND the request's own address. We
            // wrap everything in a top-level OR so any match qualifies.
            filter.OR = [
                { address: { contains: q, mode: "insensitive" } },
                {
                    user: {
                        OR: [
                            { firstName: { contains: q, mode: "insensitive" } },
                            { lastName: { contains: q, mode: "insensitive" } },
                            { email: { contains: q, mode: "insensitive" } },
                            { username: { contains: q, mode: "insensitive" } },
                        ],
                    },
                },
            ];
        }
        const response = yield prisma_1.prisma.roomRegistration.findMany({
            where: filter,
            take: limit + 1, // Take one extra to check if there are more
            skip: cursor ? 1 : 0,
            cursor,
            orderBy: {
                timestamp: "desc",
            },
            include: {
                user: {
                    select: {
                        id: true,
                        firstName: true,
                        lastName: true,
                        email: true,
                        username: true,
                    },
                },
                line: {
                    select: {
                        id: true,
                        name: true,
                    },
                },
            },
        });
        // Check if there are more items
        const hasMore = response.length > limit;
        const items = hasMore ? response.slice(0, -1) : response;
        const newLastCursorId = items.length > 0 ? items[items.length - 1].id : null;
        return res.code(200).send({
            list: items,
            lastCursor: newLastCursorId,
            hasMore,
        });
    }
    catch (error) {
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            console.error("Prisma error:", error);
            throw new errors_1.AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
        }
        console.error("Room request error:", error);
        throw error;
    }
});
exports.roomRequest = roomRequest;
const updateStatus = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const body = req.body;
    if (!body.id || !body.lineId || !body.status || !body.userId) {
        throw new errors_1.ValidationError("INVALID REQUIRED ID");
    }
    try {
        const response = yield prisma_1.prisma.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            const dateUpdated = {};
            const request = yield tx.roomRegistration.update({
                where: {
                    id: body.id,
                },
                data: {
                    status: body.status,
                },
                include: {
                    authorizedUser: true,
                },
            });
            if (body.status === 1) {
                dateUpdated.dateApproved = new Date().toISOString();
            }
            if (body.status === 2) {
                dateUpdated.dateRejected = new Date().toISOString();
            }
            // Only create a room on approval — previously this ran for every
            // status update including rejections, which left orphaned rooms.
            if (body.status === 1) {
                const room = yield tx.receivingRoom.create({
                    data: {
                        address: request.address,
                        code: `RM-${Math.random().toString(36).slice(2, 9).toUpperCase()}`,
                        lineId: request.lineId,
                    },
                });
                // Always include the requester themselves as an authorized user
                // (type 0 = owner). Previously only `request.authorizedUser` (the
                // co-signatories they listed) were added, which left the requester
                // without a membership if they didn't list themselves.
                const members = [
                    { userId: request.userId, type: 0 },
                    ...request.authorizedUser.map((item) => ({
                        userId: item.userId,
                        type: item.type,
                    })),
                ];
                const seen = new Set();
                const uniqueMembers = members.filter((m) => {
                    if (seen.has(m.userId))
                        return false;
                    seen.add(m.userId);
                    return true;
                });
                yield tx.roomAuthorizedUser.createMany({
                    data: uniqueMembers.map((m) => ({
                        userId: m.userId,
                        type: m.type,
                        receivingRoomId: room.id,
                    })),
                });
                yield (0, notificationEvents_1.createUserNotification)(tx, {
                    recipientId: request.userId,
                    content: `You can now access and manage Document.`,
                    title: "Document Room Approved",
                    senderId: body.userId,
                });
            }
            yield tx.humanResourcesLogs.create({
                data: {
                    lineId: body.lineId,
                    userId: body.userId,
                    action: "UPDATE",
                    desc: `UPDATE ROOM REQUEST`,
                },
            });
            return true;
        }));
        if (!response) {
            throw new errors_1.ValidationError("TRANSACTION FAILED");
        }
        return res.code(200).send({ message: "OK" });
    }
    catch (error) {
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw new errors_1.AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
        }
        throw error;
    }
});
exports.updateStatus = updateStatus;
const deleteRoomRequest = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const params = req.query;
    if (!params.id || !params.lineId || !params.userId) {
        throw new errors_1.ValidationError("INVALID REQUIRED ID");
    }
    try {
        const response = yield prisma_1.prisma.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            const request = yield tx.roomRegistration.delete({
                where: {
                    id: params.id,
                },
                include: {
                    user: {
                        select: {
                            username: true,
                        },
                    },
                },
            });
            yield tx.humanResourcesLogs.create({
                data: {
                    action: "DELETE",
                    desc: `DELETE DOCUMENT ROOM REQUEST: ${request.user.username}`,
                    userId: params.userId,
                    lineId: params.lineId,
                },
            });
            return true;
        }));
        if (!response) {
            throw new errors_1.ValidationError("TRANSACTION FAILED");
        }
        return res.code(200).send({ message: "OK" });
    }
    catch (error) {
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw new errors_1.AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
        }
        throw error;
    }
});
exports.deleteRoomRequest = deleteRoomRequest;
const roomRequestDetails = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    const params = req.query;
    if (!params.id)
        throw new errors_1.ValidationError("INVALID REQUIRED ID");
    try {
        const response = yield prisma_1.prisma.roomRegistration.findUnique({
            where: { id: params.id },
            include: {
                authorizedUser: {
                    select: {
                        id: true,
                        userId: true,
                        user: {
                            select: {
                                id: true,
                                lastName: true,
                                firstName: true,
                                username: true,
                                email: true,
                            },
                        },
                    },
                },
                roomRegistrationSignatures: true,
                roomRegistrationConversations: {
                    orderBy: { timestamp: "desc" },
                    take: 25,
                },
                line: { select: { id: true, name: true } },
                user: {
                    select: {
                        id: true,
                        username: true,
                        lastName: true,
                        firstName: true,
                        email: true,
                    },
                },
            },
        });
        if (!response)
            throw new errors_1.NotFoundError("REQUEST NOT FOUND");
        // The frontend historically reads `receivers`; alias the relation so
        // both shapes are available without breaking the existing type.
        const payload = Object.assign(Object.assign({}, response), { receivers: (_a = response.authorizedUser) !== null && _a !== void 0 ? _a : [] });
        return res.code(200).send(payload);
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
exports.roomRequestDetails = roomRequestDetails;
const archives = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    const params = req.query;
    if (!params.id) {
        throw new errors_1.ValidationError("INVALID REQUIRED ID");
    }
    try {
        const limit = params.limit ? parseInt(params.limit, 10) : 20;
        const q = (_a = params.query) === null || _a === void 0 ? void 0 : _a.trim();
        const roomId = params.roomId;
        const where = { lineId: params.id, status: 1 };
        if (roomId)
            where.receivingRoomId = roomId;
        // Keyword filter searches BOTH document.title and abstract content/title
        if (q) {
            where.OR = [
                { document: { title: { contains: q, mode: "insensitive" } } },
                { abstract: { title: { contains: q, mode: "insensitive" } } },
                { abstract: { content: { contains: q, mode: "insensitive" } } },
            ];
        }
        const cursor = params.lastCursor ? { id: params.lastCursor } : undefined;
        const response = yield prisma_1.prisma.archiveDocument.findMany({
            where,
            take: limit,
            skip: cursor ? 1 : 0,
            cursor,
            orderBy: { timestamp: "desc" },
            include: {
                document: {
                    select: {
                        id: true,
                        title: true,
                        timestamp: true,
                        size: true,
                    },
                },
                abstract: {
                    select: { id: true, title: true, content: true, timestamp: true },
                },
                preservation: {
                    select: {
                        id: true,
                        retentionDate: true,
                        safeDate: true,
                        detentionDate: true,
                    },
                },
            },
        });
        const newLastCursorId = response.length > 0 ? response[response.length - 1].id : null;
        const hasMore = response.length === limit;
        return res.code(200).send({
            list: response,
            lastCursor: newLastCursorId,
            hasMore,
        });
    }
    catch (error) {
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw new errors_1.AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
        }
        throw error;
    }
});
exports.archives = archives;
/**
 * Semantic search across archived documents.
 *
 * Strategy:
 *   1) Pre-filter candidate archives by line / room (cheap SQL).
 *   2) Embed the query once (384 dims, all-MiniLM-L6-v2).
 *   3) Cosine-compare against each candidate's stored composite vector
 *      (title + type + abstract embedded together at write time).
 *   4) Drop results below a similarity threshold.
 *   5) Sort by score and apply offset-based pagination.
 *
 * Returns each item with a `similarity` score so the UI can display
 * "relevance" badges. Falls back to recency order when no query is given.
 */
const searchArchiveDocsAI = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p;
    const params = req.query;
    try {
        const limit = params.limit ? parseInt(params.limit, 10) : 20;
        // Accept either `offset` or `lastCursor` (treated as a stringified offset)
        const offset = params.offset !== undefined
            ? parseInt(params.offset, 10) || 0
            : params.lastCursor
                ? parseInt(params.lastCursor, 10) || 0
                : 0;
        const lineId = params.lineId;
        const roomId = params.id;
        const q = (_b = (_a = params.query) === null || _a === void 0 ? void 0 : _a.trim()) !== null && _b !== void 0 ? _b : "";
        // Mean-pooled MiniLM embeddings typically score 0.10–0.45 for paraphrases.
        // Default of 0.15 catches genuine matches without flooding with noise.
        const threshold = params.threshold
            ? Math.max(0, Math.min(1, parseFloat(params.threshold)))
            : 0.15;
        // Pre-filter candidates: scope by room/line + exclude removed (status=0).
        // Using `not: 0` so legacy NULL/unset status values are still included.
        const whereScope = { status: { not: 0 } };
        if (roomId)
            whereScope.receivingRoomId = roomId;
        if (lineId)
            whereScope.lineId = lineId;
        const baseInclude = {
            document: { select: { id: true, title: true } },
            abstract: {
                select: {
                    id: true,
                    title: true,
                    content: true,
                    embedding: { select: { vector: true, dimensions: true } },
                },
            },
            receivingRoom: { select: { id: true, code: true, address: true } },
        };
        // ── No query → recency order (with simple offset paging) ──────────
        if (!q) {
            const items = yield prisma_1.prisma.archiveDocument.findMany({
                where: whereScope,
                orderBy: { timestamp: "desc" },
                skip: offset,
                take: limit + 1,
                include: baseInclude,
            });
            const hasMore = items.length > limit;
            const list = items.slice(0, limit).map((i) => (Object.assign(Object.assign({}, i), { similarity: 0 })));
            return res.code(200).send({
                list,
                hasMore,
                nextOffset: hasMore ? offset + limit : null,
                lastCursor: hasMore ? String(offset + limit) : null,
            });
        }
        // ── Embedded query → vector similarity ────────────────────────────
        let queryVector;
        try {
            yield Embedding_1.embeddingService.initialize();
            queryVector = yield Embedding_1.embeddingService.generateEmbedding(q);
        }
        catch (e) {
            console.error("[searchArchiveDocsAI] embedder failed to load:", e);
            throw new errors_1.AppError("EMBEDDING_INIT_FAILED", 503, "AI search is temporarily unavailable. Please try keyword search instead.");
        }
        const candidates = yield prisma_1.prisma.archiveDocument.findMany({
            where: whereScope,
            include: baseInclude,
        });
        // Lazy re-index: any candidate whose embedding is missing OR not the
        // expected 384 dims (legacy records had broken 1152-dim concat vectors)
        // gets regenerated from its title+type+abstract on the fly. After one
        // Deep Search, all candidates end up with correct composite vectors.
        const EXPECTED_DIM = 384;
        let reindexed = 0;
        for (const c of candidates) {
            const v = (_d = (_c = c.abstract) === null || _c === void 0 ? void 0 : _c.embedding) === null || _d === void 0 ? void 0 : _d.vector;
            const needsFix = !v || !Array.isArray(v) || v.length !== EXPECTED_DIM;
            if (!needsFix)
                continue;
            if (!((_e = c.abstract) === null || _e === void 0 ? void 0 : _e.id))
                continue;
            const title = (_j = (_g = (_f = c.document) === null || _f === void 0 ? void 0 : _f.title) !== null && _g !== void 0 ? _g : (_h = c.abstract) === null || _h === void 0 ? void 0 : _h.title) !== null && _j !== void 0 ? _j : "";
            const typeLabel = (_l = helper_1.archiveDocType[(_k = c.docType) !== null && _k !== void 0 ? _k : 0]) !== null && _l !== void 0 ? _l : "Other";
            const content = (_o = (_m = c.abstract) === null || _m === void 0 ? void 0 : _m.content) !== null && _o !== void 0 ? _o : "";
            const composite = [title, `[${typeLabel}]`, content]
                .filter(Boolean)
                .join("\n");
            if (!composite.trim())
                continue;
            try {
                const fresh = yield Embedding_1.embeddingService.generateEmbedding(composite);
                yield prisma_1.prisma.archiveEmbedding.upsert({
                    where: { documentAbstractId: c.abstract.id },
                    update: {
                        vector: fresh,
                        dimensions: fresh.length,
                        model: "Xenova/all-MiniLM-L6-v2",
                        updatedAt: new Date(),
                    },
                    create: {
                        documentAbstractId: c.abstract.id,
                        vector: fresh,
                        dimensions: fresh.length,
                        model: "Xenova/all-MiniLM-L6-v2",
                    },
                });
                // mutate in-memory so this request uses the fresh vector
                if ((_p = c.abstract) === null || _p === void 0 ? void 0 : _p.embedding) {
                    c.abstract.embedding.vector = fresh;
                    c.abstract.embedding.dimensions = fresh.length;
                }
                else if (c.abstract) {
                    c.abstract.embedding = { vector: fresh, dimensions: fresh.length };
                }
                reindexed += 1;
            }
            catch (e) {
                console.warn("[searchArchiveDocsAI] reindex failed for", c.id, e);
            }
        }
        const cosine = (a, b) => {
            if (!a || !b || a.length === 0 || b.length === 0)
                return 0;
            const n = Math.min(a.length, b.length);
            let dot = 0, ma = 0, mb = 0;
            for (let i = 0; i < n; i++) {
                dot += a[i] * b[i];
                ma += a[i] * a[i];
                mb += b[i] * b[i];
            }
            const denom = Math.sqrt(ma) * Math.sqrt(mb);
            return denom ? dot / denom : 0;
        };
        let withEmbeddings = 0;
        const scored = candidates
            .map((c) => {
            var _a, _b;
            const v = (_b = (_a = c.abstract) === null || _a === void 0 ? void 0 : _a.embedding) === null || _b === void 0 ? void 0 : _b.vector;
            if (v)
                withEmbeddings += 1;
            return Object.assign(Object.assign({}, c), { similarity: v ? cosine(queryVector, v) : 0 });
        })
            .filter((c) => c.similarity >= threshold)
            .sort((a, b) => b.similarity - a.similarity);
        const topScores = scored.slice(0, 5).map((s) => +s.similarity.toFixed(3));
        console.log(`[searchArchiveDocsAI] q="${q}" candidates=${candidates.length} ` +
            `withEmb=${withEmbeddings} reindexed=${reindexed} ` +
            `≥${threshold}=${scored.length} top=${JSON.stringify(topScores)}`);
        // ── Fallback: if vector search finds nothing above threshold,
        // run a keyword search across title + abstract so the user always
        // gets *something* useful (paired with a `fallback: "keyword"` flag).
        if (scored.length === 0) {
            const fallback = yield prisma_1.prisma.archiveDocument.findMany({
                where: Object.assign(Object.assign({}, whereScope), { OR: [
                        { document: { title: { contains: q, mode: "insensitive" } } },
                        { abstract: { title: { contains: q, mode: "insensitive" } } },
                        { abstract: { content: { contains: q, mode: "insensitive" } } },
                    ] }),
                take: limit + 1,
                skip: offset,
                orderBy: { timestamp: "desc" },
                include: baseInclude,
            });
            const hasMore = fallback.length > limit;
            const list = fallback
                .slice(0, limit)
                .map((i) => (Object.assign(Object.assign({}, i), { similarity: 0 })));
            return res.code(200).send({
                list,
                hasMore,
                nextOffset: hasMore ? offset + limit : null,
                lastCursor: hasMore ? String(offset + limit) : null,
                totalCandidates: candidates.length,
                totalMatches: list.length,
                withEmbeddings,
                threshold,
                fallback: "keyword",
                note: "No semantic matches above threshold; showing keyword matches instead.",
            });
        }
        const sliced = scored.slice(offset, offset + limit);
        const hasMore = scored.length > offset + limit;
        return res.code(200).send({
            list: sliced,
            hasMore,
            nextOffset: hasMore ? offset + limit : null,
            lastCursor: hasMore ? String(offset + limit) : null,
            totalCandidates: candidates.length,
            totalMatches: scored.length,
            withEmbeddings,
            threshold,
            topScores,
        });
    }
    catch (error) {
        if (error instanceof errors_1.AppError)
            throw error;
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw new errors_1.AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
        }
        console.error("[searchArchiveDocsAI] unexpected error:", error);
        throw error;
    }
});
exports.searchArchiveDocsAI = searchArchiveDocsAI;
/**
 * Plain-text (keyword) search across archived documents.
 *
 * Matches against BOTH the document title and the abstract content.
 * Scoped to the current room (preferred) or the line (fallback). Uses
 * cursor pagination on the single query — no more duplicated rows from
 * concatenating two queries.
 */
const searchArchiveDocs = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    const params = req.query;
    try {
        const cursor = params.lastCursor ? { id: params.lastCursor } : undefined;
        const limit = params.limit ? parseInt(params.limit, 10) : 20;
        const lineId = params.lineId;
        const roomId = params.id;
        const q = (_a = params.query) === null || _a === void 0 ? void 0 : _a.trim();
        // Scope: room (preferred), else line, else everything visible
        const scope = { status: 1 };
        if (roomId)
            scope.receivingRoomId = roomId;
        else if (lineId)
            scope.lineId = lineId;
        // Keyword OR across title + abstract content (case-insensitive)
        let searchClause = {};
        if (q) {
            searchClause.OR = [
                { document: { title: { contains: q, mode: "insensitive" } } },
                { abstract: { title: { contains: q, mode: "insensitive" } } },
                { abstract: { content: { contains: q, mode: "insensitive" } } },
            ];
        }
        const where = Object.assign(Object.assign({}, scope), searchClause);
        const response = yield prisma_1.prisma.archiveDocument.findMany({
            where,
            take: limit,
            skip: cursor ? 1 : 0,
            cursor,
            orderBy: { timestamp: "desc" },
            include: {
                document: { select: { id: true, title: true } },
                abstract: { select: { title: true, content: true } },
                receivingRoom: { select: { id: true, code: true, address: true } },
            },
        });
        const newLastCursorId = response.length > 0 ? response[response.length - 1].id : null;
        const hasMore = response.length === limit;
        return res.code(200).send({
            list: response,
            lastCursor: newLastCursorId,
            hasMore,
        });
    }
    catch (error) {
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw new errors_1.AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
        }
        throw error;
    }
});
exports.searchArchiveDocs = searchArchiveDocs;
const archiveFile = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, e_3, _b, _c, _d, e_4, _e, _f;
    var _g, _h, _j;
    const isMultipart = req.isMultipart();
    if (!isMultipart)
        throw new errors_1.ValidationError("INVALID MULTIPARTS");
    try {
        const parts = req.parts();
        let file;
        const formData = {};
        try {
            for (var _k = true, parts_2 = __asyncValues(parts), parts_2_1; parts_2_1 = yield parts_2.next(), _a = parts_2_1.done, !_a; _k = true) {
                _c = parts_2_1.value;
                _k = false;
                let part = _c;
                if (part.type === "file") {
                    const buffers = [];
                    try {
                        for (var _l = true, _m = (e_4 = void 0, __asyncValues(part.file)), _o; _o = yield _m.next(), _d = _o.done, !_d; _l = true) {
                            _f = _o.value;
                            _l = false;
                            const chunk = _f;
                            buffers.push(chunk);
                        }
                    }
                    catch (e_4_1) { e_4 = { error: e_4_1 }; }
                    finally {
                        try {
                            if (!_l && !_d && (_e = _m.return)) yield _e.call(_m);
                        }
                        finally { if (e_4) throw e_4.error; }
                    }
                    file = {
                        fieldname: part.fieldname,
                        filename: part.filename,
                        mimetype: part.mimetype,
                        buffer: Buffer.concat(buffers),
                    };
                }
                else {
                    formData[part.fieldname] = part.value;
                }
            }
        }
        catch (e_3_1) { e_3 = { error: e_3_1 }; }
        finally {
            try {
                if (!_k && !_a && (_b = parts_2.return)) yield _b.call(parts_2);
            }
            finally { if (e_3) throw e_3.error; }
        }
        // console.log({ file, formData: JSON.stringify(formData) });
        if (!formData.userId || !formData.lineId || !formData.receivingRoomId) {
            throw new errors_1.ValidationError("INVALID REQUIRED ID");
        }
        if (!file) {
            throw new errors_1.ValidationError("INVALID FILE");
        }
        if (!((_g = formData.title) === null || _g === void 0 ? void 0 : _g.trim()) || !((_h = formData.abstract) === null || _h === void 0 ? void 0 : _h.trim())) {
            throw new errors_1.ValidationError("Title and abstract are required.");
        }
        const fileType = (0, document_1.getFileType)({
            mimetype: file.mimetype,
            filename: file.filename,
            buffer: file.buffer,
        });
        const docTypeIndex = formData.docType ? parseInt(formData.docType, 10) : 0;
        const docTypeLabel = (_j = helper_1.archiveDocType[docTypeIndex]) !== null && _j !== void 0 ? _j : "Other";
        // ── Single composite embedding ────────────────────────────────────────
        // Concatenating multiple separate 384-dim vectors does NOT compose
        // semantically (cosine similarity would only compare each slice with
        // its own slice). Instead, build a single text that captures title +
        // type + abstract, then embed once. This keeps stored dim = 384 and
        // makes query-time similarity correct.
        const compositeText = [
            formData.title.trim(),
            `[${docTypeLabel}]`,
            formData.abstract.trim(),
        ].join("\n");
        const compositeVector = yield Embedding_1.embeddingService.generateEmbedding(compositeText);
        // ── Parse optional preservation dates ────────────────────────────────
        const toDate = (v) => v && /^\d{4}-\d{2}-\d{2}/.test(v) ? new Date(v) : undefined;
        const retentionDate = toDate(formData.retentionDate);
        const safeDate = toDate(formData.safeDate);
        const wantsPreservation = !!(retentionDate || safeDate);
        const result = yield prisma_1.prisma.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            // 1) Document + file blob — created in two steps so the binary write
            // doesn't have to fit inside Prisma's nested-create payload (large
            // bytea blobs in a single nested create were tripping the FK
            // constraint when the inner DecodedFile row landed before the parent
            // Document was visible to the connection).
            const doc = yield tx.document.create({
                data: {
                    docType: docTypeIndex,
                    size: file.buffer.length,
                    title: formData.title,
                    lineId: formData.lineId,
                    userId: formData.userId,
                    receivingRoomId: formData.receivingRoomId,
                },
            });
            yield tx.decodedFile.create({
                data: {
                    documentId: doc.id,
                    fileName: file.filename,
                    fileDecoded: file.buffer,
                    fileSize: file.buffer.length.toString(),
                    fileType: fileType,
                },
            });
            // 2) Optional preservation record
            let preservationId;
            if (wantsPreservation) {
                const pres = yield tx.archivePreservation.create({
                    data: {
                        type: 1,
                        retentionDate,
                        safeDate,
                    },
                });
                preservationId = pres.id;
            }
            // 3) Archive + abstract + embedding
            const archive = yield tx.archiveDocument.create({
                data: Object.assign({ docType: docTypeIndex, retentionDate, abstract: {
                        create: {
                            content: formData.abstract,
                            title: formData.title,
                            embedding: {
                                create: {
                                    vector: compositeVector,
                                    model: "Xenova/all-MiniLM-L6-v2",
                                    dimensions: compositeVector.length,
                                },
                            },
                        },
                    }, receivingRoom: { connect: { id: formData.receivingRoomId } }, document: { connect: { id: doc.id } }, line: { connect: { id: formData.lineId } } }, (preservationId
                    ? { preservation: { connect: { id: preservationId } } }
                    : {})),
            });
            // 4) Activity log
            yield tx.documentActivityLogs.create({
                data: {
                    userId: formData.userId,
                    lineId: formData.lineId,
                    title: `Archived — ${file.filename}`,
                    desc: `Document "${formData.title}" archived. Abstract: ${formData.abstract.substring(0, 80)}${formData.abstract.length > 80 ? "…" : ""}`,
                    action: 1,
                    documentId: doc.id,
                },
            });
            return { archiveId: archive.id, documentId: doc.id };
        }), {
            // Large bytea writes can take far longer than Prisma's 5s default.
            maxWait: 60000, // wait up to 1m to acquire the tx
            timeout: 30 * 60000, // tx may run up to 30m for huge files
        });
        return res.code(200).send({
            message: "OK",
            id: result.archiveId,
            documentId: result.documentId,
        });
    }
    catch (error) {
        console.log({ error });
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw new errors_1.AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
        }
        throw error;
    }
});
exports.archiveFile = archiveFile;
const rooms = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const params = req.query;
    if (!params.id)
        throw new errors_1.ValidationError("INVALID REQUIRED ID");
    try {
        const cursor = params.lastCursor ? { id: params.lastCursor } : undefined;
        const limit = params.limit ? parseInt(params.limit, 10) : 20;
        const where = {
            lineId: params.id,
        };
        if (params.query && params.query.trim()) {
            const q = params.query.trim();
            where.OR = [
                { address: { contains: q, mode: "insensitive" } },
                { code: { contains: q, mode: "insensitive" } },
            ];
        }
        const [list, total] = yield Promise.all([
            prisma_1.prisma.receivingRoom.findMany({
                where,
                take: limit,
                skip: cursor ? 1 : 0,
                cursor,
                orderBy: { timestamp: "desc" },
                // Include a count of authorized users on each room so the
                // list can surface "N users" at a glance.
                include: {
                    _count: {
                        select: {
                            authorizedUser: true,
                        },
                    },
                },
            }),
            prisma_1.prisma.receivingRoom.count({ where: { lineId: params.id } }),
        ]);
        const newLastCursorId = list.length ? list[list.length - 1].id : null;
        const hasMore = list.length === limit;
        return res
            .code(200)
            .send({ list, lastCursor: newLastCursorId, hasMore, total });
    }
    catch (error) {
        console.log("Error: ", error);
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw new errors_1.AppError("DB_CONNECTION", 500, "DB_FAILED");
        }
        throw error;
    }
});
exports.rooms = rooms;
const room = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const params = req.query;
    if (!params.id)
        throw new errors_1.ValidationError("INVALID REQUIRED ID");
    try {
        const response = yield prisma_1.prisma.receivingRoom.findUnique({
            where: { id: params.id },
            include: {
                line: { select: { id: true, name: true } },
                authorizedUser: {
                    select: {
                        id: true,
                        userId: true,
                        type: true,
                        user: {
                            select: {
                                id: true,
                                firstName: true,
                                lastName: true,
                                username: true,
                                email: true,
                            },
                        },
                    },
                },
                _count: {
                    select: {
                        authorizedUser: true,
                        targetRooms: true,
                    },
                },
            },
        });
        if (!response)
            throw new errors_1.NotFoundError("ROOM NOT FOUND");
        return res.code(200).send(response);
    }
    catch (error) {
        if (error instanceof errors_1.NotFoundError)
            throw error;
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw new errors_1.AppError("DB_CONNECTION", 500, "DB_FAILED");
        }
        throw error;
    }
});
exports.room = room;
/**
 * Soft-delete a receiving room (status: 0). Hard delete would cascade
 * across documents and authorizedUser rows; we'd lose the audit chain.
 */
const removeRoom = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const params = req.query;
    if (!params.id || !params.lineId || !params.userId) {
        throw new errors_1.ValidationError("INVALID REQUIRED ID");
    }
    try {
        const response = yield prisma_1.prisma.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            var _a;
            const room = yield tx.receivingRoom.findUnique({
                where: { id: params.id },
            });
            if (!room)
                throw new errors_1.NotFoundError("ROOM NOT FOUND");
            if (room.status === 0)
                return true; // already removed
            yield tx.receivingRoom.update({
                where: { id: room.id },
                data: { status: 0 },
            });
            yield tx.humanResourcesLogs.create({
                data: {
                    action: "DELETE",
                    desc: `REMOVE RECEIVING ROOM: ${(_a = room.address) !== null && _a !== void 0 ? _a : ""}-${room.code}`,
                    userId: params.userId,
                    lineId: params.lineId,
                },
            });
            return true;
        }));
        if (!response) {
            throw new errors_1.ValidationError("TRANSACTION FAILED");
        }
        return res.code(200).send({ message: "Ok" });
    }
    catch (error) {
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw new errors_1.AppError("DB_CONNECTION", 500, "DB_FAILED");
        }
        throw error;
    }
});
exports.removeRoom = removeRoom;
const updateRoomStatus = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const body = req.body;
    if (!body.id || !body.lineId || !body.userId) {
        throw new Error("INVALID REQUIRED ID");
    }
    try {
        const response = yield prisma_1.prisma.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            const updatedRoom = yield tx.receivingRoom.update({
                where: {
                    id: body.id,
                },
                data: {
                    status: body.status,
                },
            });
            yield tx.humanResourcesLogs.create({
                data: {
                    action: "UPDATE",
                    desc: `UPDATE RECEIVING ROOM: ${updatedRoom.address}-${updatedRoom}`,
                    userId: body.userId,
                    lineId: body.lineId,
                },
            });
            return true;
        }));
        if (!response) {
            throw new errors_1.ValidationError("TRANSACTION FAILED");
        }
        return res.code(200).send({ message: "Ok" });
    }
    catch (error) {
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw new errors_1.AppError("DB_CONNECTION", 500, "DB_FAILED");
        }
        throw error;
    }
});
exports.updateRoomStatus = updateRoomStatus;
const archiveDetail = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const params = req.query;
    if (!params.id)
        throw new errors_1.ValidationError("INVALID REQUIRED ID");
    try {
        const response = yield prisma_1.prisma.archiveDocument.findUnique({
            where: { id: params.id },
            include: {
                document: {
                    select: {
                        id: true,
                        title: true,
                        timestamp: true,
                        size: true,
                        docType: true,
                        file: {
                            select: {
                                id: true,
                                fileName: true,
                                fileSize: true,
                                fileType: true,
                            },
                        },
                    },
                },
                abstract: {
                    select: { id: true, title: true, content: true, timestamp: true },
                },
                preservation: {
                    select: {
                        id: true,
                        type: true,
                        retentionDate: true,
                        safeDate: true,
                        detentionDate: true,
                        timestamp: true,
                    },
                },
                line: {
                    select: { id: true, name: true },
                },
                receivingRoom: {
                    select: { id: true, code: true, address: true },
                },
            },
        });
        if (!response)
            throw new errors_1.NotFoundError("ARCHIVE NOT FOUND");
        return res.code(200).send(response);
    }
    catch (error) {
        if (error instanceof errors_1.ValidationError)
            throw error;
        if (error instanceof errors_1.NotFoundError)
            throw error;
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw new errors_1.AppError("DB_CONNECTION", 500, "DB_FAILED");
        }
        throw error;
    }
});
exports.archiveDetail = archiveDetail;
/**
 * Soft-remove an archived document.
 *
 * Flips `status` → 0 so the document disappears from active archive listings
 * while preserving the row, its abstract/embedding, and the original file
 * for audit/compliance. Logs the action to documentActivityLogs.
 */
const removeArchive = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const params = req.query;
    if (!params.id || !params.userId || !params.lineId)
        throw new errors_1.ValidationError("INVALID REQUIRED IDS");
    try {
        const result = yield prisma_1.prisma.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            var _a, _b, _c;
            const existing = yield tx.archiveDocument.findUnique({
                where: { id: params.id },
                select: {
                    id: true,
                    status: true,
                    lineId: true,
                    documentId: true,
                    document: { select: { title: true } },
                },
            });
            if (!existing)
                throw new errors_1.NotFoundError("ARCHIVE_NOT_FOUND");
            if (existing.status === 0)
                throw new errors_1.ValidationError("Archive is already removed.");
            // Scope: ensure the user is removing within their line
            if (existing.lineId && existing.lineId !== params.lineId)
                throw new errors_1.ValidationError("You can only remove archives from your own line.");
            // Soft delete
            const updated = yield tx.archiveDocument.update({
                where: { id: params.id },
                data: { status: 0 },
            });
            // Audit log
            yield tx.documentActivityLogs.create({
                data: {
                    userId: params.userId,
                    lineId: params.lineId,
                    title: `Removed — ${(_b = (_a = existing.document) === null || _a === void 0 ? void 0 : _a.title) !== null && _b !== void 0 ? _b : "Untitled"}`,
                    desc: `Archive ${params.id} marked as removed.`,
                    action: 2,
                    documentId: (_c = existing.documentId) !== null && _c !== void 0 ? _c : undefined,
                },
            });
            return updated;
        }));
        return res.code(200).send({ message: "OK", id: result.id });
    }
    catch (error) {
        console.error("Error in removeArchive:", error);
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
exports.removeArchive = removeArchive;
const downloadArchiveFile = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    const params = req.query;
    if (!params.id)
        throw new errors_1.ValidationError("INVALID REQUIRED ID");
    try {
        const response = yield prisma_1.prisma.archiveDocument.findUnique({
            where: {
                id: params.id,
            },
            include: {
                document: {
                    select: {
                        file: true,
                    },
                },
            },
        });
        if (!response)
            throw new errors_1.NotFoundError("ARCHIVE NOT FOUND");
        const buffered = (_a = response.document) === null || _a === void 0 ? void 0 : _a.file;
        if (!buffered) {
            throw new errors_1.ValidationError("INVALID FILE FORMAT");
        }
        if (!buffered.fileDecoded) {
            throw new errors_1.ValidationError("FILE DATA IS MISSING OR CORRUPTED");
        }
        const fileBuffer = Buffer.from(buffered.fileDecoded);
        // Set headers for file download
        const filename = buffered.fileName ||
            `document_${params.id}.${((_b = buffered.fileType) === null || _b === void 0 ? void 0 : _b.split("/")[1]) || "bin"}`;
        res.header("Content-Type", buffered.fileType || "application/octet-stream");
        res.header("Content-Disposition", `attachment; filename="${filename}"`);
        res.header("Content-Length", fileBuffer.length.toString());
        // Send the file
        return res.code(200).send(fileBuffer);
    }
    catch (error) {
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw new errors_1.AppError("DB_CONNECTION", 500, "DB_FAILED");
        }
        throw error;
    }
});
exports.downloadArchiveFile = downloadArchiveFile;
const createDocumentRoute = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const body = req.body;
    if (!body.roomName || !body.lineId || !body.userId || !body.roomId) {
        throw new errors_1.ValidationError("INVALID REQUIRED ID");
    }
    try {
        const response = yield prisma_1.prisma.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            const room = yield tx.signatureQueueRoom.create({
                data: {
                    title: body.roomName,
                    receivingRoomId: body.roomId,
                    userId: body.userId,
                    status: 0,
                    step: 0,
                },
            });
            yield tx.documentActivityLogs.create({
                data: {
                    userId: body.userId,
                    lineId: body.lineId,
                    title: `Created Document Room - ${body.roomName}`,
                    desc: `Document Room "${body.roomName}" was created.`,
                    action: 1,
                },
            });
            return room.id;
        }));
        if (!response)
            throw new errors_1.ValidationError("TRANSACTION FAILED");
        return res.code(200).send({ id: response });
    }
    catch (error) {
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw new errors_1.AppError("DB_CONNECTION", 500, "DB_FAILED");
        }
        throw error;
    }
});
exports.createDocumentRoute = createDocumentRoute;
const routerInfo = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const params = req.query;
    console.log("Route: ", params);
    if (!params.id) {
        throw new errors_1.ValidationError("INVALID REQUIRED PARAMETERS");
    }
    try {
        const response = yield prisma_1.prisma.signatureQueueRoom.findUnique({
            where: {
                id: params.id,
            },
        });
        if (!response)
            throw new errors_1.NotFoundError("DATA NOT FOUND");
        return res.code(200).send(response);
    }
    catch (error) {
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw new errors_1.AppError("DB_CONNECTION", 500, "DB_FAILED");
        }
        throw error;
    }
});
exports.routerInfo = routerInfo;
/**
 * Generate an abstract from an uploaded file (PDF only — for now).
 * Runs entirely in-memory. Caps the file size at 10MB to avoid OOM and
 * limits the parsed text we feed the summarizer to ~3000 chars (the
 * model's effective input window).
 */
const generateAbstract = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, e_5, _b, _c;
    if (!req.isMultipart()) {
        throw new errors_1.ValidationError("Missing multipart payload");
    }
    // Abstract generation is memory-heavy (PDF parse + summarizer), so we
    // keep this cap lower than the archive upload limit. Big PDFs should
    // have the abstract typed in manually.
    const MAX_BYTES = 100 * 1024 * 1024; // 100MB
    try {
        let fileBuffer = null;
        let filename = "";
        let mimetype = "";
        try {
            for (var _d = true, _e = __asyncValues(req.parts()), _f; _f = yield _e.next(), _a = _f.done, !_a; _d = true) {
                _c = _f.value;
                _d = false;
                const part = _c;
                if (part.type === "file") {
                    fileBuffer = yield part.toBuffer();
                    filename = part.filename;
                    mimetype = part.mimetype;
                    break;
                }
            }
        }
        catch (e_5_1) { e_5 = { error: e_5_1 }; }
        finally {
            try {
                if (!_d && !_a && (_b = _e.return)) yield _b.call(_e);
            }
            finally { if (e_5) throw e_5.error; }
        }
        if (!fileBuffer) {
            throw new errors_1.ValidationError("No file uploaded");
        }
        if (fileBuffer.length > MAX_BYTES) {
            throw new errors_1.ValidationError(`File too large for in-server abstract generation (max ${(MAX_BYTES / 1024 / 1024).toFixed(0)}MB).`);
        }
        const isPdf = mimetype === "application/pdf" ||
            filename.toLowerCase().endsWith(".pdf");
        if (!isPdf) {
            throw new errors_1.ValidationError("Auto-abstract currently supports PDF files only. Type one in manually for other formats.");
        }
        const abstract = yield Embedding_1.embeddingService.generateAbstractFromBuffer(fileBuffer);
        return res.code(200).send({ abstract });
    }
    catch (error) {
        if (error instanceof errors_1.ValidationError)
            throw error;
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw new errors_1.AppError("DB_CONNECTION", 500, "DB_FAILED");
        }
        throw error;
    }
});
exports.generateAbstract = generateAbstract;
