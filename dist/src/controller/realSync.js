"use strict";
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
exports.isRealTable = exports.REAL_PULL = exports.REAL_PUSH = void 0;
const prisma_1 = require("../barrel/prisma");
const handler_1 = require("../middleware/handler");
const notificationEvents_1 = require("../service/notificationEvents");
const storageAccessController_1 = require("./storageAccessController");
const s = (v) => {
    if (v === null || v === undefined)
        return null;
    const t = String(v).trim();
    return t === "" ? null : t;
};
const iso = (d) => (d ? d.toISOString() : null);
/**
 * PSGC address ids (region/province/municipal/barangay) are FKs into lookup
 * tables that are only partially seeded — they're filled in on demand (see
 * lineController) as codes are used. A desktop patient carries both the PSGC
 * codes AND the resolved names (from the same public PSGC API the web uses), so
 * we create any missing lookup rows here (parent-first) instead of letting an
 * unseeded code fail the whole patient upsert. If the lookup itself can't be
 * written for some reason, we fall back to keeping only codes that already
 * exist, so the patient still syncs either way.
 */
function resolveAddressIds(row) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c, _d;
        const rId = s(row.region_id);
        const pId = s(row.province_id);
        const mId = s(row.municipal_id);
        const bId = s(row.barangay_id);
        try {
            if (rId)
                yield prisma_1.prisma.region.upsert({
                    where: { id: rId },
                    create: { id: rId, name: (_a = s(row.region_name)) !== null && _a !== void 0 ? _a : rId },
                    update: {},
                });
            if (pId)
                yield prisma_1.prisma.province.upsert({
                    where: { id: pId },
                    create: { id: pId, name: (_b = s(row.province_name)) !== null && _b !== void 0 ? _b : pId, regionId: rId !== null && rId !== void 0 ? rId : undefined },
                    update: {},
                });
            if (mId)
                yield prisma_1.prisma.municipal.upsert({
                    where: { id: mId },
                    create: { id: mId, name: (_c = s(row.municipal_name)) !== null && _c !== void 0 ? _c : mId, provinceId: pId !== null && pId !== void 0 ? pId : undefined },
                    update: {},
                });
            if (bId)
                yield prisma_1.prisma.barangay.upsert({
                    where: { id: bId },
                    create: { id: bId, name: (_d = s(row.barangay_name)) !== null && _d !== void 0 ? _d : bId, municipalId: mId !== null && mId !== void 0 ? mId : undefined },
                    update: {},
                });
            return { regionId: rId, provinceId: pId, municipalId: mId, barangayId: bId };
        }
        catch (_e) {
            const keep = (find, id) => __awaiter(this, void 0, void 0, function* () { return (id && (yield find(id)) ? id : null); });
            return {
                regionId: yield keep((id) => prisma_1.prisma.region.findUnique({ where: { id }, select: { id: true } }), rId),
                provinceId: yield keep((id) => prisma_1.prisma.province.findUnique({ where: { id }, select: { id: true } }), pId),
                municipalId: yield keep((id) => prisma_1.prisma.municipal.findUnique({ where: { id }, select: { id: true } }), mId),
                barangayId: yield keep((id) => prisma_1.prisma.barangay.findUnique({ where: { id }, select: { id: true } }), bId),
            };
        }
    });
}
/**
 * Write the same MedicineLogs audit entry the web writes for a pharmacy action.
 * action codes match the web: 0 remove, 1 add, 2 update, 3/4 dispense. Logging
 * is best-effort and never blocks the sync. Skipped without a User id.
 */
function audit(action, message, ctx) {
    return __awaiter(this, void 0, void 0, function* () {
        if (!ctx.userId)
            return;
        try {
            yield prisma_1.prisma.medicineLogs.create({
                data: { action, message, userId: ctx.userId, lineId: ctx.lineId },
            });
        }
        catch (_a) {
            /* audit log is best-effort */
        }
    });
}
/**
 * Fire the same notifications the web's createPrescriptions does when a NEW
 * prescription first syncs: a real-time MedicineNotification (pharmacy feed) and
 * a bell Notification for every pharmacy-module user on the line (except the
 * prescriber). Best-effort — never blocks the sync.
 */
// "Lastname, Firstname" of whoever performed the action (the prescriber /
// dispenser), or a sensible fallback.
function actorName(ctx) {
    return __awaiter(this, void 0, void 0, function* () {
        if (!ctx.userId)
            return "Pharmacy Desktop";
        const user = yield prisma_1.prisma.user.findUnique({
            where: { id: ctx.userId },
            select: { firstName: true, lastName: true },
        });
        return user ? `${user.lastName}, ${user.firstName}` : "Pharmacy Desktop";
    });
}
/**
 * Core notifier shared by the prescribe + dispense events. Creates the realtime
 * MedicineNotification (→ socket + wakes desktop long-polls) and a per-user bell
 * notification for every OTHER pharmacy user on the line (the actor is skipped,
 * and the long-poll excludes `userId==caller` too — so nobody is notified about
 * their own action, but their teammates are).
 */
