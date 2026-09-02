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
exports.registerController = exports.sessionLine = exports.authController = void 0;
const prisma_1 = require("../barrel/prisma");
const argon2_1 = __importDefault(require("argon2"));
const errors_1 = require("../errors/errors");
const authController = (request, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d;
    try {
        const { username, password } = request.body;
        console.log({ username, password });
        if (!username || !password) {
            return res
                .code(400)
                .send({ message: "Username and password are required", error: 10 });
        }
        const user = yield prisma_1.prisma.account.findFirst({
            where: {
                username: username,
            },
            include: {
                User: {
                    select: {
                        departmentId: true,
                        id: true,
                        privilege: { select: { super: true } },
                    },
                },
                line: {
                    select: {
                        status: true,
                    },
                },
            },
        });
        if (!user) {
            return res.code(200).send({ message: "User not found", error: 1 });
        }
        // if (user.status === 2) {
        //   return res.code(200).send({ message: "Account suspended", error: 4 });
        // }
        const mathced = yield argon2_1.default.verify(user.password, password);
        if (!mathced) {
            return res.code(200).send({ message: "Incorrect password", error: 2 });
        }
        // Suspended accounts (e.g. ended provisional engagements) cannot sign in.
        if (user.active === false) {
            return res.code(200).send({
                message: "This account has been disabled. Please contact HR.",
                error: 4,
            });
        }
        const token = yield res.jwtSign({ id: user.id, username: user.username });
        // Block sign-in on any non-active line (0 Inactive / 2 Suspended), not just
        // status 0 — matches the real-time force-logout when a line is suspended.
        if (user.line && user.line.status !== 1) {
            return res.code(200).send({
                message: user.line.status === 2
                    ? "Line Suspended"
                    : "Line Deactivated",
                error: 4,
                data: {
                    username: user.username,
                    token: token,
                    id: user.id,
                },
            });
        }
        if (user.lineId === null) {
            return res.code(200).send({
                message: "User is not assigned to a line",
                error: 3,
                data: {
                    username: user.username,
                    token: token,
                    id: user.id,
                },
            });
        }
        console.log({ user });
        res.code(200).send({
            data: {
                username: user.username,
                token: token,
                id: (_a = user.User) === null || _a === void 0 ? void 0 : _a.id,
                line: user.lineId,
                departmentId: (_b = user.User) === null || _b === void 0 ? void 0 : _b.departmentId,
                // Super-admins bypass per-storage access in the desktop app (mirrors
                // the server rule). Extra field; other clients ignore it.
                super: !!((_d = (_c = user.User) === null || _c === void 0 ? void 0 : _c.privilege) === null || _d === void 0 ? void 0 : _d.super),
            },
        });
    }
    catch (error) {
        console.log(error);
        res.code(500).send({
            message: "Internal Server Error",
            error: error instanceof Error ? error.message : "An unexpected error occurred",
        });
    }
});
exports.authController = authController;
/**
 * GET /auth/session-line — which line does the AUTHENTICATED session belong
 * to? Lets the web's root page send an already-signed-in user straight to
 * their line's control panel (older sessions never persisted the line
 * client-side). Token carries the ACCOUNT id.
 */
const sessionLine = (request, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c;
    const accountId = (_a = request.user) === null || _a === void 0 ? void 0 : _a.id;
    if (!accountId)
        return res.code(401).send({ message: "Unauthorized" });
    try {
        const account = yield prisma_1.prisma.account.findUnique({
            where: { id: accountId },
            select: { lineId: true, User: { select: { id: true } } },
        });
        if (!account)
            return res.code(404).send({ message: "Account not found" });
        return res.code(200).send({
            lineId: account.lineId,
            userId: (_c = (_b = account.User) === null || _b === void 0 ? void 0 : _b.id) !== null && _c !== void 0 ? _c : null,
        });
    }
    catch (error) {
        console.log(error);
        return res.code(500).send({ message: "Failed to resolve the session line" });
    }
});
exports.sessionLine = sessionLine;
const registerController = (request, res) => __awaiter(void 0, void 0, void 0, function* () {
    const data = request.body;
    if (!data.username || !data.password)
        throw new errors_1.ValidationError("BAD_REQUEST");
    try {
        yield prisma_1.prisma.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            const existingUser = yield tx.account.findFirst({
                where: { username: { contains: data.username, mode: "insensitive" } },
            });
            if (existingUser) {
                return res.code(400).send({ message: "User already exists" });
            }
            const hashed = yield argon2_1.default.hash(data.password);
            const newUser = yield tx.account.create({
                data: {
                    username: data.username,
                    password: hashed,
                    lineId: "c039c8fd-8058-4e07-820e-7a3f36dc108d",
                },
            });
            const user = yield tx.user.create({
                data: {
                    username: data.username,
                    lastName: data.lastName,
                    level: 2,
                    firstName: data.firstName,
                    middleName: "dasdasd",
                    email: data.email,
                    accountId: newUser.id,
                    lineId: "c039c8fd-8058-4e07-820e-7a3f36dc108d",
                },
            });
            console.log("user created", user);
        }));
    }
    catch (error) {
        console.log(error);
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw new errors_1.AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
        }
        throw error;
    }
});
exports.registerController = registerController;
