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
 * Verifies the mobile "Barcode registration" endpoint:
 *   - gated: 403 without PharmacyMobileAccess
 *   - attach → 200, barcode set, timestamp TOUCHED (so incremental
 *     /medicine/sync?since=<before> re-delivers the medicine)
 *   - attaching the same barcode to another medicine → 409 + existingMedicineId
 *   - replacing a medicine's own barcode → 200
 *
 * Run:  npx ts-node scripts/attach_barcode_itest.ts   (API must be running)
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
        var _a, _b, _c, _d;
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
        const medA = (0, crypto_1.randomUUID)();
        const medB = (0, crypto_1.randomUUID)();
        const BARCODE = "ITEST-BAR-" + Date.now();
        const BARCODE2 = "ITEST-BAR2-" + Date.now();
        try {
            yield prisma_1.prisma.pharmacyMobileAccess.deleteMany({ where: { lineId, userId } });
            yield prisma_1.prisma.medicine.createMany({
                data: [
                    { id: medA, name: "ITEST BarMed A", serialNumber: "IT-BA-" + Date.now(), lineId },
                    { id: medB, name: "ITEST BarMed B", serialNumber: "IT-BB-" + Date.now(), lineId },
                ],
            });
            const before = Date.now();
            // gated without access
            let r = yield fetch(BASE + "/medicine/attach-barcode", {
                method: "PATCH", headers: H,
                body: JSON.stringify({ medicineId: medA, barcode: BARCODE, lineId, userId }),
            });
            ok("attach is gated (403 without mobile access)", r.status === 403, r.status);
            // grant access
            yield prisma_1.prisma.pharmacyMobileAccess.create({ data: { lineId, userId } });
            // attach to A
            r = yield fetch(BASE + "/medicine/attach-barcode", {
                method: "PATCH", headers: H,
                body: JSON.stringify({ medicineId: medA, barcode: BARCODE, lineId, userId }),
            });
            let j = yield r.json();
            ok("attach returns 200", r.status === 200, j);
            const a = yield prisma_1.prisma.medicine.findUnique({ where: { id: medA }, select: { barcode: true, timestamp: true } });
            ok("barcode stored on the medicine", (a === null || a === void 0 ? void 0 : a.barcode) === BARCODE, a === null || a === void 0 ? void 0 : a.barcode);
            ok("timestamp touched (incremental sync will re-deliver)", ((_c = (_b = a === null || a === void 0 ? void 0 : a.timestamp) === null || _b === void 0 ? void 0 : _b.getTime()) !== null && _c !== void 0 ? _c : 0) >= before, a === null || a === void 0 ? void 0 : a.timestamp);
            // incremental sync picks it up
            r = yield fetch(BASE + `/medicine/sync?lineId=${lineId}&since=${before - 1}`, { headers: H });
            j = yield r.json();
            const synced = ((_d = j.medicines) !== null && _d !== void 0 ? _d : []).find((m) => m.id === medA);
            ok("/medicine/sync?since=<before> includes the updated medicine w/ barcode", !!synced && synced.barcode === BARCODE, synced && { barcode: synced.barcode });
            // same barcode on B -> 409 with pointer to A
            r = yield fetch(BASE + "/medicine/attach-barcode", {
                method: "PATCH", headers: H,
                body: JSON.stringify({ medicineId: medB, barcode: BARCODE, lineId, userId }),
            });
            j = yield r.json();
            ok("attaching a taken barcode → 409", r.status === 409, r.status);
            ok("409 carries existingMedicineId (app redirects to restock)", j.existingMedicineId === medA, j);
            // replacing A's own barcode is allowed
            r = yield fetch(BASE + "/medicine/attach-barcode", {
                method: "PATCH", headers: H,
                body: JSON.stringify({ medicineId: medA, barcode: BARCODE2, lineId, userId }),
            });
            ok("replacing the medicine's own barcode → 200", r.status === 200, r.status);
            const a2 = yield prisma_1.prisma.medicine.findUnique({ where: { id: medA }, select: { barcode: true } });
            ok("replacement stored", (a2 === null || a2 === void 0 ? void 0 : a2.barcode) === BARCODE2, a2 === null || a2 === void 0 ? void 0 : a2.barcode);
            // offline-queue idempotency: same clientOpId replayed → short-circuit
            const opId = (0, crypto_1.randomUUID)();
            const BARCODE3 = "ITEST-BAR3-" + Date.now();
            r = yield fetch(BASE + "/medicine/attach-barcode", {
                method: "PATCH", headers: H,
                body: JSON.stringify({ medicineId: medB, barcode: BARCODE3, lineId, userId, clientOpId: opId }),
            });
            j = yield r.json();
            ok("attach with clientOpId → 200 (first apply)", r.status === 200 && !j.duplicate, j);
            const logRow = yield prisma_1.prisma.mobileUploadLog.findUnique({ where: { clientOpId: opId } });
            ok("MobileUploadLog recorded (kind attach-barcode)", (logRow === null || logRow === void 0 ? void 0 : logRow.kind) === "attach-barcode", logRow === null || logRow === void 0 ? void 0 : logRow.kind);
            r = yield fetch(BASE + "/medicine/attach-barcode", {
                method: "PATCH", headers: H,
                body: JSON.stringify({ medicineId: medB, barcode: BARCODE3, lineId, userId, clientOpId: opId }),
            });
            j = yield r.json();
            ok("replaying the same clientOpId → duplicate:true (no double-apply)", r.status === 200 && j.duplicate === true, j);
            console.log("\nATTACH BARCODE ITEST OK");
        }
        finally {
            yield prisma_1.prisma.medicineLogs.deleteMany({ where: { message: { contains: "ITEST BarMed" } } });
            yield prisma_1.prisma.mobileUploadLog.deleteMany({ where: { resultId: { in: [medA, medB] }, kind: "attach-barcode" } });
            yield prisma_1.prisma.medicine.deleteMany({ where: { id: { in: [medA, medB] } } });
            yield prisma_1.prisma.pharmacyMobileAccess.deleteMany({ where: { lineId, userId } });
            yield prisma_1.prisma.$disconnect();
        }
    });
}
main().catch((e) => __awaiter(void 0, void 0, void 0, function* () { console.error(e); process.exitCode = 1; yield prisma_1.prisma.$disconnect(); }));
