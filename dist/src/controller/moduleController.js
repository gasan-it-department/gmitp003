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
const notificationEvents_1 = require("../service/notificationEvents");
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
            throw (0, errors_1.dbError)(error);
        }
        throw error;
    }
});
exports.modules = modules;
const moduleUsers = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const params = req.query;
    // Module access is per line — scope the membership list by lineId when the
    // caller provides it, so "who has this module" (and the Add-page badges that
    // read it) are accurate for the current line rather than counting every line.
    const lineId = req.query.lineId;
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
                    some: Object.assign({ moduleName: params.id }, (lineId ? { lineId } : {})),
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
            throw (0, errors_1.dbError)(error);
        }
        throw error;
    }
});
exports.moduleUsers = moduleUsers;
const addModuleAccess = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d;
    const body = req.body;
    // Privilege selection was removed from the grant UI — granting access now
    // gives full module access by default. Stay tolerant of an old client that
    // still sends a privilege.
    const privilege = typeof body.privilege === "number" ? body.privilege : 1;
    if (!body.userId || !body.module || !body.currUserId)
        throw new errors_1.ValidationError("INVALID REQUIRED");
    try {
        const response = yield prisma_1.prisma.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            var _a, _b, _c, _d, _e;
            // Get user details
            let user = yield tx.user.findUnique({
                where: {
                    id: body.userId,
                },
                include: {
                    Position: true,
                    department: true,
                },
            });
            // The admin's intent is the @USERNAME shown on the row and on the
            // confirm button — the id is just plumbing that can go stale (cached
            // lists, re-registered accounts). If the id is missing or points at a
            // DIFFERENT username than the one the admin verified on screen,
            // resolve the grantee BY USERNAME within the line and grant that
            // person. Only refuse when the username itself can't be resolved.
            const expected = (_a = body.username) === null || _a === void 0 ? void 0 : _a.trim();
            if (expected && (!user || (user.username && user.username !== expected))) {
                const staleResolved = (_b = user === null || user === void 0 ? void 0 : user.username) !== null && _b !== void 0 ? _b : null;
                const candidates = yield tx.user.findMany({
                    where: Object.assign({ username: expected }, (body.lineId ? { lineId: body.lineId } : {})),
                    include: {
                        Position: true,
                        department: true,
                    },
                    orderBy: { createdAt: "desc" },
                });
                // Prefer the row wired to a real login account (duplicate rows can
                // exist from failed-registration retries — grant the live one).
                const withAccount = candidates.filter((c) => c.accountId);
                const resolved = (withAccount.length ? withAccount : candidates)[0];
                if (resolved) {
                    console.error(`[addModuleAccess] STALE ID AUTO-CORRECT — requested id ${body.userId}` +
                        (staleResolved
                            ? ` resolves to @${staleResolved}`
                            : " matches no user") +
                        ` but the admin selected @${expected};` +
                        ` granting to @${expected} (id ${resolved.id})` +
                        (candidates.length > 1
                            ? ` [${candidates.length} rows share this username — picked the one with an active account]`
                            : ""));
                    user = resolved;
                }
                else {
                    throw new errors_1.ValidationError(`Cannot grant: no account @${expected} exists in this line` +
                        (staleResolved
                            ? ` (the clicked row's id belongs to @${staleResolved})`
                            : "") +
                        ". Refresh the page and try again — no access was granted.");
                }
            }
            if (!user)
                throw new errors_1.ValidationError("USER NOT FOUND!");
            // Tripwire: the grant must happen inside the line HR is working in.
            // If the id the client sent resolves to a user of a DIFFERENT line,
            // fail loudly with the account name instead of silently granting a
            // module that the current line's lists will never show.
            if (body.lineId && user.lineId && user.lineId !== body.lineId) {
                throw new errors_1.ValidationError(`@${(_c = user.username) !== null && _c !== void 0 ? _c : user.id} belongs to a different line — ` +
                    "cannot grant module access from here.");
            }
            const grantLineId = ((_d = user.lineId) !== null && _d !== void 0 ? _d : body.lineId);
            if (!grantLineId) {
                throw new errors_1.ValidationError(`@${(_e = user.username) !== null && _e !== void 0 ? _e : user.id} has no line assigned — ask MIS to fix the account before granting access.`);
            }
            // Module access is stored PER LINE (Module.lineId = the grantee's line),
            // so scope the duplicate check by lineId too — otherwise a user who has
            // this module in a different line wrongly reads as "already assigned".
            // Also make it IDEMPOTENT: if a row already exists, return calmly instead
            // of throwing a hard "ALREADY ASSIGNED". The end state (user has access)
            // is identical, so HR is never blocked by a pre-existing/stale row.
            const existing = yield tx.module.findFirst({
                where: {
                    moduleName: body.module,
                    userId: user.id,
                    lineId: grantLineId,
                },
            });
            if (existing)
                return { outcome: "EXISTS", user };
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
                    privilege,
                    moduleName: body.module,
                    moduleIndex: "1",
                    lineId: grantLineId,
                },
            });
            // Create notification (with real-time push)
            yield (0, notificationEvents_1.createUserNotification)(tx, {
                recipientId: user.id,
                senderId: body.currUserId,
                title: "Module Access Granted",
                content: `${(currentUser === null || currentUser === void 0 ? void 0 : currentUser.firstName) || "A system administrator"} has granted you access to the ${body.module} module. You can now access this module from your dashboard.`,
                path: `${body.module}`,
            });
            // Send email
            const emailSubject = `Access Granted: ${body.module} Module`;
            const emailContent = `
Dear ${user.firstName} ${user.lastName},

You have been granted access to the ${body.module} module.

Details:
• Module: ${body.module}
• Granted By: ${(currentUser === null || currentUser === void 0 ? void 0 : currentUser.firstName) || "System Administrator"} ${(currentUser === null || currentUser === void 0 ? void 0 : currentUser.lastName) || ""}
• Date: ${new Date().toLocaleDateString()}

You can now access this module from your dashboard. If you have any questions, please contact your system administrator.

Best regards,
System Administrator
      `;
            if (decryptedData) {
                yield (0, handler_1.sendEmail)(emailSubject, decryptedData, emailContent, "module-access-granted");
            }
            return { outcome: "OK", user };
        }));
        if (!response) {
            throw new errors_1.AppError("SOMETHING WENT WRONG");
        }
        // Echo WHO the grant actually landed on. If the client ever sends a
        // wrong id, the toast names the real account instead of hiding it.
        const grantee = {
            id: response.user.id,
            username: response.user.username,
            firstName: response.user.firstName,
            lastName: response.user.lastName,
        };
        // Forensic trail for EVERY grant call — if a wrong-user report ever
        // comes in again, the Railway logs show exactly what the client sent
        // and who it resolved to, no guesswork.
        console.log(`[addModuleAccess] module=${body.module} requestedId=${body.userId}` +
            ` expected=@${(_a = body.username) !== null && _a !== void 0 ? _a : "-"}` +
            ` resolved=@${(_b = grantee.username) !== null && _b !== void 0 ? _b : grantee.id}` +
            ` outcome=${response.outcome} by=${body.currUserId}`);
        return res.status(200).send({
            success: true,
            alreadyHad: response.outcome === "EXISTS",
            grantee,
            message: response.outcome === "EXISTS"
                ? `@${(_c = grantee.username) !== null && _c !== void 0 ? _c : grantee.id} already has access to this module.`
                : `Module access granted to @${(_d = grantee.username) !== null && _d !== void 0 ? _d : grantee.id}.`,
        });
    }
    catch (error) {
        console.log(error);
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw (0, errors_1.dbError)(error);
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
            throw (0, errors_1.dbError)(error);
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
            throw (0, errors_1.dbError)(error);
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
            throw (0, errors_1.dbError)(error);
        }
        throw error;
    }
});
exports.updateModuleAccess = updateModuleAccess;
