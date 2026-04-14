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
exports.removeContainer = exports.inventoryLogs = exports.inventoryLogsAccessList = exports.viewContainerAuth = exports.createInventory = exports.inventories = void 0;
const prisma_1 = require("../barrel/prisma");
const handler_1 = require("../middleware/handler");
const errors_1 = require("../errors/errors");
const inventories = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const params = req.query;
        const { lastCursor, limit, query, departId, userId } = params;
        const filter = {};
        const cursor = lastCursor ? { id: lastCursor } : undefined;
        if (query) {
            const searchTerms = query.trim().split(/\s+/); // Split on any whitespace
            if (searchTerms.length === 1) {
                filter.OR = [
                    { name: { contains: searchTerms[0], mode: "insensitive" } },
                    { code: { contains: searchTerms[0], mode: "insensitive" } },
                ];
            }
            else {
                filter.AND = searchTerms.map((term) => ({
                    OR: [
                        { name: { contains: term, mode: "insensitive" } },
                        { code: { contains: term, mode: "insensitive" } },
                    ],
                }));
            }
        }
        if (userId) {
            filter.userId = userId;
        }
        if (departId) {
            filter.departmentId = departId;
        }
        const response = yield prisma_1.prisma.inventoryBox.findMany({
            where: Object.assign({}, filter),
            cursor,
            take: parseInt(limit, 10),
            skip: cursor ? 1 : 0,
        });
        const nextLastCursorId = response.length > 0 ? response[response.length - 1].id : null;
        const hasMore = response.length === 20;
        res
            .code(200)
            .send({ list: response, lastCursor: nextLastCursorId, hasMore });
    }
    catch (error) {
        console.log(error);
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw new errors_1.AppError("DB_CONNECTION_ERROR", 500, "DB_ERROR");
        }
        throw error;
    }
});
exports.inventories = inventories;
const createInventory = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const body = req.body;
        console.log({ body });
        if (!body.name) {
            return res.code(400).send({ message: "Bad Request 12" });
        }
        const check = yield prisma_1.prisma.inventoryBox.findUnique({
            where: {
                name: body.name,
            },
        });
        if (check) {
            return res
                .code(400)
                .send({ message: "This Inventory Container already exist!" });
        }
        const code = yield (0, handler_1.generatedBoxCode)();
        const response = yield prisma_1.prisma.inventoryBox.create({
            data: {
                name: body.name,
                code: code,
                lineId: body.lineId,
                userId: body.userId,
                departmentId: body.departmentId || null,
                createdAt: new Date(),
            },
        });
        if (!response)
            throw new errors_1.ValidationError("TRANSACTION FAILED");
        yield prisma_1.prisma.containerAllowedUser.create({
            data: {
                inventoryBoxId: response.id,
                userId: response.userId,
                grantByUserId: response.userId,
            },
        });
        res.code(200).send({ message: "OK", data: response });
    }
    catch (error) {
        console.log(error);
        res.code(500).send({ message: "Internal Server Error" });
    }
});
exports.createInventory = createInventory;
const viewContainerAuth = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const params = req.query;
    console.log("Containers: ", { params });
    if (!params.id || !params.userId) {
        throw new errors_1.ValidationError("INVALID REQUIRED FIELDS");
    }
    try {
        const response = yield prisma_1.prisma.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            const checkPrev = yield tx.module.findFirst({
                where: {
                    userId: params.userId,
                    moduleName: "supplies",
                },
            });
            if (!checkPrev) {
                throw new errors_1.UnauthorizedError("INVALID ACCESS");
            }
            const data = yield tx.inventoryBox.findUnique({
                where: {
                    id: params.id,
                },
                select: {
                    batch: true,
                    id: true,
                    name: true,
                    code: true,
                    createdBy: {
                        select: {
                            username: true,
                        },
                    },
                    createdAt: true,
                },
            });
            return data;
        }));
        console.log({ response });
        if (!response) {
            throw new errors_1.NotFoundError("DATA NOT FOUND!");
        }
        return res.code(200).send({ message: "OK", data: response });
    }
    catch (error) {
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw new errors_1.AppError("DB_CONNECTION_ERROR", 500, "DB_FAILED");
        }
        throw error;
    }
});
exports.viewContainerAuth = viewContainerAuth;
const inventoryLogsAccessList = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id, lastCursor, limit, query } = req.query;
        if (!id) {
            return res.code(400).send({ message: "Bad Request" });
        }
        const filter = {};
        const cursor = lastCursor ? { id: lastCursor } : undefined;
        if (query) {
            const searchTerms = query.trim().split(/\s+/); // Split on any whitespace
            if (searchTerms.length === 1) {
                filter.OR = [
                    { lastName: { contains: searchTerms[0], mode: "insensitive" } },
                    { firstName: { contains: searchTerms[0], mode: "insensitive" } },
                    { middleName: { contains: searchTerms[0], mode: "insensitive" } },
                ];
            }
            else {
                filter.AND = searchTerms.map((term) => ({
                    OR: [
                        { firstname: { contains: term, mode: "insensitive" } },
                        { lastname: { contains: term, mode: "insensitive" } },
                    ],
                }));
                filter.OR = [
                    { AND: filter.AND },
                    { middleName: { contains: query.trim(), mode: "insensitive" } },
                ];
                delete filter.AND; // Remove the AND since we've incorporated it into OR
            }
        }
        const response = yield prisma_1.prisma.containerAllowedUser.findMany({
            where: {
                user: filter,
                inventoryBoxId: id,
            },
            cursor,
            take: parseInt(limit, 10),
            skip: cursor ? 1 : 0,
            select: {
                id: true,
                timestamp: true,
                grantBy: {
                    select: {
                        lastName: true,
                        firstName: true,
                        middleName: true,
                        id: true,
                    },
                },
                user: {
                    select: {
                        lastName: true,
                        firstName: true,
                        middleName: true,
                        id: true,
                        email: true,
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
exports.inventoryLogsAccessList = inventoryLogsAccessList;
const inventoryLogs = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const params = req.query;
    if (!params.id)
        throw new errors_1.ValidationError("INVALID REQUIRED ID");
    try {
        const cursor = params.lastCursor ? { id: params.id } : undefined;
        const limit = params.limit ? parseInt(params.limit, 10) : 20;
        const response = yield prisma_1.prisma.supplyTransaction.findMany({
            where: {
                inventoryBoxId: params.id,
            },
            skip: cursor ? 1 : 0,
            take: limit,
            orderBy: {
                timestamp: "desc",
            },
            cursor,
        });
        const newLastCursorId = response.length > 0 ? response[response.length - 1].id : null;
        const hasMore = limit === response.length;
        return res
            .code(200)
            .send({ list: response, lastCursor: newLastCursorId, hasMore });
    }
    catch (error) {
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw new errors_1.AppError("DB_CONNECTION_ERROR", 500, "DB_FAILED");
        }
        throw error;
    }
});
exports.inventoryLogs = inventoryLogs;
const removeContainer = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id, userId } = req.query;
        console.log({ id, userId });
        if (!id || !userId) {
            return res.code(400).send({ message: "Bad Request" });
        }
        const response = yield prisma_1.prisma.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            const items = yield tx.supplies.count({
                where: {
                    inventoryBoxId: id,
                },
            });
            const stocks = yield tx.supplyStockTrack.count({
                where: {
                    inventoryBoxId: id,
                },
            });
            const dispensedLogs = yield tx.supplyDispenseRecord.count({
                where: {
                    inventoryBoxId: id,
                },
            });
            const recievedItems = yield tx.supplieRecieveHistory.count({
                where: {
                    inventoryBoxId: id,
                },
            });
            if (items > 0 || stocks > 0 || dispensedLogs > 0 || recievedItems > 0) {
                throw new errors_1.ValidationError("CANNOT DELETE CONTAINER WITH EXISTING RECORDS");
            }
            // const lists = await tx.
            const container = yield tx.inventoryBox.delete({
                where: {
                    id,
                },
            });
            yield tx.inventoryLogs.create({
                data: {
                    userId,
                    action: 4,
                    lineId: container.lineId,
                    desc: `Container Removed - ${container.name} (${container.code}) | Remaining Items: ${items} | Remaining Stocks: ${stocks} | `,
                },
            });
            yield tx.inventoryAccessLogs.create({
                data: {
                    userId,
                    action: "REMOVED CONTAINER",
                },
            });
            return true;
        }));
        if (!response) {
            throw new errors_1.ValidationError("TRANSACTION FAILED");
        }
        return res.code(200).send({ message: "Container removed successfully" });
    }
    catch (error) {
        console.log(error);
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw new errors_1.AppError("DB_CONNECTION_ERROR", 500, "DB_FAILED");
        }
        throw error;
    }
});
exports.removeContainer = removeContainer;