function sendPrescriptionNotification(opts) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        const { prescriptionId, title, medMessage, bellContent, ctx } = opts;
        if (!ctx.userId || !ctx.lineId)
            return;
        try {
            const medNotif = yield prisma_1.prisma.medicineNotification.create({
                data: {
                    userId: ctx.userId,
                    view: 0,
                    path: `prescription/${prescriptionId}`,
                    message: medMessage,
                    title,
                    lineId: ctx.lineId,
                },
                select: {
                    id: true, userId: true, title: true, message: true, lineId: true,
                    path: true, timestamp: true, type: true, view: true,
                },
            });
            try {
                const { notificationSocket } = yield Promise.resolve().then(() => __importStar(require("..")));
                notificationSocket.emitMedicineNotification(medNotif.lineId, {
                    id: medNotif.id,
                    userId: medNotif.userId,
                    title: medNotif.title,
                    message: medNotif.message,
                    lineId: medNotif.lineId,
                    path: (_a = medNotif.path) !== null && _a !== void 0 ? _a : undefined,
                    timestamp: typeof medNotif.timestamp === "string"
                        ? medNotif.timestamp
                        : medNotif.timestamp.toISOString(),
                    type: medNotif.type,
                    view: medNotif.view,
                });
            }
            catch (e) {
                console.warn("[realSync] medicine notif emit failed:", e);
            }
            // bell notification for the line's pharmacy users (skip the actor)
            const pharmacyUsers = yield prisma_1.prisma.module.findMany({
                where: {
                    lineId: ctx.lineId,
                    OR: [
                        { moduleName: { equals: "medicine", mode: "insensitive" } },
                        { moduleName: { equals: "Pharmacy", mode: "insensitive" } },
                    ],
                },
                select: { userId: true },
            });
            const ids = [...new Set(pharmacyUsers.map((m) => m.userId))].filter((id) => id && id !== ctx.userId);
            for (const recipientId of ids) {
                yield (0, notificationEvents_1.createUserNotification)(prisma_1.prisma, {
                    recipientId,
                    title,
                    content: bellContent,
                    path: `/${ctx.lineId}/medicine/prescription/${prescriptionId}`,
                    senderId: ctx.userId,
                });
            }
        }
        catch (e) {
            console.warn("[realSync] prescription notify failed:", e);
        }
    });
}
function notifyNewPrescription(prescriptionId, patientLabel, ctx) {
    return __awaiter(this, void 0, void 0, function* () {
        if (!ctx.userId || !ctx.lineId)
            return;
        const who = yield actorName(ctx);
        yield sendPrescriptionNotification({
            prescriptionId,
            title: "New Prescription",
            medMessage: `${who} - submitted prescription for ${patientLabel}`,
            bellContent: `${who} submitted a prescription for ${patientLabel}.`,
            ctx,
        });
    });
}
// When a prescription is dispensed, tell the rest of the line (the prescriber
// especially) — the dispenser themselves is skipped by the per-user rule.
function notifyPrescriptionDispensed(prescriptionId, patientLabel, ctx) {
    return __awaiter(this, void 0, void 0, function* () {
        if (!ctx.userId || !ctx.lineId)
            return;
        const who = yield actorName(ctx);
        yield sendPrescriptionNotification({
            prescriptionId,
            title: "Prescription Dispensed",
            medMessage: `${who} - dispensed prescription for ${patientLabel}`,
            bellContent: `${who} dispensed the prescription for ${patientLabel}.`,
            ctx,
        });
    });
}
/**
 * Fire the "New Prescription" alert only once the prescription AND at least one
 * prescribed medicine both exist on the server.
 *
 * The desktop pushes the prescription and its `prescription_item` rows as two
 * SEPARATE sync requests (prescription first, for the FK). Notifying on the
 * prescription push alone raced the items: a pharmacist who tapped the bell
 * immediately opened `prescription/{id}` before the medicines had synced and
 * saw "No Medicines Found". So both handlers call this; whichever lands last
 * sends the alert, and the notification's `path` is the natural dedup key so it
 * only ever fires once.
 */
