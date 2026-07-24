import { FastifyInstance } from "../barrel/fastify";
import {
  authenticated,
  medicineAccessAuth,
  pharmacyMobileAuth,
} from "../middleware/handler";
import {
  listMobileAccess,
  mobileAccessCandidates,
  grantMobileAccess,
  revokeMobileAccess,
  myMobileAccess,
} from "../controller/mobileAccessController";
import {
  listStorageAccess,
  storageAccessCandidates,
  grantStorageAccess,
  revokeStorageAccess,
} from "../controller/storageAccessController";

import {
  medicineStorage,
  searchMedicineStock,
  directDispenseBulk,
  addMedicineStorage,
  medicineList,
  addStorageMed,
  medicineLogList,
  storageMeds,
  setMedicineLowStockThreshold,
  addStorageMedInList,
  storageMedList,
  newPrescriptionCount,
  medicineNotification,
  viewNotification,
  transferMedicine,
  removeStock,
  medicineTransactions,
  removeMedicine,
  medicineOverview,
  storageData,
  removeStorage,
  scanLowStock,
  expirationList,
  exportExpirationList,
  updateMedicineEntry,
  recordMedicineScan,
  attachMedicineBarcode,
  medicineSync,
  bulkAddMedicineStock,
  editMedicineStock,
  exportMedicineReport,
  medicineBulkUpload,
  updateMedicineThreshold,
} from "../controller/medicineController";

