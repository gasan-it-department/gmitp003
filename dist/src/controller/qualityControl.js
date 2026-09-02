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
exports.unitOfMeasures = void 0;
const prisma_1 = require("../barrel/prisma");
const unitOfMeasures = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const params = req.query;
        const cursor = params.lastCursor ? { id: params.lastCursor } : undefined;
        const response = yield prisma_1.prisma.suppliesQuality.findMany({
            cursor,
            take: parseInt(params.limit, 10),
            skip: cursor ? 1 : 0,
        });
        const newLastCursorId = response.length > 0 ? response[response.length - 1].id : null;
        const hasMore = response.length === parseInt(params.limit, 10);
        res
            .code(200)
            .send({ list: response, lastCursor: newLastCursorId, hasMore });
    }
    catch (error) {
        res.code(500).send({ message: "Internal Server Error" });
    }
});
exports.unitOfMeasures = unitOfMeasures;
