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
/** Reproduces "patient with address synced but not showing in web". */
require("dotenv/config");
const crypto_1 = require("crypto");
const fast_jwt_1 = require("fast-jwt");
const prisma_1 = require("../src/barrel/prisma");
const BASE = "http://localhost:3000";
function main() {
    return __awaiter(this, void 0, void 0, function* () {
        const account = yield prisma_1.prisma.account.findFirst({ where: { lineId: { not: undefined } }, select: { id: true, lineId: true } });
        if (!(account === null || account === void 0 ? void 0 : account.lineId))
            throw new Error("no account with line");
        const token = (0, fast_jwt_1.createSigner)({ key: process.env.JWT_SECRET })({ id: account.id });
        const H = { Authorization: "Bearer " + token, "Content-Type": "application/json" };
        // real Gasan address from PSGC, exactly what the desktop form would send
        const provinces = yield (yield fetch("https://psgc.gitlab.io/api/regions/170000000/provinces/")).json();
        const marinduque = provinces.find((p) => p.name.includes("Marinduque"));
        const muns = yield (yield fetch(`https://psgc.gitlab.io/api/provinces/${marinduque.code}/municipalities/`)).json();
        const gasan = muns.find((m) => m.name.includes("Gasan"));
        const brgys = yield (yield fetch(`https://psgc.gitlab.io/api/municipalities/${gasan.code}/barangays/`)).json();
        const brgy = brgys[0];
        console.log("address codes:", { region: "170000000", province: marinduque.code, municipal: gasan.code, barangay: brgy.code });
        const id = (0, crypto_1.randomUUID)();
        const patient = {
            id, firstname: "ADDR", middlename: "", lastname: "Test",
            birthday: null, phone: "0917", email: null, illi: 0,
            region_id: "170000000", region_name: "MIMAROPA",
            province_id: marinduque.code, province_name: "Marinduque",
            municipal_id: gasan.code, municipal_name: "Gasan",
            barangay_id: brgy.code, barangay_name: brgy.name,
            updated_at: new Date().toISOString(), deleted_at: null,
        };
        const r = yield fetch(BASE + "/sync/push", { method: "POST", headers: H, body: JSON.stringify({ table: "patient", rows: [patient] }) });
        const j = yield r.json();
        console.log("PUSH RESPONSE:", JSON.stringify(j, null, 2));
        const inDb = yield prisma_1.prisma.patient.findUnique({ where: { id } });
        console.log("LANDED IN PATIENT TABLE? ", !!inDb);
        if (inDb)
            console.log("  lineId:", inDb.lineId, " barangayId:", inDb.barangayId);
        yield prisma_1.prisma.patient.deleteMany({ where: { id } });
        yield prisma_1.prisma.$disconnect();
    });
}
main().catch((e) => __awaiter(void 0, void 0, void 0, function* () { console.error(e); yield prisma_1.prisma.$disconnect(); }));
