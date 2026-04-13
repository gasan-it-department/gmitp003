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
exports.realTimeNoif = exports.markAsRead = exports.viewNotifcation = exports.notifications = void 0;
const prisma_1 = require("../barrel/prisma");
const errors_1 = require("../errors/errors");
const notifications = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const params = req.query;
    if (!params.id)
        throw new errors_1.ValidationError("INVALID REQUIRED ID");
    try {
        const cursor = params.lastCursor ? { id: params.id } : undefined;
        const limit = params.limit ? parseInt(params.limit, 10) : 20;
        const response = yield prisma_1.prisma.notification.findMany({
            where: {
                recipientId: params.id,
            },
            include: {
                sender: {
                    select: {
                        firstName: true,
                        lastName: true,
                        userProfilePictures: {
                            select: {
                                file_name: true,
                                id: true,
                                file_size: true,
                                file_url: true,
                                file_public_id: true,
                            },
                        },
                    },
                },
            },
            skip: cursor ? 1 : 0,
            take: limit,
            orderBy: {
                createdAt: "desc",
            },
            cursor,
        });
        const newLastCursorId = response.length > 0 ? response[response.length - 1].id : null;
        const hasMore = response.length === limit;
        return res
            .code(200)
            .send({ list: response, lastCursor: newLastCursorId, hasMore });
    }
    catch (error) {
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw new errors_1.AppError("DB_CONNECTION_ERROR", 500, "DB_FAILED");
        }
        throw error;
    }
});
exports.notifications = notifications;
const viewNotifcation = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const body = req.body;
    if (!body.userId || !body.id)
        throw new errors_1.ValidationError("INVALID REQURIED ID");
    try {
        const response = yield prisma_1.prisma.notification.update({
            where: {
                id: body.id,
            },
            data: {
                isRead: true,
            },
        });
        if (!response)
            throw new errors_1.ValidationError("TRANSACTION FAILED");
        return res.code(200).send({ message: "OK" });
    }
    catch (error) {
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw new errors_1.AppError("DB_CONNECTION_ERROR", 500, "DB_FAILED");
        }
        throw error;
    }
});
exports.viewNotifcation = viewNotifcation;
const markAsRead = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const body = req.body;
    if (!body.id)
        throw new errors_1.ValidationError("INVALID REQURIED ID");
    try {
        yield prisma_1.prisma.notification.update({
            where: {
                id: body.id,
            },
            data: {
                isRead: true,
            },
        });
        return res.code(200).send({ message: "OK" });
    }
    catch (error) {
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw new errors_1.AppError("DB_CONNECTION_ERROR", 500, "DB_FAILED");
        }
        throw error;
    }
});
exports.markAsRead = markAsRead;
const realTimeNoif = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const socket = req.socket;
    socket.on("connect", (data) => {
        console.log("Client connected: ", data.id);
        socket.on("disconnect", (reason) => {
            console.log("Client disconnected: ", data.id, "Reason:", reason);
        });
    });
});
exports.realTimeNoif = realTimeNoif;
