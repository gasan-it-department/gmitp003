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
exports.publicAnnouncement = exports.removeAnnouncement = exports.markOkayAnnouncement = exports.viewAnnouncement = exports.announcementUpdateStatus = exports.publishAnnouncement = exports.announcementData = exports.createNewAnnouncement = exports.announcements = void 0;
const prisma_1 = require("../barrel/prisma");
const errors_1 = require("../errors/errors");
const encryption_1 = require("../service/encryption");
const helper_1 = require("../utils/helper");
//
const announcements = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const params = req.query;
    if (!params.id)
        throw new errors_1.ValidationError("INVALID REQUIRED ID");
    try {
        const filter = {
            lineId: params.id,
        };
        const cursor = params.lastCursor ? { id: params.lastCursor } : undefined;
        const take = params.limit ? parseInt(params.limit, 10) : 20;
        if (params.query) {
            filter.title = {
                contains: params.query,
                mode: "insensitive",
            };
        }
        const announcements = yield prisma_1.prisma.announcement.findMany({
            where: filter,
            cursor,
            take: take,
            skip: cursor ? 1 : 0,
            select: {
                id: true,
                title: true,
                titleIv: true,
                createdAt: true,
                status: true,
                content: true,
                contentIv: true,
            },
            orderBy: {
                createdAt: "desc", // Added ordering
            },
        });
        // Decrypt all titles in parallel
        const decryptedAnnouncements = yield Promise.all(announcements.map((item) => __awaiter(void 0, void 0, void 0, function* () {
            try {
                const { title, titleIv, id, createdAt, content, contentIv } = item;
                // Decrypt the title if IV exists
                let decryptedTitle = title;
                let decryptedContent = content;
                if (title && titleIv) {
                    try {
                        decryptedTitle = yield encryption_1.EncryptionService.decrypt(title, titleIv);
                    }
                    catch (decryptError) {
                        console.error(`Failed to decrypt title for announcement ${id}:`, decryptError);
                        decryptedTitle = "[Encrypted - Decryption Failed]";
                    }
                }
                if (content && contentIv) {
                    try {
                        decryptedContent = yield encryption_1.EncryptionService.decrypt(content, contentIv);
                    }
                    catch (decryptError) {
                        console.error(`Failed to decrypt title for announcement ${id}:`, decryptError);
                        decryptedContent = "[Encrypted - Decryption Failed]";
                    }
                }
                return {
                    id,
                    title: decryptedTitle,
                    createdAt,
                    status: item.status,
                    content: decryptedContent,
                };
            }
            catch (error) {
                console.error(`Error processing announcement ${item.id}:`, error);
                return {
                    id: item.id,
                    title: "[Error Processing]",
                    createdAt: item.createdAt,
                    status: item.status,
                };
            }
        })));
        // Get cursor for pagination
        const newLastCursorId = decryptedAnnouncements.length > 0
            ? decryptedAnnouncements[decryptedAnnouncements.length - 1].id
            : null;
        // Check if there are more items (using original announcements count)
        const hasMore = announcements.length === take;
        return res.code(200).send({
            list: decryptedAnnouncements,
            lastCursor: newLastCursorId,
            hasMore,
        });
    }
    catch (error) {
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw new errors_1.AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
        }
        if (error instanceof errors_1.ValidationError) {
            throw error;
        }
        throw new errors_1.AppError("ANNOUNCEMENTS_FETCH_FAILED", 500, "Failed to fetch announcements");
    }
});
exports.announcements = announcements;
const createNewAnnouncement = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const body = req.body;
    if (!body.lineId || !body.authorId || !body.title)
        throw new errors_1.ValidationError("INVALID REQUIRED FIELDS");
    try {
        const encryptedTitle = yield encryption_1.EncryptionService.encrypt(body.title);
        const newAnnouncement = yield prisma_1.prisma.announcement.create({
            data: {
                title: encryptedTitle.encryptedData,
                titleIv: encryptedTitle.iv,
                content: "Content here...",
                authorId: body.authorId,
                important: body.important,
                lineId: body.lineId,
                status: 0,
            },
        });
        return res.code(200).send({ message: "OK", id: newAnnouncement.id });
    }
    catch (error) {
        console.log(error);
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw new errors_1.AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
        }
        throw error;
    }
});
exports.createNewAnnouncement = createNewAnnouncement;
const announcementData = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const params = req.query;
    if (!params.id || !params.userId)
        throw new errors_1.ValidationError("INVALID REQUIRED ID");
    try {
        const data = yield prisma_1.prisma.announcement.findUnique({
            where: {
                id: params.id,
            },
            include: {
                announcementAttachFiles: true,
                _count: {
                    select: {
                        announcementViews: true,
                        announcementAttachFiles: true,
                        announcementMentions: true,
                        announcementReactions: true,
                    },
                },
                author: {
                    select: {
                        firstName: true,
                        lastName: true,
                        id: true,
                        username: true,
                    },
                },
            },
        });
        const reacted = yield prisma_1.prisma.announcementReaction.findFirst({
            where: {
                userId: params.userId,
                announcementId: params.id,
            },
        });
        if (!data)
            throw new errors_1.NotFoundError("DATA NOT FOUND!");
        const { title, titleIv, content, contentIv, announcementAttachFiles, _count, createdAt, author, } = data;
        const decryptedData = yield Promise.all([
            titleIv ? encryption_1.EncryptionService.decrypt(title, titleIv) : titleIv,
            contentIv ? encryption_1.EncryptionService.decrypt(content, contentIv) : contentIv,
        ]);
        const [decryptedTitle, decryptedContent] = decryptedData;
        return res.code(200).send({
            title: decryptedTitle,
            content: decryptedContent,
            files: announcementAttachFiles,
            status: data.status,
            _count: {
                views: _count.announcementViews,
                reactions: _count.announcementReactions,
                mentions: _count.announcementMentions,
                files: _count.announcementAttachFiles,
            },
            createdAt,
            author,
            reacted: reacted ? true : false,
        });
    }
    catch (error) {
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw new errors_1.AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
        }
        throw error;
    }
});
exports.announcementData = announcementData;
const publishAnnouncement = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const body = req.body;
    if (!body.lineId || !body.authorId || !body.id) {
        throw new errors_1.ValidationError("INVALID REQUIRED ID");
    }
    try {
        const encryptedData = yield Promise.all([
            encryption_1.EncryptionService.encrypt(body.title),
            encryption_1.EncryptionService.encrypt(body.content),
        ]);
        const [title, content] = encryptedData;
        if (!title || !content) {
            throw new errors_1.ValidationError("FAILED ENCRYPTION");
        }
        const sent = [];
        const fail = [];
        const response = yield prisma_1.prisma.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            // const users = await tx.user.findMany({
            //   where: {
            //     status: "",
            //   },
            // });
            const announcement = yield tx.announcement.update({
                data: {
                    title: title.encryptedData,
                    titleIv: title.iv,
                    content: content.encryptedData,
                    contentIv: content.iv,
                    status: body.status,
                },
                where: {
                    id: body.id,
                },
            });
            yield tx.humanResourcesLogs.create({
                data: {
                    userId: body.authorId,
                    tab: 2,
                    desc: `POSTED: New announcement: ${announcement.title}`,
                    lineId: body.lineId,
                    action: "ADDED",
                },
            });
            return "OK";
        }));
        if (!response) {
            throw new errors_1.ValidationError("SOMETHING WENT WRONG");
        }
        return res.code(200).send({ data: body });
    }
    catch (error) {
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw new errors_1.AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
        }
        throw error;
    }
});
exports.publishAnnouncement = publishAnnouncement;
const announcementUpdateStatus = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const body = req.body;
    if (!body.id || !body.userId || !body.status)
        throw new errors_1.ValidationError("INVALID REQUIRED FIELD");
    try {
        const statusText = helper_1.announcementStatus[body.status];
        const response = yield prisma_1.prisma.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            const announcement = yield tx.announcement.update({
                where: {
                    id: body.id,
                },
                data: {
                    status: body.status,
                },
            });
            yield tx.humanResourcesLogs.create({
                data: {
                    userId: body.userId,
                    tab: 2,
                    desc: `UPDATED: Change announcement status: ${announcement.title} - [${statusText}]`,
                    lineId: body.lineId,
                    action: "UPDATED",
                },
            });
            return "OK";
        }));
        if (!response)
            throw new errors_1.ValidationError("FAILED TO UPDATE");
        return res.code(200).send({ message: "OK" });
    }
    catch (error) {
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw new errors_1.AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
        }
        throw error;
    }
});
exports.announcementUpdateStatus = announcementUpdateStatus;
const viewAnnouncement = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const body = req.body;
    try {
        const resposne = yield prisma_1.prisma.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            const checked = yield tx.announcementViews.findFirst({
                where: {
                    announcementId: body.id,
                    userId: body.userId,
                },
            });
            if (checked)
                return true;
            yield tx.announcementViews.create({
                data: {
                    userId: body.userId,
                    announcementId: body.id,
                },
            });
            return true;
        }));
        if (!resposne)
            throw new errors_1.ValidationError("TRANSACTION FAILED");
        return res.code(200).send({ message: "OK" });
    }
    catch (error) {
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw new errors_1.AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
        }
        throw error;
    }
});
exports.viewAnnouncement = viewAnnouncement;
const markOkayAnnouncement = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const params = req.body;
    console.log("React: ", { params });
    if (!params.id || !params.userId)
        throw new errors_1.ValidationError("INVALID REQUIRED ID");
    try {
        const response = yield prisma_1.prisma.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            // Check if user exists
            const user = yield tx.user.findUnique({
                where: {
                    id: params.userId,
                },
            });
            if (!user)
                throw new errors_1.NotFoundError("USER NOT FOUND");
            // Check if announcement exists
            const announcement = yield tx.announcement.findUnique({
                where: {
                    id: params.id,
                },
            });
            if (!announcement)
                throw new errors_1.NotFoundError("ANNOUNCEMENT NOT FOUND");
            // Check if user already reacted to this announcement
            const existingReaction = yield tx.announcementReaction.findFirst({
                where: {
                    announcementId: params.id, // Fixed: should be announcementId, not id
                    userId: params.userId,
                },
            });
            // await tx.announcementReaction.deleteMany();
            // Toggle logic: if reaction exists, delete it; if not, create it
            if (existingReaction) {
                // Delete existing reaction
                yield tx.announcementReaction.delete({
                    where: {
                        id: existingReaction.id,
                    },
                });
                return { action: "removed", reacted: false };
            }
            else {
                // Create new reaction (assuming reaction type 1 for "okay")
                yield tx.announcementReaction.create({
                    data: {
                        userId: params.userId,
                        announcementId: params.id,
                        reaction: 1, // Assuming 1 represents "okay" reaction
                        timestamp: new Date(),
                    },
                });
                return { action: "added", reacted: true };
            }
        }));
        return res.code(200).send({
            message: "OK",
            data: response,
        });
    }
    catch (error) {
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw new errors_1.AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
        }
        throw error;
    }
});
exports.markOkayAnnouncement = markOkayAnnouncement;
const removeAnnouncement = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const params = req.query;
    console.log({ params });
    if (!params.id || !params.lineId || !params.userId) {
        throw new errors_1.ValidationError("INVALID REQUIRED FIELD");
    }
    try {
        const response = yield prisma_1.prisma.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            const announcement = yield tx.announcement.delete({
                where: {
                    id: params.id,
                },
            });
            const decryptedAnnouncement = announcement.titleIv
                ? yield encryption_1.EncryptionService.decrypt(announcement.title, announcement.titleIv)
                : undefined;
            yield tx.humanResourcesLogs.create({
                data: {
                    lineId: params.lineId,
                    userId: params.userId,
                    action: "REMOVE",
                    desc: `REMOVE ANNOUNCEMENT: ${decryptedAnnouncement || "Unknown"}`,
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
        console.log(error);
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw new errors_1.AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
        }
        throw error;
    }
});
exports.removeAnnouncement = removeAnnouncement;
const publicAnnouncement = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const params = req.query;
    console.log({ params });
    if (!params.id) {
        throw new errors_1.ValidationError("INVALID REQUIRED FIELD");
    }
    try {
        const filter = {
            lineId: params.id,
            status: 1,
        };
        const cursor = params.lastCursor ? { id: params.lastCursor } : undefined;
        const take = params.limit ? parseInt(params.limit, 10) : 20;
        if (params.query) {
            filter.title = {
                contains: params.query,
                mode: "insensitive",
            };
        }
        const announcements = yield prisma_1.prisma.announcement.findMany({
            where: filter,
            cursor,
            take: take,
            skip: cursor ? 1 : 0,
            select: {
                id: true,
                title: true,
                titleIv: true,
                createdAt: true,
                status: true,
                content: true,
                contentIv: true,
            },
            orderBy: {
                createdAt: "desc", // Added ordering
            },
        });
        // Decrypt all titles in parallel
        const decryptedAnnouncements = yield Promise.all(announcements.map((item) => __awaiter(void 0, void 0, void 0, function* () {
            try {
                const { title, titleIv, id, createdAt, content, contentIv } = item;
                // Decrypt the title if IV exists
                let decryptedTitle = title;
                let decryptedContent = content;
                if (title && titleIv) {
                    try {
                        decryptedTitle = yield encryption_1.EncryptionService.decrypt(title, titleIv);
                    }
                    catch (decryptError) {
                        console.error(`Failed to decrypt title for announcement ${id}:`, decryptError);
                        decryptedTitle = "[Encrypted - Decryption Failed]";
                    }
                }
                if (content && contentIv) {
                    try {
                        decryptedContent = yield encryption_1.EncryptionService.decrypt(content, contentIv);
                    }
                    catch (decryptError) {
                        console.error(`Failed to decrypt title for announcement ${id}:`, decryptError);
                        decryptedContent = "[Encrypted - Decryption Failed]";
                    }
                }
                return {
                    id,
                    title: decryptedTitle,
                    createdAt,
                    status: item.status,
                    content: decryptedContent,
                };
            }
            catch (error) {
                console.error(`Error processing announcement ${item.id}:`, error);
                return {
                    id: item.id,
                    title: "[Error Processing]",
                    createdAt: item.createdAt,
                    status: item.status,
                };
            }
        })));
        // Get cursor for pagination
        const newLastCursorId = decryptedAnnouncements.length > 0
            ? decryptedAnnouncements[decryptedAnnouncements.length - 1].id
            : null;
        // Check if there are more items (using original announcements count)
        const hasMore = announcements.length === take;
        return res.code(200).send({
            list: decryptedAnnouncements,
            lastCursor: newLastCursorId,
            hasMore,
        });
    }
    catch (error) {
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw new errors_1.AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
        }
        throw error;
    }
});
exports.publicAnnouncement = publicAnnouncement;
