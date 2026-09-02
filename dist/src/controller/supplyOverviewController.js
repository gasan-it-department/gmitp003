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
        const take = limit ? parseInt(limit, 10) : 20;
        const cursor = lastCursor ? { id: lastCursor } : undefined;
        // Build search filter on Supplies (item name / refNumber)
        const searchFilter = {};
        if (query) {
            const terms = query.trim().split(/\s+/);
            if (terms.length === 1) {
                searchFilter.OR = [
                    { item: { contains: terms[0], mode: "insensitive" } },
                    { refNumber: { contains: terms[0], mode: "insensitive" } },
                ];
            }
            else {
                searchFilter.AND = terms.map((term) => ({
                    OR: [
                        { item: { contains: term, mode: "insensitive" } },
                        { refNumber: { contains: term, mode: "insensitive" } },
                    ],
                }));
            }
        }
        // Pull Supplies that have any SupplyStockTrack in this batch/list,
        // including just those stock-track rows + their latest brand & price.
        const supplies = yield prisma_1.prisma.supplies.findMany({
            where: Object.assign(Object.assign({}, searchFilter), { SupplyStockTrack: {
                    some: { supplyBatchId: id },
                } }),
            take,
            skip: cursor ? 1 : 0,
            cursor,
            orderBy: { item: "asc" },
            include: {
                SupplyStockTrack: {
                    where: { supplyBatchId: id },
                    orderBy: { timestamp: "desc" },
                    include: {
                        brand: {
                            select: { brand: true, model: true },
                            orderBy: { timestamp: "desc" },
                            take: 1,
                        },
                        supplier: {
                            select: { id: true, name: true },
                        },
                    },
                },
                SupplyPriceTrack: {
                    select: { value: true, timestamp: true },
                    orderBy: { timestamp: "desc" },
                    take: 1,
                },
            },
        });
        // Attach a computed `totalStock` per supply
        const list = supplies.map((s) => {
            var _a;
            const tracks = (_a = s.SupplyStockTrack) !== null && _a !== void 0 ? _a : [];
            const totalStock = tracks.reduce((sum, t) => { var _a; return sum + ((_a = t.quantity) !== null && _a !== void 0 ? _a : 0) * (t.perQuantity || 1); }, 0);
            return Object.assign(Object.assign({}, s), { totalStock });
        });
        const newLastCursorId = list.length > 0 ? list[list.length - 1].id : null;
        const hasMore = list.length === take;
        return res.code(200).send({
            list,
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
