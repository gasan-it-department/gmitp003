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
exports.searchUnit = exports.addUnit = void 0;
const prisma_1 = require("../barrel/prisma");
const errors_1 = require("../errors/errors");
const addUnit = () => __awaiter(void 0, void 0, void 0, function* () { });
exports.addUnit = addUnit;
const searchUnit = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const params = req.query;
    if (!params.id)
        throw new errors_1.ValidationError("INVALID REQUIRED ID");
    if (!params.query)
        return res.code(200).send({ list: [], hasMore: false, lastCursor: null });
    try {
        const cursor = params.lastCursor ? { id: params.lastCursor } : undefined;
        const limit = params.limit ? parseInt(params.limit, 10) : 20;
        const filter = {};
        if (params.query) {
            filter.name = {
                contains: params.query,
                mode: "insensitive",
            };
        }
        const response = yield prisma_1.prisma.department.findMany({
            where: Object.assign({ lineId: params.id }, filter),
            select: {
                idCode: true,
                id: true,
                name: true,
            },
        });
        const newLastCursorId = response.length > 0 ? response[response.length - 1].id : null;
        const hasMore = limit === response.length;
        return res
            .code(200)
            .send({ list: response, hasMore, lastCursor: newLastCursorId });
    }
    catch (error) {
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw new errors_1.AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
        }
        throw error;
    }
});
exports.searchUnit = searchUnit;
