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
 * Verifies the Pharmacy "Mobile Access" feature end-to-end:
 *   - a user with no grant: /mobile-access/me = false AND the gated mobile
 *     endpoint (/medicine/sync) returns 403
 *   - grant → /me = true, gate opens, list shows the user, candidates hides them
 *   - re-grant is idempotent (1 row)
 *   - revoke → /me = false, gate closes (403 again)
 *
 * Run:  npx ts-node scripts/mobile_access_itest.ts   (API must be running)
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
        var _a, _b, _c, _d, _e;
        const candidates = yield prisma_1.prisma.account.findMany({
            where: { User: { isNot: null } },
            select: { id: true, lineId: true, User: { select: { id: true } } },
        });
        const account = candidates.find((a) => { var _a; return a.lineId && ((_a = a.User) === null || _a === void 0 ? void 0 : _a.id); });
        if (!(account === null || account === void 0 ? void 0 : account.lineId) || !((_a = account.User) === null || _a === void 0 ? void 0 : _a.id))
            throw new Error("Need an account with a lineId and a linked User.");
        const lineId = account.lineId;
        const userId = account.User.id;
        const token = (0, fast_jwt_1.createSigner)({ key: process.env.JWT_SECRET })({ id: account.id });
        const H = { Authorization: "Bearer " + token, "Content-Type": "application/json" };
        console.log("account", account.id, "line", lineId, "user", userId);
        try {
            // clean slate
            yield prisma_1.prisma.pharmacyMobileAccess.deleteMany({ where: { lineId, userId } });
            // ── not granted → /me false, gate 403 ──
            let r = yield fetch(BASE + "/medicine/mobile-access/me", { headers: H });
            let j = yield r.json();
            ok("me = not granted initially", j.granted === false, j);
            let gate = yield fetch(BASE + "/medicine/sync", { headers: H });
            ok("gated /medicine/sync = 403 when NOT granted", gate.status === 403, gate.status);
            // ── grant ──
            r = yield fetch(BASE + "/medicine/mobile-access", {
                method: "POST", headers: H,
                body: JSON.stringify({ lineId, userId, grantedById: userId }),
            });
            ok("grant returns 200", r.status === 200, r.status);
            r = yield fetch(BASE + "/medicine/mobile-access/me", { headers: H });
            j = yield r.json();
            ok("me = granted after grant", j.granted === true, j);
            gate = yield fetch(BASE + "/medicine/sync", { headers: H });
            ok("gate OPENS when granted (/medicine/sync no longer 403)", gate.status !== 403, gate.status);
            // list shows the user
            r = yield fetch(BASE + "/medicine/mobile-access?lineId=" + lineId, { headers: H });
            j = yield r.json();
            ok("list includes the granted user", ((_b = j.list) !== null && _b !== void 0 ? _b : []).some((x) => x.userId === userId), ((_c = j.list) !== null && _c !== void 0 ? _c : []).length);
            // candidates hides the already-granted user
            r = yield fetch(BASE + "/medicine/mobile-access/candidates?lineId=" + lineId, { headers: H });
            j = yield r.json();
            ok("candidates EXCLUDES the granted user", !((_d = j.list) !== null && _d !== void 0 ? _d : []).some((x) => x.id === userId), ((_e = j.list) !== null && _e !== void 0 ? _e : []).length);
            // re-grant idempotent
            yield fetch(BASE + "/medicine/mobile-access", {
                method: "POST", headers: H,
                body: JSON.stringify({ lineId, userId, grantedById: userId }),
            });
            const cnt = yield prisma_1.prisma.pharmacyMobileAccess.count({ where: { lineId, userId } });
            ok("re-grant is idempotent (exactly 1 row)", cnt === 1, cnt);
            // ── revoke ──
            r = yield fetch(BASE + "/medicine/mobile-access", {
                method: "DELETE", headers: H,
                body: JSON.stringify({ lineId, userId, revokedById: userId }),
            });
            ok("revoke returns 200", r.status === 200, r.status);
            r = yield fetch(BASE + "/medicine/mobile-access/me", { headers: H });
            j = yield r.json();
            ok("me = not granted after revoke", j.granted === false, j);
            gate = yield fetch(BASE + "/medicine/sync", { headers: H });
            ok("gate CLOSES again after revoke (403)", gate.status === 403, gate.status);
            console.log("\nMOBILE ACCESS ITEST OK");
        }
        finally {
            yield prisma_1.prisma.pharmacyMobileAccess.deleteMany({ where: { lineId, userId } });
            yield prisma_1.prisma.medicineLogs.deleteMany({ where: { message: { contains: "mobile pharmacy access" } } });
            yield prisma_1.prisma.$disconnect();
        }
    });
}
main().catch((e) => __awaiter(void 0, void 0, void 0, function* () { console.error(e); process.exitCode = 1; yield prisma_1.prisma.$disconnect(); }));
