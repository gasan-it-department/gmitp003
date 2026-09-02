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
 * Proves desktop sync now lands in the REAL web tables (so the web app sees it).
 * Pushes a patient + medicine through /sync/push, asserts they appear in
 * prisma.patient / prisma.medicine for the line, checks idempotency (re-push =
 * no duplicate), checks pull returns them in the desktop's shape, then cleans up.
 *
 * Run:  npx ts-node scripts/real_sync_itest.ts
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
        var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s, _t;
        const candidates = yield prisma_1.prisma.account.findMany({
            where: { User: { isNot: null } },
            select: { id: true, lineId: true, User: { select: { id: true } } },
        });
        const account = candidates.find((a) => { var _a; return a.lineId && ((_a = a.User) === null || _a === void 0 ? void 0 : _a.id); });
        if (!(account === null || account === void 0 ? void 0 : account.lineId))
            throw new Error("Need an account with a lineId and a linked User.");
        const token = (0, fast_jwt_1.createSigner)({ key: process.env.JWT_SECRET })({ id: account.id });
        const H = { Authorization: "Bearer " + token, "Content-Type": "application/json" };
        console.log("account", account.id, "line", account.lineId);
        const patientId = (0, crypto_1.randomUUID)();
        const addrPatientId = (0, crypto_1.randomUUID)();
        const medicineId = (0, crypto_1.randomUUID)();
        const storageId = (0, crypto_1.randomUUID)();
        const stockId = (0, crypto_1.randomUUID)();
        const diagnosisId = (0, crypto_1.randomUUID)();
        const prescriptionId = (0, crypto_1.randomUUID)();
        const itemId = (0, crypto_1.randomUUID)();
        const orphanRxId = (0, crypto_1.randomUUID)();
        const ITEST_REG = "ITEST-REG", ITEST_PROV = "ITEST-PROV", ITEST_MUN = "ITEST-MUN", ITEST_BRGY = "ITEST-BRGY";
        let presRef = "";
        try {
            // ── push a patient ──
            const patient = {
                id: patientId,
                firstname: "ITEST", middlename: "Sync", lastname: "Patient",
                birthday: "1992-04-05", phone: "09171234567", email: "itest@example.com",
                illi: 0,
                region_id: "170000000", province_id: "174000000",
                municipal_id: null, barangay_id: null,
                updated_at: new Date().toISOString(), deleted_at: null,
            };
            let r = yield fetch(BASE + "/sync/push", { method: "POST", headers: H, body: JSON.stringify({ table: "patient", rows: [patient] }) });
            let j = yield r.json();
            ok("patient push ok, no per-row errors", j.ok === true && ((_b = (_a = j.errors) === null || _a === void 0 ? void 0 : _a.length) !== null && _b !== void 0 ? _b : 0) === 0, j);
            const inDb = yield prisma_1.prisma.patient.findUnique({ where: { id: patientId } });
            ok("patient landed in REAL Patient table", !!inDb && inDb.firstname === "ITEST", { found: !!inDb });
            ok("patient is scoped to the line (web list would show it)", (inDb === null || inDb === void 0 ? void 0 : inDb.lineId) === account.lineId);
            ok("patient phone mapped to phoneNumber", (inDb === null || inDb === void 0 ? void 0 : inDb.phoneNumber) === "09171234567");
            // idempotent re-push -> still exactly one row
            yield fetch(BASE + "/sync/push", { method: "POST", headers: H, body: JSON.stringify({ table: "patient", rows: [patient] }) });
            const cnt = yield prisma_1.prisma.patient.count({ where: { id: patientId } });
            ok("re-push does not duplicate the patient", cnt === 1, { cnt });
            // a patient whose barangay code isn't seeded yet still syncs — the desktop
            // sends the PSGC names too, so the lookup rows are created on demand (like
            // the web) and the address is preserved rather than dropped
            const addrPatient = {
                id: addrPatientId, firstname: "ADDR", lastname: "Tolerant", illi: 0,
                region_id: ITEST_REG, region_name: "Itest Region",
                province_id: ITEST_PROV, province_name: "Itest Province",
                municipal_id: ITEST_MUN, municipal_name: "Itest Municipality",
                barangay_id: ITEST_BRGY, barangay_name: "Itest Barangay",
                updated_at: new Date().toISOString(), deleted_at: null,
            };
            r = yield fetch(BASE + "/sync/push", { method: "POST", headers: H, body: JSON.stringify({ table: "patient", rows: [addrPatient] }) });
            j = yield r.json();
            ok("patient with an unseeded address code still pushes (no per-row errors)", j.ok === true && ((_d = (_c = j.errors) === null || _c === void 0 ? void 0 : _c.length) !== null && _d !== void 0 ? _d : 0) === 0, j);
            const addrDb = yield prisma_1.prisma.patient.findUnique({ where: { id: addrPatientId }, select: { id: true, barangayId: true, municipalId: true } });
            ok("patient landed WITH its address (barangay/municipal preserved)", !!addrDb && addrDb.barangayId === ITEST_BRGY && addrDb.municipalId === ITEST_MUN, addrDb);
            const brgyDb = yield prisma_1.prisma.barangay.findUnique({ where: { id: ITEST_BRGY }, select: { name: true } });
            ok("missing barangay lookup row was created on demand (name from desktop)", (brgyDb === null || brgyDb === void 0 ? void 0 : brgyDb.name) === "Itest Barangay", brgyDb);
            // ── push a medicine ──
            const medicine = {
                id: medicineId, serial_number: "MED-ITEST01", barcode: null,
                name: "ITEST Paracetamol", descr: "500mg tablet",
                updated_at: new Date().toISOString(), deleted_at: null,
            };
            r = yield fetch(BASE + "/sync/push", { method: "POST", headers: H, body: JSON.stringify({ table: "medicine", rows: [medicine] }) });
            j = yield r.json();
            ok("medicine push ok", j.ok === true && ((_f = (_e = j.errors) === null || _e === void 0 ? void 0 : _e.length) !== null && _f !== void 0 ? _f : 0) === 0, j);
            const medDb = yield prisma_1.prisma.medicine.findUnique({ where: { id: medicineId } });
            ok("medicine landed in REAL Medicine table", !!medDb && medDb.name === "ITEST Paracetamol");
            const medLog = yield prisma_1.prisma.medicineLogs.findFirst({ where: { userId: account.User.id, message: { contains: "MED-ITEST01" } } });
            ok("medicine-add written to MedicineLogs (action 1, like the web)", !!medLog && medLog.action === 1, medLog === null || medLog === void 0 ? void 0 : medLog.message);
            // ── push a storage location (mirrors the web "Add Storage Location") ──
            const storage = {
                id: storageId, name: "ITEST Storage", descr: "itest bay",
                department_id: null, department_name: null,
                timestamp: new Date().toISOString(),
                updated_at: new Date().toISOString(), deleted_at: null,
            };
            r = yield fetch(BASE + "/sync/push", { method: "POST", headers: H, body: JSON.stringify({ table: "medicine_storage", rows: [storage] }) });
            j = yield r.json();
            ok("storage push ok", j.ok === true && ((_h = (_g = j.errors) === null || _g === void 0 ? void 0 : _g.length) !== null && _h !== void 0 ? _h : 0) === 0, j);
            const storageDb = yield prisma_1.prisma.medicineStorage.findUnique({ where: { id: storageId } });
            ok("storage landed in REAL MedicineStorage (refNumber generated, department defaulted)", !!storageDb && !!storageDb.refNumber && !!storageDb.departmentId && storageDb.lineId === account.lineId, storageDb && { ref: storageDb.refNumber, dept: storageDb.departmentId });
            const storageLog = yield prisma_1.prisma.medicineLogs.findFirst({ where: { message: { contains: `Added new Storage location: ITEST Storage` } } });
            ok("storage-add written to MedicineLogs (action 1, like the web)", !!storageLog && storageLog.action === 1);
            // ── push a stock batch for that medicine, INTO that storage ──
            const stock = {
                id: stockId, medicine_id: medicineId, medicine_storage_id: storageId,
                unit_of_measure: "box", quantity: 10, per_unit: 10, actual_stock: 100,
                threshold: 20, price: 2.5, manufacturing_date: "2026-01-01", expiration: "2027-01-01",
                address_room: "A", address_sec: "1", address_row: "2", address_col: "3", container: "shelf",
                updated_at: new Date().toISOString(), deleted_at: null,
            };
            r = yield fetch(BASE + "/sync/push", { method: "POST", headers: H, body: JSON.stringify({ table: "medicine_stock", rows: [stock] }) });
            j = yield r.json();
            ok("stock push ok", j.ok === true && ((_k = (_j = j.errors) === null || _j === void 0 ? void 0 : _j.length) !== null && _k !== void 0 ? _k : 0) === 0, j);
            const stockDb = yield prisma_1.prisma.medicineStock.findUnique({ where: { id: stockId } });
            ok("stock landed in REAL MedicineStock (unit -> quality, perUnit -> perQuantity)", !!stockDb && stockDb.quality === "box" && stockDb.perQuantity === 10 && stockDb.actualStock === 100, stockDb);
            ok("stock is linked to its storage (medicineStorageId)", (stockDb === null || stockDb === void 0 ? void 0 : stockDb.medicineStorageId) === storageId, { got: stockDb === null || stockDb === void 0 ? void 0 : stockDb.medicineStorageId });
            // ── pull the storage back in desktop shape ──
            r = yield fetch(BASE + "/sync/pull?table=medicine_storage", { headers: H });
            j = yield r.json();
            const pulledStorage = j.rows.find((x) => x.id === storageId);
            ok("pull returns the storage in desktop shape (ref_number + department_name)", !!pulledStorage && !!pulledStorage.ref_number && "department_name" in pulledStorage, pulledStorage);
            // ── push a diagnosis (PatientRecord type 0) for that patient ──
            const diagnosis = {
                id: diagnosisId, patient_id: patientId, diagnose: "ITEST viral infection",
                updated_at: new Date().toISOString(), deleted_at: null,
            };
            r = yield fetch(BASE + "/sync/push", { method: "POST", headers: H, body: JSON.stringify({ table: "diagnosis", rows: [diagnosis] }) });
            j = yield r.json();
            ok("diagnosis push ok", j.ok === true && ((_m = (_l = j.errors) === null || _l === void 0 ? void 0 : _l.length) !== null && _m !== void 0 ? _m : 0) === 0, j);
            const recDb = yield prisma_1.prisma.patientRecord.findUnique({ where: { id: diagnosisId } });
            ok("diagnosis landed in REAL PatientRecord (type 0)", !!recDb && recDb.type === 0 && recDb.diagnose === "ITEST viral infection");
            // ── push a prescription + a prescribed medicine ──
            const prescription = {
                id: prescriptionId, patient_id: patientId, diagnosis_id: null,
                descr: "ITEST rest and fluids", status: "open",
                created_at: new Date().toISOString(), updated_at: new Date().toISOString(), deleted_at: null,
            };
            r = yield fetch(BASE + "/sync/push", { method: "POST", headers: H, body: JSON.stringify({ table: "prescription", rows: [prescription] }) });
            j = yield r.json();
            ok("prescription push ok", j.ok === true && ((_p = (_o = j.errors) === null || _o === void 0 ? void 0 : _o.length) !== null && _p !== void 0 ? _p : 0) === 0, j);
            const presDb = yield prisma_1.prisma.prescription.findUnique({ where: { id: prescriptionId } });
            ok("prescription landed in REAL Prescription table (refNumber + userId set)", !!presDb && !!presDb.refNumber && presDb.userId === account.User.id && presDb.patientId === patientId, presDb && { ref: presDb.refNumber, userId: presDb.userId });
            const timeline = yield prisma_1.prisma.patientRecord.findUnique({ where: { id: "presrec_" + prescriptionId } });
            ok("prescription added to patient timeline (PatientRecord type 1)", !!timeline && timeline.type === 1);
            ok("timeline record is linked to the patient (shows in Patient Record module)", (timeline === null || timeline === void 0 ? void 0 : timeline.patientId) === patientId, { got: timeline === null || timeline === void 0 ? void 0 : timeline.patientId });
            // prescription carries the patient's address (so the web detail view — which
            // reads barangay/municipal/province off the Prescription — doesn't get nulls)
            const presPatient = yield prisma_1.prisma.patient.findUnique({
                where: { id: patientId },
                select: { provinceId: true, municipalId: true, barangayId: true },
            });
            ok("prescription copies the patient's province onto itself", (presDb === null || presDb === void 0 ? void 0 : presDb.provinceId) === (presPatient === null || presPatient === void 0 ? void 0 : presPatient.provinceId), { rx: presDb === null || presDb === void 0 ? void 0 : presDb.provinceId, pt: presPatient === null || presPatient === void 0 ? void 0 : presPatient.provinceId });
            presRef = presDb.refNumber;
            const submitLog = yield prisma_1.prisma.medicineLogs.findFirst({ where: { message: { contains: `Submitted Prescription Ref. #: ${presRef}` } } });
            ok("prescription submit written to MedicineLogs (action 1)", !!submitLog && submitLog.action === 1);
            const presNotif = yield prisma_1.prisma.medicineNotification.findFirst({ where: { path: `prescription/${prescriptionId}` } });
            ok("new prescription fires a MedicineNotification (pharmacy is notified)", !!presNotif && presNotif.title === "New Prescription", presNotif === null || presNotif === void 0 ? void 0 : presNotif.message);
            const item = {
                id: itemId, prescription_id: prescriptionId, medicine_id: medicineId,
                comment: "1 tab q6h", quantity: 10,
                updated_at: new Date().toISOString(), deleted_at: null,
            };
            r = yield fetch(BASE + "/sync/push", { method: "POST", headers: H, body: JSON.stringify({ table: "prescription_item", rows: [item] }) });
            j = yield r.json();
            ok("prescription_item push ok", j.ok === true && ((_r = (_q = j.errors) === null || _q === void 0 ? void 0 : _q.length) !== null && _r !== void 0 ? _r : 0) === 0, j);
            const itemDb = yield prisma_1.prisma.precribeMedicine.findUnique({ where: { id: itemId } });
            ok("item landed in REAL PrecribeMedicine (comment -> desc, qty)", !!itemDb && itemDb.desc === "1 tab q6h" && itemDb.quantity === 10);
            // ── dispense: re-push the prescription as dispensed ──
            const dispensed = Object.assign(Object.assign({}, prescription), { status: "dispensed", updated_at: new Date(Date.now() + 1000).toISOString() });
            r = yield fetch(BASE + "/sync/push", { method: "POST", headers: H, body: JSON.stringify({ table: "prescription", rows: [dispensed] }) });
            yield r.json();
            const dispLog = yield prisma_1.prisma.medicineLogs.findFirst({ where: { message: { contains: `Dispensed Medicine: Ref. #: ${presRef}` } } });
            ok("dispense written to MedicineLogs (action 4)", !!dispLog && dispLog.action === 4);
            const dispRec = yield prisma_1.prisma.patientRecord.findUnique({ where: { id: "disprec_" + prescriptionId } });
            ok("dispense recorded on patient timeline (PatientRecord type 2)", !!dispRec && dispRec.type === 2);
            // ── a prescription whose patient is NOT in the cloud still lands (FK-tolerant) ──
            const orphanRx = {
                id: orphanRxId, patient_id: (0, crypto_1.randomUUID)(), patient_name: "Ghost Patient",
                descr: "patient not synced yet", status: "open",
                created_at: new Date().toISOString(), updated_at: new Date().toISOString(), deleted_at: null,
            };
            r = yield fetch(BASE + "/sync/push", { method: "POST", headers: H, body: JSON.stringify({ table: "prescription", rows: [orphanRx] }) });
            j = yield r.json();
            ok("orphan-patient prescription push ok (no per-row errors)", j.ok === true && ((_t = (_s = j.errors) === null || _s === void 0 ? void 0 : _s.length) !== null && _t !== void 0 ? _t : 0) === 0, j);
            const orphanDb = yield prisma_1.prisma.prescription.findUnique({ where: { id: orphanRxId } });
            ok("prescription lands even when patient not in cloud (patientId null, name kept)", !!orphanDb && orphanDb.patientId === null && orphanDb.firstname === "Ghost" && orphanDb.lastname === "Patient", orphanDb && { pid: orphanDb.patientId, fn: orphanDb.firstname, ln: orphanDb.lastname });
            // ── pull patient back in desktop shape ──
            r = yield fetch(BASE + "/sync/pull?table=patient", { headers: H });
            j = yield r.json();
            const pulled = j.rows.find((x) => x.id === patientId);
            ok("pull returns the patient in desktop shape (phone field)", !!pulled && pulled.phone === "09171234567", pulled);
            ok("pull returns a cursor", typeof j.cursor === "string" && j.cursor.length > 0);
            console.log("\nREAL SYNC ITEST OK");
        }
        finally {
            // remove the audit logs this test created
            yield prisma_1.prisma.medicineLogs.deleteMany({ where: { message: { contains: "MED-ITEST01" } } });
            if (presRef)
                yield prisma_1.prisma.medicineLogs.deleteMany({ where: { message: { contains: presRef } } });
            yield prisma_1.prisma.medicineNotification.deleteMany({ where: { path: `prescription/${prescriptionId}` } });
            yield prisma_1.prisma.notification.deleteMany({ where: { path: `/${account.lineId}/medicine/prescription/${prescriptionId}` } });
            yield prisma_1.prisma.patientRecord.deleteMany({ where: { id: "disprec_" + prescriptionId } });
            yield prisma_1.prisma.precribeMedicine.deleteMany({ where: { id: itemId } });
            yield prisma_1.prisma.patientRecord.deleteMany({ where: { id: "presrec_" + prescriptionId } });
            yield prisma_1.prisma.prescription.deleteMany({ where: { id: prescriptionId } });
            yield prisma_1.prisma.prescription.deleteMany({ where: { id: orphanRxId } });
            yield prisma_1.prisma.patientRecord.deleteMany({ where: { id: diagnosisId } });
            yield prisma_1.prisma.medicineStock.deleteMany({ where: { id: stockId } });
            yield prisma_1.prisma.medicineLogs.deleteMany({ where: { message: { contains: "Added new Storage location: ITEST Storage" } } });
            yield prisma_1.prisma.medicineStorage.deleteMany({ where: { id: storageId } });
            yield prisma_1.prisma.patient.deleteMany({ where: { id: patientId } });
            yield prisma_1.prisma.patient.deleteMany({ where: { id: addrPatientId } });
            yield prisma_1.prisma.medicine.deleteMany({ where: { id: medicineId } });
            // remove the on-demand PSGC lookup rows the address test created (children first)
            yield prisma_1.prisma.barangay.deleteMany({ where: { id: ITEST_BRGY } });
            yield prisma_1.prisma.municipal.deleteMany({ where: { id: ITEST_MUN } });
            yield prisma_1.prisma.province.deleteMany({ where: { id: ITEST_PROV } });
            yield prisma_1.prisma.region.deleteMany({ where: { id: ITEST_REG } });
            console.log("cleaned up");
            yield prisma_1.prisma.$disconnect();
        }
    });
}
main().catch((e) => __awaiter(void 0, void 0, void 0, function* () { console.error(e); process.exitCode = 1; yield prisma_1.prisma.$disconnect(); }));
