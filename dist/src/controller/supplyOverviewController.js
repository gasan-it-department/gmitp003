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
exports.supplyOverviewStatus = exports.supplyOverview = void 0;
const prisma_1 = require("../barrel/prisma");
const errors_1 = require("../errors/errors");
const supplyOverview = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const params = req.query;
    if (!params.id) {
        throw new errors_1.ValidationError("BAD_REQUEST");
    }
    try {
        const { lastCursor, limit, query, id } = params;
        const filter = {};
        if (query) {
            const searchTerms = query.trim().split(/\s+/); // Split on any whitespace
            if (searchTerms.length === 1) {
                filter.OR = [
                    { item: { contains: searchTerms[0], mode: "insensitive" } },
                    { refNumber: { contains: searchTerms[0], mode: "insensitive" } },
                ];
            }
            else {
                filter.AND = searchTerms.map((term) => ({
                    OR: [
                        { item: { contains: term, mode: "insensitive" } },
                        { refNumber: { contains: term, mode: "insensitive" } },
                    ],
                }));
                filter.OR = [
                    { item: filter.AND },
                    { refNumber: { contains: query.trim(), mode: "insensitive" } },
                ];
                delete filter.AND; // Remove the AND since we've incorporated it into OR
            }
        }
        const cursor = lastCursor ? { id: lastCursor } : undefined;
        const items = yield prisma_1.prisma.supplyStockTrack.findMany({
            where: {
                supply: filter,
                supplyBatchId: id,
            },
            take: parseInt(limit),
            skip: cursor ? 1 : 0,
            cursor: cursor,
            orderBy: {
                timestamp: "desc",
            },
            include: {
                brand: {
                    select: {
                        brand: true,
                    },
                    orderBy: {
                        timestamp: "desc",
                    },
                    take: 1,
                },
                price: {
                    select: {
                        value: true,
                    },
                    orderBy: {
                        timestamp: "desc",
                    },
                    take: 1,
                },
                supply: {
                    select: {
                        item: true,
                        id: true,
                        refNumber: true,
                    },
                },
            },
        });
        const newLastCursorId = items.length > 0 ? items[items.length - 1].id : null;
        const hasMore = items.length === parseInt(limit);
        return res.code(200).send({
            list: items,
            lastCursor: newLastCursorId,
            hasMore,
        });
    }
    catch (error) {
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw new errors_1.AppError("Database operation failed");
        }
        throw error;
    }
});
exports.supplyOverview = supplyOverview;
const supplyOverviewStatus = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const params = req.query;
    if (!params)
        throw new errors_1.ValidationError("INVALID REQUIRED ID");
    try {
        const response = yield prisma_1.prisma.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            const total = yield tx.supplyStockTrack.count({
                where: {
                    supplyBatchId: params.listId,
                },
            });
            const lowStock = yield tx.supplyStockTrack.count({
                where: {
                    supplyBatchId: params.listId,
                    stock: {
                        lt: 10,
                    },
                },
            });
            const order = yield tx.supplyBatchOrder.count({
                where: {
                    supplyBatchId: params.listId,
                    status: 0,
                },
            });
            return { total, lowStock, order };
        }));
        if (!response)
            throw new errors_1.ValidationError("DATA FAILED TO PARSED");
        return res.code(200).send(response);
    }
    catch (error) {
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw new errors_1.AppError("DB_CONNECTION_ERROR", 500, "DB_ERROR");
        }
    }
});
exports.supplyOverviewStatus = supplyOverviewStatus;
