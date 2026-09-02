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
require("dotenv/config");
const prisma_1 = require("../src/barrel/prisma");
(() => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    const total = yield prisma_1.prisma.syncRecord.count();
    console.log("SyncRecord rows total:", total);
    const byTable = yield prisma_1.prisma.syncRecord.groupBy({ by: ["tableName"], _count: { _all: true } });
    console.log("by table:");
    for (const g of byTable)
        console.log("  ", g.tableName, "=", g._count._all);
    const recent = yield prisma_1.prisma.syncRecord.findMany({
        orderBy: { serverAt: "desc" },
        take: 10,
        select: { tableName: true, recordId: true, lineId: true, serverAt: true, payload: true },
    });
    console.log("\nMOST RECENT 10 SyncRecord rows:");
    for (const r of recent) {
        const p = r.payload;
        const label = (p === null || p === void 0 ? void 0 : p.firstname) ? p.firstname + " " + p.lastname : (_a = p === null || p === void 0 ? void 0 : p.name) !== null && _a !== void 0 ? _a : "";
        console.log("  ", r.serverAt.toISOString(), r.tableName, "line:", r.lineId, "|", label);
    }
    yield prisma_1.prisma.$disconnect();
}))().catch((e) => { console.error(e); process.exit(1); });
