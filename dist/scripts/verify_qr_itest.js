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
/**
 * Verifies GET /user/my-verify-qr: returns the ID-card verify URL for the
 * logged-in employee, generating + persisting User.verifyCode on first use,
 * and returning the SAME code on repeat calls (permanent → mobile can cache).
 *
 * Run:  npx ts-node scripts/verify_qr_itest.ts   (API must be running)
 */
require("dotenv/config");
const fast_jwt_1 = require("fast-jwt");
const prisma_1 = require("../src/barrel/prisma");
const BASE = "http://localhost:3000";
function ok(label, cond, extra) {
    console.log((cond ? "  PASS  " : "  FAIL  ") + label + (extra !== undefined ? "  " + JSON.stringify(extra) : ""));
    if (!cond)
        throw new Error("FAILED: " + label);
}
function main() {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        const candidates = yield prisma_1.prisma.account.findMany({
            where: { User: { isNot: null } },
            select: { id: true, User: { select: { id: true, verifyCode: true } } },
        });
        const account = candidates.find((a) => { var _a; return (_a = a.User) === null || _a === void 0 ? void 0 : _a.id; });
        if (!((_a = account === null || account === void 0 ? void 0 : account.User) === null || _a === void 0 ? void 0 : _a.id))
            throw new Error("Need an account with a linked User.");
        const token = (0, fast_jwt_1.createSigner)({ key: process.env.JWT_SECRET })({ id: account.id });
        const H = { Authorization: "Bearer " + token };
        const hadCode = account.User.verifyCode;
        try {
            let r = yield fetch(BASE + "/user/my-verify-qr", { headers: H });
            let j = yield r.json();
            ok("returns 200 with code + url", r.status === 200 && !!j.code && !!j.url, j);
            ok("url is the ID-card verify format", /\/verify-id\?code=/.test(j.url), j.url);
            const first = j.code;
            const dbUser = yield prisma_1.prisma.user.findUnique({
                where: { id: account.User.id },
                select: { verifyCode: true },
            });
            ok("verifyCode persisted on the User", (dbUser === null || dbUser === void 0 ? void 0 : dbUser.verifyCode) === first);
            if (hadCode)
                ok("existing code reused (matches ID card)", first === hadCode);
            r = yield fetch(BASE + "/user/my-verify-qr", { headers: H });
            j = yield r.json();
            ok("repeat call returns the SAME code (permanent → cacheable)", j.code === first);
            r = yield fetch(BASE + "/user/my-verify-qr");
            ok("unauthenticated → 401", r.status === 401, r.status);
            console.log("\nVERIFY QR ITEST OK");
        }
        finally {
            yield prisma_1.prisma.$disconnect();
        }
    });
}
main().catch((e) => __awaiter(void 0, void 0, void 0, function* () { console.error(e); process.exitCode = 1; yield prisma_1.prisma.$disconnect(); }));
