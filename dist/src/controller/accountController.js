"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
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
exports.resetUserPassword = exports.forgotPassword = exports.sendResetPasswordLink = exports.adminDeleteAccount = exports.adminSetAccountStatus = exports.accountList = void 0;
const prisma_1 = require("../barrel/prisma");
const errors_1 = require("../errors/errors");
const argon2_1 = __importDefault(require("argon2"));
const handler_1 = require("../middleware/handler");
const encryption_1 = require("../service/encryption");
const accountList = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const params = req.query;
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
        // Account-level where. Search filters apply to the linked User; the "hrmo"
        // role filter matches either the HR Management Officer position (created at
        // line registration) OR an account username that looks like an HRMO login.
        const where = { User: Object.assign({}, filter) };
        if (params.filter === "hrmo") {
            where.OR = [
                {
                    User: {
                        is: {
                            Position: {
                                is: {
                                    name: {
                                        contains: "Human Resources Management",
                                        mode: "insensitive",
                                    },
                                },
                            },
                        },
                    },
                },
                { username: { contains: "hrmo", mode: "insensitive" } },
            ];
        }
        const cursor = params.lastCursor ? { id: params.lastCursor } : undefined;
        const accounts = yield prisma_1.prisma.account.findMany({
            where,
            cursor,
            take: parseInt(params.limit, 10) || 20,
            select: {
                User: {
                    select: {
                        id: true,
                        firstName: true,
                        lastName: true,
                        email: true,
                        emailIv: true,
                    },
                },
                id: true,
                username: true,
                status: true,
                active: true,
            },
            skip: cursor ? 1 : 0,
        });
        // `User.email` is encrypted when `emailIv` is set — decrypt before sending
        // and strip the IV from the payload.
        const list = yield Promise.all(accounts.map((a) => __awaiter(void 0, void 0, void 0, function* () {
            var _a, _b, _c;
            let email = (_b = (_a = a.User) === null || _a === void 0 ? void 0 : _a.email) !== null && _b !== void 0 ? _b : null;
            if (((_c = a.User) === null || _c === void 0 ? void 0 : _c.email) && a.User.emailIv) {
                try {
                    email = yield encryption_1.EncryptionService.decrypt(a.User.email, a.User.emailIv);
                }
                catch (_d) {
                    email = null;
                }
            }
            return {
                id: a.id,
                username: a.username,
                status: a.status,
                active: a.active,
                User: a.User
                    ? {
                        id: a.User.id,
                        firstName: a.User.firstName,
                        lastName: a.User.lastName,
                        email,
                    }
                    : null,
            };
        })));
        const nextLastCursorId = list.length > 0 ? list[list.length - 1].id : null;
        const hasMore = accounts.length === (parseInt(params.limit, 10) || 20);
        res.code(200).send({ list, lastCursor: nextLastCursorId, hasMore });
    }
    catch (error) {
        console.log(error);
        res.code(500).send({ message: "Internal Server Error" });
    }
});
exports.accountList = accountList;
// PATCH /account/status { accountId, active }
// Suspend (active=false → status 2) or reactivate (active=true → status 1).
const adminSetAccountStatus = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    const body = req.body;
    if (!body.accountId || typeof body.active !== "boolean") {
        throw new errors_1.ValidationError("INVALID REQUIRED FIELDS");
    }
    try {
        const updated = yield prisma_1.prisma.account.update({
            where: { id: body.accountId },
            data: { active: body.active, status: body.active ? 1 : 2 },
            select: { id: true, active: true, User: { select: { id: true } } },
        });
        // When suspending, kick the user out of any live sessions in real time.
        if (!body.active && ((_a = updated.User) === null || _a === void 0 ? void 0 : _a.id)) {
            try {
                const { notificationSocket } = yield Promise.resolve().then(() => __importStar(require("..")));
                notificationSocket.emitForceLogout(updated.User.id, "Your account has been suspended by an administrator.");
            }
            catch (e) {
                console.warn("[adminSetAccountStatus] force-logout emit failed", e);
            }
        }
        return res.code(200).send({ message: "OK", active: body.active });
    }
    catch (error) {
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError &&
            error.code === "P2025") {
            return res.code(404).send({ message: "Account not found" });
        }
        console.error("[adminSetAccountStatus]", error);
        return res.code(500).send({ message: "Internal Server Error" });
    }
});
exports.adminSetAccountStatus = adminSetAccountStatus;
// DELETE /account/delete { accountId }
// Full delete: the account is removed and the linked User cascade-deletes
// (User.account onDelete: Cascade). Reset links (Restrict) are cleared first.
const adminDeleteAccount = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    const body = req.body;
    if (!body.accountId)
        throw new errors_1.ValidationError("INVALID REQUIRED FIELDS");
    const accountId = body.accountId;
    try {
        // Capture the linked user before deleting so we can force-logout any live
        // session afterwards (the row is gone by then, but the socket room is just
        // an id string).
        const acct = yield prisma_1.prisma.account.findUnique({
            where: { id: accountId },
            select: { User: { select: { id: true } } },
        });
        yield prisma_1.prisma.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            yield tx.accountResetLink.deleteMany({ where: { accountId } });
            yield tx.account.delete({ where: { id: accountId } });
        }));
        if ((_a = acct === null || acct === void 0 ? void 0 : acct.User) === null || _a === void 0 ? void 0 : _a.id) {
            try {
                const { notificationSocket } = yield Promise.resolve().then(() => __importStar(require("..")));
                notificationSocket.emitForceLogout(acct.User.id, "Your account has been removed by an administrator.");
            }
            catch (e) {
                console.warn("[adminDeleteAccount] force-logout emit failed", e);
            }
        }
        return res.code(200).send({ message: "OK" });
    }
    catch (error) {
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            if (error.code === "P2025") {
                return res.code(404).send({ message: "Account not found" });
            }
            if (error.code === "P2003" || error.code === "P2014") {
                return res.code(409).send({
                    message: "This account is linked to records that block deletion. Suspend it instead.",
                });
            }
        }
        console.error("[adminDeleteAccount]", error);
        return res.code(500).send({ message: "Internal Server Error" });
    }
});
exports.adminDeleteAccount = adminDeleteAccount;
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
        const resetLink = `${frontEnd}/public/${line.id}/reset-password/${link.id}/${account.id}`;
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
/**
 * POST /account/forgot-password  (PUBLIC — used by the logged-out login page).
 *
 * Keyed by `username` (Account.username is stored in plaintext; User.email is
 * encrypted, so it can't be queried directly). Looks up the account, decrypts
 * its registered email, mints a one-time reset link and emails it via Resend.
 *
 * SECURITY: always answers 200 with the same generic message so the endpoint
 * can't be used to enumerate which usernames exist / have email on file.
 */
