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
exports.addSupplier = exports.getSuppliers = void 0;
const prisma_1 = require("../barrel/prisma");
const errors_1 = require("../errors/errors");
const getSuppliers = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const params = req.query;
    if (!params.id)
        throw new errors_1.ValidationError("BAD_REQUEST");
    if (!params.query)
        return res.code(200).send({ list: [], lastCursor: null, hasMore: false });
    try {
        const cursor = params.lastCursor ? { id: params.lastCursor } : undefined;
        const limit = params.limit
            ? parseInt(params.limit)
            : 10;
        const response = yield prisma_1.prisma.supplier.findMany({
            take: limit,
            skip: cursor ? 1 : 0,
            cursor: cursor,
            orderBy: { id: "asc" },
            where: {
                name: {
                    contains: params.query,
                    mode: "insensitive",
                },
            },
        });
        const newLastCursorId = response.length > 0 ? response[response.length - 1].id : null;
        const hasMore = response.length === limit;
        return res
            .status(200)
            .send({ list: response, lastCursor: newLastCursorId, hasMore });
    }
    catch (error) {
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw new errors_1.AppError("DATABASE_CONNECTION_ERROR", 500, "DB_FAILED");
        }
        throw error;
    }
});
exports.getSuppliers = getSuppliers;
const addSupplier = (name, lineId) => __awaiter(void 0, void 0, void 0, function* () {
    if (!name)
        throw new errors_1.ValidationError("BAD_REQUEST");
    try {
        const data = yield prisma_1.prisma.supplier.create({
            data: {
                name: name,
                lineId: lineId,
            },
        });
        return data;
    }
    catch (error) {
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw new errors_1.AppError("DATABASE_CONNECTION_ERROR", 500, "DB_FAILED");
        }
        throw error;
    }
});
exports.addSupplier = addSupplier;
