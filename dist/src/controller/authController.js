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
exports.registerController = exports.authController = void 0;
const prisma_1 = require("../barrel/prisma");
const argon2_1 = __importDefault(require("argon2"));
const errors_1 = require("../errors/errors");
const authController = (request, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    try {
        const { username, password } = request.body;
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
        const token = yield res.jwtSign({ id: user.id, username: user.username });
        if (user.line && user.line.status === 0) {
            console.log("Get");
            return res.code(200).send({
                message: "Line Deactivated",
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
