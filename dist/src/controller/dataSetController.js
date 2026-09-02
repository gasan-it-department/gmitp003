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
exports.deleteDataSet = exports.dataSetSelection = exports.dataSetSupplies = exports.dateSetData = exports.dataSetList = exports.createDateSet = void 0;
const prisma_1 = require("../barrel/prisma");
const errors_1 = require("../errors/errors");
const createDateSet = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const body = req.body;
        if (!body.title || !body.lineId || !body.inventoryBoxId || !body.userId) {
            return res.code(400).send({ message: "Bad request!" });
        }
        yield prisma_1.prisma.$transaction([
            prisma_1.prisma.suppliesDataSet.create({
                data: {
                    title: body.title,
                    lineId: body.lineId,
                    inventoryBoxId: body.inventoryBoxId,
                },
            }),
            prisma_1.prisma.inventoryAccessLogs.create({
                data: {
                    userId: body.userId,
                    inventoryBoxId: body.inventoryBoxId,
                    action: "Add Data Set",
                    timestamp: new Date(),
                },
            }),
        ]);
        return res.code(200).send({ message: "OK" });
    }
    catch (error) {
        console.log(error);
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            if (error.code === "P2002") {
                return res.status(409).send({
                    error: "Duplicate title",
                    fields: (_a = error.meta) === null || _a === void 0 ? void 0 : _a.target, // Will show ['title']
                });
            }
        }
        return res.status(500).send({
            error: "Internal Server Error",
            message: "Something went wrong",
        });
    }
});
exports.createDateSet = createDateSet;
const dataSetList = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const body = req.query;
        if (!body.id) {
            return res.code(400).send({ message: "Bad request!" });
        }
        const cursor = body.lastCursor ? { id: body.lastCursor } : undefined;
        const limit = body.limit ? parseInt(body.limit, 10) : 20;
        const response = yield prisma_1.prisma.suppliesDataSet.findMany({
            where: {
                inventoryBoxId: body.id,
            },
            select: {
                _count: {
                    select: {
                        list: true,
                        supplies: true,
                    },
                },
                id: true,
                title: true,
                timestamp: true,
            },
            cursor,
            take: limit,
            skip: cursor ? 1 : 0,
        });
        const newLastCursorId = response.length > 0 ? response[response.length - 1].id : null;
        const hasMore = response.length === limit;
        return res.code(200).send({
            message: "OK",
            list: response,
            lastCursor: newLastCursorId,
            hasMore,
        });
    }
    catch (error) {
        return res.status(500).send({
            error: "Internal Server Error",
            message: "Something went wrong",
        });
    }
});
exports.dataSetList = dataSetList;
const dateSetData = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const params = req.query;
        console.log("Params: ", { params });
        if (!params.id) {
            return res.code(400).send({ messag: "Bad Request" });
        }
        const data = yield prisma_1.prisma.suppliesDataSet.findUnique({
            where: {
                id: params.id,
            },
        });
        if (!data) {
            return res.code(404).send({ message: "Data not found" });
        }
        return res.code(200).send({ data });
    }
    catch (error) {
        console.log(error);
        res.code(500).send({ message: "Internal Server Error" });
    }
});
exports.dateSetData = dateSetData;
const dataSetSupplies = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const params = req.query;
        const filter = {
            suppliesDataSetId: params.id,
        };
        console.log("Data Set Item: ", { params });
        if (!params.id) {
            return res.code(400).send({ message: "Bad request!" });
        }
        if (params.query) {
            const searchTerms = params.query.trim().split(/\s+/); // Split on any whitespace
            if (searchTerms.length === 1) {
                filter.OR = [
                    { item: { contains: searchTerms[0], mode: "insensitive" } },
                    {
                        code: {
                            equals: isNaN(parseInt(searchTerms[0], 10))
                                ? undefined
                                : parseInt(searchTerms[0], 10),
                        },
                    },
                ].filter((condition) => {
                    var _a;
                    // Filter out invalid conditions (where code equals undefined)
                    if ("code" in condition) {
                        return ((_a = condition === null || condition === void 0 ? void 0 : condition.code) === null || _a === void 0 ? void 0 : _a.equals) !== undefined;
                    }
                    return true;
                });
            }
            else {
                filter.AND = searchTerms.map((term) => ({
                    OR: [
                        { item: { contains: term, mode: "insensitive" } },
                        {
                            code: {
                                equals: isNaN(parseInt(term, 10))
                                    ? undefined
                                    : parseInt(term, 10),
                            },
                        },
                    ].filter((condition) => {
                        var _a;
                        if ("code" in condition) {
                            return ((_a = condition === null || condition === void 0 ? void 0 : condition.code) === null || _a === void 0 ? void 0 : _a.equals) !== undefined;
                        }
                        return true;
                    }),
                }));
            }
        }
        const cursor = params.lastCursor ? { id: params.lastCursor } : undefined;
        const response = yield prisma_1.prisma.supplies.findMany({
            where: filter,
            cursor,
            take: parseInt(params.limit, 10) || 20,
            skip: cursor ? 1 : 0,
            orderBy: {
                createdAt: "asc",
            },
        });
        const nextLastCursorId = response.length > 0 ? response[response.length - 1].id : null;
        const hasMore = response.length === (parseInt(params.limit, 10) || 20);
        return res
            .code(200)
            .send({ list: response, lastCursor: nextLastCursorId, hasMore });
    }
    catch (error) {
        console.log(error);
        return res.code(500).send({ message: "Internal server error" });
    }
});
exports.dataSetSupplies = dataSetSupplies;
const dataSetSelection = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const body = req.query;
    }
    catch (error) {
        console.log(error);
    }
});
exports.dataSetSelection = dataSetSelection;
const deleteDataSet = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const params = req.query;
    if (!params.id || !params.userId || !params.inventoryBoxId)
        throw new errors_1.ValidationError();
    try {
        yield prisma_1.prisma.suppliesDataSet.delete({
            where: {
                id: params.id,
            },
        });
        return res.code(200).send({ message: "OK" });
    }
    catch (error) {
        console.log("Delete Error: ", error);
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw new errors_1.AppError("DB_CONNECTION_ERROR", 500, "DB_ERROR");
        }
        throw error;
    }
});
exports.deleteDataSet = deleteDataSet;
