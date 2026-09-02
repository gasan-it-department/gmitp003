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
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Proves the desktop login path: create a throwaway account, POST /auth with
 * its credentials, confirm a token comes back in the web's shape, confirm that
 * token is accepted by /sync/ping, then delete the account.
 *
 * Run:  npx ts-node scripts/login_itest.ts
 */
require("dotenv/config");
const argon = __importStar(require("argon2"));
const prisma_1 = require("../src/barrel/prisma");
const BASE = "http://localhost:3000";
function ok(label, cond, extra) {
    console.log((cond ? "  PASS  " : "  FAIL  ") + label + (extra !== undefined ? "  " + JSON.stringify(extra) : ""));
    if (!cond)
        throw new Error("FAILED: " + label);
}
function main() {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c, _d, _e, _f;
        const line = yield prisma_1.prisma.line.findFirst({ select: { id: true } });
        const username = "itest_" + Date.now();
        const password = "Test#12345";
        const hashed = yield argon.hash(password);
        const acct = yield prisma_1.prisma.account.create({
            data: { username, password: hashed, lineId: (_a = line === null || line === void 0 ? void 0 : line.id) !== null && _a !== void 0 ? _a : null, role: "user", active: true, status: 1 },
            select: { id: true },
        });
        console.log("created account", acct.id, "line", line === null || line === void 0 ? void 0 : line.id);
        try {
            // 1) login
            let r = yield fetch(BASE + "/auth", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ username, password }),
            });
            const j = yield r.json();
            const token = (_b = j === null || j === void 0 ? void 0 : j.data) === null || _b === void 0 ? void 0 : _b.token;
            ok("login returns a token", !!token, { error: j === null || j === void 0 ? void 0 : j.error, message: j === null || j === void 0 ? void 0 : j.message });
            ok("login returns line id", ((_c = j === null || j === void 0 ? void 0 : j.data) === null || _c === void 0 ? void 0 : _c.line) === ((_d = line === null || line === void 0 ? void 0 : line.id) !== null && _d !== void 0 ? _d : null), (_e = j === null || j === void 0 ? void 0 : j.data) === null || _e === void 0 ? void 0 : _e.line);
            // 2) wrong password is rejected with an error code
            r = yield fetch(BASE + "/auth", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ username, password: "wrong" }),
            });
            const j2 = yield r.json();
            ok("wrong password rejected", (j2 === null || j2 === void 0 ? void 0 : j2.error) === 2 && !((_f = j2 === null || j2 === void 0 ? void 0 : j2.data) === null || _f === void 0 ? void 0 : _f.token), j2 === null || j2 === void 0 ? void 0 : j2.message);
            // 3) the login token is accepted by the authenticated sync endpoint
            r = yield fetch(BASE + "/sync/ping", { headers: { Authorization: "Bearer " + token } });
            const j3 = yield r.json();
            ok("login token works on /sync/ping", r.status === 200 && j3.ok === true);
            console.log("\nLOGIN ITEST OK");
        }
        finally {
            yield prisma_1.prisma.account.delete({ where: { id: acct.id } });
            console.log("cleaned up account");
            yield prisma_1.prisma.$disconnect();
        }
    });
}
main().catch((e) => __awaiter(void 0, void 0, void 0, function* () { console.error(e); process.exitCode = 1; yield prisma_1.prisma.$disconnect(); }));
