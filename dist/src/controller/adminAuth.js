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
exports.creteAdmin = exports.adminAuth = void 0;
const prisma_1 = require("../barrel/prisma");
const argon2_1 = __importDefault(require("argon2"));
const adminAuth = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const params = req.body;
        const username = (_a = params.username) === null || _a === void 0 ? void 0 : _a.trim();
        const password = params.password;
        if (!username || !password) {
            return res.code(400).send({ message: "Bad Request!" });
        }
        // Exact (case-insensitive) match — a `contains` match would let a partial
        // username sign in as a different admin.
        const admin = yield prisma_1.prisma.admin.findFirst({
            where: {
                username: { equals: username, mode: "insensitive" },
            },
        });
        if (!admin) {
            return res.code(200).send({ error: 1, message: "Account not found!" });
        }
        const verified = yield argon2_1.default.verify(admin.password, password);
        if (!verified) {
            return res.code(200).send({ error: 2, message: "Incorrect Password!" });
        }
        const token = yield res.jwtSign({ id: admin.id, username: admin.username });
        return res
            .code(200)
            .send({ admin: { id: admin.id, username: admin.username, token } });
    }
    catch (error) {
        console.error("[adminAuth]", error);
        // Always answer — the old code returned nothing on error, leaving the
        // client hanging on an empty 200.
        return res.code(500).send({ error: 9, message: "Internal Server Error" });
    }
});
exports.adminAuth = adminAuth;
const creteAdmin = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const body = req.body;
        if (!body.username || !body.password) {
            return res.code(400).send({ message: "Bad Request!" });
        }
        const { username, password } = body;
        const admin = yield prisma_1.prisma.admin.findFirst({
            where: {
                username: { contains: username, mode: "insensitive" },
            },
        });
        if (admin) {
            return res
                .code(200)
                .send({ error: 1, message: "Username already exist!" });
        }
        const hashedPassword = yield argon2_1.default.hash(password);
        const response = yield prisma_1.prisma.admin.create({
            data: {
                username,
                password: hashedPassword,
            },
        });
        if (!response) {
            res
                .code(409)
                .send({ message: "Something went wrong, please try again!" });
        }
        res.code(200).send({ error: 0, message: "OK" });
    }
    catch (error) {
        res.code(500).send({ message: "Internal Server Error" });
    }
});
exports.creteAdmin = creteAdmin;
