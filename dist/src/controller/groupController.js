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
exports.deleteUnit = exports.unitInfo = exports.createGroup = exports.groupList = void 0;
const prisma_1 = require("../barrel/prisma");
const errors_1 = require("../errors/errors");
const groupList = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const params = req.query;
    if (!params.id)
        throw new errors_1.ValidationError("INVALID_REQUEST");
    try {
        const cursor = params.lastCursor ? { id: params.lastCursor } : undefined;
        const limit = params.limit ? parseInt(params.limit) : 20;
        const filter = {
            lineId: params.id,
        };
        if (params.query) {
            filter.name = {
                contains: params.query,
                mode: "insensitive",
            };
        }
        const groups = yield prisma_1.prisma.department.findMany({
            where: Object.assign({}, filter),
            take: limit,
            cursor: cursor,
            skip: cursor ? 1 : 0,
            include: {
                _count: {
                    select: {
                        users: true,
                    },
                },
            },
        });
        const newLastCursorId = groups.length > 0 ? groups[groups.length - 1].id : null;
        const hasMore = groups.length === limit;
        return res
            .code(200)
            .send({ list: groups, lastCursor: newLastCursorId, hasMore: hasMore });
    }
    catch (error) {
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw new errors_1.AppError("DB_CONNECTION_EROR", 500, "DB_FAILED");
        }
        throw error;
    }
});
exports.groupList = groupList;
const createGroup = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const body = req.body;
        console.log(body);
        if (!body || !body.title) {
            throw new errors_1.ValidationError("INVALID_REQUEST");
        }
        const existingGroup = yield prisma_1.prisma.department.findFirst({
            where: {
                name: {
                    contains: body.title,
                    mode: "insensitive",
                },
                lineId: body.lineId,
            },
        });
        if (existingGroup) {
            throw new errors_1.ValidationError("UNIT_ALREADY_EXISTS");
        }
        yield prisma_1.prisma.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            const newGroup = yield tx.department.create({
                data: {
                    name: body.title,
                    description: body.description,
                    lineId: body.lineId,
                },
            });
            console.log({ newGroup });
            yield tx.humanResourcesLogs.create({
                data: {
                    action: "CREATED UNIT",
                    lineId: body.lineId,
                    userId: body.userId,
                    desc: `Created new unit: ${newGroup.name}`,
                },
            });
        }));
        return res.code(200).send({ message: "OK" });
    }
    catch (error) {
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw new errors_1.AppError("DB_CONNECTION_EROR", 500, "DB_FAILED");
        }
        throw error;
    }
});
exports.createGroup = createGroup;
const unitInfo = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const params = req.query;
    if (!params.id)
        throw new errors_1.ValidationError("INVALID_REQUEST");
    try {
        const unit = yield prisma_1.prisma.department.findUnique({
            where: {
                id: params.id,
            },
            include: {
                _count: {
                    select: {
                        users: true,
                    },
                },
            },
        });
        if (!unit) {
            throw new errors_1.NotFoundError("UNIT_NOT_FOUND");
        }
        return res.code(200).send(unit);
    }
    catch (error) {
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw new errors_1.AppError("DB_CONNECTION_EROR", 500, "DB_FAILED");
        }
        throw error;
    }
});
exports.unitInfo = unitInfo;
const deleteUnit = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const params = req.query;
    if (!params.id || !params.lineId || !params.userId) {
        throw new errors_1.ValidationError("INVALID REQUIRED ID");
    }
    try {
        const response = yield prisma_1.prisma.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            const unit = yield tx.department.delete({
                where: {
                    id: params.id,
                },
            });
            yield tx.humanResourcesLogs.create({
                data: {
                    userId: params.userId,
                    lineId: params.lineId,
                    action: "REMOVE",
                    desc: `REMOVE UNIT: ${unit.name}`,
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
            throw new errors_1.AppError("DB_CONNECTION_EROR", 500, "DB_FAILED");
        }
        throw error;
    }
});
exports.deleteUnit = deleteUnit;
