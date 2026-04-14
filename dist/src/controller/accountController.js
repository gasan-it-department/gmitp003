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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.resetUserPassword = exports.sendResetPasswordLink = exports.accountList = void 0;
const prisma_1 = require("../barrel/prisma");
const errors_1 = require("../errors/errors");
const argon2_1 = __importDefault(require("argon2"));
const handler_1 = require("../middleware/handler");
const encryption_1 = require("../service/encryption");
const accountList = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const params = req.query;
        console.log({ params });
        const filter = {};
        if (params.query) {
            const searchTerms = params.query.trim().split(/\s+/); // Split on any whitespace
            if (searchTerms.length === 1) {
                filter.OR = [
                    { lastName: { contains: searchTerms[0], mode: "insensitive" } },
                    { firstName: { contains: searchTerms[0], mode: "insensitive" } },
                    { middleName: { contains: searchTerms[0], mode: "insensitive" } },
                    { email: { contains: searchTerms[0], mode: "insensitive" } },
                ];
            }
            else {
                filter.AND = searchTerms.map((term) => ({
                    OR: [
                        { firstName: { contains: term, mode: "insensitive" } },
                        { lastName: { contains: term, mode: "insensitive" } },
                        { middleName: { contains: term, mode: "insensitive" } },
                        { email: { contains: term, mode: "insensitive" } },
                    ],
                }));
                filter.OR = [
                    { AND: filter.AND },
                    {
                        username: { contains: params.query.trim(), mode: "insensitive" },
                    },
                ];
                delete filter.AND; // Remove the AND since we've incorporated it into OR
            }
        }
        const cursor = params.lastCursor ? { id: params.lastCursor } : undefined;
        const accounts = yield prisma_1.prisma.account.findMany({
            where: {
                User: Object.assign({}, filter),
            },
            cursor,
            take: parseInt(params.limit, 10),
            select: {
                User: {
                    select: {
                        id: true,
                        firstName: true,
                        lastName: true,
                        email: true,
                    },
                },
                id: true,
                username: true,
            },
            skip: cursor ? 1 : 0,
        });
        const nextLastCursorId = accounts.length > 0 ? accounts[accounts.length - 1].id : null;
        const hasMore = accounts.length === 20;
        res
            .code(200)
            .send({ list: accounts, lastCursor: nextLastCursorId, hasMore });
    }
    catch (error) {
        console.log(error);
        res.code(500).send({ message: "Internal Server Error" });
    }
});
exports.accountList = accountList;
const sendResetPasswordLink = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const body = req.body;
    const frontEnd = process.env.VITE_LOCAL_FRONTEND_URL;
    if (!body.accountId || !body.lineId)
        throw new errors_1.ValidationError("INVALID REQUIRED ID");
    try {
        // Find the account with user details
        const [account, line] = yield prisma_1.prisma.$transaction([
            prisma_1.prisma.account.findUnique({
                where: {
                    id: body.accountId,
                },
                select: {
                    id: true,
                    username: true,
                    User: {
                        select: {
                            email: true,
                            emailIv: true,
                        },
                    },
                },
            }),
            prisma_1.prisma.line.findUnique({
                where: {
                    id: body.lineId,
                },
                select: {
                    id: true,
                    province: {
                        select: {
                            name: true,
                        },
                    },
                    municipal: {
                        select: {
                            name: true,
                        },
                    },
                    barangay: {
                        select: {
                            name: true,
                        },
                    },
                },
            }),
        ]);
        if (!account)
            throw new errors_1.NotFoundError("ACCOUNT NOT FOUND!");
        if (!line)
            throw new errors_1.ValidationError("INVALID LINE");
        // Decrypt the email
        const decryptedEmail = account.User &&
            account.User.email &&
            account.User.emailIv &&
            (yield encryption_1.EncryptionService.decrypt(account.User.email, account.User.emailIv));
        if (!decryptedEmail)
            throw new errors_1.ValidationError("FAILED TO SEND RESET LINK");
        // Generate a unique reset token
        const link = yield prisma_1.prisma.accountResetLink.create({
            data: {
                accountId: account.id,
            },
        });
        // Create reset link
        const resetLink = `${frontEnd}public/${line.id}/reset-password/${link.id}/${account.id}`;
        // Get user name
        const userName = account.username;
        // Plain text email content
        const emailSubject = "Password Reset Request - Gasan Municipal Portal";
        const emailBody = `
PASSWORD RESET REQUEST

Dear ${userName},

You have requested to reset your password for your Gasan Municipal Portal account.

To reset your password, please click on the following link:
${resetLink}


If you did not request this password reset, please ignore this email. Your account security has not been compromised.

Please note:
- The link can only be used once
- You will be prompted to create a new password
- After resetting, you will need to log in with your new password

For security reasons, never share your password or this reset link with anyone.

If you need assistance, please contact the municipal IT support.

HR Management
Municipality of ${line.municipal.name}
${line.province.name}, Philippines
`;
        // Send the email
        yield (0, handler_1.sendEmail)(emailSubject, decryptedEmail, emailBody, "text/plain");
        // Log the action
        return res.code(200).send({
            message: "OK",
        });
    }
    catch (error) {
        console.error("Error sending reset password link:", error);
        if (error instanceof errors_1.ValidationError || error instanceof errors_1.NotFoundError) {
            throw error;
        }
        throw error;
    }
});
exports.sendResetPasswordLink = sendResetPasswordLink;
const resetUserPassword = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const body = req.body;
    console.log({ body });
    if (!body.accountId || !body.linkId || !body.password)
        throw new errors_1.ValidationError("INVALID REQUIRED ID");
    try {
        const [link, account] = yield prisma_1.prisma.$transaction([
            prisma_1.prisma.accountResetLink.findUnique({
                where: {
                    id: body.linkId,
                },
            }),
            prisma_1.prisma.account.findUnique({
                where: {
                    id: body.accountId,
                },
            }),
        ]);
        if (!link)
            throw new errors_1.NotFoundError("LINK NOT FOUND");
        if (!account)
            throw new errors_1.NotFoundError("USER NOT FOUND");
        //if (account.status === 2) throw new ValidationError("USER IN SUSPENSION");
        if (link.status === 0)
            throw new errors_1.ValidationError("INVALID LINK");
        const hashed = yield argon2_1.default.hash(body.password);
        yield prisma_1.prisma.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            yield tx.account.update({
                where: {
                    id: body.accountId,
                },
                data: {
                    password: hashed,
                },
            });
            yield tx.accountResetLink.update({
                where: {
                    id: link.id,
                },
                data: {
                    status: 0,
                },
            });
        }));
        return res.code(200).send({ message: "OK" });
    }
    catch (error) {
        console.log(error);
        if (error instanceof errors_1.ValidationError || error instanceof errors_1.NotFoundError) {
            throw error;
        }
        throw error;
    }
});
exports.resetUserPassword = resetUserPassword;
