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
Object.defineProperty(exports, "__esModule", { value: true });
exports.removeList = exports.deleteList = exports.listAccessUsers = exports.addListAccess = exports.listData = exports.list = exports.createList = void 0;
const prisma_1 = require("../barrel/prisma");
const errors_1 = require("../errors/errors");
const createList = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const body = req.body;
        console.log(body);
        if (!body.inventoryBoxId || !body.lineId || !body.title) {
            return res.code(400).send({ message: "Bad Request" });
        }
        yield prisma_1.prisma.supplyBatch.create({
            data: {
                title: body.title,
                inventoryBoxId: body.inventoryBoxId,
            },
        });
        return res.code(200).send({ message: "Ok" });
    }
    catch (error) {
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            // Handle unique constraint violation
            if (error.code === "P2002") {
                return res.status(409).send({
                    error: "Duplicate title",
                    fields: (_a = error.meta) === null || _a === void 0 ? void 0 : _a.target, // Will show ['title']
                });
            }
        }
        // Handle other errors
        return res.status(500).send({
            error: "Internal Server Error",
            message: "Something went wrong",
        });
    }
});
exports.createList = createList;
const list = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id, lastCursor, limit, query } = req.query;
        console.log("123", id, lastCursor, limit, query);
        const filter = {
            inventoryBoxId: id,
        };
        if (query) {
            filter.title = { contains: query, mode: "insensitive" };
        }
        const cursor = lastCursor ? { id: lastCursor } : undefined;
        const response = yield prisma_1.prisma.supplyBatch.findMany({
            where: filter,
            take: parseInt(limit, 10),
            skip: cursor ? 1 : 0,
            cursor,
            orderBy: {
                timestamp: "asc",
            },
            include: {
                _count: {
                    select: {
                        SupplyStockTrack: true,
                    },
                },
            },
        });
        const newLastCursorId = response.length > 0 ? response[response.length - 1].id : null;
        const hasMore = response.length === parseInt(limit, 10);
        return res
            .code(200)
            .send({ list: response, lastCursor: newLastCursorId, hasMore });
    }
    catch (error) {
        console.log(error);
        res.code(500).send({ message: "Internal Server Error" });
    }
});
exports.list = list;
const listData = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const params = req.query;
    if (!params.id)
        throw new errors_1.ValidationError();
    try {
        const data = yield prisma_1.prisma.supplyBatch.findUnique({
            where: {
                id: params.id,
            },
        });
        if (!data)
            throw new errors_1.NotFoundError();
        return res.code(200).send({ message: "OK", data });
    }
    catch (error) {
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw new errors_1.AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
        }
        throw error;
    }
});
exports.listData = listData;
const addListAccess = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const params = req.query;
    if (!params.containerId || !params.listId || !params.userId)
        throw new errors_1.ValidationError();
    try {
        const [user, list] = yield prisma_1.prisma.$transaction([
            prisma_1.prisma.user.findUnique({
                where: {
                    id: params.userId,
                },
            }),
            prisma_1.prisma.supplyBatch.findUnique({
                where: {
                    id: params.listId,
                },
            }),
        ]);
        if (!user || !list)
            throw new errors_1.NotFoundError();
        yield prisma_1.prisma.$transaction([
            prisma_1.prisma.inventoryAccessLogs.create({
                data: {
                    inventoryBoxId: params.containerId,
                    userId: params.userId,
                    action: `Allowed ${user.username} to access list: ${list.title}`,
                },
            }),
            prisma_1.prisma.supplyBatchAccess.create({
                data: {
                    userId: params.userId,
                    supplyBatchId: params.listId,
                },
            }),
        ]);
        res.code(200).send({ message: "OK" });
    }
    catch (error) {
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw new errors_1.AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
        }
        throw error;
    }
});
exports.addListAccess = addListAccess;
const listAccessUsers = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const params = req.query;
    if (!params.id)
        throw new errors_1.ValidationError();
    try {
        const cursor = params.lastCursor ? { id: params.lastCursor } : undefined;
        const filter = {};
        if (params.query) {
            filter.user = {
                firstName: { contains: params.query, mode: "insensitive" },
                lastName: { contains: params.query, mode: "insensitive" },
                username: { contains: params.query, mode: "insensitive" },
            };
        }
        const response = yield prisma_1.prisma.supplyBatchAccess.findMany({
            where: {
                user: filter,
            },
            include: {
                user: {
                    select: {
                        id: true,
                        firstName: true,
                        lastName: true,
                        username: true,
                    },
                },
            },
            skip: cursor ? 1 : 0,
            take: parseInt(params.limit, 10),
            cursor,
        });
        const newLastCursorId = response.length > 0 ? response[response.length - 1].id : null;
        const hasMore = response.length === parseInt(params.limit, 10);
        return res
            .code(200)
            .send({ list: response, lastCursor: newLastCursorId, hasMore });
    }
    catch (error) {
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw new errors_1.AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
        }
        throw error;
    }
});
exports.listAccessUsers = listAccessUsers;
const deleteList = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const params = req.query;
    if (!params.id || !params.containerId || !params.userId)
        throw new errors_1.ValidationError();
    try {
        const [list] = yield prisma_1.prisma.$transaction([
            prisma_1.prisma.supplyBatch.findUnique({
                where: {
                    id: params.id,
                },
            }),
        ]);
        if (!list)
            throw new errors_1.NotFoundError();
        yield prisma_1.prisma.$transaction([
            prisma_1.prisma.inventoryAccessLogs.create({
                data: {
                    inventoryBoxId: params.containerId,
                    userId: params.userId,
                    action: `DELETED List: ${list.title}`,
                },
            }),
            prisma_1.prisma.supplyBatchAccess.delete({
                where: {
                    id: params.id,
                },
            }),
        ]);
        return res.code(200).send({ message: "OK" });
    }
    catch (error) {
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw new errors_1.AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
        }
        throw error;
    }
});
exports.deleteList = deleteList;
const removeList = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const params = req.query;
    if (!params.id || !params.userId || !params.lineId)
        throw new errors_1.ValidationError("INVALID REQUIRED ID");
    try {
        const response = yield prisma_1.prisma.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            const list = yield tx.supplyBatch.delete({
                where: {
                    id: params.id,
                },
            });
            yield tx.inventoryLogs.create({
                data: {
                    userId: params.userId,
                    lineId: params.lineId,
                    action: 4,
                    desc: `ROMOVE: List - (${list.title})`,
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
            throw new errors_1.AppError("DB_CONNECTION_ERROR", 500, "DB_FAILED");
        }
        throw error;
    }
});
exports.removeList = removeList;
