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
    const lines = yield prisma_1.prisma.line.findMany({ select: { id: true } });
    console.log("LINES:", lines.length, lines.map((l) => l.id));
    const accts = yield prisma_1.prisma.account.findMany({ select: { username: true, lineId: true } });
    console.log("\nACCOUNTS (username -> lineId):");
    for (const a of accts)
        console.log("  ", a.username, "->", a.lineId);
    const byLine = yield prisma_1.prisma.patient.groupBy({ by: ["lineId"], _count: { _all: true } });
    console.log("\nPATIENTS per lineId:");
    for (const g of byLine)
        console.log("  ", g.lineId, "=", g._count._all);
    const recent = yield prisma_1.prisma.patient.findMany({
        select: { firstname: true, lastname: true, lineId: true, timestamp: true },
        orderBy: { timestamp: "desc" },
        take: 8,
    });
    console.log("\nMOST RECENT 8 PATIENTS:");
    for (const p of recent)
        console.log("  ", p.timestamp.toISOString(), p.firstname, p.lastname, "line:", p.lineId);
    yield prisma_1.prisma.$disconnect();
}))().catch((e) => { console.error(e); process.exit(1); });
