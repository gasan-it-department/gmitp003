"use strict";
// Low-stock alert helpers — MEDICINE-LEVEL.
//
// Business rules (one threshold per MEDICINE, not per batch):
//   * A medicine is "low" when Medicine.lowStockThreshold > 0 AND the SUM
//     of actualStock across EVERY batch row of that medicine in the line
//     is <= that threshold.
//   * We don't spam: an active medicine-level MedicineAlert (type=1,
//     medicineId set) means the low state is already known. We only emit
//     when transitioning INTO the state.
//   * When the total rises back above the threshold (restock), the
//     medicine's alerts are cleared so the next dip notifies again.
//   * Notifications fan out to storage-access holders + every Pharmacy
//     module user in the line.
//
// Both helpers keep their historical (tx, stockId) signatures — every
// stock mutation site calls them with the touched batch row, and the
// helpers resolve the medicine from it.
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
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
exports.checkAndNotifyLowStock = checkAndNotifyLowStock;
exports.clearLowStockAlerts = clearLowStockAlerts;
/** SUM of actualStock across every batch row of the medicine (line-wide). */
function medicineTotal(tx, medicineId) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        const agg = yield tx.medicineStock.aggregate({
            where: { medicineId },
            _sum: { actualStock: true },
        });
        return (_a = agg._sum.actualStock) !== null && _a !== void 0 ? _a : 0;
    });
}
/**
 * After a stock row has been mutated, check whether its MEDICINE crossed
 * into low-stock state (total <= Medicine.lowStockThreshold). If so,
 * notify once and plant a medicine-level sentinel alert.
 */
function checkAndNotifyLowStock(tx, stockId) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b;
        const stock = yield tx.medicineStock.findUnique({
            where: { id: stockId },
            include: {
                medicine: {
                    select: {
                        id: true,
                        name: true,
                        serialNumber: true,
                        lowStockThreshold: true,
                    },
                },
                MedicineStorage: {
                    select: { id: true, name: true, refNumber: true, lineId: true },
                },
            },
        });
        if (!stock || !stock.medicine || !stock.MedicineStorage)
            return null;
        const threshold = stock.medicine.lowStockThreshold;
        if (threshold <= 0)
            return null;
        const total = yield medicineTotal(tx, stock.medicine.id);
        if (total > threshold)
            return null;
        // Already in a known low state for this MEDICINE? Skip.
        const existing = yield tx.medicineAlert.findFirst({
            where: { medicineId: stock.medicine.id, type: 1 },
            orderBy: { timestamp: "desc" },
        });
        if (existing)
            return null;
        // Sentinel — bound to the touched row (FK), keyed by the medicine.
        yield tx.medicineAlert.create({
            data: {
                type: 1,
                count: total,
                medicineId: stock.medicine.id,
                medicineStockId: stock.id,
                expiration: (_a = stock.expiration) !== null && _a !== void 0 ? _a : null,
            },
        });
        const lineId = stock.MedicineStorage.lineId;
        const [accessRows, moduleUsers] = yield Promise.all([
            tx.medicineStorageAccess.findMany({
                where: { medicineStorageId: stock.MedicineStorage.id },
                select: { userId: true },
            }),
            tx.module.findMany({
                where: {
                    lineId,
                    OR: [
                        { moduleName: { equals: "medicine", mode: "insensitive" } },
                        { moduleName: { equals: "Pharmacy", mode: "insensitive" } },
                    ],
                },
                select: { userId: true },
            }),
        ]);
        const recipientIds = [
            ...new Set([
                ...accessRows.map((a) => a.userId),
                ...moduleUsers.map((m) => m.userId),
            ]),
        ];
        if (recipientIds.length === 0)
            return { notified: 0 };
        const isOut = total <= 0;
        const title = isOut ? "Out of stock" : "Low stock alert";
        const message = `${stock.medicine.name} (${stock.medicine.serialNumber}) ` +
            (isOut
                ? "is OUT of stock across all storages."
                : `is low: ${total} left in total (threshold ${threshold}).`);
        const path = `medicine/storage/${stock.MedicineStorage.id}`;
        const created = yield Promise.all(recipientIds.map((userId) => tx.medicineNotification.create({
            data: {
                userId,
                view: 0,
                title,
                message,
                lineId,
                path,
                type: 1,
            },
            select: {
                id: true,
                userId: true,
                title: true,
                message: true,
                lineId: true,
                path: true,
                timestamp: true,
                type: true,
                view: true,
            },
        })));
        try {
            const { notificationSocket } = yield Promise.resolve().then(() => __importStar(require("..")));
            for (const n of created) {
                notificationSocket.emitMedicineNotification(lineId, {
                    id: n.id,
                    userId: n.userId,
                    title: n.title,
                    message: n.message,
                    lineId: n.lineId,
                    path: (_b = n.path) !== null && _b !== void 0 ? _b : undefined,
                    timestamp: typeof n.timestamp === "string"
                        ? n.timestamp
                        : n.timestamp.toISOString(),
                    type: n.type,
                    view: n.view,
                });
            }
        }
        catch (e) {
            console.warn("[medicineAlerts] socket emit failed:", e);
        }
        return { notified: recipientIds.length };
    });
}
/**
 * After a restock/add, clear the MEDICINE's active low-stock alerts if its
 * total is back above the threshold — so the next dip notifies again.
 * (Also clears any legacy per-stock alerts bound to this row.)
 */
function clearLowStockAlerts(tx, stockId) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b;
        const stock = yield tx.medicineStock.findUnique({
            where: { id: stockId },
            select: {
                id: true,
                medicineId: true,
                medicine: { select: { lowStockThreshold: true } },
            },
        });
        let count = 0;
        if (stock === null || stock === void 0 ? void 0 : stock.medicineId) {
            const threshold = (_b = (_a = stock.medicine) === null || _a === void 0 ? void 0 : _a.lowStockThreshold) !== null && _b !== void 0 ? _b : 0;
            const total = yield medicineTotal(tx, stock.medicineId);
            if (threshold <= 0 || total > threshold) {
                const r = yield tx.medicineAlert.deleteMany({
                    where: { medicineId: stock.medicineId, type: 1 },
                });
                count += r.count;
            }
        }
        // Legacy per-stock alerts (pre-medicine-level era) — always clearable.
        const legacy = yield tx.medicineAlert.deleteMany({
            where: { medicineStockId: stockId, medicineId: null, type: 1 },
        });
        return count + legacy.count;
    });
}
