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
const PHARMACY = ["medicine", "patients-record", "patient-diagnose", "prescribe-medicine"];
(() => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    // accounts -> their User -> their Module grants (pharmacy slugs)
    const accounts = yield prisma_1.prisma.account.findMany({
        select: { username: true, lineId: true, User: { select: { id: true } } },
    });
    console.log("Pharmacy module grants per account (username -> [slugs]):\n");
    for (const a of accounts) {
        if (!((_a = a.User) === null || _a === void 0 ? void 0 : _a.id)) {
            console.log(`  ${a.username}: (no linked User)`);
            continue;
        }
        const mods = yield prisma_1.prisma.module.findMany({
            where: { userId: a.User.id, moduleName: { in: PHARMACY } },
            select: { moduleName: true },
        });
        const slugs = mods.map((m) => m.moduleName);
        if (slugs.length)
            console.log(`  ${a.username}:  ${slugs.join(", ")}`);
    }
    console.log("\nAll distinct moduleName values in the Module table:");
    const all = yield prisma_1.prisma.module.groupBy({ by: ["moduleName"], _count: { _all: true } });
    for (const g of all.sort((x, y) => x.moduleName.localeCompare(y.moduleName)))
        console.log(`  ${g.moduleName}  (${g._count._all})`);
    yield prisma_1.prisma.$disconnect();
}))().catch((e) => { console.error(e); process.exit(1); });
