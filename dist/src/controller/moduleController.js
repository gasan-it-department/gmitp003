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
exports.updateModuleAccess = exports.removeAccess = exports.userAccessModule = exports.addModuleAccess = exports.moduleUsers = exports.modules = void 0;
const prisma_1 = require("../barrel/prisma");
const errors_1 = require("../errors/errors");
const handler_1 = require("../middleware/handler");
const encryption_1 = require("../service/encryption");
const modules = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const params = req.query; // indexes is a string
    console.log("Params: ", params);
    if (!params.id) {
        throw new errors_1.ValidationError("INVALID REQUIRED ID OR INDEXES");
    }
    // Parse the comma-separated indexes string into an array of numbers
    const indexes = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];
    try {
        const response = yield prisma_1.prisma.module.groupBy({
            by: ["moduleIndex", "moduleName"],
            _count: {
                userId: true,
            },
            where: {
                lineId: params.id,
            },
        });
        console.log({ response });
        const modulesWithUserCount = response.map((module) => ({
            moduleIndex: module.moduleIndex,
            moduleName: module.moduleName,
            totalUsers: module._count.userId,
        }));
        return res.code(200).send(modulesWithUserCount);
    }
    catch (error) {
        console.log(error);
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw new errors_1.AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
        }
        throw error;
    }
});
exports.modules = modules;
const moduleUsers = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const params = req.query;
    console.log({ params });
    if (!params.id)
        throw new errors_1.ValidationError("INVALID REQUIRED ID");
    try {
        const cursor = params.lastCursor ? { id: params.lastCursor } : undefined;
        const limit = params.limit ? parseInt(params.limit, 10) : 20;
        const filter = {};
        if (params.query) {
            const searchTerms = params.query.trim().split(/\s+/); // Split on any whitespace
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
                    {
                        middleName: { contains: params.query.trim(), mode: "insensitive" },
                    },
                ];
                delete filter.AND; // Remove the AND since we've incorporated it into OR
            }
        }
        const response = yield prisma_1.prisma.user.findMany({
            where: Object.assign({ modules: {
                    some: {
                        moduleName: params.id,
                    },
                } }, filter),
            select: {
                id: true,
                firstName: true,
                lastName: true,
                username: true,
                modules: {
                    where: {
                        moduleName: params.id,
                    },
                },
            },
            take: limit,
            skip: cursor ? 1 : 0,
            orderBy: {
                lastName: "desc",
            },
            cursor,
        });
        console.log({ response });
        const newLastCursorId = response.length > 0 ? response[response.length - 1].id : null;
        const hasMore = response.length === limit;
        return res
            .code(200)
            .send({ list: response, lastCursor: newLastCursorId, hasMore });
    }
    catch (error) {
        console.log(error);
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw new errors_1.AppError("DB_CONNECTION_ERROR", 500, "D_ERROR");
        }
        throw error;
    }
});
exports.moduleUsers = moduleUsers;
const addModuleAccess = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const body = req.body;
    console.log({ body });
    if (!body.userId || !body.privilege || !body.module || !body.currUserId)
        throw new errors_1.ValidationError("INVALID REQUIRED");
    try {
        const response = yield prisma_1.prisma.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            // Get user details
            const user = yield tx.user.findUnique({
                where: {
                    id: body.userId,
                },
                include: {
                    Position: true,
                    department: true,
                },
            });
            if (!user)
                throw new errors_1.ValidationError("USER NOT FOUND!");
            // Check if module access already exists
            const moduleAccess = yield tx.module.findFirst({
                where: {
                    moduleName: body.module,
                    userId: user.id,
                },
            });
            if (moduleAccess)
                throw new errors_1.ValidationError("ALREADY ASSIGNED");
            // Get current user who is assigning the module
            const currentUser = yield tx.user.findUnique({
                where: {
                    id: body.currUserId,
                },
                select: {
                    firstName: true,
                    lastName: true,
                    Position: true,
                    email: true,
                    emailIv: true,
                },
            });
            if (!currentUser) {
                throw new errors_1.ValidationError("CURRENT USER NOT FOUND");
            }
            const decryptedData = currentUser.emailIv
                ? yield encryption_1.EncryptionService.decrypt(currentUser.email, currentUser.emailIv)
                : undefined;
            // Create module access
            const access = yield tx.module.create({
                data: {
                    userId: user.id,
                    privilege: body.privilege,
                    moduleName: body.module,
                    moduleIndex: "1",
                    lineId: user.lineId,
                },
            });
            // Create notification
            yield tx.notification.create({
                data: {
                    recipientId: user.id,
                    senderId: body.currUserId,
                    title: "Module Access Granted",
                    content: `${(currentUser === null || currentUser === void 0 ? void 0 : currentUser.firstName) || "A system administrator"} has granted you access to the ${body.module} module with ${getPrivilegeLevel(body.privilege)} privileges. You can now access this module from your dashboard.`,
                    path: `${body.module}`,
                },
            });
            // Send email
            const emailSubject = `Access Granted: ${body.module} Module`;
            const emailContent = `
Dear ${user.firstName} ${user.lastName},

You have been granted access to the ${body.module} module.

Details:
• Module: ${body.module}
• Privilege Level: ${getPrivilegeLevel(body.privilege)}
• Granted By: ${(currentUser === null || currentUser === void 0 ? void 0 : currentUser.firstName) || "System Administrator"} ${(currentUser === null || currentUser === void 0 ? void 0 : currentUser.lastName) || ""}
• Date: ${new Date().toLocaleDateString()}

You can now access this module from your dashboard. If you have any questions, please contact your system administrator.

Best regards,
System Administrator
      `;
            if (decryptedData) {
                yield (0, handler_1.sendEmail)(emailSubject, decryptedData, emailContent, "module-access-granted");
            }
            return "OK";
        }));
        if (!response) {
            throw new errors_1.AppError("SOMETHING WENT WRONG");
        }
        return res
            .status(200)
            .send({ success: true, message: "Module access granted successfully" });
    }
    catch (error) {
        console.log(error);
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw new errors_1.AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
        }
        throw error;
    }
});
exports.addModuleAccess = addModuleAccess;
// Helper function to convert privilege number to readable text
function getPrivilegeLevel(privilege) {
    const privilegeLevels = ["Read Only", "Read and Write"];
    return privilegeLevels[privilege] || `Level ${privilege + 1}`;
}
const userAccessModule = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const params = req.query;
    console.log({ params });
    if (!params.userId)
        throw new errors_1.ValidationError("INVALID REQUIRED ID");
    try {
        const response = yield prisma_1.prisma.module.findMany({
            where: {
                userId: params.userId,
            },
        });
        console.log({ response });
        return res.code(200).send(response);
    }
    catch (error) {
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw new errors_1.AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
        }
        throw error;
    }
});
exports.userAccessModule = userAccessModule;
const removeAccess = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const body = req.body;
    console.log({ body });
    if (!body.id || !body.userId || !body.lineId)
        throw new errors_1.ValidationError("BAD REQUEST");
    try {
        const response = yield prisma_1.prisma.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            const user = yield tx.user.findUnique({
                where: {
                    id: body.userId,
                },
            });
            const module = yield tx.module.findFirst({
                where: {
                    moduleName: body.module,
                    userId: body.id,
                },
            });
            if (!user)
                throw new errors_1.NotFoundError("USER NOT FOUND");
            if (!module)
                throw new errors_1.NotFoundError("ACCESS NOT FOUND");
            yield tx.module.delete({
                where: {
                    id: module.id,
                },
            });
            yield tx.humanResourcesLogs.create({
                data: {
                    action: "REMOVE ACCESS",
                    userId: body.userId,
                    desc: `REMOVE MODULE ACCESS: ${body.module} - @${user.username}`,
                    lineId: body.lineId,
                },
            });
            yield tx.activityLogs.create({
                data: {
                    action: 5,
                    desc: `You remove ${user.username}'s access to module ${body.module}`,
                    lineId: body.lineId,
                    userId: body.userId,
                },
            });
            return true;
        }));
        if (!response)
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
exports.removeAccess = removeAccess;
const updateModuleAccess = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const body = req.body;
    console.log({ body });
    if (!body.id || !body.module || !body.userId)
        throw new errors_1.ValidationError("INVALID REQUIRED FIELDS");
    try {
        const updateData = {};
        // Cleaner check for optional status
        if (body.status !== undefined) {
            updateData.status = body.status;
        }
        // Cleaner check for optional privilege
        if (body.privilege !== undefined) {
            updateData.privilege = body.privilege;
        }
        // Check if there's actually something to update
        if (Object.keys(updateData).length === 0) {
            throw new errors_1.ValidationError("NO_DATA_TO_UPDATE");
        }
        console.log({ updateData });
        const response = yield prisma_1.prisma.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            var _a, _b;
            const user = yield tx.user.findUnique({
                where: {
                    id: body.id,
                },
            });
            if (!user)
                throw new errors_1.NotFoundError("USER NOT FOUND");
            const module = yield tx.module.findFirst({
                where: {
                    moduleName: body.module,
                    userId: user.id,
                },
            });
            if (!module)
                throw new errors_1.NotFoundError("MODULE NOT FOUND");
            yield tx.module.update({
                where: {
                    id: module.id,
                },
                data: updateData,
            });
            yield tx.humanResourcesLogs.create({
                data: {
                    action: "UPDATE MODULE ACCESS",
                    desc: `UPDATE MODULE ACCESS: ${body.module} - @${user.username} (status: ${(_a = updateData.status) !== null && _a !== void 0 ? _a : "unchanged"}, privilege: ${(_b = updateData.privilege) !== null && _b !== void 0 ? _b : "unchanged"})`,
                    userId: body.userId,
                    lineId: body.lineId,
                },
            });
            yield tx.activityLogs.create({
                data: {
                    action: 4,
                    desc: `You update ${user.username}'s access to module ${body.module}`,
                    userId: body.userId,
                    lineId: body.lineId,
                },
            });
            return true;
        }));
        if (!response)
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
exports.updateModuleAccess = updateModuleAccess;
