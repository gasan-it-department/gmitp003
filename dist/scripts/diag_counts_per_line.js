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
    console.log("Per-line syncable record counts (patient / medicine / stock / diagnose=type0):\n");
    for (const l of lines) {
        const [patients, medicines, stock, diag] = yield Promise.all([
            prisma_1.prisma.patient.count({ where: { lineId: l.id } }),
            prisma_1.prisma.medicine.count({ where: { lineId: l.id } }),
            prisma_1.prisma.medicineStock.count({ where: { lineId: l.id } }),
            prisma_1.prisma.patientRecord.count({ where: { type: 0, patient: { lineId: l.id } } }),
        ]);
        const total = patients + medicines + stock + diag;
        if (total > 0)
            console.log(`  line ${l.id}:  patients=${patients} medicines=${medicines} stock=${stock} diagnose=${diag}  => total ${total}`);
    }
    console.log("\n(The line whose total = 5 is the one your desktop is logged into.)");
    yield prisma_1.prisma.$disconnect();
}))().catch((e) => { console.error(e); process.exit(1); });
