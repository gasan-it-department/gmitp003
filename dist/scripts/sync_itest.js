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
 * Integration test for the desktop sync endpoints. Mints a real JWT for an
 * existing account, then exercises ping -> push -> push-again (dedup) ->
 * pull -> update -> pull, asserting idempotency + last-write-wins.
 *
 * Run:  npx ts-node scripts/sync_itest.ts
 */
require("dotenv/config");
const crypto_1 = require("crypto");
const fast_jwt_1 = require("fast-jwt");
const prisma_1 = require("../src/barrel/prisma");
const BASE = "http://localhost:3000";
function assert(label, ok, extra) {
    console.log((ok ? "  PASS  " : "  FAIL  ") + label + (extra !== undefined ? "  " + JSON.stringify(extra) : ""));
    if (!ok)
        throw new Error("FAILED: " + label);
}
function main() {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b;
        const account = yield prisma_1.prisma.account.findFirst({ select: { id: true, lineId: true } });
        if (!account)
            throw new Error("No account in DB to authenticate as.");
        console.log("Using account", account.id, "line", account.lineId);
        const sign = (0, fast_jwt_1.createSigner)({ key: process.env.JWT_SECRET });
        const token = sign({ id: account.id });
        const H = { Authorization: "Bearer " + token, "Content-Type": "application/json" };
        // 1) ping
        let r = yield fetch(BASE + "/sync/ping", { headers: H });
        let j = yield r.json();
        assert("ping ok", r.status === 200 && j.ok === true);
        // 2) push a medicine row
        const id = (0, crypto_1.randomUUID)();
        const row = {
            id,
            serial_number: "MED-ITEST",
            barcode: "ITEST-0001",
            name: "ITEST Amoxicillin",
            descr: "Antibiotic 500mg",
            updated_at: new Date().toISOString(),
            deleted_at: null,
        };
        r = yield fetch(BASE + "/sync/push", { method: "POST", headers: H, body: JSON.stringify({ table: "medicine", rows: [row] }) });
        j = yield r.json();
        assert("push inserts 1", r.status === 200 && j.count === 1, j);
        // 3) push the SAME row again -> idempotent upsert, no duplicate row created
        r = yield fetch(BASE + "/sync/push", { method: "POST", headers: H, body: JSON.stringify({ table: "medicine", rows: [row] }) });
        yield r.json();
        const dupCount = yield prisma_1.prisma.syncRecord.count({ where: { tableName: "medicine", recordId: id } });
        assert("re-push does not duplicate (exactly 1 stored row)", dupCount === 1, { dupCount });
        // 4) pull from scratch -> our row is returned
        r = yield fetch(BASE + "/sync/pull?table=medicine", { headers: H });
        j = yield r.json();
        const pulled = j.rows.find((x) => x.id === id);
        assert("pull returns the pushed row", !!pulled && pulled.name === "ITEST Amoxicillin");
        assert("pull returns a cursor", typeof j.cursor === "string" && j.cursor.length > 0, { cursor: j.cursor });
        // 5) update with a NEWER updated_at -> last-write-wins
        const newer = Object.assign(Object.assign({}, row), { name: "ITEST Amoxicillin 500mg", updated_at: new Date(Date.now() + 5000).toISOString() });
        r = yield fetch(BASE + "/sync/push", { method: "POST", headers: H, body: JSON.stringify({ table: "medicine", rows: [newer] }) });
        yield r.json();
        // 6) incremental pull using the previous cursor returns the updated payload
        r = yield fetch(BASE + "/sync/pull?table=medicine&since=" + encodeURIComponent(j.cursor), { headers: H });
        const j2 = yield r.json();
        const updated = j2.rows.find((x) => x.id === id);
        assert("incremental pull returns updated row", !!updated && updated.name === "ITEST Amoxicillin 500mg", updated === null || updated === void 0 ? void 0 : updated.name);
        // 7) stale push (older updated_at) is ignored
        const stale = Object.assign(Object.assign({}, row), { name: "STALE SHOULD NOT WIN", updated_at: new Date(Date.now() - 60000).toISOString() });
        yield fetch(BASE + "/sync/push", { method: "POST", headers: H, body: JSON.stringify({ table: "medicine", rows: [stale] }) });
        const finalRec = yield prisma_1.prisma.syncRecord.findUnique({ where: { tableName_recordId: { tableName: "medicine", recordId: id } }, select: { payload: true } });
        assert("stale write is rejected (newer value kept)", ((_a = finalRec === null || finalRec === void 0 ? void 0 : finalRec.payload) === null || _a === void 0 ? void 0 : _a.name) === "ITEST Amoxicillin 500mg", (_b = finalRec === null || finalRec === void 0 ? void 0 : finalRec.payload) === null || _b === void 0 ? void 0 : _b.name);
        // cleanup test rows
        yield prisma_1.prisma.syncRecord.deleteMany({ where: { tableName: "medicine", recordId: id } });
        console.log("\nSYNC ITEST OK — cleaned up.");
    });
}
main()
    .catch((e) => { console.error(e); process.exitCode = 1; })
    .finally(() => __awaiter(void 0, void 0, void 0, function* () { yield prisma_1.prisma.$disconnect(); }));