function maybeNotifyPrescription(prescriptionId, ctx) {
    return __awaiter(this, void 0, void 0, function* () {
        if (!prescriptionId || !ctx.userId || !ctx.lineId)
            return;
        // already alerted for this prescription?
        const already = yield prisma_1.prisma.medicineNotification.findFirst({
            where: { path: `prescription/${prescriptionId}` },
            select: { id: true },
        });
        if (already)
            return;
        // items haven't landed yet — defer; the prescription_item push calls back
        // here once at least one row exists
        const item = yield prisma_1.prisma.precribeMedicine.findFirst({
            where: { prescriptionId },
            select: { id: true },
        });
        if (!item)
            return;
        const presc = yield prisma_1.prisma.prescription.findUnique({
            where: { id: prescriptionId },
            select: { firstname: true, lastname: true },
        });
        if (!presc)
            return;
        const patientLabel = [presc.lastname, presc.firstname]
            .filter((x) => x && String(x).trim())
            .join(", ") || "a patient";
        yield notifyNewPrescription(prescriptionId, patientLabel, ctx);
    });
}
function medName(medicineId) {
    return __awaiter(this, void 0, void 0, function* () {
        if (!medicineId)
            return "Unknown Medicine";
        const m = yield prisma_1.prisma.medicine.findUnique({
            where: { id: medicineId },
            select: { name: true, serialNumber: true },
        });
        return m ? `${m.name} (${m.serialNumber})` : "Unknown Medicine";
    });
}
// ── PUSH: desktop row -> real table (idempotent upsert by id) ───────────────
exports.REAL_PUSH = {
    patient(row, ctx) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a, _b;
            const lineId = ctx.lineId;
            const id = s(row.id);
            if (!id)
                return;
            if (s(row.deleted_at)) {
                yield prisma_1.prisma.patient.deleteMany({ where: { id } });
                return;
            }
            if (!lineId)
                throw new Error("This account is not assigned to a line; cannot sync.");
            const addr = yield resolveAddressIds(row);
            const data = {
                firstname: (_a = s(row.firstname)) !== null && _a !== void 0 ? _a : "",
                lastname: (_b = s(row.lastname)) !== null && _b !== void 0 ? _b : "",
                middlename: s(row.middlename),
                email: s(row.email),
                phoneNumber: s(row.phone),
                philHealthNo: s(row.philhealth_no),
                barangayId: addr.barangayId,
                municipalId: addr.municipalId,
                provinceId: addr.provinceId,
                regionId: addr.regionId,
                birthday: s(row.birthday) ? new Date(String(row.birthday)) : null,
                illi: row.illi === 1 || row.illi === true,
                lineId,
            };
            yield prisma_1.prisma.patient.upsert({
                where: { id },
                create: Object.assign({ id }, data),
                update: data,
            });
        });
    },
    medicine(row, ctx) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a, _b, _c;
            const lineId = ctx.lineId;
            const id = s(row.id);
            if (!id)
                return;
            if (s(row.deleted_at)) {
                const existed = yield prisma_1.prisma.medicine.findUnique({ where: { id }, select: { name: true, serialNumber: true } });
                yield prisma_1.prisma.medicine.deleteMany({ where: { id } });
                if (existed)
                    yield audit(0, `Removed medicine — ${existed.name} (${existed.serialNumber})`, ctx);
                return;
            }
            if (!lineId)
                throw new Error("This account is not assigned to a line; cannot sync.");
            const name = (_a = s(row.name)) !== null && _a !== void 0 ? _a : "Unnamed";
            const desc = (_b = s(row.descr)) !== null && _b !== void 0 ? _b : "None";
            const barcode = s(row.barcode);
            const serialNumber = (_c = s(row.serial_number)) !== null && _c !== void 0 ? _c : "MED-" + id.slice(0, 8);
            const isNew = !(yield prisma_1.prisma.medicine.findUnique({ where: { id }, select: { id: true } }));
            yield prisma_1.prisma.medicine.upsert({
                where: { id },
                create: { id, name, desc, serialNumber, barcode, lineId },
                update: { name, desc, barcode },
            });
            if (isNew)
                yield audit(1, `Added new medicine in the list; Med. Serial Ref.: ${serialNumber} - Label: ${name}`, ctx);
        });
    },
    // A storage location (mirrors the web StorageList "Add Storage Location").
    // The refNumber is generated once server-side and preserved on re-push, so
    // syncing is idempotent. departmentId is a required FK — use the one the
    // desktop provides when valid, else default to the line's first department.
    medicine_storage(row, ctx) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a, _b, _c, _d, _e, _f;
            const lineId = ctx.lineId;
            const id = s(row.id);
            if (!id)
                return;
            if (s(row.deleted_at)) {
                const existed = yield prisma_1.prisma.medicineStorage.findUnique({
                    where: { id },
                    select: { name: true, refNumber: true },
                });
                yield prisma_1.prisma.medicineStorage.deleteMany({ where: { id } });
                if (existed)
                    yield audit(0, `STORAGE: ${existed.name}-${existed.refNumber}, has been removed`, ctx);
                return;
            }
            if (!lineId)
                throw new Error("This account is not assigned to a line; cannot sync.");
            // resolve a valid department for the required FK
            let departmentId = s(row.department_id);
            if (departmentId) {
                const d = yield prisma_1.prisma.department.findFirst({
                    where: { id: departmentId, lineId },
                    select: { id: true },
                });
                if (!d)
                    departmentId = null;
            }
            if (!departmentId) {
                const d = yield prisma_1.prisma.department.findFirst({
                    where: { lineId },
                    orderBy: { createdAt: "asc" },
                    select: { id: true },
                });
                if (!d)
                    throw new Error("No unit/department exists for this line; create one on the web first.");
                departmentId = d.id;
            }
            const existing = yield prisma_1.prisma.medicineStorage.findUnique({
                where: { id },
                select: { refNumber: true },
            });
            const refNumber = (_a = existing === null || existing === void 0 ? void 0 : existing.refNumber) !== null && _a !== void 0 ? _a : (yield (0, handler_1.generateStorageRef)());
            const name = (_b = s(row.name)) !== null && _b !== void 0 ? _b : "Storage";
            const desc = (_c = s(row.descr)) !== null && _c !== void 0 ? _c : "";
            const timestamp = (_d = s(row.timestamp)) !== null && _d !== void 0 ? _d : new Date().toISOString();
            yield prisma_1.prisma.medicineStorage.upsert({
                where: { id },
                // On create, the pushing user IS the creator (fall back to any created_by
                // the client sent) — so the creator-write bypass recognizes them. Never
                // reassign the creator on update.
                create: {
                    id, refNumber, name, desc, lineId, departmentId, timestamp,
                    createdById: (_f = (_e = ctx.userId) !== null && _e !== void 0 ? _e : s(row.created_by)) !== null && _f !== void 0 ? _f : undefined,
                },
                update: { name, desc, departmentId },
            });
            if (!existing)
                yield audit(1, `Added new Storage location: ${name}, Ref. number: ${refNumber}`, ctx);
        });
    },
    medicine_stock(row, ctx) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l;
            const lineId = ctx.lineId;
            const id = s(row.id);
            if (!id)
                return;
            if (s(row.deleted_at)) {
                // storage access: deleting a batch counts as touching that storage
                const victim = yield prisma_1.prisma.medicineStock.findUnique({
                    where: { id },
                    select: { medicineStorageId: true },
                });
                if (victim)
                    yield (0, storageAccessController_1.assertStorageAccess)(ctx.userId, [victim.medicineStorageId], "remove stock");
                const med = yield medName(s(row.medicine_id));
                yield prisma_1.prisma.medicineStock.deleteMany({ where: { id } });
                yield audit(0, `REMOVE: stock batch — ${med}`, ctx);
                return;
            }
            if (!lineId)
                throw new Error("This account is not assigned to a line; cannot sync.");
            const existing = yield prisma_1.prisma.medicineStock.findUnique({ where: { id } });
            const num = (v) => {
                const n = Number(v);
                return Number.isFinite(n) ? Math.trunc(n) : 0;
            };
            // don't let a not-yet-synced storage's FK block the insert; re-links on a
            // later push once the storage exists in the cloud
            let storageId = s(row.medicine_storage_id);
            if (storageId) {
                const st = yield prisma_1.prisma.medicineStorage.findUnique({
                    where: { id: storageId },
                    select: { id: true },
                });
                if (!st)
                    storageId = null;
            }
            const data = {
                medicineId: s(row.medicine_id),
                medicineStorageId: storageId,
                quarter: Math.floor(new Date().getMonth() / 3) + 1, // current quarter
                quality: (_a = s(row.unit_of_measure)) !== null && _a !== void 0 ? _a : "box", // web stores unit in `quality`
                perQuantity: num(row.per_unit) || 1,
                quantity: num(row.quantity) || 1,
                actualStock: num(row.actual_stock),
                threshold: num(row.threshold),
                expiration: s(row.expiration) ? new Date(String(row.expiration)) : null,
                manufacturingDate: s(row.manufacturing_date)
                    ? new Date(String(row.manufacturing_date))
                    : null,
                addressRoom: s(row.address_room),
                addressCol: s(row.address_col),
                addressRow: s(row.address_row),
                addressSec: s(row.address_sec),
                container: s(row.container),
                lineId,
            };
            // Unchanged replay (e.g. the desktop's "force full re-sync" re-pushes
            // every row) — nothing to write, so no storage-access check either.
            // Without this, strict storage access would permanently reject other
            // storages' untouched rows on a full resync.
            if (existing) {
                const t = (d) => (d ? d.getTime() : null);
                const same = existing.medicineId === data.medicineId &&
                    existing.medicineStorageId === data.medicineStorageId &&
                    existing.quality === data.quality &&
                    existing.perQuantity === data.perQuantity &&
                    existing.quantity === data.quantity &&
                    existing.actualStock === data.actualStock &&
                    existing.threshold === data.threshold &&
                    t(existing.expiration) === t(data.expiration) &&
                    t(existing.manufacturingDate) === t(data.manufacturingDate) &&
                    ((_b = existing.addressRoom) !== null && _b !== void 0 ? _b : null) === ((_c = data.addressRoom) !== null && _c !== void 0 ? _c : null) &&
                    ((_d = existing.addressCol) !== null && _d !== void 0 ? _d : null) === ((_e = data.addressCol) !== null && _e !== void 0 ? _e : null) &&
                    ((_f = existing.addressRow) !== null && _f !== void 0 ? _f : null) === ((_g = data.addressRow) !== null && _g !== void 0 ? _g : null) &&
                    ((_h = existing.addressSec) !== null && _h !== void 0 ? _h : null) === ((_j = data.addressSec) !== null && _j !== void 0 ? _j : null) &&
                    ((_k = existing.container) !== null && _k !== void 0 ? _k : null) === ((_l = data.container) !== null && _l !== void 0 ? _l : null);
                if (same)
                    return;
            }
            // Storage access (LOCKED BY DEFAULT): the pusher needs a grant on the
            // storage the row claims AND on the storage the existing server row sits
            // in (so batches can't be pulled out of a storage they can't touch).
            yield (0, storageAccessController_1.assertStorageAccess)(ctx.userId, [storageId, existing === null || existing === void 0 ? void 0 : existing.medicineStorageId], "modify stock");
            yield prisma_1.prisma.medicineStock.upsert({
                where: { id },
                create: Object.assign({ id }, data),
                update: data,
            });
            if (!existing) {
                const total = data.quantity * data.perQuantity;
                yield audit(1, `Added new batch: ${yield medName(data.medicineId)} — ` +
                    `qty ${data.quantity} × ${data.perQuantity} ${data.quality} (${total} items)`, ctx);
            }
        });
    },
    diagnosis(row, _ctx) {
        return __awaiter(this, void 0, void 0, function* () {
            const id = s(row.id);
            if (!id)
                return;
            if (s(row.deleted_at)) {
                yield prisma_1.prisma.patientRecord.deleteMany({ where: { id } });
                return;
            }
            // a Diagnose is a PatientRecord of type 0 (scoped via its patient's line)
            const data = { patientId: s(row.patient_id), diagnose: s(row.diagnose), type: 0 };
            yield prisma_1.prisma.patientRecord.upsert({
                where: { id },
                create: Object.assign({ id }, data),
                update: data,
            });
        });
    },
    prescription(row, ctx) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a;
            const lineId = ctx.lineId;
            const id = s(row.id);
            if (!id)
                return;
            if (s(row.deleted_at)) {
                // PrecribeMedicine cascades from Prescription; also drop the timeline row
                yield prisma_1.prisma.patientRecord.deleteMany({ where: { id: "presrec_" + id } });
                yield prisma_1.prisma.prescription.deleteMany({ where: { id } });
                return;
            }
            if (!lineId)
                throw new Error("This account is not assigned to a line; cannot sync.");
            if (!ctx.userId)
                throw new Error("Cannot resolve the prescribing user for this account.");
            const patientId = s(row.patient_id);
            // denormalise patient name + age + address (the web's prescription detail
            // shows these, and its DispensaryPrescription view reads them straight off
            // the Prescription row like a web-created one)
            let firstname = null;
            let lastname = null;
            let age = "N/A";
            let patientExists = false;
            let barangayId = null;
            let municipalId = null;
            let provinceId = null;
            if (patientId) {
                const p = yield prisma_1.prisma.patient.findUnique({
                    where: { id: patientId },
                    select: {
                        firstname: true, lastname: true, birthday: true,
                        barangayId: true, municipalId: true, provinceId: true,
                    },
                });
                if (p) {
                    patientExists = true;
                    firstname = p.firstname;
                    lastname = p.lastname;
                    // these came off a Patient that already synced, so they're valid FKs
                    barangayId = p.barangayId;
                    municipalId = p.municipalId;
                    provinceId = p.provinceId;
                    if (p.birthday)
                        age = String(Math.max(0, Math.floor((Date.now() - p.birthday.getTime()) / 31557600000)));
                }
            }
            // fall back to the name the desktop sent, so the prescription always shows one
            if (!firstname && !lastname && s(row.patient_name)) {
                const parts = String(row.patient_name).trim().split(/\s+/);
                lastname = parts.length > 1 ? parts[parts.length - 1] : parts[0];
                firstname = parts.length > 1 ? parts.slice(0, -1).join(" ") : null;
            }
            // don't let a not-yet-synced patient's FK block the insert; re-links on a
            // later push once the patient exists
            const linkPatientId = patientExists ? patientId : null;
            // dispensed === 2 to match the web (prescriptionDispense sets status 2 and
            // blocks re-dispense on status===2). Using 1 here let the web re-dispense a
            // desktop-dispensed rx (double dispense).
            const status = s(row.status) === "dispensed" ? 2 : 0;
            const timestamp = s(row.created_at) ? new Date(String(row.created_at)) : new Date();
            // refNumber is generated once and preserved on re-push (idempotent)
            const existing = yield prisma_1.prisma.prescription.findUnique({
                where: { id },
                select: { refNumber: true, status: true },
            });
            const refNumber = (_a = existing === null || existing === void 0 ? void 0 : existing.refNumber) !== null && _a !== void 0 ? _a : (yield (0, handler_1.generatePrescriptionRef)());
            yield prisma_1.prisma.prescription.upsert({
                where: { id },
                create: {
                    id,
                    refNumber,
                    userId: ctx.userId,
                    lineId,
                    patientId: linkPatientId !== null && linkPatientId !== void 0 ? linkPatientId : undefined,
                    condtion: s(row.descr),
                    firstname,
                    lastname,
                    age,
                    barangayId: barangayId !== null && barangayId !== void 0 ? barangayId : undefined,
                    municipalId: municipalId !== null && municipalId !== void 0 ? municipalId : undefined,
                    provinceId: provinceId !== null && provinceId !== void 0 ? provinceId : undefined,
                    status,
                    external: row.external === 1 || row.external === true,
                    externalSource: s(row.external_source),
                    timestamp,
                    // web createPrescription seeds a progress step 0; mirror it so the
                    // dispensary progress view has a starting point
                    progress: { create: { step: 0 } },
                },
                update: {
                    patientId: linkPatientId !== null && linkPatientId !== void 0 ? linkPatientId : undefined,
                    condtion: s(row.descr),
                    firstname,
                    lastname,
                    age,
                    barangayId: barangayId !== null && barangayId !== void 0 ? barangayId : undefined,
                    municipalId: municipalId !== null && municipalId !== void 0 ? municipalId : undefined,
                    provinceId: provinceId !== null && provinceId !== void 0 ? provinceId : undefined,
                    status,
                    external: row.external === 1 || row.external === true,
                    externalSource: s(row.external_source),
                },
            });
            // record it on the patient's timeline (type 1 = Prescribed), idempotent id
            if (linkPatientId) {
                const recId = "presrec_" + id;
                yield prisma_1.prisma.patientRecord.upsert({
                    where: { id: recId },
                    create: { id: recId, patientId, diagnose: s(row.descr), type: 1, prescriptionId: id },
                    update: { diagnose: s(row.descr) },
                });
            }
            // audit logs (web parity): "submitted" on first sync, "dispensed" on the
            // open->dispensed transition (with a type-2 "Medicine Dispensed" record)
            if (!existing) {
                yield audit(1, `Submitted Prescription Ref. #: ${refNumber}.`, ctx);
            }
            // Notify the line's pharmacy users, but only once the prescribed medicines
            // have also synced — they arrive in a separate, later push, so this call
            // usually defers and the prescription_item handler fires the alert instead.
            yield maybeNotifyPrescription(id, ctx);
            if (status === 2 && (!existing || existing.status !== 2)) {
                yield audit(4, `Dispensed Medicine: Ref. #: ${refNumber}`, ctx);
                if (linkPatientId) {
                    const dispRecId = "disprec_" + id;
                    const patientId = linkPatientId;
                    yield prisma_1.prisma.patientRecord.upsert({
                        where: { id: dispRecId },
                        create: { id: dispRecId, patientId, type: 2, prescriptionId: id },
                        update: {},
                    });
                }
                // notify the line (the prescriber especially) that it was dispensed —
                // the dispenser themselves is skipped by the per-user rule
                const dispensedFor = [lastname, firstname].filter((x) => x && String(x).trim()).join(", ") ||
                    s(row.patient_name) ||
                    "a patient";
                yield notifyPrescriptionDispensed(id, dispensedFor, ctx);
            }
        });
    },
    prescription_item(row, ctx) {
        return __awaiter(this, void 0, void 0, function* () {
            const id = s(row.id);
            if (!id)
                return;
            if (s(row.deleted_at)) {
                yield prisma_1.prisma.precribeMedicine.deleteMany({ where: { id } });
                return;
            }
            const n = Number(row.quantity);
            const rel = Number(row.release_quantity);
            const remark = s(row.remark);
            const data = Object.assign(Object.assign({ prescriptionId: s(row.prescription_id), medicineId: s(row.medicine_id), quantity: Number.isFinite(n) ? Math.trunc(n) : 1, desc: s(row.comment) }, (Number.isFinite(rel) ? { releaseQuantity: Math.trunc(rel) } : {})), (remark ? { remark } : {}));
            yield prisma_1.prisma.precribeMedicine.upsert({
                where: { id },
                create: Object.assign({ id }, data),
                update: data,
            });
            // A prescribed medicine now exists — send the "New Prescription" alert if
            // the prescription push deferred it (idempotent; dedups on the notif path).
            yield maybeNotifyPrescription(data.prescriptionId, ctx);
        });
    },
    // Server-owned: grants are managed on the web only. The desktop never dirties
    // these rows; if a client pushes anyway, silently ignore it.
    storage_access(_row, _ctx) {
        return __awaiter(this, void 0, void 0, function* () {
            return;
        });
    },
};
// ── PULL: real table -> desktop rows (cursor on `timestamp`) ─────────────────
const PULL_LIMIT = 500;
exports.REAL_PULL = {
    patient(lineId, since) {
        return __awaiter(this, void 0, void 0, function* () {
            if (!lineId)
                return { rows: [], cursor: since ? since.toISOString() : null };
            const recs = yield prisma_1.prisma.patient.findMany({
                where: Object.assign({ lineId }, (since ? { timestamp: { gt: since } } : {})),
                orderBy: { timestamp: "asc" },
                take: PULL_LIMIT,
            });
            const rows = recs.map((p) => ({
                id: p.id,
                firstname: p.firstname,
                middlename: p.middlename,
                lastname: p.lastname,
                birthday: p.birthday ? p.birthday.toISOString().slice(0, 10) : null,
                email: p.email,
                phone: p.phoneNumber,
                philhealth_no: p.philHealthNo,
                illi: p.illi ? 1 : 0,
                region_id: p.regionId,
                province_id: p.provinceId,
                municipal_id: p.municipalId,
                barangay_id: p.barangayId,
                updated_at: iso(p.timestamp),
                deleted_at: null,
            }));
            const cursor = recs.length > 0 ? iso(recs[recs.length - 1].timestamp) : null;
            return { rows, cursor };
        });
    },
    medicine(lineId, since) {
        return __awaiter(this, void 0, void 0, function* () {
            if (!lineId)
                return { rows: [], cursor: since ? since.toISOString() : null };
            const recs = yield prisma_1.prisma.medicine.findMany({
                where: Object.assign({ lineId }, (since ? { timestamp: { gt: since } } : {})),
                orderBy: { timestamp: "asc" },
                take: PULL_LIMIT,
            });
            const rows = recs.map((m) => ({
                id: m.id,
                serial_number: m.serialNumber,
                barcode: m.barcode,
                name: m.name,
                descr: m.desc,
                updated_at: iso(m.timestamp),
                deleted_at: null,
            }));
            const cursor = recs.length > 0 ? iso(recs[recs.length - 1].timestamp) : null;
            return { rows, cursor };
        });
    },
    // Storage locations are few, so we return the whole line's set each pull
    // (no cursor). The desktop upserts by id, so repeats are harmless.
    medicine_storage(lineId, _since) {
        return __awaiter(this, void 0, void 0, function* () {
            if (!lineId)
                return { rows: [], cursor: null };
            const recs = yield prisma_1.prisma.medicineStorage.findMany({
                where: { lineId },
                orderBy: { refNumber: "asc" },
                include: { unit: { select: { name: true } } },
            });
            const rows = recs.map((r) => {
                var _a, _b;
                return ({
                    id: r.id,
                    ref_number: r.refNumber,
                    name: r.name,
                    descr: r.desc,
                    department_id: r.departmentId,
                    department_name: (_b = (_a = r.unit) === null || _a === void 0 ? void 0 : _a.name) !== null && _b !== void 0 ? _b : null,
                    // creator id so the desktop can honor the SAME creator-write bypass the
                    // server does (a storage's creator may write even without a grant).
                    created_by: r.createdById,
                    timestamp: r.timestamp,
                    updated_at: r.timestamp,
                    deleted_at: null,
                });
            });
            return { rows, cursor: null };
        });
    },
    medicine_stock(lineId, since) {
        return __awaiter(this, void 0, void 0, function* () {
            if (!lineId)
                return { rows: [], cursor: since ? since.toISOString() : null };
            const recs = yield prisma_1.prisma.medicineStock.findMany({
                where: Object.assign({ lineId }, (since ? { timestamp: { gt: since } } : {})),
                orderBy: { timestamp: "asc" },
                take: PULL_LIMIT,
            });
            const rows = recs.map((r) => ({
                id: r.id,
                medicine_id: r.medicineId,
                medicine_storage_id: r.medicineStorageId,
                unit_of_measure: r.quality,
                quantity: r.quantity,
                per_unit: r.perQuantity,
                actual_stock: r.actualStock,
                threshold: r.threshold,
                price: 0,
                manufacturing_date: r.manufacturingDate
                    ? r.manufacturingDate.toISOString().slice(0, 10)
                    : null,
                expiration: r.expiration ? r.expiration.toISOString().slice(0, 10) : null,
                address_room: r.addressRoom,
                address_col: r.addressCol,
                address_row: r.addressRow,
                address_sec: r.addressSec,
                container: r.container,
                created_by: null,
                created_at: iso(r.timestamp),
                updated_at: iso(r.timestamp),
                deleted_at: null,
            }));
            const cursor = recs.length > 0 ? iso(recs[recs.length - 1].timestamp) : null;
            return { rows, cursor };
        });
    },
    diagnosis(lineId, since) {
        return __awaiter(this, void 0, void 0, function* () {
            if (!lineId)
                return { rows: [], cursor: since ? since.toISOString() : null };
            const recs = yield prisma_1.prisma.patientRecord.findMany({
                where: Object.assign({ type: 0, patient: { lineId } }, (since ? { timestamp: { gt: since } } : {})),
                orderBy: { timestamp: "asc" },
                take: PULL_LIMIT,
                include: { patient: { select: { firstname: true, middlename: true, lastname: true } } },
            });
            const rows = recs.map((r) => ({
                id: r.id,
                patient_id: r.patientId,
                // denormalised name so the desktop shows it even before the patient syncs
                patient_name: r.patient
                    ? [r.patient.firstname, r.patient.middlename, r.patient.lastname]
                        .filter((x) => x && String(x).trim())
                        .join(" ")
                    : null,
                diagnose: r.diagnose,
                created_by: null,
                created_at: iso(r.timestamp),
                updated_at: iso(r.timestamp),
                deleted_at: null,
            }));
            const cursor = recs.length > 0 ? iso(recs[recs.length - 1].timestamp) : null;
            return { rows, cursor };
        });
    },
    prescription(lineId, since) {
        return __awaiter(this, void 0, void 0, function* () {
            if (!lineId)
                return { rows: [], cursor: since ? since.toISOString() : null };
            const recs = yield prisma_1.prisma.prescription.findMany({
                where: Object.assign({ lineId }, (since ? { timestamp: { gt: since } } : {})),
                orderBy: { timestamp: "asc" },
                take: PULL_LIMIT,
            });
            const rows = recs.map((r) => ({
                id: r.id,
                patient_id: r.patientId,
                patient_name: [r.firstname, r.lastname].filter((x) => x && String(x).trim()).join(" ") || null,
                diagnosis_id: null,
                descr: r.condtion,
                external: r.external ? 1 : 0,
                external_source: r.externalSource,
                // dispensed = 2 (web) or legacy 1; anything else is still open
                status: r.status === 2 || r.status === 1 ? "dispensed" : "open",
                created_by: null,
                created_at: iso(r.timestamp),
                updated_at: iso(r.timestamp),
                deleted_at: null,
            }));
            const cursor = recs.length > 0 ? iso(recs[recs.length - 1].timestamp) : null;
            return { rows, cursor };
        });
    },
    prescription_item(lineId, since) {
        return __awaiter(this, void 0, void 0, function* () {
            if (!lineId)
                return { rows: [], cursor: since ? since.toISOString() : null };
            const recs = yield prisma_1.prisma.precribeMedicine.findMany({
                where: Object.assign({ Prescription: { lineId } }, (since ? { timestamp: { gt: since } } : {})),
                orderBy: { timestamp: "asc" },
                take: PULL_LIMIT,
            });
            const rows = recs.map((r) => ({
                id: r.id,
                prescription_id: r.prescriptionId,
                medicine_id: r.medicineId,
                comment: r.desc,
                quantity: r.quantity,
                release_quantity: r.releaseQuantity,
                remark: r.remark,
                updated_at: iso(r.timestamp),
                deleted_at: null,
            }));
            const cursor = recs.length > 0 ? iso(recs[recs.length - 1].timestamp) : null;
            return { rows, cursor };
        });
    },
    // Per-user storage grants (Storage > Dispense Access). Tiny table — return
    // the whole line's set each pull (no cursor); the desktop REPLACES its local
    // copy so revocations propagate too.
    storage_access(lineId, _since) {
        return __awaiter(this, void 0, void 0, function* () {
            if (!lineId)
                return { rows: [], cursor: null };
            const recs = yield prisma_1.prisma.medicineStorageAccess.findMany({
                where: { medicineStorage: { lineId } },
                select: {
                    id: true,
                    medicineStorageId: true,
                    userId: true,
                    timestamp: true,
                },
            });
            const rows = recs.map((r) => ({
                id: r.id,
                medicine_storage_id: r.medicineStorageId,
                user_id: r.userId,
                updated_at: iso(r.timestamp),
                deleted_at: null,
            }));
            return { rows, cursor: null };
        });
    },
};
const isRealTable = (t) => t in exports.REAL_PUSH;
exports.isRealTable = isRealTable;