export const medicine = (fastify: FastifyInstance) => {
  fastify.get(
    "/medicine/storage",
    { preHandler: authenticated },
    medicineStorage,
  );
  // Pharmacy Home search: any medicine-module user sees a medicine's stock
  // per storage (each storage flagged accessible for the caller).
  fastify.get(
    "/medicine/search-stock",
    { preHandler: authenticated },
    searchMedicineStock,
  );
  // Direct dispense (no prescription): FEFO deduction + Medicine Logs audit,
  // idempotent ops, actor from token, Dispense & Stock Access enforced.
  fastify.post(
    "/medicine/direct-dispense/bulk",
    { preHandler: authenticated },
    directDispenseBulk,
  );
  fastify.get("/medicine/logs", { preHandler: authenticated }, medicineLogList);
  fastify.patch(
    "/medicine/threshold",
    { preHandler: authenticated },
    updateMedicineThreshold,
  );
  fastify.post(
    "/medicine/storage/add-storage-location",
    { preHandler: authenticated },
    addMedicineStorage,
  );
  fastify.get(
    "/medicine/storage-list",
    { preHandler: authenticated },
    medicineList,
  );

  fastify.get("/medicine/items", { preHandler: authenticated }, storageMeds);
  fastify.get("/medicine/storage-item", storageMedList);
  // ONE low-stock threshold per MEDICINE — alerts on the medicine TOTAL.
  fastify.patch(
    "/medicine/low-stock-threshold",
    { preHandler: authenticated },
    setMedicineLowStockThreshold,
  );

  fastify.post("/add-medicine", { preHandler: authenticated }, addStorageMed);
  fastify.post(
    "/storage/add-medicine",
    { preHandler: authenticated },
    addStorageMedInList,
  );
  fastify.get(
    "/medicine/new/notif",
    { preHandler: authenticated },
    newPrescriptionCount,
  );
  fastify.get(
    "/medicine/notifications",
    { preHandler: authenticated },
    medicineNotification,
  );
  fastify.patch(
    "/medicine/notification/view",
    { preHandler: authenticated },
    viewNotification,
  );

  fastify.patch(
    "/medicine/transfer",
    { preHandler: authenticated },
    transferMedicine,
  );

  fastify.delete(
    "/storage/medicine/remove",
    { preHandler: authenticated },
    removeStock,
  );
  fastify.get(
    "/medicine/transactions",
    { preHandler: authenticated },
    medicineTransactions,
  );
  fastify.delete(
    "/medicine/remove",
    { preHandler: authenticated },
    removeMedicine,
  );
  fastify.patch(
    "/medicine/update",
    { preHandler: authenticated },
    updateMedicineEntry,
  );
  fastify.get(
    "/medicine/overview",
    { preHandler: authenticated },
    medicineOverview,
  );
  fastify.get("/storage/data", { preHandler: authenticated }, storageData);
  fastify.delete(
    "/storage/remove",
    { preHandler: authenticated },
    removeStorage,
  );
  fastify.post(
    "/medicine/scan-low-stock",
    { preHandler: authenticated },
    scanLowStock,
  );
  // Mobile offline-scan upload. Mobile sends barcode + name (+ optional
  // notes/lineId/scannedAt) and we upsert a Medicine row keyed on
  // (serialNumber, lineId), returning its id for client-side dedupe.
  fastify.post(
    "/medicine/scan-log",
    { preHandler: [authenticated, pharmacyMobileAuth] },
    recordMedicineScan,
  );
  // Mobile "Barcode registration": attach a scanned barcode to a medicine.
  fastify.patch(
    "/medicine/attach-barcode",
    { preHandler: [authenticated, pharmacyMobileAuth] },
    attachMedicineBarcode,
  );
  // Mobile bulk-pull. Returns every Medicine + its MedicineStock rows in
  // the line, optionally only those newer than ?since=<unix-ms>. Mobile
  // mirrors this into local SQLite for the offline scanner / detail.
  fastify.get(
    "/medicine/sync",
    { preHandler: [authenticated, pharmacyMobileAuth] },
    medicineSync,
  );
  // Mobile bulk upload of queued Add Stock ops. Body: { ops: [...] } where
  // each op carries a clientOpId for idempotency. Response includes a
  // per-op outcome so the mobile can mark only successes as synced.
  fastify.post(
    "/medicine/add-stock/bulk",
    { preHandler: [authenticated, pharmacyMobileAuth] },
    bulkAddMedicineStock,
  );
  // Correct a batch's details (quantity, per-unit, unit, dates). Access is
  // enforced inside: storage creator or Dispense & Stock Access only.
  fastify.patch(
    "/medicine/stock/edit",
    { preHandler: authenticated },
    editMedicineStock,
  );
  fastify.get(
    "/medicine/expiration",
    { preHandler: authenticated },
    expirationList,
  );
  fastify.get(
    "/medicine/expiration/export",
    { preHandler: authenticated },
    exportExpirationList,
  );
  // Export a storage's medicines into the Excel report template.
  fastify.get(
    "/medicine/export/report",
    { preHandler: authenticated },
    exportMedicineReport,
  );
  // Bulk-import medicines from an uploaded spreadsheet (web Config page).
  fastify.post(
    "/medicine/bulk-upload",
    { preHandler: authenticated },
    medicineBulkUpload,
  );

  // ── Mobile Access management (web Medicine > Config > Mobile Access tab) ──
  fastify.get(
    "/medicine/mobile-access",
    { preHandler: authenticated },
    listMobileAccess,
  );
  fastify.get(
    "/medicine/mobile-access/candidates",
    { preHandler: authenticated },
    mobileAccessCandidates,
  );
  fastify.post(
    "/medicine/mobile-access",
    { preHandler: authenticated },
    grantMobileAccess,
  );
  fastify.delete(
    "/medicine/mobile-access",
    { preHandler: authenticated },
    revokeMobileAccess,
  );
  // Mobile self-check: does the logged-in user have pharmacy mobile access?
  fastify.get(
    "/medicine/mobile-access/me",
    { preHandler: authenticated },
    myMobileAccess,
  );

  // ── Per-storage Dispense Access (web Medicine > Storage > Dispense Access) ──
  fastify.get(
    "/medicine/storage-access",
    { preHandler: authenticated },
    listStorageAccess,
  );
  fastify.get(
    "/medicine/storage-access/candidates",
    { preHandler: authenticated },
    storageAccessCandidates,
  );
  fastify.post(
    "/medicine/storage-access",
    { preHandler: authenticated },
    grantStorageAccess,
  );
  fastify.delete(
    "/medicine/storage-access",
    { preHandler: authenticated },
    revokeStorageAccess,
  );
};
