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
exports.generateAbstract = exports.routerInfo = exports.createDocumentRoute = exports.downloadArchiveFile = exports.archiveDetail = exports.updateRoomStatus = exports.removeRoom = exports.room = exports.rooms = exports.archiveFile = exports.searchArchiveDocs = exports.searchArchiveDocsAI = exports.archives = exports.roomRequestDetails = exports.deleteRoomRequest = exports.updateStatus = exports.roomRequest = exports.signatoryRegistry = exports.roomRegister = exports.authorizedUsers = exports.addDocument = void 0;
const prisma_1 = require("../barrel/prisma");
const errors_1 = require("../errors/errors");
const Embedding_1 = require("../service/Embedding");
const fs_1 = __importDefault(require("fs"));
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
const path_1 = __importDefault(require("path"));
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
        const cursor = params.lastCursor ? { id: params.id } : undefined;
        const limit = params.limit ? parseInt(params.limit, 10) : 20;
        // Start with base filter
        const filter = {
            lineId: params.id,
        };
        // Add status filter if provided
        if (params.status &&
            typeof params.status === "string" &&
            params.status !== "all") {
            filter.status = parseInt(params.status, 10);
        }
        // Add search filter if query provided
        if (params.query && params.query.trim()) {
            const searchTerms = params.query.trim().split(/\s+/);
            const searchQuery = params.query.trim();
            // Create user filter for the relation
            filter.user = {
                OR: [
                    // Search in firstname
                    { firstName: { contains: searchQuery, mode: "insensitive" } },
                    // Search in lastname
                    { lastName: { contains: searchQuery, mode: "insensitive" } },
                    // Search in email
                    { email: { contains: searchQuery, mode: "insensitive" } },
                    // Search in username if exists
                    { username: { contains: searchQuery, mode: "insensitive" } },
                    // Also search address directly on roomRegistration
                ],
            };
            // If multiple search terms, also search for combinations
            if (searchTerms.length > 1) {
                // Add AND conditions for each term (more strict search)
                filter.user.OR.push({
                    AND: searchTerms.map((term) => ({
                        OR: [
                            { firstName: { contains: term, mode: "insensitive" } },
                            { lastName: { contains: term, mode: "insensitive" } },
                        ],
                    })),
                });
            }
        }
        console.log("Filter:", JSON.stringify(filter, null, 2));
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
            const room = yield tx.receivingRoom.create({
                data: {
                    address: request.address,
                    code: `RM-${Math.random().toString(36).slice(2, 9).toUpperCase()}`,
                    lineId: request.lineId,
                },
            });
            if (body.status === 1) {
                yield tx.roomAuthorizedUser.createMany({
                    data: request.authorizedUser.map((item) => {
                        return {
                            userId: item.userId,
                            type: item.type,
                            receivingRoomId: room.id,
                        };
                    }),
                });
                yield tx.notification.create({
                    data: {
                        recipientId: request.userId,
                        content: `You can now access and manage Document.`,
                        title: "Document Room Approved",
                        senderId: body.userId,
                    },
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
    const params = req.query;
    if (!params.id) {
        throw new errors_1.ValidationError("INVALID REQUIRED ID");
    }
    try {
        const response = yield prisma_1.prisma.roomRegistration.findUnique({
            where: {
                id: params.id,
            },
            include: {
                authorizedUser: {
                    select: {
                        id: true,
                        userId: true,
                        user: {
                            select: {
                                lastName: true,
                                firstName: true,
                                username: true,
                            },
                        },
                    },
                },
                roomRegistrationSignatures: true,
                user: {
                    select: {
                        username: true,
                        lastName: true,
                        firstName: true,
                        id: true,
                    },
                },
            },
        });
        if (!response) {
            throw new errors_1.NotFoundError("REQUEST NOT FOUND");
        }
        return res.code(200).send(response);
    }
    catch (error) {
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw new errors_1.AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
        }
        throw error;
    }
});
exports.roomRequestDetails = roomRequestDetails;
const archives = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const params = req.query;
    if (!params.id) {
        throw new errors_1.ValidationError("INVALID REQUIRED ID");
    }
    try {
        const limit = params.limit ? parseInt(params.limit, 10) : 20;
        const searchTerms = params.query;
        const where = {
            lineId: params.id,
        };
        if (searchTerms && searchTerms.trim()) {
            where.abstract = {
                content: {
                    contains: searchTerms,
                    mode: "insensitive",
                },
            };
        }
        const cursor = params.lastCursor ? { id: params.lastCursor } : undefined;
        const response = yield prisma_1.prisma.archiveDocument.findMany({
            take: limit,
            skip: cursor ? 1 : 0,
            cursor,
            orderBy: {
                timestamp: "desc",
            },
            select: {
                id: true,
                lineId: true,
                abstract: true,
                timestamp: true,
                docType: true,
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
const searchArchiveDocsAI = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    const params = req.query;
    console.log("Search Archives: ", { params });
    try {
        const cursor = params.lastCursor ? { id: params.lastCursor } : undefined;
        const limit = params.limit ? parseInt(params.limit, 10) : 20;
        const lineId = params.lineId;
        const roomId = params.id;
        const searchQuery = (_a = params.query) === null || _a === void 0 ? void 0 : _a.trim();
        yield Embedding_1.embeddingService.initialize();
        const similar = params.query
            ? yield Embedding_1.embeddingService.findSimilar(params.query, roomId, 20)
            : [];
        // Build search conditions for abstract content
        // const buildAbstractSearch = () => {
        //   if (!searchQuery) return {};
        //   const searchTerms = searchQuery
        //     .split(/\s+/)
        //     .filter((term) => term.length > 0);
        //   if (searchTerms.length === 1) {
        //     return {
        //       abstract: {
        //         content: {
        //           contains: searchTerms[0],
        //           mode: "insensitive" as const,
        //         },
        //       },
        //     };
        //   }
        //   // For multiple terms, match if any term is present in abstract
        //   return {
        //     OR: searchTerms.map((term) => ({
        //       abstract: {
        //         content: {
        //           contains: term,
        //           mode: "insensitive" as const,
        //         },
        //       },
        //     })),
        //   };
        // };
        // const response = await prisma.$transaction(async (tx) => {
        //   const abstractSearch = buildAbstractSearch();
        //   const roomArchive = await tx.archiveDocument.findMany({
        //     where: {
        //       receivingRoomId: roomId,
        //       ...(searchQuery && abstractSearch),
        //     },
        //     take: limit,
        //     skip: cursor ? 1 : 0,
        //     cursor,
        //     orderBy: {
        //       timestamp: "desc",
        //     },
        //     select: {
        //       id: true,
        //       lineId: true,
        //       abstract: true,
        //       timestamp: true,
        //       document: {
        //         select: {
        //           title: true,
        //           id: true,
        //         },
        //       },
        //     },
        //   });
        //   // Other archives search - from same line but different rooms
        //   const otherArchives = await tx.archiveDocument.findMany({
        //     where: {
        //       lineId: lineId,
        //       receivingRoomId: {
        //         not: roomId,
        //       },
        //       ...(searchQuery && abstractSearch),
        //     },
        //     take: limit,
        //     skip: cursor ? 1 : 0,
        //     cursor,
        //     orderBy: {
        //       timestamp: "desc",
        //     },
        //     select: {
        //       id: true,
        //       lineId: true,
        //       abstract: true,
        //       timestamp: true,
        //       document: {
        //         select: {
        //           title: true,
        //           id: true,
        //         },
        //       },
        //     },
        //   });
        //   return [...roomArchive, ...otherArchives];
        // });
        // // Sort combined results by timestamp
        // const sortedResponse = response.sort(
        //   (a, b) =>
        //     new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
        // );
        const newLastCursor = similar.length > 0 ? similar[similar.length - 1].id : null;
        const hasMore = similar.length === limit;
        return res.code(200).send({
            list: similar,
            hasMore,
            lastCursor: newLastCursor,
        });
    }
    catch (error) {
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw new errors_1.AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
        }
        throw error;
    }
});
exports.searchArchiveDocsAI = searchArchiveDocsAI;
const searchArchiveDocs = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    const params = req.query;
    console.log("Reg", { params });
    try {
        const cursor = params.lastCursor ? { id: params.lastCursor } : undefined;
        const limit = params.limit ? parseInt(params.limit, 10) : 20;
        const lineId = params.lineId;
        const roomId = params.id;
        const filter = {};
        const searchQuery = (_a = params.query) === null || _a === void 0 ? void 0 : _a.trim();
        if (searchQuery) {
            filter.document = {
                title: {
                    contains: searchQuery,
                    mode: "insensitive",
                },
            };
        }
        const response = yield prisma_1.prisma.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            const lineArchives = yield tx.archiveDocument.findMany({
                where: Object.assign({ lineId: lineId }, filter),
                take: limit,
                cursor,
            });
            const roomAcrhives = yield tx.archiveDocument.findMany({
                where: Object.assign({ receivingRoomId: roomId }, filter),
                take: limit,
                cursor,
            });
            return [...roomAcrhives, ...lineArchives];
        }));
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
    const isMultipart = req.isMultipart();
    if (!isMultipart)
        throw new errors_1.ValidationError("INVALID MULTIPARTS");
    try {
        const parts = req.parts();
        let file;
        const formData = {};
        try {
            for (var _g = true, parts_2 = __asyncValues(parts), parts_2_1; parts_2_1 = yield parts_2.next(), _a = parts_2_1.done, !_a; _g = true) {
                _c = parts_2_1.value;
                _g = false;
                let part = _c;
                if (part.type === "file") {
                    const buffers = [];
                    try {
                        for (var _h = true, _j = (e_4 = void 0, __asyncValues(part.file)), _k; _k = yield _j.next(), _d = _k.done, !_d; _h = true) {
                            _f = _k.value;
                            _h = false;
                            const chunk = _f;
                            buffers.push(chunk);
                        }
                    }
                    catch (e_4_1) { e_4 = { error: e_4_1 }; }
                    finally {
                        try {
                            if (!_h && !_d && (_e = _j.return)) yield _e.call(_j);
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
                if (!_g && !_a && (_b = parts_2.return)) yield _b.call(parts_2);
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
        const fileType = (0, document_1.getFileType)({
            mimetype: file.mimetype,
            filename: file.filename,
            buffer: file.buffer,
        });
        const docTypeIndex = formData.docType ? parseInt(formData.docType, 10) : 0;
        const docType = helper_1.archiveDocType[docTypeIndex];
        const response = yield prisma_1.prisma.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            var _a, _b;
            const doc = yield tx.document.create({
                data: {
                    file: {
                        create: {
                            fileName: file.filename,
                            fileDecoded: file.buffer,
                            fileSize: file.buffer.length.toString(),
                            fileType: fileType,
                        },
                    },
                    docType: docTypeIndex,
                    size: file.buffer.length,
                    title: formData.title,
                    lineId: formData.lineId,
                    userId: formData.userId,
                    receivingRoomId: formData.receivingRoomId,
                },
            });
            const abstractVector = yield Embedding_1.embeddingService.generateEmbedding(formData.abstract);
            const titleVector = yield Embedding_1.embeddingService.generateEmbedding(formData.title);
            const typeVector = yield Embedding_1.embeddingService.generateEmbedding(docType);
            yield tx.archiveDocument.create({
                data: {
                    abstract: {
                        create: {
                            content: formData.abstract,
                            title: `${formData.title}`,
                            embedding: {
                                create: {
                                    vector: [...abstractVector, ...titleVector, ...typeVector],
                                    model: "Xenova/all-MiniLM-L6-v2",
                                    dimensions: 384,
                                },
                            },
                        },
                    },
                    receivingRoom: {
                        connect: {
                            id: formData.receivingRoomId,
                        },
                    },
                    document: {
                        connect: {
                            id: doc.id,
                        },
                    },
                    line: {
                        connect: {
                            id: formData.lineId,
                        },
                    },
                },
            });
            yield tx.documentActivityLogs.create({
                data: {
                    userId: formData.userId,
                    lineId: formData.lineId,
                    title: `Archived - ${file.filename}`,
                    desc: `Document "${formData.title}" was archived with abstract: ${(_a = formData.abstract) === null || _a === void 0 ? void 0 : _a.substring(0, 50)}${((_b = formData.abstract) === null || _b === void 0 ? void 0 : _b.length) > 50 ? "..." : ""}`,
                    action: 1,
                    documentId: doc.id,
                },
            });
            return true;
        }));
        if (!response)
            throw new errors_1.ValidationError("TRANSACTION FAILED");
        return res.code(200).send("OK");
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
    if (!params.id) {
        throw new errors_1.ValidationError("INVALID REQUIRED ID");
    }
    try {
        const cursor = params.lastCursor ? { id: params.lastCursor } : undefined;
        const limit = params.limit ? parseInt(params.limit) : 20;
        const response = yield prisma_1.prisma.receivingRoom.findMany({
            where: {
                lineId: params.id,
            },
            take: limit,
            skip: cursor ? 1 : 0,
            orderBy: {
                timestamp: "desc",
            },
        });
        const newLastCursorId = response.length > 0 ? response[response.length - 1].id : null;
        const hasMore = response.length === limit;
        return res
            .code(200)
            .send({ list: response, lastCursor: newLastCursorId, hasMore });
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
    if (!params.id) {
        throw new errors_1.ValidationError("INVALID REQUIRED ID");
    }
    try {
        const response = yield prisma_1.prisma.receivingRoom.findUnique({
            where: {
                id: params.id,
            },
        });
        if (!response) {
            throw new errors_1.NotFoundError("ROOM NOT FOUND");
        }
        return res.code(200).send(response);
    }
    catch (error) {
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw new errors_1.AppError("DB_CONNECTION", 500, "DB_FAILED");
        }
        throw error;
    }
});
exports.room = room;
const removeRoom = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const params = req.query;
    if (!params.id || !params.lineId || !params.userId) {
        throw new errors_1.ValidationError("INVALID REQUIRED ID");
    }
    try {
        const response = yield prisma_1.prisma.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            const room = yield tx.receivingRoom.delete({
                where: {
                    id: params.id,
                },
            });
            yield tx.humanResourcesLogs.create({
                data: {
                    action: "DELETE",
                    desc: `REMOVE RECEIVING ROOM: ${room.address}-${room.code}`,
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
    try {
        const response = yield prisma_1.prisma.archiveDocument.findUnique({
            where: {
                id: params.id,
            },
            include: {
                abstract: true,
            },
        });
        if (!response) {
            throw new errors_1.NotFoundError("ARCHIVE NOT FOUND");
        }
        return res.code(200).send(response);
    }
    catch (error) {
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw new errors_1.AppError("DB_CONNECTION", 500, "DB_FAILED");
        }
        throw error;
    }
});
exports.archiveDetail = archiveDetail;
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
const generateAbstract = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, e_5, _b, _c;
    if (!req.isMultipart()) {
        throw new errors_1.ValidationError("INVALID REQUIRED FIELD");
    }
    try {
        const parts = req.parts();
        console.log("Gen. Abstract: ", parts);
        const tmpDir = path_1.default.join(process.cwd(), "tmp_uploads");
        // Ensure tmp directory exists
        if (!fs_1.default.existsSync(tmpDir)) {
            fs_1.default.mkdirSync(tmpDir, { recursive: true });
        }
        let fileBuffer = null;
        let filename = "";
        try {
            for (var _d = true, parts_3 = __asyncValues(parts), parts_3_1; parts_3_1 = yield parts_3.next(), _a = parts_3_1.done, !_a; _d = true) {
                _c = parts_3_1.value;
                _d = false;
                let part = _c;
                if (part.type === "file") {
                    fileBuffer = yield part.toBuffer(); // Get the buffer from the part
                    filename = part.filename;
                    break; // Exit after getting the first file
                }
            }
        }
        catch (e_5_1) { e_5 = { error: e_5_1 }; }
        finally {
            try {
                if (!_d && !_a && (_b = parts_3.return)) yield _b.call(parts_3);
            }
            finally { if (e_5) throw e_5.error; }
        }
        if (!fileBuffer) {
            throw new errors_1.ValidationError("NO_FILE_UPLOADED");
        }
        const safe = filename.replace(/[^\w.-]/g, "_");
        const tmpPath = path_1.default.join(tmpDir, safe);
        // Write buffer to file
        fs_1.default.writeFileSync(tmpPath, fileBuffer);
        // Generate abstract
        const response = yield Embedding_1.embeddingService.generateAbstractFromPDF(tmpPath);
        // Clean up
        fs_1.default.unlinkSync(tmpPath);
        console.log({ abstract: response });
        return res.code(200).send({ abstract: response });
    }
    catch (error) {
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw new errors_1.AppError("DB_CONNECTION", 500, "DB_FAILED");
        }
        throw error;
    }
});
exports.generateAbstract = generateAbstract;
