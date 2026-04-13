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
exports.getUserInfo = exports.searchUsers = exports.users = void 0;
const prisma_1 = require("../barrel/prisma");
const errors_1 = require("../errors/errors");
const users = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const params = req.query;
    console.log({ params });
    if (!params.id)
        throw new errors_1.ValidationError("BAD_REQUEST");
    try {
        const cursor = params.lastCursor ? { id: params.lastCursor } : undefined;
        const filter = {};
        const limit = params.limit ? parseInt(params.limit, 10) : 20;
        const query = params.query;
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
                delete filter.AND;
            }
        }
        const response = yield prisma_1.prisma.user.findMany({
            where: Object.assign({ lineId: params.id }, filter),
            cursor,
            take: limit,
            select: {
                department: {
                    select: {
                        name: true,
                        id: true,
                    },
                },
                SalaryGrade: true,
                Promotions: true,
                Position: true,
                id: true,
                lastName: true,
                firstName: true,
            },
            skip: cursor ? 1 : 0,
            orderBy: {
                lastName: "asc",
            },
        });
        const newLastCursorId = response.length > 0 ? response[response.length - 1].id : null;
        const hasMore = response.length === limit;
        return res
            .code(200)
            .send({ list: response, lastCursorId: newLastCursorId, hasMore });
    }
    catch (error) {
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw new errors_1.AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
        }
        throw error;
    }
});
exports.users = users;
const searchUsers = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const params = req.query;
    console.log("User: ", { params });
    console.log("0");
    if (!params.id)
        throw new errors_1.ValidationError("BAD_REQUEST");
    console.log("1");
    if (!params.query)
        return res.code(200).send({ list: [], hasMore: false, lastCursor: null });
    console.log("check");
    try {
        const cursor = params.lastCursor ? { id: params.lastCursor } : undefined;
        const filter = {};
        const limit = params.limit ? parseInt(params.limit, 10) : 20;
        const query = params.query;
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
                delete filter.AND;
            }
        }
        console.log({ filter });
        const response = yield prisma_1.prisma.user.findMany({
            where: Object.assign({ lineId: params.id }, filter),
            cursor,
            take: limit,
            select: {
                department: {
                    select: {
                        name: true,
                        id: true,
                    },
                },
                SalaryGrade: true,
                Promotions: true,
                Position: true,
                id: true,
                lastName: true,
                firstName: true,
                userProfilePictures: {
                    select: {
                        file_url: true,
                        file_name: true,
                    },
                },
                username: true,
            },
            skip: cursor ? 1 : 0,
            orderBy: {
                lastName: "asc",
            },
        });
        console.log({ response });
        const newLastCursorId = response.length > 0 ? response[response.length - 1].id : null;
        const hasMore = response.length === limit;
        return res
            .code(200)
            .send({ list: response, lastCursorId: newLastCursorId, hasMore });
    }
    catch (error) {
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw new errors_1.AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
        }
        throw error;
    }
});
exports.searchUsers = searchUsers;
const getUserInfo = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const params = req.query;
    console.log("user: ", { params });
    if (!params.id)
        throw new errors_1.ValidationError("BAD_REQUEST");
    try {
        const user = yield prisma_1.prisma.user.findUnique({
            where: {
                id: params.id,
            },
            include: {
                department: {
                    select: {
                        name: true,
                        id: true,
                    },
                },
                userProfilePictures: {
                    select: {
                        file_name: true,
                        file_url: true,
                    },
                },
            },
        });
        if (!user)
            throw new errors_1.NotFoundError("USER_NOT_FOUND");
        return res.code(200).send(user);
    }
    catch (error) {
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw new errors_1.AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
        }
        throw error;
    }
});
exports.getUserInfo = getUserInfo;
