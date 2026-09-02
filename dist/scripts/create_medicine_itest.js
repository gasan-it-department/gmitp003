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
 * Verifies the mobile "create medicine on the spot" upload path
 * (POST /medicine/scan-log with a client-supplied id):
 *   - gated: 403 without PharmacyMobileAccess
 *   - create honours the client id + generates a serial + writes the
 *     web-parity MedicineLogs entry
 *   - replaying the same op (same barcode) → mode "updated", same id
 *   - a barcode that already belongs to ANOTHER medicine → returns that
 *     medicine's id (mobile remaps its local references)
 *
 * Run:  npx ts-node scripts/create_medicine_itest.ts   (API must be running)
 */
require("dotenv/config");
const crypto_1 = require("crypto");
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
            select: { id: true, lineId: true, User: { select: { id: true } } },
        });
        const account = candidates.find((a) => { var _a; return a.lineId && ((_a = a.User) === null || _a === void 0 ? void 0 : _a.id); });
        if (!(account === null || account === void 0 ? void 0 : account.lineId) || !((_a = account.User) === null || _a === void 0 ? void 0 : _a.id))
            throw new Error("Need an account with a lineId and a linked User.");
        const lineId = account.lineId;
        const userId = account.User.id;
        const token = (0, fast_jwt_1.createSigner)({ key: process.env.JWT_SECRET })({ id: account.id });
        const H = { Authorization: "Bearer " + token, "Content-Type": "application/json" };
        const clientId = (0, crypto_1.randomUUID)();
        const otherId = (0, crypto_1.randomUUID)();
        const BARCODE = "ITEST-CRT-" + Date.now();
        const OTHER_BARCODE = "ITEST-CRT2-" + Date.now();
        try {
            yield prisma_1.prisma.pharmacyMobileAccess.deleteMany({ where: { lineId, userId } });
            // gated without access
            let r = yield fetch(BASE + "/medicine/scan-log", {
                method: "POST", headers: H,
                body: JSON.stringify({ id: clientId, barcode: BARCODE, name: "ITEST CreateMed", lineId, scannedByUserId: userId }),
            });
            ok("create is gated (403 without mobile access)", r.status === 403, r.status);
            yield prisma_1.prisma.pharmacyMobileAccess.create({ data: { lineId, userId } });
            // create honours the client id
            r = yield fetch(BASE + "/medicine/scan-log", {
                method: "POST", headers: H,
                body: JSON.stringify({ id: clientId, barcode: BARCODE, name: "ITEST CreateMed", notes: "500mg tab", lineId, scannedByUserId: userId }),
            });
            let j = yield r.json();
            ok("create returns 200 + mode created", r.status === 200 && j.mode === "created", j);
            ok("server used the CLIENT id (queued stock-adds stay resolvable)", j.id === clientId, { got: j.id });
            ok("serial generated server-side", typeof j.serialNumber === "string" && j.serialNumber.length > 0, j.serialNumber);
            const log = yield prisma_1.prisma.medicineLogs.findFirst({
                where: { message: { contains: `Label: ITEST CreateMed` } },
            });
            ok("web-parity MedicineLogs entry written (action 1)", !!log && log.action === 1, log === null || log === void 0 ? void 0 : log.message);
            // replay (offline queue retry) → updated, same id, no duplicate row
            r = yield fetch(BASE + "/medicine/scan-log", {
                method: "POST", headers: H,
                body: JSON.stringify({ id: clientId, barcode: BARCODE, name: "ITEST CreateMed", lineId, scannedByUserId: userId }),
            });
            j = yield r.json();
            ok("replay → mode updated with the same id (idempotent)", j.mode === "updated" && j.id === clientId, j);
            const cnt = yield prisma_1.prisma.medicine.count({ where: { OR: [{ id: clientId }, { barcode: BARCODE }] } });
            ok("no duplicate medicine row", cnt === 1, cnt);
            // remap case: create op whose barcode already belongs to another med
            yield prisma_1.prisma.medicine.create({
                data: { id: otherId, name: "ITEST OtherMed", serialNumber: "IT-OTH-" + Date.now(), barcode: OTHER_BARCODE, lineId },
            });
            const wantedId = (0, crypto_1.randomUUID)();
            r = yield fetch(BASE + "/medicine/scan-log", {
                method: "POST", headers: H,
                body: JSON.stringify({ id: wantedId, barcode: OTHER_BARCODE, name: "ITEST OtherMed renamed", lineId, scannedByUserId: userId }),
            });
            j = yield r.json();
            ok("existing-barcode create → returns the EXISTING medicine id (mobile remaps)", j.mode === "updated" && j.id === otherId, { got: j.id, wanted: wantedId });
            console.log("\nCREATE MEDICINE ITEST OK");
        }
        finally {
            yield prisma_1.prisma.medicineLogs.deleteMany({ where: { message: { contains: "ITEST CreateMed" } } });
            yield prisma_1.prisma.medicine.deleteMany({ where: { id: { in: [clientId, otherId] } } });
            yield prisma_1.prisma.pharmacyMobileAccess.deleteMany({ where: { lineId, userId } });
            yield prisma_1.prisma.$disconnect();
        }
    });
}
main().catch((e) => __awaiter(void 0, void 0, void 0, function* () { console.error(e); process.exitCode = 1; yield prisma_1.prisma.$disconnect(); }));
