"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.medicine = void 0;
const handler_1 = require("../middleware/handler");
const mobileAccessController_1 = require("../controller/mobileAccessController");
const storageAccessController_1 = require("../controller/storageAccessController");
const medicineController_1 = require("../controller/medicineController");
const medicine = (fastify) => {
    fastify.get("/medicine/storage", { preHandler: handler_1.authenticated }, medicineController_1.medicineStorage);
    // Pharmacy Home search: any medicine-module user sees a medicine's stock
    // per storage (each storage flagged accessible for the caller).
    fastify.get("/medicine/search-stock", { preHandler: handler_1.authenticated }, medicineController_1.searchMedicineStock);
    // Direct dispense (no prescription): FEFO deduction + Medicine Logs audit,
    // idempotent ops, actor from token, Dispense & Stock Access enforced.
    fastify.post("/medicine/direct-dispense/bulk", { preHandler: handler_1.authenticated }, medicineController_1.directDispenseBulk);
    // Bulk direct dispense: ONE patient, MANY scanned items → one record.
    fastify.post("/medicine/direct-dispense/multi", { preHandler: handler_1.authenticated }, medicineController_1.directDispenseMulti);
    // Dispense History (direct + prescription) list + detail.
    fastify.get("/medicine/dispense-history", { preHandler: handler_1.authenticated }, medicineController_1.dispenseHistoryList);
    fastify.get("/medicine/dispense-history/detail", { preHandler: handler_1.authenticated }, medicineController_1.dispenseHistoryDetail);
    // Per-patient dispensing summary (No, Full Name, Address, medicine units) as
    // an .xlsx — honors the same search / kind / date-range filters as the list.
    fastify.get("/medicine/dispense-history/export", { preHandler: handler_1.authenticated }, medicineController_1.dispenseHistoryExport);
    // Procurement decision-support: fast/slow movers, reorder priority, trend.
    fastify.get("/medicine/insights", { preHandler: handler_1.authenticated }, medicineController_1.medicineDispenseInsights);
    fastify.get("/medicine/logs", { preHandler: handler_1.authenticated }, medicineController_1.medicineLogList);
    fastify.patch("/medicine/threshold", { preHandler: handler_1.authenticated }, medicineController_1.updateMedicineThreshold);
    fastify.post("/medicine/storage/add-storage-location", { preHandler: handler_1.authenticated }, medicineController_1.addMedicineStorage);
    fastify.get("/medicine/storage-list", { preHandler: handler_1.authenticated }, medicineController_1.medicineList);
    fastify.get("/medicine/items", { preHandler: handler_1.authenticated }, medicineController_1.storageMeds);
    fastify.get("/medicine/storage-item", medicineController_1.storageMedList);
    // ONE low-stock threshold per MEDICINE — alerts on the medicine TOTAL.
    fastify.patch("/medicine/low-stock-threshold", { preHandler: handler_1.authenticated }, medicineController_1.setMedicineLowStockThreshold);
    fastify.post("/add-medicine", { preHandler: handler_1.authenticated }, medicineController_1.addStorageMed);
    fastify.post("/storage/add-medicine", { preHandler: handler_1.authenticated }, medicineController_1.addStorageMedInList);
    fastify.get("/medicine/new/notif", { preHandler: handler_1.authenticated }, medicineController_1.newPrescriptionCount);
    fastify.get("/medicine/notifications", { preHandler: handler_1.authenticated }, medicineController_1.medicineNotification);
    fastify.patch("/medicine/notification/view", { preHandler: handler_1.authenticated }, medicineController_1.viewNotification);
    fastify.patch("/medicine/transfer", { preHandler: handler_1.authenticated }, medicineController_1.transferMedicine);
    fastify.delete("/storage/medicine/remove", { preHandler: handler_1.authenticated }, medicineController_1.removeStock);
    fastify.get("/medicine/transactions", { preHandler: handler_1.authenticated }, medicineController_1.medicineTransactions);
    fastify.delete("/medicine/remove", { preHandler: handler_1.authenticated }, medicineController_1.removeMedicine);
    fastify.patch("/medicine/update", { preHandler: handler_1.authenticated }, medicineController_1.updateMedicineEntry);
    fastify.get("/medicine/overview", { preHandler: handler_1.authenticated }, medicineController_1.medicineOverview);
    fastify.get("/storage/data", { preHandler: handler_1.authenticated }, medicineController_1.storageData);
    fastify.delete("/storage/remove", { preHandler: handler_1.authenticated }, medicineController_1.removeStorage);
    fastify.post("/medicine/scan-low-stock", { preHandler: handler_1.authenticated }, medicineController_1.scanLowStock);
    // Mobile offline-scan upload. Mobile sends barcode + name (+ optional
    // notes/lineId/scannedAt) and we upsert a Medicine row keyed on
    // (serialNumber, lineId), returning its id for client-side dedupe.
    fastify.post("/medicine/scan-log", { preHandler: [handler_1.authenticated, handler_1.pharmacyMobileAuth] }, medicineController_1.recordMedicineScan);
    // Mobile "Barcode registration": attach a scanned barcode to a medicine.
    fastify.patch("/medicine/attach-barcode", { preHandler: [handler_1.authenticated, handler_1.pharmacyMobileAuth] }, medicineController_1.attachMedicineBarcode);
    // Mobile bulk-pull. Returns every Medicine + its MedicineStock rows in
    // the line, optionally only those newer than ?since=<unix-ms>. Mobile
    // mirrors this into local SQLite for the offline scanner / detail.
    fastify.get("/medicine/sync", { preHandler: [handler_1.authenticated, handler_1.pharmacyMobileAuth] }, medicineController_1.medicineSync);
    // Mobile bulk upload of queued Add Stock ops. Body: { ops: [...] } where
    // each op carries a clientOpId for idempotency. Response includes a
    // per-op outcome so the mobile can mark only successes as synced.
    fastify.post("/medicine/add-stock/bulk", { preHandler: [handler_1.authenticated, handler_1.pharmacyMobileAuth] }, medicineController_1.bulkAddMedicineStock);
    // Correct a batch's details (quantity, per-unit, unit, dates). Access is
    // enforced inside: storage creator or Dispense & Stock Access only.
    fastify.patch("/medicine/stock/edit", { preHandler: handler_1.authenticated }, medicineController_1.editMedicineStock);
    fastify.get("/medicine/expiration", { preHandler: handler_1.authenticated }, medicineController_1.expirationList);
    fastify.get("/medicine/expiration/export", { preHandler: handler_1.authenticated }, medicineController_1.exportExpirationList);
    // Export a storage's medicines into the Excel report template.
    fastify.get("/medicine/export/report", { preHandler: handler_1.authenticated }, medicineController_1.exportMedicineReport);
    // Bulk-import medicines from an uploaded spreadsheet (web Config page).
    fastify.post("/medicine/bulk-upload", { preHandler: handler_1.authenticated }, medicineController_1.medicineBulkUpload);
    // ── Mobile Access management (web Medicine > Config > Mobile Access tab) ──
    fastify.get("/medicine/mobile-access", { preHandler: handler_1.authenticated }, mobileAccessController_1.listMobileAccess);
    fastify.get("/medicine/mobile-access/candidates", { preHandler: handler_1.authenticated }, mobileAccessController_1.mobileAccessCandidates);
    fastify.post("/medicine/mobile-access", { preHandler: handler_1.authenticated }, mobileAccessController_1.grantMobileAccess);
    fastify.delete("/medicine/mobile-access", { preHandler: handler_1.authenticated }, mobileAccessController_1.revokeMobileAccess);
    // Mobile self-check: does the logged-in user have pharmacy mobile access?
    fastify.get("/medicine/mobile-access/me", { preHandler: handler_1.authenticated }, mobileAccessController_1.myMobileAccess);
    // ── Per-storage Dispense Access (web Medicine > Storage > Dispense Access) ──
    fastify.get("/medicine/storage-access", { preHandler: handler_1.authenticated }, storageAccessController_1.listStorageAccess);
    fastify.get("/medicine/storage-access/candidates", { preHandler: handler_1.authenticated }, storageAccessController_1.storageAccessCandidates);
    fastify.post("/medicine/storage-access", { preHandler: handler_1.authenticated }, storageAccessController_1.grantStorageAccess);
    fastify.delete("/medicine/storage-access", { preHandler: handler_1.authenticated }, storageAccessController_1.revokeStorageAccess);
};
exports.medicine = medicine;