const forgotPassword = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d, _e, _f;
    const body = req.body;
    const username = ((_a = body.username) !== null && _a !== void 0 ? _a : "").trim();
    const generic = {
        message: "If that account exists, a password reset link has been sent to its registered email.",
    };
    if (!username)
        return res.code(200).send(generic);
    try {
        // Mirror the /auth login lookup (exact username match) so the reset
        // targets the same account the user actually signs in with.
        const account = yield prisma_1.prisma.account.findFirst({
            where: { username },
            select: {
                id: true,
                username: true,
                lineId: true,
                User: { select: { email: true, emailIv: true } },
                line: {
                    select: {
                        province: { select: { name: true } },
                        municipal: { select: { name: true } },
                    },
                },
            },
        });
        // Nothing to do — but still answer generically (no enumeration).
        if (!account || !account.lineId || !((_b = account.User) === null || _b === void 0 ? void 0 : _b.email)) {
            return res.code(200).send(generic);
        }
        let email = account.User.email;
        if (account.User.emailIv) {
            try {
                email = yield encryption_1.EncryptionService.decrypt(account.User.email, account.User.emailIv);
            }
            catch (_g) {
                email = null;
            }
        }
        if (!email)
            return res.code(200).send(generic);
        const frontEnd = (process.env.VITE_LOCAL_FRONTEND_URL || "").replace(/\/+$/, "");
        const link = yield prisma_1.prisma.accountResetLink.create({
            data: { accountId: account.id },
        });
        const resetLink = `${frontEnd}/public/${account.lineId}/reset-password/${link.id}/${account.id}`;
        const municipal = ((_d = (_c = account.line) === null || _c === void 0 ? void 0 : _c.municipal) === null || _d === void 0 ? void 0 : _d.name) || "Gasan";
        const province = ((_f = (_e = account.line) === null || _e === void 0 ? void 0 : _e.province) === null || _f === void 0 ? void 0 : _f.name) || "Marinduque";
        const emailSubject = "Password Reset Request - Gasan Municipal Portal";
        const emailBody = `
PASSWORD RESET REQUEST

Dear ${account.username},

You have requested to reset your password for your Gasan Municipal Portal account.

To reset your password, please open the following link:
${resetLink}


If you did not request this password reset, please ignore this email. Your account security has not been compromised.

Please note:
- The link can only be used once
- You will be prompted to create a new password
- After resetting, log in with your new password

For security reasons, never share your password or this reset link with anyone.

HR Management
Municipality of ${municipal}
${province}, Philippines
`;
        yield (0, handler_1.sendEmail)(emailSubject, email, emailBody, "Gasan Municipal Portal");
        return res.code(200).send(generic);
    }
    catch (error) {
        // Log server-side, but never leak the failure to the caller.
        console.error("[forgotPassword]", error);
        return res.code(200).send(generic);
    }
});
exports.forgotPassword = forgotPassword;
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
