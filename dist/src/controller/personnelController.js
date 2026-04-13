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
exports.personnelList = void 0;
const prisma_1 = require("../barrel/prisma");
const errors_1 = require("../errors/errors");
const personnelList = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { lastCursor, query, limit, id } = req.query;
    console.log({ id });
    if (!id)
        throw new errors_1.ValidationError("INVALID_REQUEST");
    try {
        const cursor = lastCursor ? { id: lastCursor } : undefined;
        const take = limit ? parseInt(limit) : 20;
        const response = yield prisma_1.prisma.user.findMany({
            where: {
                departmentId: id,
            },
            cursor,
            take,
            skip: cursor ? 1 : 0,
            orderBy: {
                lastName: "asc",
            },
            select: {
                id: true,
                firstName: true,
                lastName: true,
                middleName: true,
                Position: {
                    select: {
                        name: true,
                    },
                },
            },
        });
        console.log({ response });
        const newLastCursorId = response.length > 0 ? response[response.length - 1].id : null;
        const hasMore = response.length === 10;
        return res
            .code(200)
            .send({ list: response, lastCursor: newLastCursorId, hasMore: hasMore });
    }
    catch (error) {
        console.log(error);
        res.code(500).send({ message: "Internel Server Error" });
    }
});
exports.personnelList = personnelList;
