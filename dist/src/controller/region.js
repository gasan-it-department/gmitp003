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
exports.getProvince = exports.getRegions = exports.regionController = void 0;
const prisma_1 = require("../barrel/prisma");
const errors_1 = require("../errors/errors");
const regionController = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const param = req.query;
        console.log();
        const cursor = param.lastCursor ? { id: param.lastCursor } : undefined;
        console.log({ param, cursor });
        const data = yield prisma_1.prisma.region.findMany({
            take: 5,
            cursor,
            skip: cursor ? 1 : 0,
        });
        console.log(data);
        const newLastCursorId = data.length > 0 ? data[data.length - 1].id : null;
        const hasMore = data.length === 20;
        return res
            .code(200)
            .send({ list: data, lastCursor: newLastCursorId, hasMore });
    }
    catch (error) {
        console.log(error);
        res.code(500).send({ message: "Internal Server Error" });
    }
});
exports.regionController = regionController;
const getRegions = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const response = yield prisma_1.prisma.region.findMany();
        return res.code(200).send(response);
    }
    catch (error) {
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw new errors_1.AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
        }
        throw error;
    }
});
exports.getRegions = getRegions;
const getProvince = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const params = req.query;
    if (!params)
        throw new errors_1.ValidationError("BAD_REQUEST");
    try {
        const response = yield prisma_1.prisma.province.findMany({
            where: {
                regionId: params.id,
            },
        });
        return res.code(200).send(response);
    }
    catch (error) {
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw new errors_1.AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
        }
        throw error;
    }
});
exports.getProvince = getProvince;
