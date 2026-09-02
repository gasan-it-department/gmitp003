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
 * One-time migration: move records that were pushed into the generic SyncRecord
 * store (before real-table sync existed) into the REAL web tables, so they show
 * up in the web app. Idempotent (upsert by id). Removes the SyncRecord row once
 * applied. Tables without a real mapping yet (prescription, prescription_item)
 * are left in SyncRecord.
 *
 * Run:  npx ts-node scripts/migrate_syncrecord_to_real.ts
 */
require("dotenv/config");
const prisma_1 = require("../src/barrel/prisma");
const realSync_1 = require("../src/controller/realSync");
(() => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    const records = yield prisma_1.prisma.syncRecord.findMany();
    console.log("SyncRecord rows:", records.length);
    // resolve a User id per line (prescriptions need one) — pick any account
    // on the line that has a linked User
    const userForLine = new Map();
    function lineUser(lineId) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a, _b;
            if (!lineId)
                return null;
            if (userForLine.has(lineId))
                return userForLine.get(lineId);
            const acct = yield prisma_1.prisma.account.findFirst({
                where: { lineId, User: { isNot: null } },
                select: { User: { select: { id: true } } },
            });
            const uid = (_b = (_a = acct === null || acct === void 0 ? void 0 : acct.User) === null || _a === void 0 ? void 0 : _a.id) !== null && _b !== void 0 ? _b : null;
            userForLine.set(lineId, uid);
            return uid;
        });
    }
    let moved = 0;
    const skipped = {};
    for (const rec of records) {
        if (!(0, realSync_1.isRealTable)(rec.tableName)) {
            skipped[rec.tableName] = ((_a = skipped[rec.tableName]) !== null && _a !== void 0 ? _a : 0) + 1;
            continue;
        }
        try {
            const payload = rec.payload;
            const userId = yield lineUser(rec.lineId);
            yield realSync_1.REAL_PUSH[rec.tableName](payload, { lineId: rec.lineId, userId });
            yield prisma_1.prisma.syncRecord.delete({ where: { id: rec.id } });
            const label = (payload === null || payload === void 0 ? void 0 : payload.firstname)
                ? `${payload.firstname} ${payload.lastname}`
                : (_b = payload === null || payload === void 0 ? void 0 : payload.name) !== null && _b !== void 0 ? _b : rec.recordId;
            console.log(`  moved ${rec.tableName}: ${label}  (line ${rec.lineId})`);
            moved++;
        }
        catch (e) {
            console.log(`  FAILED ${rec.tableName} ${rec.recordId}: ${e instanceof Error ? e.message : e}`);
        }
    }
    console.log(`\nMoved ${moved} record(s) into the real tables.`);
    if (Object.keys(skipped).length)
        console.log("Left in SyncRecord (no real mapping yet):", skipped);
    yield prisma_1.prisma.$disconnect();
}))().catch((e) => { console.error(e); process.exit(1); });
