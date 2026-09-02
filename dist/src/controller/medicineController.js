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
var __rest = (this && this.__rest) || function (s, e) {
    var t = {};
    for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0)
        t[p] = s[p];
    if (s != null && typeof Object.getOwnPropertySymbols === "function")
        for (var i = 0, p = Object.getOwnPropertySymbols(s); i < p.length; i++) {
            if (e.indexOf(p[i]) < 0 && Object.prototype.propertyIsEnumerable.call(s, p[i]))
                t[p[i]] = s[p[i]];
        }
    return t;
};
var __asyncValues = (this && this.__asyncValues) || function (o) {
    if (!Symbol.asyncIterator) throw new TypeError("Symbol.asyncIterator is not defined.");
    var m = o[Symbol.asyncIterator], i;
    return m ? m.call(o) : (o = typeof __values === "function" ? __values(o) : o[Symbol.iterator](), i = {}, verb("next"), verb("throw"), verb("return"), i[Symbol.asyncIterator] = function () { return this; }, i);
    function verb(n) { i[n] = o[n] && function (v) { return new Promise(function (resolve, reject) { v = o[n](v), settle(resolve, reject, v.done, v.value); }); }; }
    function settle(resolve, reject, d, v) { Promise.resolve(v).then(function(v) { resolve({ value: v, done: d }); }, reject); }
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateMedicineThreshold = exports.medicineBulkUpload = exports.exportMedicineReport = exports.medicineDispenseInsights = exports.dispenseHistoryExport = exports.dispenseHistoryDetail = exports.dispenseHistoryList = exports.directDispenseMulti = exports.directDispenseBulk = exports.createDispenseRecord = exports.bulkAddMedicineStock = exports.medicineSync = exports.recordMedicineScan = exports.scanLowStock = exports.removeStorage = exports.storageData = exports.exportExpirationList = exports.expirationList = exports.medicineOverview = exports.removeMedicine = exports.medicineTransactions = exports.updateMedicineStock = exports.removeStock = exports.updateStock = exports.transferMedicine = exports.viewNotification = exports.medicineNotification = exports.newPrescriptionCount = exports.setMedicineLowStockThreshold = exports.storageMedList = exports.addStorageMedInList = exports.editMedicineStock = exports.consolidateSplitBatches = exports.storageMeds = exports.searchMedicineStock = exports.medicineLogList = exports.addStorageMed = exports.multiAddMed = exports.addMedFromExcel = exports.attachMedicineBarcode = exports.updateMedicineEntry = exports.medicineList = exports.addMedicineStorage = exports.medicineStorage = void 0;
const prisma_1 = require("../barrel/prisma");
const errors_1 = require("../errors/errors");
//
const path_1 = __importDefault(require("path"));
const exceljs_1 = __importDefault(require("exceljs"));
const xlsx_1 = __importDefault(require("xlsx"));
const stream_1 = require("stream");
//
const handler_1 = require("../middleware/handler");
const date_1 = require("../utils/date");
const storageAccessController_1 = require("./storageAccessController");
const medicineAlerts_1 = require("../service/medicineAlerts");
const scanCode_1 = require("../utils/scanCode");
const medicineStorage = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c;
    const params = req.query;
    if (!params.id)
        throw new errors_1.ValidationError("BAD_REQUEST");
    try {
        const cursor = params.lastCursor ? { id: params.lastCursor } : undefined;
        const limit = params.limit ? parseInt(params.limit.toString()) : 10;
        // ?accessibleOnly=1 → only storages the AUTHENTICATED user has a
        // Dispense Access grant on. The mobile scanner's storage picker uses
        // this so a scan can only ever stock a storage the user is allowed in.
        let accessFilter = {};
        if (params.accessibleOnly === "1") {
            const accountId = (_a = req.user) === null || _a === void 0 ? void 0 : _a.id;
            const account = accountId
                ? yield prisma_1.prisma.account.findUnique({
                    where: { id: accountId },
                    select: { User: { select: { id: true } } },
                })
                : null;
            const authUserId = (_c = (_b = account === null || account === void 0 ? void 0 : account.User) === null || _b === void 0 ? void 0 : _b.id) !== null && _c !== void 0 ? _c : null;
            // Self-heal: single-storage lines auto-assign the scanner user before
            // filtering, so the picker is never empty for a trusted mobile user.
            yield (0, storageAccessController_1.autoGrantSoleStorageAccess)(authUserId, params.id);
            accessFilter = {
                MedicineStorageAccess: {
                    some: { userId: authUserId !== null && authUserId !== void 0 ? authUserId : "__none__" },
                },
            };
        }
        const response = yield prisma_1.prisma.medicineStorage.findMany({
            where: Object.assign({ lineId: params.id, status: { not: 0 } }, accessFilter),
            skip: cursor ? 1 : 0,
            take: limit,
            cursor,
        });
        const newLastCursorId = response.length > 0 ? response[response.length - 1].id : null;
        const hasMore = response.length === limit;
        res.code(200).send({
            list: response,
            lastCursor: newLastCursorId,
            hasMore,
        });
    }
    catch (error) {
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw new errors_1.AppError("DB_CONNECTION_EROR", 500, "DB_FAILED");
        }
        throw error;
    }
});
exports.medicineStorage = medicineStorage;
const addMedicineStorage = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d;
    const body = req.body;
    console.log(body);
    if (!body.name || !body.lineId || !body.departmentId) {
        throw new errors_1.ValidationError("BAD_REQUEST");
    }
    try {
        const refNumber = yield (0, handler_1.generateStorageRef)();
        // The CREATOR is implicitly allowed to stock/restock/dispense in their
        // own storage — resolve them from the auth token (body.userId backup).
        const accountId = (_a = req.user) === null || _a === void 0 ? void 0 : _a.id;
        const authAccount = accountId
            ? yield prisma_1.prisma.account.findUnique({
                where: { id: accountId },
                select: { User: { select: { id: true } } },
            })
            : null;
        const creatorId = (_d = (_c = (_b = authAccount === null || authAccount === void 0 ? void 0 : authAccount.User) === null || _b === void 0 ? void 0 : _b.id) !== null && _c !== void 0 ? _c : body.userId) !== null && _d !== void 0 ? _d : null;
        yield prisma_1.prisma.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            const storage = yield prisma_1.prisma.medicineStorage.create({
                data: {
                    name: body.name,
                    desc: body.desc,
                    lineId: body.lineId,
                    departmentId: body.departmentId,
                    refNumber: refNumber,
                    timestamp: new Date().toISOString(),
                    createdById: creatorId,
                },
            });
            yield tx.medicineLogs.create({
                data: {
                    action: 1,
                    message: `Added new Storage location: ${storage.name}, Ref. number: ${storage.refNumber}`,
                    userId: body.userId,
                },
            });
        }));
        res.code(200).send({ message: "OK" });
    }
    catch (error) {
        console.log(error);
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw new errors_1.AppError("DB_CONNECTION_EROR", 500, "DB_FAILED");
        }
        throw error;
    }
});
exports.addMedicineStorage = addMedicineStorage;
/**
 * Catalog list — the master list of medicines available in a line.
 *
 * Excludes soft-deleted entries (phase=0). Each row carries a small
 * `stats` block (batches + on-hand units) so the catalog UI can show
 * "5 batches · 120 units" without an extra trip per row.
 */
const medicineList = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const params = req.query;
    if (!params.id)
        throw new errors_1.ValidationError("BAD_REQUEST");
    try {
        const cursor = params.lastCursor ? { id: params.lastCursor } : undefined;
        const limit = params.limit ? parseInt(params.limit, 10) : 20;
        // Soft-delete marker is `phase: -1`. All existing rows default to
        // `phase: 0` so we filter "not removed" instead of "phase == 1".
        const where = { lineId: params.id, phase: { not: -1 } };
        if (params.query) {
            const q = params.query.trim();
            where.OR = [
                { name: { contains: q, mode: "insensitive" } },
                { serialNumber: { contains: q, mode: "insensitive" } },
            ];
        }
        const rows = yield prisma_1.prisma.medicine.findMany({
            where,
            skip: cursor ? 1 : 0,
            take: limit,
            cursor,
            orderBy: { name: "asc" },
            include: {
                _count: { select: { MedicineStock: true } },
                MedicineStock: { select: { actualStock: true } },
            },
        });
        const list = rows.map((m) => {
            var _a, _b;
            const stocks = (_a = m.MedicineStock) !== null && _a !== void 0 ? _a : [];
            const totalUnits = stocks.reduce((s, r) => { var _a; return s + ((_a = r.actualStock) !== null && _a !== void 0 ? _a : 0); }, 0);
            const { MedicineStock, _count } = m, rest = __rest(m, ["MedicineStock", "_count"]);
            return Object.assign(Object.assign({}, rest), { stats: {
                    batches: (_b = _count === null || _count === void 0 ? void 0 : _count.MedicineStock) !== null && _b !== void 0 ? _b : 0,
                    totalUnits,
                } });
        });
        const lastCursor = list.length > 0 ? list[list.length - 1].id : null;
        const hasMore = list.length === limit;
        return res.code(200).send({ list, lastCursor, hasMore });
    }
    catch (error) {
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw new errors_1.AppError("DB_CONNECTION_EROR", 500, "DB_FAILED");
        }
        throw error;
    }
});
exports.medicineList = medicineList;
/**
 * Update a medicine's catalog metadata (name / description).
 *
 * Refuses to change `serialNumber` (immutable — used as a stable
 * reference across history, transactions, and labels).
 */
const updateMedicineEntry = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    const body = req.body;
    if (!body.id)
        throw new errors_1.ValidationError("INVALID REQUIRED ID");
    const name = (_a = body.name) === null || _a === void 0 ? void 0 : _a.trim();
    if (!name)
        throw new errors_1.ValidationError("Name is required.");
    try {
        const result = yield prisma_1.prisma.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            var _a, _b, _c;
            const existing = yield tx.medicine.findUnique({
                where: { id: body.id },
            });
            if (!existing)
                throw new errors_1.NotFoundError("Medicine not found");
            if (existing.phase === -1)
                throw new errors_1.ValidationError("This medicine has been removed.");
            const updated = yield tx.medicine.update({
                where: { id: body.id },
                data: {
                    name,
                    desc: (_b = (_a = body.desc) === null || _a === void 0 ? void 0 : _a.trim()) !== null && _b !== void 0 ? _b : existing.desc,
                },
            });
            if (body.userId) {
                yield tx.medicineLogs.create({
                    data: {
                        action: 2,
                        userId: body.userId,
                        lineId: (_c = body.lineId) !== null && _c !== void 0 ? _c : null,
                        message: `Updated medicine "${existing.name}" → "${updated.name}" ` +
                            `(serial ${updated.serialNumber})`,
                    },
                });
            }
            return updated;
        }));
        return res.code(200).send({ message: "OK", medicine: result });
    }
    catch (error) {
        if (error instanceof errors_1.NotFoundError)
            throw error;
        if (error instanceof errors_1.ValidationError)
            throw error;
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw (0, errors_1.dbError)(error);
        }
        throw error;
    }
});
exports.updateMedicineEntry = updateMedicineEntry;
/**
 * PATCH /medicine/attach-barcode { medicineId, barcode, lineId?, userId? }
 * Mobile "Barcode registration": attach a scanned barcode to an existing
 * medicine. Barcode is globally unique — if it's already registered to a
 * different medicine we return 409 plus that medicine's id/name so the app
 * can jump straight to its restock page instead.
 */
const attachMedicineBarcode = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d, _e, _f;
    const body = req.body;
    // QR payloads are read through the SAME canonical reader as 1D barcodes:
    // GS1 QR yields the product GTIN (so every lot maps to one medicine),
    // and foreign QRs (employee IDs, signature links, WiFi, vCard) are
    // refused here rather than being registered as a medicine.
    const reading = (0, scanCode_1.readScannedCode)((_a = body.barcode) !== null && _a !== void 0 ? _a : "");
    if (reading.rejected)
        throw new errors_1.ValidationError(reading.rejected);
    const barcode = reading.code;
    if (!body.medicineId || !barcode)
        throw new errors_1.ValidationError("medicineId and barcode are required");
    try {
        // Idempotency: the mobile queue retries with the same clientOpId when a
        // response is lost — if we've already applied this op, say OK again.
        if (body.clientOpId) {
            const prior = yield prisma_1.prisma.mobileUploadLog.findUnique({
                where: { clientOpId: body.clientOpId },
                select: { resultId: true },
            });
            if (prior) {
                return res.code(200).send({
                    message: "OK (already applied)",
                    id: (_b = prior.resultId) !== null && _b !== void 0 ? _b : body.medicineId,
                    barcode,
                    duplicate: true,
                });
            }
        }
        const med = yield prisma_1.prisma.medicine.findUnique({
            where: { id: body.medicineId },
            select: {
                id: true,
                name: true,
                serialNumber: true,
                phase: true,
                barcode: true,
                lineId: true,
            },
        });
        if (!med)
            throw new errors_1.NotFoundError("Medicine not found");
        if (med.phase === -1)
            throw new errors_1.ValidationError("This medicine has been removed.");
        // Barcode uniqueness is PER LINE — another line owning the same EAN is
        // fine (identical products nationwide); only a conflict INSIDE this
        // medicine's line blocks the registration. Match every stored form so
        // a pre-normalization row is recognised as the holder.
        const holder = yield prisma_1.prisma.medicine.findFirst({
            where: {
                lineId: med.lineId,
                barcode: { in: (0, scanCode_1.barcodeLookupCandidates)((_c = body.barcode) !== null && _c !== void 0 ? _c : "") },
                NOT: { id: med.id },
            },
            select: { id: true, name: true },
        });
        if (holder) {
            return res.code(409).send({
                message: `Barcode already registered to ${holder.name}`,
                existingMedicineId: holder.id,
                existingName: holder.name,
            });
        }
        const updated = yield prisma_1.prisma.medicine.update({
            where: { id: body.medicineId },
            // Touch timestamp so other devices' incremental /medicine/sync pulls
            // (which filter on timestamp > since) pick up the new barcode.
            data: { barcode, timestamp: new Date() },
        });
        if (body.clientOpId) {
            try {
                yield prisma_1.prisma.mobileUploadLog.create({
                    data: {
                        clientOpId: body.clientOpId,
                        kind: "attach-barcode",
                        userId: (_d = body.userId) !== null && _d !== void 0 ? _d : null,
                        lineId: (_e = body.lineId) !== null && _e !== void 0 ? _e : null,
                        resultId: updated.id,
                        message: `barcode ${barcode}`,
                    },
                });
            }
            catch (_g) {
                /* dedupe log is best-effort */
            }
        }
        if (body.userId) {
            try {
                yield prisma_1.prisma.medicineLogs.create({
                    data: {
                        action: 2,
                        userId: body.userId,
                        lineId: (_f = body.lineId) !== null && _f !== void 0 ? _f : null,
                        message: `Registered barcode ${barcode} to "${med.name}" ` +
                            `(serial ${med.serialNumber})` +
                            (med.barcode && med.barcode !== barcode
                                ? ` — replaced ${med.barcode}`
                                : ""),
                    },
                });
            }
            catch (_h) {
                /* audit is best-effort */
            }
        }
        return res
            .code(200)
            .send({ message: "OK", id: updated.id, barcode: updated.barcode });
    }
    catch (error) {
        if (error instanceof errors_1.NotFoundError)
            throw error;
        if (error instanceof errors_1.ValidationError)
            throw error;
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw (0, errors_1.dbError)(error);
        }
        throw error;
    }
});
exports.attachMedicineBarcode = attachMedicineBarcode;
const addMedFromExcel = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        // Check if the request is multipart
        if (!req.isMultipart()) {
            throw new errors_1.ValidationError("Request is not multipart");
        }
        const data = yield req.file();
        if (!data) {
            throw new errors_1.ValidationError("No file uploaded");
        }
        const workbook = new exceljs_1.default.Workbook();
        workbook.created = new Date();
        // Check if file is an Excel file
        const allowedMimeTypes = [
            "application/vnd.ms-excel",
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "application/octet-stream",
        ];
        if (!allowedMimeTypes.includes(data.mimetype)) {
            throw new errors_1.ValidationError("Only Excel files are allowed");
        }
        // Create uploads directory if it doesn't exist
        const uploadsDir = path_1.default.join(__dirname, "uploads");
        const workbooks = xlsx_1.default.readFile(uploadsDir);
        const sheets = workbooks.SheetNames;
        sheets.forEach((item, i) => __awaiter(void 0, void 0, void 0, function* () {
            const workSheet = workbooks.Sheets[item];
            const data = xlsx_1.default.utils.sheet_to_json(workSheet);
            data.forEach((item) => { });
            // const existedThruName = await prisma.medicine.findMany({
            //   where:{
            //     name: data.map((item)=> item.Medicines)
            //   }
            // })
        }));
        return res.status(200).send({
            success: true,
            message: "File uploaded successfully",
        });
    }
    catch (error) {
        if (error instanceof errors_1.ValidationError) {
            return res.status(400).send({
                success: false,
                error: error.message,
            });
        }
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw new errors_1.AppError("DB_CONNECTION_ERROR", 500, "DB_FAILED");
        }
        console.error("Upload error:", error);
        return res.status(500).send({
            success: false,
            error: "Internal server error",
        });
    }
});
exports.addMedFromExcel = addMedFromExcel;
const multiAddMed = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const body = req.body;
    if (body.ids.length === 0 || !body.storageId)
        throw new errors_1.ValidationError("BAD_REQUEST");
    try {
        let processed = 0;
        const chunkSize = 50;
        const chunks = [];
        // Create chunks of 50 IDs each
        for (let i = 0; i < body.ids.length; i += chunkSize) {
            const chunk = body.ids.slice(i, i + chunkSize);
            chunks.push(chunk);
        }
        console.log(`Processing ${body.ids.length} IDs in ${chunks.length} chunks`);
        // Process each chunk
        for (let i = 0; i < chunks.length; i++) {
            const chunk = chunks[i];
            console.log(`Processing chunk ${i + 1}/${chunks.length} with ${chunk.length} IDs`);
            // Process the chunk (replace with your actual logic)
        }
        return res.status(200).send({
            success: true,
            message: `Successfully processed ${body.ids.length} IDs in ${chunks.length} batches`,
            totalProcessed: body.ids.length,
            batches: chunks.length,
        });
    }
    catch (error) {
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw new errors_1.AppError("DB_CONNECTION_ERROR", 500, "DB_FAILED");
        }
        throw error;
    }
});
exports.multiAddMed = multiAddMed;
// const processChunk = async (chunk: string[], storageId: string) => {
//   await prisma.medicineStock.create({
//     data: {
//       stock: {
//         create: {
//           quantity: 0,
//         },
//       },
//       medicineStorageId: storageId,
//       medicineId:
//     }
//   })
// };
const addStorageMed = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const body = req.body;
    if (!body.lineId || !body.userId || !body.name) {
        throw new errors_1.ValidationError("BAD_REQUEST");
    }
    try {
        const created = yield prisma_1.prisma.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            var _a;
            // Prefer barcode match (scanner workflow) before falling back to
            // the legacy name-based dedupe used by the web Add Medicine flow.
            let med = null;
            if (body.barcode && body.barcode.trim()) {
                // Line-scoped: another line owning this barcode is NOT a duplicate.
                med = yield tx.medicine.findFirst({
                    where: { barcode: body.barcode.trim(), lineId: body.lineId },
                });
            }
            if (!med) {
                // Same name (ignoring case/pad) in THIS line = already in the catalog.
                // Was `contains` and unscoped, which got it wrong both ways: it blocked
                // a name another LINE happened to own, it blocked "Cefalexin" when
                // "Cefalexin 125mg/5ml" existed (different products), and it let
                // "Cefalexin 125mg/5ml" through when plain "Cefalexin" existed —
                // creating the duplicate rows that split a medicine's stock.
                med = yield tx.medicine.findFirst({
                    where: {
                        lineId: body.lineId,
                        name: { equals: body.name.trim(), mode: "insensitive" },
                    },
                });
            }
            if (med)
                throw new errors_1.ValidationError("ALREADY_EXIST");
            const serialNumber = yield (0, handler_1.generateMedRef)();
            const medicine = yield tx.medicine.create({
                data: {
                    lineId: body.lineId,
                    name: body.name,
                    desc: body.desc,
                    serialNumber,
                    barcode: ((_a = body.barcode) === null || _a === void 0 ? void 0 : _a.trim()) || null,
                },
            });
            yield tx.medicineLogs.create({
                data: {
                    action: 1,
                    message: `Added new medicine in the list; Med. Serial Ref.: ${medicine.serialNumber} - Label: ${medicine.name}`,
                    userId: body.userId,
                    lineId: body.lineId,
                },
            });
            return medicine;
        }));
        return res.code(200).send({ id: created.id, serialNumber: created.serialNumber });
    }
    catch (error) {
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw new errors_1.AppError("DB_CONNECTION_EROR", 500, "DB_FAILED");
        }
        throw error;
    }
});
exports.addStorageMed = addStorageMed;
const medicineLogList = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const params = req.query;
    if (!params.id)
        throw new errors_1.ValidationError("BAD_REQUEST");
    try {
        const cursor = params.lastCursor ? { id: params.lastCursor } : undefined;
        const limit = params.limit ? parseInt(params.limit, 10) : 20;
        const response = yield prisma_1.prisma.medicineLogs.findMany({
            where: {
                lineId: params.id,
            },
            skip: cursor ? 1 : 0,
            take: limit,
            cursor,
            orderBy: {
                timestamp: "desc",
            },
            include: {
                user: {
                    select: {
                        id: true,
                        profilePicture: true,
                        username: true,
                    },
                },
            },
        });
        const newLastCursorId = response.length > 0 ? response[response.length - 1].id : null;
        const hasMore = limit === response.length;
        return res
            .code(200)
            .send({ list: response, lastCursor: newLastCursorId, hasMore });
    }
    catch (error) {
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw new errors_1.AppError("DB_CONNECTION_EROR", 500, "DB_FAILED");
        }
        throw error;
    }
});
exports.medicineLogList = medicineLogList;
/**
 * GET /medicine/search-stock?id=<lineId>&query= — the Pharmacy Home search.
 *
 * ANY user holding the medicine module may search a medicine and see WHERE
 * its stock sits: one row per medicine, its stock grouped per storage, each
 * storage carrying an `accessible` flag — whether the CALLER holds Dispense
 * & Stock Access there. Reading is open to the module; the flag is what the
 * UI uses to show "view only" vs the edit affordances (the server still
 * enforces every write regardless).
 */
const searchMedicineStock = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d;
    const params = req.query;
    if (!params.id)
        throw new errors_1.ValidationError("BAD_REQUEST");
    const q = ((_a = params.query) !== null && _a !== void 0 ? _a : "").trim();
    if (!q)
        return res.code(200).send({ list: [] });
    try {
        const meds = yield prisma_1.prisma.medicine.findMany({
            where: {
                lineId: params.id,
                OR: [
                    { name: { contains: q, mode: "insensitive" } },
                    { serialNumber: { contains: q, mode: "insensitive" } },
                    { barcode: { contains: q, mode: "insensitive" } },
                ],
            },
            take: 12,
            orderBy: { name: "asc" },
            select: {
                id: true,
                name: true,
                serialNumber: true,
                barcode: true,
                MedicineStock: {
                    select: {
                        id: true,
                        actualStock: true,
                        quality: true,
                        perQuantity: true,
                        expiration: true,
                        medicineStorageId: true,
                        MedicineStorage: {
                            select: { id: true, name: true, refNumber: true },
                        },
                    },
                },
            },
        });
        // Which of the involved storages can the CALLER write in?
        const accountId = (_b = req.user) === null || _b === void 0 ? void 0 : _b.id;
        const account = accountId
            ? yield prisma_1.prisma.account.findUnique({
                where: { id: accountId },
                select: { User: { select: { id: true } } },
            })
            : null;
        const callerUserId = (_d = (_c = account === null || account === void 0 ? void 0 : account.User) === null || _c === void 0 ? void 0 : _c.id) !== null && _d !== void 0 ? _d : null;
        const storageIds = [
            ...new Set(meds.flatMap((m) => m.MedicineStock.map((s) => s.medicineStorageId).filter(Boolean))),
        ];
        const [grants, createdMine, callerIsSuper] = yield Promise.all([
            callerUserId && storageIds.length
                ? prisma_1.prisma.medicineStorageAccess.findMany({
                    where: { userId: callerUserId, medicineStorageId: { in: storageIds } },
                    select: { medicineStorageId: true },
                })
                : Promise.resolve([]),
            callerUserId && storageIds.length
                ? prisma_1.prisma.medicineStorage.findMany({
                    where: { id: { in: storageIds }, createdById: callerUserId },
                    select: { id: true },
                })
                : Promise.resolve([]),
            (0, storageAccessController_1.isSuperAdmin)(callerUserId),
        ]);
        // Accessible = super-admin (all), OR the storage's creator, OR an explicit
        // Dispense & Stock Access grant. Drives whether Dispense can use a storage.
        const canWrite = new Set([
            ...grants.map((g) => g.medicineStorageId),
            ...createdMine.map((s) => s.id),
        ]);
        const list = meds.map((m) => {
            var _a, _b, _c, _d, _e, _f;
            const perStorage = new Map();
            let totalOnHand = 0;
            for (const s of m.MedicineStock) {
                totalOnHand += (_a = s.actualStock) !== null && _a !== void 0 ? _a : 0;
                const st = s.MedicineStorage;
                if (!st)
                    continue;
                const row = (_b = perStorage.get(st.id)) !== null && _b !== void 0 ? _b : {
                    id: st.id,
                    name: (_c = st.name) !== null && _c !== void 0 ? _c : null,
                    refNumber: (_d = st.refNumber) !== null && _d !== void 0 ? _d : null,
                    onHand: 0,
                    batches: 0,
                    nearestExpiration: null,
                    accessible: callerIsSuper || canWrite.has(st.id),
                };
                row.onHand += (_e = s.actualStock) !== null && _e !== void 0 ? _e : 0;
                row.batches += 1;
                if (s.expiration &&
                    ((_f = s.actualStock) !== null && _f !== void 0 ? _f : 0) > 0 &&
                    (!row.nearestExpiration || s.expiration < row.nearestExpiration)) {
                    row.nearestExpiration = s.expiration;
                }
                perStorage.set(st.id, row);
            }
            return {
                id: m.id,
                name: m.name,
                serialNumber: m.serialNumber,
                barcode: m.barcode,
                totalOnHand,
                storages: [...perStorage.values()].sort((a, b) => b.onHand - a.onHand),
            };
        });
        return res.code(200).send({ list });
    }
    catch (error) {
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw (0, errors_1.dbError)(error);
        }
        throw error;
    }
});
exports.searchMedicineStock = searchMedicineStock;
/**
 * List medicines that have stock in the given storage.
 *
 * Returns one row per Medicine (NOT per MedicineStock). Each row includes the
 * stock batches for that medicine in this storage, plus precomputed
 * `totalStock` and `stockToExpire` so the table can render without
 * client-side aggregation. Cursor pagination is over Medicine.id.
 */
const storageMeds = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c;
    const params = req.query;
    if (!params.id)
        throw new errors_1.ValidationError("BAD_REQUEST");
    // Whether the CALLER (token identity) may write to this storage — creator or
    // a Dispense & Stock Access holder. The UI uses this to show/hide the edit,
    // transfer, add and remove controls; the write endpoints re-check regardless.
    const accountId = (_a = req.user) === null || _a === void 0 ? void 0 : _a.id;
    const authAccount = accountId
        ? yield prisma_1.prisma.account.findUnique({
            where: { id: accountId },
            select: { User: { select: { id: true } } },
        })
        : null;
    const actorId = (_c = (_b = authAccount === null || authAccount === void 0 ? void 0 : authAccount.User) === null || _b === void 0 ? void 0 : _b.id) !== null && _c !== void 0 ? _c : null;
    try {
        const cursor = params.lastCursor ? { id: params.lastCursor } : undefined;
        const limit = params.limit ? parseInt(params.limit, 10) : 10;
        const where = {
            MedicineStock: { some: { medicineStorageId: params.id } },
        };
        if (params.query) {
            const terms = params.query.trim().split(/\s+/);
            const termClauses = terms.map((term) => ({
                OR: [
                    { name: { contains: term, mode: "insensitive" } },
                    { serialNumber: { contains: term, mode: "insensitive" } },
                ],
            }));
            where.AND = termClauses;
        }
        // 6-month expiration window for "stockToExpire" count.
        const now = new Date();
        const sixMonths = new Date(now);
        sixMonths.setMonth(sixMonths.getMonth() + 6);
        const medicines = yield prisma_1.prisma.medicine.findMany({
            where,
            take: limit,
            skip: cursor ? 1 : 0,
            cursor,
            orderBy: { timestamp: "desc" },
            include: {
                MedicineStock: {
                    where: { medicineStorageId: params.id },
                    orderBy: { expiration: "asc" },
                    include: {
                        stock: { select: { unit: true, quantity: true, perUnit: true } },
                        price: {
                            select: { value: true },
                            orderBy: { timestamp: "desc" },
                            take: 1,
                        },
                    },
                },
            },
        });
        const list = medicines.map((m) => {
            var _a;
            const stocks = (_a = m.MedicineStock) !== null && _a !== void 0 ? _a : [];
            const totalStock = stocks.reduce((sum, s) => { var _a; return sum + ((_a = s.actualStock) !== null && _a !== void 0 ? _a : 0); }, 0);
            const stockToExpire = stocks.filter((s) => s.expiration && new Date(s.expiration) <= sixMonths).length;
            return Object.assign(Object.assign({}, m), { totalStock, stockToExpire });
        });
        const newLastCursorId = list.length > 0 ? list[list.length - 1].id : null;
        const hasMore = list.length === limit;
        const canWrite = yield (0, storageAccessController_1.canWriteStorage)(actorId, params.id);
        return res
            .code(200)
            .send({ list, lastCursor: newLastCursorId, hasMore, canWrite });
    }
    catch (error) {
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw new errors_1.AppError("DB_CONNECTION_EROR", 500, "DB_FAILED");
        }
        throw error;
    }
});
exports.storageMeds = storageMeds;
/**
 * Batch dates arrive with CLIENT-DEPENDENT times of day: the web saves
 * local midnight (+08 → 16:00Z of the previous day), the mobile saves UTC
 * midnight, the desktop various. Same calendar date, different instants —
 * which used to split ONE real batch into multiple rows because the
 * restock dedupe compares exact timestamps. Normalize to the NEAREST UTC
 * day boundary so one calendar date is one instant.
 */
const normalizeBatchDay = (d) => new Date(Math.round(d.getTime() / 86400000) * 86400000);
/** ±12h window around the normalized day — matches LEGACY rows stored
 *  with any time-of-day for the same calendar date. */
const batchDayWindow = (d) => {
    const mid = normalizeBatchDay(d).getTime();
    return { gte: new Date(mid - 43200000), lt: new Date(mid + 43200000) };
};
/**
 * Absorb duplicate rows of the SAME batch into `keep`: price history is
 * repointed, the dupes' low-stock alerts dropped (stale state), and the
 * rows deleted. Returns the quantity/items the caller must ADD onto the
 * keeper. Caller guarantees all rows share the batch identity.
 */
const absorbDuplicateStocks = (tx, keepId, dupes) => __awaiter(void 0, void 0, void 0, function* () {
    if (dupes.length === 0)
        return { addQty: 0, addItems: 0 };
    const ids = dupes.map((d) => d.id);
    yield tx.medicineAlert.deleteMany({
        where: { medicineStockId: { in: ids } },
    });
    yield tx.medicinePriceTrack.updateMany({
        where: { medicineStockId: { in: ids } },
        data: { medicineStockId: keepId },
    });
    yield tx.medicineStock.deleteMany({ where: { id: { in: ids } } });
    return {
        addQty: dupes.reduce((s, d) => s + d.quantity, 0),
        addItems: dupes.reduce((s, d) => s + d.actualStock, 0),
    };
});
/**
 * One-shot healer, run at boot: find batches split across multiple rows
 * (same medicine, storage, UoM, per-unit, and same nearest-day expiration
 * + manufacturing date) and merge each group into its oldest row. Fixes
 * the historical rows created before dates were normalized.
 */
const consolidateSplitBatches = () => __awaiter(void 0, void 0, void 0, function* () {
    const all = yield prisma_1.prisma.medicineStock.findMany({
        select: {
            id: true,
            medicineId: true,
            medicineStorageId: true,
            quality: true,
            perQuantity: true,
            expiration: true,
            manufacturingDate: true,
            quantity: true,
            actualStock: true,
            timestamp: true,
        },
    });
    const dayBucket = (d) => d ? Math.round(d.getTime() / 86400000) : "x";
    const groups = new Map();
    for (const r of all) {
        if (!r.medicineId || !r.medicineStorageId)
            continue;
        const k = [
            r.medicineId,
            r.medicineStorageId,
            r.quality,
            r.perQuantity,
            dayBucket(r.expiration),
            dayBucket(r.manufacturingDate),
        ].join("|");
        const g = groups.get(k);
        if (g)
            g.push(r);
        else
            groups.set(k, [r]);
    }
    let merged = 0;
    for (const rows of groups.values()) {
        if (rows.length < 2)
            continue;
        rows.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
        const keep = rows[0];
        const dupes = rows.slice(1);
        try {
            yield prisma_1.prisma.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
                const add = yield absorbDuplicateStocks(tx, keep.id, dupes);
                yield tx.medicineStock.update({
                    where: { id: keep.id },
                    data: Object.assign(Object.assign({ quantity: keep.quantity + add.addQty, actualStock: keep.actualStock + add.addItems }, (keep.expiration
                        ? { expiration: normalizeBatchDay(keep.expiration) }
                        : {})), (keep.manufacturingDate
                        ? { manufacturingDate: normalizeBatchDay(keep.manufacturingDate) }
                        : {})),
                });
            }));
            merged += dupes.length;
            console.log(`[consolidateSplitBatches] merged ${dupes.length} duplicate row(s) into stock ${keep.id}`);
        }
        catch (e) {
            console.warn("[consolidateSplitBatches] group skipped:", e);
        }
    }
    return merged;
});
exports.consolidateSplitBatches = consolidateSplitBatches;
/**
 * PATCH /medicine/stock/edit — correct a batch's details.
 *
 * Editable: quantity, per-unit quantity, unit of measure, expiration and
 * manufacturing dates. STRICT access: only the storage's creator or a
 * holder of Dispense & Stock Access may edit, exactly like restocking.
 *
 * The dangerous part is that four of those fields ARE the batch identity
 * — editing them can turn this row into a twin of an existing batch. In
 * that case we MERGE into the older row (price history repointed, stale
 * alerts cleared) instead of leaving two identical rows, which is the
 * split-batch bug this system already fought once. Totals are recomputed
 * (actualStock = quantity x perUnit), every change is written to Medicine
 * Logs with before/after values, and the medicine's low-stock state is
 * re-evaluated afterwards.
 */
const editMedicineStock = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k;
    const body = req.body;
    if (!body.stockId)
        throw new errors_1.ValidationError("stockId is required");
    // Identity from the TOKEN — never trust a client-supplied user id.
    const accountId = (_a = req.user) === null || _a === void 0 ? void 0 : _a.id;
    const authAccount = accountId
        ? yield prisma_1.prisma.account.findUnique({
            where: { id: accountId },
            select: { User: { select: { id: true } } },
        })
        : null;
    const actorId = (_c = (_b = authAccount === null || authAccount === void 0 ? void 0 : authAccount.User) === null || _b === void 0 ? void 0 : _b.id) !== null && _c !== void 0 ? _c : null;
    if (!actorId)
        throw new errors_1.ValidationError("Could not resolve your user account — sign in again.");
    try {
        const current = yield prisma_1.prisma.medicineStock.findUnique({
            where: { id: body.stockId },
            include: {
                medicine: { select: { id: true, name: true, serialNumber: true } },
                MedicineStorage: { select: { id: true, refNumber: true } },
            },
        });
        if (!current)
            throw new errors_1.NotFoundError("BATCH_NOT_FOUND");
        yield (0, storageAccessController_1.assertStorageAccess)(actorId, [current.medicineStorageId], "edit stock");
        const quantity = body.quantity !== undefined ? Math.trunc(Number(body.quantity)) : current.quantity;
        const perUnit = body.perUnit !== undefined ? Math.trunc(Number(body.perUnit)) : current.perQuantity;
        const quality = body.unitOfMeasure !== undefined && body.unitOfMeasure.trim()
            ? body.unitOfMeasure.trim()
            : current.quality;
        const expiration = body.expiration !== undefined
            ? normalizeBatchDay(new Date(body.expiration))
            : current.expiration;
        const manufacturingDate = body.manufacturingDate !== undefined
            ? normalizeBatchDay(new Date(body.manufacturingDate))
            : current.manufacturingDate;
        if (!Number.isFinite(quantity) || quantity < 0)
            throw new errors_1.ValidationError("Quantity must be 0 or more.");
        if (!Number.isFinite(perUnit) || perUnit <= 0)
            throw new errors_1.ValidationError("Per-unit quantity must be greater than 0.");
        if (expiration &&
            manufacturingDate &&
            !(expiration.getTime() > manufacturingDate.getTime()))
            throw new errors_1.ValidationError("Expiration must be after manufacturing date.");
        const result = yield prisma_1.prisma.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            const totalItems = quantity * perUnit;
            // Did this edit turn the row into a twin of another batch?
            const twins = yield tx.medicineStock.findMany({
                where: Object.assign(Object.assign({ id: { not: current.id }, medicineId: current.medicineId, medicineStorageId: current.medicineStorageId, quality, perQuantity: perUnit }, (expiration ? { expiration: batchDayWindow(expiration) } : {})), (manufacturingDate
                    ? { manufacturingDate: batchDayWindow(manufacturingDate) }
                    : {})),
                orderBy: { timestamp: "asc" },
            });
            yield (0, medicineAlerts_1.clearLowStockAlerts)(tx, current.id);
            if (twins.length > 0) {
                // Fold this row INTO the older twin — never leave duplicates.
                const keep = twins[0];
                const absorbed = yield absorbDuplicateStocks(tx, keep.id, [
                    ...twins.slice(1),
                    {
                        id: current.id,
                        quantity,
                        actualStock: totalItems,
                    },
                ]);
                const merged = yield tx.medicineStock.update({
                    where: { id: keep.id },
                    data: Object.assign(Object.assign({ quantity: keep.quantity + absorbed.addQty, actualStock: keep.actualStock + absorbed.addItems, quality, perQuantity: perUnit }, (expiration ? { expiration } : {})), (manufacturingDate ? { manufacturingDate } : {})),
                });
                return { stockId: merged.id, mergedInto: keep.id, totalItems };
            }
            const updated = yield tx.medicineStock.update({
                where: { id: current.id },
                data: Object.assign(Object.assign({ quantity, perQuantity: perUnit, quality, actualStock: totalItems }, (expiration ? { expiration } : {})), (manufacturingDate ? { manufacturingDate } : {})),
            });
            return { stockId: updated.id, mergedInto: null, totalItems };
        }));
        // Audit — spell out exactly what changed, old → new.
        const d = (x) => x ? new Date(x).toISOString().slice(0, 10) : "—";
        const changes = [];
        if (quantity !== current.quantity)
            changes.push(`quantity ${current.quantity} → ${quantity}`);
        if (perUnit !== current.perQuantity)
            changes.push(`per-unit ${current.perQuantity} → ${perUnit}`);
        if (quality !== current.quality)
            changes.push(`unit ${current.quality} → ${quality}`);
        if (d(expiration) !== d(current.expiration))
            changes.push(`expiry ${d(current.expiration)} → ${d(expiration)}`);
        if (d(manufacturingDate) !== d(current.manufacturingDate))
            changes.push(`manufactured ${d(current.manufacturingDate)} → ${d(manufacturingDate)}`);
        if (result.mergedInto)
            changes.push("merged into an identical batch");
        if (changes.length > 0) {
            yield prisma_1.prisma.medicineLogs.create({
                data: {
                    action: 2,
                    userId: actorId,
                    lineId: current.lineId,
                    message: `Edited batch of ${(_e = (_d = current.medicine) === null || _d === void 0 ? void 0 : _d.name) !== null && _e !== void 0 ? _e : "medicine"} ` +
                        `(${(_g = (_f = current.medicine) === null || _f === void 0 ? void 0 : _f.serialNumber) !== null && _g !== void 0 ? _g : "—"}) in storage ` +
                        `${(_j = (_h = current.MedicineStorage) === null || _h === void 0 ? void 0 : _h.refNumber) !== null && _j !== void 0 ? _j : "—"}: ${changes.join(", ")}` +
                        (((_k = body.reason) === null || _k === void 0 ? void 0 : _k.trim()) ? ` — reason: ${body.reason.trim()}` : ""),
                },
            });
        }
        // Stock moved, so the medicine-level low-stock state may have flipped.
        yield prisma_1.prisma.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            yield (0, medicineAlerts_1.checkAndNotifyLowStock)(tx, result.stockId);
        }));
        return res.code(200).send({
            message: "OK",
            stockId: result.stockId,
            mergedInto: result.mergedInto,
            actualStock: result.totalItems,
            changes,
        });
    }
    catch (error) {
        if (error instanceof errors_1.NotFoundError)
            throw error;
        if (error instanceof errors_1.ValidationError)
            throw error;
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError)
            throw (0, errors_1.dbError)(error);
        throw error;
    }
});
exports.editMedicineStock = editMedicineStock;
/**
 * Add (or restock) a medicine batch into a storage location.
 *
 * Business logic:
 *   - A batch is uniquely identified by
 *       (medicine, storage, expiration, manufacturingDate, UoM, perUnit).
 *   - If an existing batch matches all of those, we RESTOCK it
 *     (actualStock += perUnit * quantity, quantity += quantity).
 *   - Otherwise we create a NEW batch row.
 *   - A MedicinePriceTrack row is always recorded for the batch so price
 *     history per batch is preserved.
 *   - Optional shelf address (room/section/row/column/container) is stored
 *     on the batch.
 */
const addStorageMedInList = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d, _e;
    const body = req.body;
    if (!body.storageId || !body.medicineId || !body.lineId) {
        throw new errors_1.ValidationError("BAD_REQUEST");
    }
    if (body.quantity <= 0 || body.perUnit <= 0) {
        throw new errors_1.ValidationError("Quantity and per-unit must be positive.");
    }
    if (!body.expiration || !body.manufacturingDate) {
        throw new errors_1.ValidationError("Manufacturing and expiration dates are required.");
    }
    // Normalized to the nearest UTC day — one calendar date, one instant,
    // regardless of which client (web/mobile/desktop) sent it.
    const expiration = normalizeBatchDay(new Date(body.expiration));
    const manufacturingDate = normalizeBatchDay(new Date(body.manufacturingDate));
    if (!(expiration > manufacturingDate)) {
        throw new errors_1.ValidationError("Expiration must be after manufacturing date.");
    }
    const price = Math.max(0, Number((_a = body.price) !== null && _a !== void 0 ? _a : 0));
    // Storage access: restricted users may only add/restock in their storages.
    // Prefer the TOKEN's identity over the client-supplied userId — a wrong or
    // missing body.userId must never skip (or misdirect) the access check.
    {
        const accountId = (_b = req.user) === null || _b === void 0 ? void 0 : _b.id;
        const authAccount = accountId
            ? yield prisma_1.prisma.account.findUnique({
                where: { id: accountId },
                select: { User: { select: { id: true } } },
            })
            : null;
        const actorId = (_d = (_c = authAccount === null || authAccount === void 0 ? void 0 : authAccount.User) === null || _c === void 0 ? void 0 : _c.id) !== null && _d !== void 0 ? _d : body.userId;
        yield (0, storageAccessController_1.assertStorageAccess)(actorId, [body.storageId], "add or restock");
    }
    try {
        // ── Idempotency short-circuit ─────────────────────────────────────
        // Mobile retries can hit us multiple times with the same op (e.g.
        // network blip while waiting for the response). If we already have
        // a log row for this clientOpId we just hand back the cached result
        // — same stock id, no second write to MedicineStock.
        if (body.clientOpId) {
            const prior = yield prisma_1.prisma.mobileUploadLog.findUnique({
                where: { clientOpId: body.clientOpId },
                select: { resultId: true, message: true },
            });
            if (prior) {
                return res.code(200).send({
                    stockId: prior.resultId,
                    mode: "duplicate",
                    message: (_e = prior.message) !== null && _e !== void 0 ? _e : "Already processed",
                });
            }
        }
        const result = yield prisma_1.prisma.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            var _a, _b;
            const [medicine, storage] = yield Promise.all([
                tx.medicine.findUnique({ where: { id: body.medicineId } }),
                tx.medicineStorage.findUnique({ where: { id: body.storageId } }),
            ]);
            if (!medicine)
                throw new errors_1.NotFoundError("ITEM_NOT_FOUND");
            if (!storage)
                throw new errors_1.NotFoundError("STORAGE_NOT_FOUND");
            // Find EVERY batch row matching the identity — day-windowed, so
            // legacy rows saved with a different time-of-day for the same
            // calendar date still match. Extras get absorbed into the oldest.
            const matches = yield tx.medicineStock.findMany({
                where: {
                    medicineId: body.medicineId,
                    medicineStorageId: body.storageId,
                    expiration: batchDayWindow(expiration),
                    manufacturingDate: batchDayWindow(manufacturingDate),
                    quality: body.unitOfMeasure,
                    perQuantity: body.perUnit,
                },
                orderBy: { timestamp: "asc" },
            });
            const existing = (_a = matches[0]) !== null && _a !== void 0 ? _a : null;
            const absorbed = existing
                ? yield absorbDuplicateStocks(tx, existing.id, matches.slice(1))
                : { addQty: 0, addItems: 0 };
            const totalItems = body.perUnit * body.quantity;
            let stockId;
            let mode;
            if (existing) {
                mode = "restock";
                // Clear any active low-stock alert before bumping the count, so
                // a future dip will notify again. This runs even if the new total
                // ends up still below threshold (in which case the check below
                // will re-create the alert with the fresh count).
                yield (0, medicineAlerts_1.clearLowStockAlerts)(tx, existing.id);
                const updated = yield tx.medicineStock.update({
                    where: { id: existing.id },
                    data: Object.assign(Object.assign(Object.assign(Object.assign(Object.assign(Object.assign({ actualStock: existing.actualStock + absorbed.addItems + totalItems, quantity: existing.quantity + absorbed.addQty + body.quantity, 
                        // Optional: only overwrite threshold/address when caller sent a value.
                        threshold: body.thresHold !== undefined ? body.thresHold : existing.threshold }, (body.addressRoom ? { addressRoom: body.addressRoom } : {})), (body.addressCol ? { addressCol: body.addressCol } : {})), (body.addressRow ? { addressRow: body.addressRow } : {})), (body.addressSec ? { addressSec: body.addressSec } : {})), (body.container ? { container: body.container } : {})), { price: { create: { value: price } } }),
                });
                stockId = updated.id;
            }
            else {
                mode = "new";
                const created = yield tx.medicineStock.create({
                    data: {
                        quantity: body.quantity,
                        medicineId: medicine.id,
                        threshold: (_b = body.thresHold) !== null && _b !== void 0 ? _b : 0,
                        medicineStorageId: body.storageId,
                        actualStock: totalItems,
                        lineId: body.lineId,
                        quarter: (0, date_1.getQuarter)(),
                        quality: body.unitOfMeasure,
                        perQuantity: body.perUnit,
                        expiration,
                        manufacturingDate,
                        addressRoom: body.addressRoom || null,
                        addressCol: body.addressCol || null,
                        addressRow: body.addressRow || null,
                        addressSec: body.addressSec || null,
                        container: body.container || null,
                        price: { create: { value: price } },
                    },
                });
                stockId = created.id;
            }
            // Even after a restock the new total may still be below threshold —
            // re-check so the user gets a fresh alert at the current count.
            yield (0, medicineAlerts_1.checkAndNotifyLowStock)(tx, stockId);
            yield tx.medicineLogs.create({
                data: {
                    action: mode === "restock" ? 2 : 1,
                    message: `${mode === "restock" ? "Restocked" : "Added new batch:"} ${medicine.name} ` +
                        `(${medicine.serialNumber}) — qty ${body.quantity} × ${body.perUnit} ${body.unitOfMeasure} ` +
                        `(${totalItems} items) → storage ${storage.refNumber}`,
                    userId: body.userId,
                    lineId: body.lineId,
                },
            });
            return { mode, stockId };
        }));
        // Persist the idempotency log AFTER the transaction commits, keyed on
        // clientOpId. We deliberately don't wrap this in the transaction:
        // if the write fails the next replay will still get the dedup hit
        // from the previous attempt, OR — worst case — re-run the stock
        // write (rare). Better than aborting the legitimate stock update.
        if (body.clientOpId) {
            try {
                yield prisma_1.prisma.mobileUploadLog.create({
                    data: {
                        clientOpId: body.clientOpId,
                        kind: "medicine.addStock",
                        userId: body.userId,
                        lineId: body.lineId,
                        resultId: result.stockId,
                        message: result.mode === "restock" ? "Restocked" : "New batch",
                    },
                });
            }
            catch (e) {
                // Most likely cause: another concurrent replay just won the race.
                // Safe to ignore — the @unique on clientOpId means the second
                // insert can't slip past us anyway.
                console.warn("[addStorageMedInList] idempotency log write failed:", e);
            }
        }
        return res.code(200).send({
            message: "OK",
            mode: result.mode,
            stockId: result.stockId,
        });
    }
    catch (error) {
        if (error instanceof errors_1.NotFoundError)
            throw error;
        if (error instanceof errors_1.ValidationError)
            throw error;
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw new errors_1.AppError("DB_CONNECTION_ERROR", 500, "DB_FAILED");
        }
        throw error;
    }
});
exports.addStorageMedInList = addStorageMedInList;
const storageMedList = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const params = req.query;
    try {
        const cursor = params.lastCursor ? { id: params.lastCursor } : undefined;
        const limit = params.limit ? parseInt(params.limit) : 20;
        const filter = {};
        if (params.query) {
            filter.medicine = {
                name: {
                    contains: params.query,
                    mode: "insensitive",
                },
            };
        }
        if (params.lineId) {
            filter.lineId = params.lineId;
        }
        const response = yield prisma_1.prisma.medicine.findMany({
            where: Object.assign({ MedicineStock: {
                    some: {
                        lineId: params.lineId,
                    },
                } }, filter),
            skip: cursor ? 1 : 0,
            take: limit,
            orderBy: {
                name: "asc",
            },
            include: {
                MedicineStock: {
                    select: {
                        id: true,
                        actualStock: true,
                        MedicineStorage: {
                            select: {
                                name: true,
                                id: true,
                            },
                        },
                    },
                },
            },
        });
        const newLastCursorId = response.length > 0 ? response[response.length - 1].id : null;
        const hasMore = limit === response.length;
        return res
            .code(200)
            .send({ list: response, lastCursor: newLastCursorId, hasMore });
    }
    catch (error) {
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw new errors_1.AppError("DB_CONNECTION_ERROR", 500, "DB_FAILED");
        }
        throw error;
    }
});
exports.storageMedList = storageMedList;
/**
 * PATCH /medicine/low-stock-threshold — ONE threshold per MEDICINE.
 * The low-stock alert fires when the medicine's TOTAL stock (all batches,
 * all storages in the line) dips to or below this value. Re-evaluates
 * immediately so setting a threshold above the current total notifies
 * right away, and raising stock above it re-arms the alert.
 */
const setMedicineLowStockThreshold = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const body = req.body;
    const threshold = Math.floor(Number(body.threshold));
    if (!body.medicineId || !Number.isFinite(threshold) || threshold < 0) {
        throw new errors_1.ValidationError("A medicine id and a threshold of 0 or more are required.");
    }
    try {
        const medicine = yield prisma_1.prisma.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            var _a;
            const med = yield tx.medicine.update({
                where: { id: body.medicineId },
                data: { lowStockThreshold: threshold },
                select: {
                    id: true,
                    name: true,
                    serialNumber: true,
                    lowStockThreshold: true,
                },
            });
            // Re-evaluate against the current total right now.
            const anyStock = yield tx.medicineStock.findFirst({
                where: { medicineId: med.id },
                select: { id: true },
            });
            if (anyStock) {
                yield (0, medicineAlerts_1.clearLowStockAlerts)(tx, anyStock.id);
                yield (0, medicineAlerts_1.checkAndNotifyLowStock)(tx, anyStock.id);
            }
            if (body.userId) {
                yield tx.medicineLogs.create({
                    data: {
                        action: 2,
                        userId: body.userId,
                        lineId: (_a = body.lineId) !== null && _a !== void 0 ? _a : null,
                        message: `Set low-stock threshold of ${med.name} (${med.serialNumber}) ` +
                            `to ${threshold} (medicine-wide total)`,
                    },
                });
            }
            return med;
        }));
        return res.code(200).send({ message: "OK", medicine });
    }
    catch (error) {
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw (0, errors_1.dbError)(error);
        }
        throw error;
    }
});
exports.setMedicineLowStockThreshold = setMedicineLowStockThreshold;
const newPrescriptionCount = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const params = req.query;
    if (!params.id)
        throw new errors_1.ValidationError("BAD_REQUEST");
    try {
        const response = yield prisma_1.prisma.medicineNotification.count({
            where: {
                view: 0,
                lineId: params.id,
            },
        });
        return res.code(200).send({ message: "OK", count: response });
    }
    catch (error) {
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw new errors_1.AppError("DB_CONNECTION_ERROR", 500, "DB_FAILED");
        }
        throw error;
    }
});
exports.newPrescriptionCount = newPrescriptionCount;
const medicineNotification = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const params = req.query;
    if (!params.id)
        throw new errors_1.ValidationError("BAD_REQUEST");
    try {
        const cursor = params.lastCursor ? { id: params.lastCursor } : undefined;
        const limit = params.limit ? parseInt(params.limit) : 20;
        const response = yield prisma_1.prisma.medicineNotification.findMany({
            where: {
                lineId: params.id,
            },
            skip: cursor ? 1 : 0,
            take: limit,
            orderBy: {
                timestamp: "desc",
            },
            cursor,
        });
        const newLastCursorId = response.length > 0 ? response[response.length - 1].id : null;
        const hasMore = limit === response.length;
        return res
            .code(200)
            .send({ list: response, hasMore, lastCursor: newLastCursorId });
    }
    catch (error) {
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw new errors_1.AppError("DB_CONNECTION_ERROR", 500, "DB_FAILED");
        }
        throw error;
    }
});
exports.medicineNotification = medicineNotification;
const viewNotification = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const params = req.body;
    try {
        yield prisma_1.prisma.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            var _a;
            const notification = yield tx.medicineNotification.findUnique({
                where: { id: params.id },
            });
            if (!notification)
                throw new errors_1.NotFoundError("ITEM_NOT_FOUND");
            const prescriptionId = (_a = notification.path) === null || _a === void 0 ? void 0 : _a.split("/")[1];
            console.log(prescriptionId);
            yield tx.prescriptionProgress.create({
                data: {
                    step: 1,
                },
            });
            yield tx.medicineNotification.update({
                where: {
                    id: notification.id,
                },
                data: {
                    view: 1,
                },
            });
        }));
        return res.code(200).send({ message: "OK" });
    }
    catch (error) {
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw new errors_1.AppError("DB_CONNECTION_ERROR", 500, "DB_FAILED");
        }
        throw error;
    }
});
exports.viewNotification = viewNotification;
/**
 * Transfer N units of a specific stock batch to another storage.
 *
 * Inputs:
 *   - stockId:   the source MedicineStock row (a specific batch).
 *   - departId:  destination MedicineStorage id.
 *   - quantity:  how many *units of the batch's UoM* (e.g. boxes, bottles)
 *                to move. Items moved = quantity * source.perQuantity.
 *
 * Semantics:
 *   - Subtracts `quantity` (and `quantity * perQuantity` items) from the
 *     source row. The source row stays — it just shrinks, possibly to 0.
 *   - If the destination already has a batch matching on
 *       (medicine, expiration, manufacturingDate, UoM, perQuantity),
 *     we restock that row (preserves price history and shelf address).
 *   - Otherwise a new batch row is created in the destination with the
 *     same identity dimensions and a fresh quarter stamp.
 *   - Refreshes low-stock alerts on both source (may now be low) and
 *     destination (may have recovered).
 */
/**
 * Transfer a medicine batch (or part of it) from one storage to another.
 *
 * Anticipated failure modes, all handled:
 *   - identity is taken from the TOKEN, never a client-supplied userId;
 *   - the actor must hold Dispense & Stock Access on BOTH storages;
 *   - source ≠ destination; destination must exist, be active, and be in
 *     the SAME line (no cross-office transfer);
 *   - quantity must be a positive whole number ≤ units on hand, AND the
 *     batch must actually hold enough PIECES (a partially-dispensed batch
 *     can't move full units it no longer has) — no phantom stock;
 *   - the source decrement is an ATOMIC conditional update, so two
 *     simultaneous transfers can never over-draw the batch;
 *   - the destination match is day-windowed (times-of-day ignored) and
 *     folds any duplicate twins together, so a transfer never splits a
 *     batch; created rows store normalized dates;
 *   - clientOpId makes the whole thing idempotent for the offline desktop
 *     queue — a replay returns the prior result instead of moving twice;
 *   - low-stock alerts are re-evaluated on both sides;
 *   - real DB errors surface their cause instead of a masked 500.
 */
const transferMedicine = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c;
    const body = req.body;
    if (!body.stockId || !body.departId) {
        throw new errors_1.ValidationError("A batch and a destination storage are required.");
    }
    const transferQty = Math.trunc(Number(body.quantity));
    if (!Number.isFinite(transferQty) || transferQty <= 0) {
        throw new errors_1.ValidationError("Transfer quantity must be a positive whole number.");
    }
    if (body.stockId === body.departId) {
        throw new errors_1.ValidationError("Destination must be different from the source.");
    }
    // Identity from the TOKEN. Fall back to a client userId only if a token
    // user can't be resolved (keeps older callers working) — but never let a
    // client override a resolved token identity.
    const accountId = (_a = req.user) === null || _a === void 0 ? void 0 : _a.id;
    const dispenser = yield resolveDispenser(accountId);
    const actorId = (_c = (_b = dispenser.id) !== null && _b !== void 0 ? _b : body.userId) !== null && _c !== void 0 ? _c : null;
    if (!actorId) {
        throw new errors_1.ValidationError("Could not resolve your user account — sign in again.");
    }
    try {
        // Idempotent replay (offline desktop retry): if we already processed
        // this op, report success again without moving stock a second time.
        if (body.clientOpId) {
            const prior = yield prisma_1.prisma.mobileUploadLog.findUnique({
                where: { clientOpId: body.clientOpId },
                select: { resultId: true, message: true },
            });
            if (prior) {
                return res.code(200).send({
                    message: "OK (already applied)",
                    mode: "duplicate",
                    destStockId: prior.resultId,
                    duplicate: true,
                });
            }
        }
        const srcRow = yield prisma_1.prisma.medicineStock.findUnique({
            where: { id: body.stockId },
            select: { medicineStorageId: true },
        });
        if (!srcRow)
            throw new errors_1.NotFoundError("Source batch not found.");
        if (srcRow.medicineStorageId === body.departId) {
            throw new errors_1.ValidationError("Destination must be different from the source storage.");
        }
        // Restricted users need BOTH sides — out of the source, into the target.
        yield (0, storageAccessController_1.assertStorageAccess)(actorId, [srcRow.medicineStorageId, body.departId], "transfer stock");
        const result = yield prisma_1.prisma.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            var _a, _b, _c, _d;
            const source = yield tx.medicineStock.findUnique({
                where: { id: body.stockId },
                include: {
                    medicine: { select: { id: true, name: true, serialNumber: true } },
                    MedicineStorage: { select: { id: true, name: true, refNumber: true } },
                },
            });
            if (!source)
                throw new errors_1.NotFoundError("Source batch not found.");
            if (!source.medicineId)
                throw new errors_1.ValidationError("This batch has no medicine linked — it cannot be transferred.");
            if (!source.MedicineStorage)
                throw new errors_1.ValidationError("This batch has no source storage on record.");
            if (source.MedicineStorage.id === body.departId)
                throw new errors_1.ValidationError("Destination must be different from the source storage.");
            const destination = yield tx.medicineStorage.findUnique({
                where: { id: body.departId },
                select: { id: true, name: true, refNumber: true, lineId: true, status: true },
            });
            if (!destination)
                throw new errors_1.NotFoundError("Destination storage not found.");
            if (destination.status === 0)
                throw new errors_1.ValidationError("The destination storage is inactive.");
            if (destination.lineId !== source.lineId)
                throw new errors_1.ValidationError("Cannot transfer to a storage in a different office/line.");
            const perQuantity = source.perQuantity || 1;
            const itemsMoved = perQuantity * transferQty;
            if (source.quantity < transferQty)
                throw new errors_1.ValidationError(`Not enough on hand. Available: ${source.quantity} ${source.quality}.`);
            if (source.actualStock < itemsMoved)
                throw new errors_1.ValidationError(`This batch holds only ${source.actualStock} piece(s) — not enough to move ` +
                    `${transferQty} ${source.quality} (needs ${itemsMoved}). Some stock may ` +
                    `already have been dispensed; transfer fewer units.`);
            // ATOMIC, race-proof decrement: only succeeds if the batch STILL has
            // enough units and pieces. Two simultaneous transfers can't over-draw.
            const dec = yield tx.medicineStock.updateMany({
                where: {
                    id: source.id,
                    quantity: { gte: transferQty },
                    actualStock: { gte: itemsMoved },
                },
                data: {
                    quantity: { decrement: transferQty },
                    actualStock: { decrement: itemsMoved },
                },
            });
            if (dec.count === 0)
                throw new errors_1.ValidationError("This batch changed while you were transferring (another action ran). " +
                    "Refresh and try again — nothing was moved.");
            const exp = source.expiration;
            const mfg = source.manufacturingDate;
            // Destination match: same medicine/storage/unit/per-unit and the SAME
            // calendar day for expiry + manufacturing (times-of-day ignored).
            const matches = yield tx.medicineStock.findMany({
                where: {
                    medicineId: source.medicineId,
                    medicineStorageId: body.departId,
                    quality: source.quality,
                    perQuantity: source.perQuantity,
                    expiration: exp ? batchDayWindow(exp) : null,
                    manufacturingDate: mfg ? batchDayWindow(mfg) : null,
                },
                orderBy: { timestamp: "asc" },
            });
            let destStockId;
            let mode;
            if (matches.length > 0) {
                mode = "merge";
                const keep = matches[0];
                const absorbed = yield absorbDuplicateStocks(tx, keep.id, matches.slice(1));
                const updated = yield tx.medicineStock.update({
                    where: { id: keep.id },
                    data: Object.assign(Object.assign({ quantity: keep.quantity + absorbed.addQty + transferQty, actualStock: keep.actualStock + absorbed.addItems + itemsMoved }, (exp ? { expiration: normalizeBatchDay(exp) } : {})), (mfg ? { manufacturingDate: normalizeBatchDay(mfg) } : {})),
                });
                destStockId = updated.id;
            }
            else {
                mode = "new";
                const created = yield tx.medicineStock.create({
                    data: {
                        medicineId: source.medicineId,
                        medicineStorageId: body.departId,
                        lineId: destination.lineId,
                        quarter: (0, date_1.getQuarter)(),
                        quality: source.quality,
                        perQuantity: source.perQuantity,
                        quantity: transferQty,
                        actualStock: itemsMoved,
                        threshold: source.threshold,
                        expiration: exp ? normalizeBatchDay(exp) : null,
                        manufacturingDate: mfg ? normalizeBatchDay(mfg) : null,
                    },
                });
                destStockId = created.id;
            }
            yield tx.medicineLogs.create({
                data: {
                    action: 2,
                    userId: actorId,
                    lineId: source.lineId,
                    message: `Transferred ${(_b = (_a = source.medicine) === null || _a === void 0 ? void 0 : _a.name) !== null && _b !== void 0 ? _b : "?"} ` +
                        `(${(_d = (_c = source.medicine) === null || _c === void 0 ? void 0 : _c.serialNumber) !== null && _d !== void 0 ? _d : "?"}) — ` +
                        `${transferQty} ${source.quality} (${itemsMoved} items) ` +
                        `from ${source.MedicineStorage.refNumber} → ${destination.refNumber}` +
                        (mode === "merge" ? " (merged into existing batch)" : " (new batch)"),
                },
            });
            if (body.clientOpId) {
                yield tx.mobileUploadLog
                    .create({
                    data: {
                        clientOpId: body.clientOpId,
                        kind: "medicine.transfer",
                        userId: actorId,
                        lineId: source.lineId,
                        resultId: destStockId,
                        message: `Transferred ${transferQty} ${source.quality}`,
                    },
                })
                    .catch(() => undefined);
            }
            // Source may now be low; destination may have recovered.
            yield (0, medicineAlerts_1.checkAndNotifyLowStock)(tx, source.id);
            yield (0, medicineAlerts_1.clearLowStockAlerts)(tx, destStockId);
            yield (0, medicineAlerts_1.checkAndNotifyLowStock)(tx, destStockId);
            return {
                mode,
                sourceStockId: source.id,
                destStockId,
                transferredUnits: transferQty,
                itemsMoved,
                sourceRemainingUnits: source.quantity - transferQty,
            };
        }));
        return res.code(200).send(Object.assign({ message: "OK" }, result));
    }
    catch (error) {
        if (error instanceof errors_1.NotFoundError)
            throw error;
        if (error instanceof errors_1.ValidationError)
            throw error;
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError)
            throw (0, errors_1.dbError)(error);
        throw error;
    }
});
exports.transferMedicine = transferMedicine;
const updateStock = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const body = req.body;
    try {
    }
    catch (error) {
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw new errors_1.AppError("DB_CONNECTION_ERROR", 500, "DB_FAILED");
        }
        throw error;
    }
});
exports.updateStock = updateStock;
const removeStock = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const body = req.query;
    if (!body.id || !body.userId) {
        throw new errors_1.ValidationError("INVALID REQUIRED ID");
    }
    // Storage access: removing a batch counts as touching that storage's stock.
    const target = yield prisma_1.prisma.medicineStock.findUnique({
        where: { id: body.id },
        select: { medicineStorageId: true },
    });
    yield (0, storageAccessController_1.assertStorageAccess)(body.userId, [target === null || target === void 0 ? void 0 : target.medicineStorageId], "remove stock");
    try {
        const response = yield prisma_1.prisma.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            var _a, _b, _c, _d;
            const stock = yield tx.medicineStock.delete({
                where: {
                    id: body.id,
                },
                include: {
                    medicine: {
                        select: {
                            name: true,
                            serialNumber: true,
                        },
                    },
                    MedicineStorage: {
                        select: {
                            name: true,
                            refNumber: true,
                        },
                    },
                },
            });
            yield tx.medicineLogs.create({
                data: {
                    action: 0,
                    userId: body.userId,
                    message: `REMOVE: medicine - ${((_a = stock.medicine) === null || _a === void 0 ? void 0 : _a.name) || "Unknown Medicine"} (${((_b = stock.medicine) === null || _b === void 0 ? void 0 : _b.serialNumber) || "Unknown Serial Number"}) from storage - ${((_c = stock.MedicineStorage) === null || _c === void 0 ? void 0 : _c.name) || "Unknown Storage"} (${((_d = stock.MedicineStorage) === null || _d === void 0 ? void 0 : _d.refNumber) || "Unknown Reference Number"})`,
                },
            });
            return "OK";
        }));
        if (!response)
            throw new errors_1.ValidationError("TRANSACTION FAILED");
        return res.code(200).send({ message: "OK" });
    }
    catch (error) {
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw (0, errors_1.dbError)(error);
        }
        throw error;
    }
});
exports.removeStock = removeStock;
const updateMedicineStock = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const params = req.body;
    if (!params.id) {
        throw new errors_1.ValidationError("INVALID REQUIRED ID");
    }
    try {
        const response = yield prisma_1.prisma.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            var _a;
            const quantity = params.quantity;
            const stock = yield tx.medicineStock.update({
                where: {
                    id: params.id,
                },
                data: {},
                select: {
                    medicine: {
                        select: {
                            name: true,
                        },
                    },
                    id: true,
                },
            });
            yield tx.medicineLogs.create({
                data: {
                    userId: params.userId,
                    message: `UPDAED: Added stock to medicine: ${(_a = stock.medicine) === null || _a === void 0 ? void 0 : _a.name} | Quantity: ${quantity}`,
                    action: 3,
                },
            });
            return "OK";
        }));
        if (!response) {
            throw new errors_1.ValidationError("TRANSACTION FAILED");
        }
        return res.code(200).send({ message: "OK" });
    }
    catch (error) {
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw (0, errors_1.dbError)(error);
        }
        throw error;
    }
});
exports.updateMedicineStock = updateMedicineStock;
const medicineTransactions = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const params = req.query;
    if (!params.id)
        throw new errors_1.ValidationError("INVALID REQUIRED ID");
    try {
        const cursor = params.lastCursor ? { id: params.lastCursor } : undefined;
        const limit = params.limit ? parseInt(params.limit, 10) : 20;
        const filter = { lineId: params.id };
        if (params.query) {
            const term = params.query.trim();
            filter.OR = [
                { prescription: { refNumber: { contains: term, mode: "insensitive" } } },
                { prescription: { firstname: { contains: term, mode: "insensitive" } } },
                { prescription: { lastname: { contains: term, mode: "insensitive" } } },
            ];
        }
        const response = yield prisma_1.prisma.medicineTransaction.findMany({
            where: filter,
            include: {
                user: {
                    select: {
                        username: true,
                        id: true,
                        firstName: true,
                        lastName: true,
                    },
                },
                storage: {
                    select: {
                        name: true,
                        id: true,
                    },
                },
                prescription: {
                    select: {
                        id: true,
                        refNumber: true,
                        firstname: true,
                        lastname: true,
                    },
                },
            },
            take: limit,
            skip: cursor ? 1 : 0,
            orderBy: {
                timestamp: "desc",
            },
            cursor,
        });
        const newLastCursorId = response.length > 0 ? response[response.length - 1].id : null;
        const hasMore = response.length === limit;
        return res
            .code(200)
            .send({ list: response, lastCursor: newLastCursorId, hasMore });
    }
    catch (error) {
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw (0, errors_1.dbError)(error);
        }
        throw error;
    }
});
exports.medicineTransactions = medicineTransactions;
/**
 * Soft-delete a medicine catalog entry.
 *
 * Sets `phase: 0` so the row stays for historical references (transactions,
 * prescriptions, logs) but disappears from the catalog list. Refuses to
 * remove a medicine that still has on-hand stock — the user must zero
 * the stocks out or transfer them first.
 */
const removeMedicine = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const params = req.query;
    if (!params.id || !params.userId) {
        throw new errors_1.ValidationError("INVALID REQUIRED ID");
    }
    try {
        const response = yield prisma_1.prisma.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            var _a, _b;
            const medicine = yield tx.medicine.findUnique({
                where: { id: params.id },
            });
            if (!medicine)
                throw new errors_1.NotFoundError("Medicine not found");
            if (medicine.phase === -1)
                throw new errors_1.ValidationError("Medicine already removed.");
            const onHand = yield tx.medicineStock.aggregate({
                where: { medicineId: params.id },
                _sum: { actualStock: true },
            });
            if (((_a = onHand._sum.actualStock) !== null && _a !== void 0 ? _a : 0) > 0) {
                throw new errors_1.ValidationError("This medicine still has stock on hand. Zero out or transfer the stock before removing.");
            }
            const updated = yield tx.medicine.update({
                where: { id: params.id },
                data: { phase: -1 },
            });
            yield tx.medicineLogs.create({
                data: {
                    action: 0,
                    userId: params.userId,
                    lineId: (_b = params.lineId) !== null && _b !== void 0 ? _b : medicine.lineId,
                    message: `Removed medicine — ${updated.name} (${updated.serialNumber})`,
                },
            });
            return { message: "OK", id: updated.id };
        }));
        return res.code(200).send(response);
    }
    catch (error) {
        if (error instanceof errors_1.NotFoundError)
            throw error;
        if (error instanceof errors_1.ValidationError)
            throw error;
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw (0, errors_1.dbError)(error);
        }
        throw error;
    }
});
exports.removeMedicine = removeMedicine;
const medicineOverview = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    const params = req.query;
    if (!params.lineId)
        throw new errors_1.ValidationError("INVALID REQUIRED ID");
    try {
        const now = new Date();
        const sixMonthsFromNow = new Date(now);
        sixMonthsFromNow.setMonth(sixMonthsFromNow.getMonth() + 6);
        const nearWhere = {
            lineId: params.lineId,
            actualStock: { gt: 0 },
            expiration: { not: null, gt: now, lte: sixMonthsFromNow },
        };
        const expiredWhere = {
            lineId: params.lineId,
            actualStock: { gt: 0 },
            expiration: { not: null, lte: now },
        };
        const [storage, totalBatches, lowStock, nearExpiration, expired, nearAgg, expiredAgg, nearByQty, expiredByQty,] = yield Promise.all([
            prisma_1.prisma.medicineStorage.count({
                where: { lineId: params.lineId, status: { not: 0 } },
            }),
            prisma_1.prisma.medicineStock.count({ where: { lineId: params.lineId } }),
            prisma_1.prisma.medicineStock.count({
                where: {
                    lineId: params.lineId,
                    threshold: { gt: 0 },
                    actualStock: { lte: prisma_1.prisma.medicineStock.fields.threshold },
                },
            }),
            prisma_1.prisma.medicineStock.count({ where: nearWhere }),
            prisma_1.prisma.medicineStock.count({ where: expiredWhere }),
            prisma_1.prisma.medicineStock.aggregate({
                where: nearWhere,
                _sum: { actualStock: true },
            }),
            prisma_1.prisma.medicineStock.aggregate({
                where: expiredWhere,
                _sum: { actualStock: true },
            }),
            // Per-quality breakdown so the dashboard can show "120 box, 30 bottle".
            prisma_1.prisma.medicineStock.groupBy({
                by: ["quality"],
                where: nearWhere,
                _sum: { actualStock: true },
            }),
            prisma_1.prisma.medicineStock.groupBy({
                by: ["quality"],
                where: expiredWhere,
                _sum: { actualStock: true },
            }),
        ]);
        const byQty = (rows) => rows
            .filter((r) => { var _a; return ((_a = r._sum.actualStock) !== null && _a !== void 0 ? _a : 0) > 0; })
            .map((r) => {
            var _a;
            return ({
                quality: r.quality,
                units: (_a = r._sum.actualStock) !== null && _a !== void 0 ? _a : 0,
            });
        })
            .sort((a, b) => b.units - a.units);
        return res.send({
            medicines: { total: totalBatches, lowStock },
            storage,
            nearExpiration,
            expired,
            nearExpirationUnits: (_a = nearAgg._sum.actualStock) !== null && _a !== void 0 ? _a : 0,
            expiredUnits: (_b = expiredAgg._sum.actualStock) !== null && _b !== void 0 ? _b : 0,
            nearExpirationByQuality: byQty(nearByQty),
            expiredByQuality: byQty(expiredByQty),
        });
    }
    catch (error) {
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw (0, errors_1.dbError)(error);
        }
        throw error;
    }
});
exports.medicineOverview = medicineOverview;
const expirationWhere = (lineId, mode, query) => {
    const now = new Date();
    const sixMonthsFromNow = new Date(now);
    sixMonthsFromNow.setMonth(sixMonthsFromNow.getMonth() + 6);
    const where = {
        lineId,
        actualStock: { gt: 0 },
        expiration: { not: null },
    };
    if (mode === "soon") {
        where.expiration = { not: null, gt: now, lte: sixMonthsFromNow };
    }
    else {
        where.expiration = { not: null, lte: now };
    }
    if (query && query.trim()) {
        const q = query.trim();
        where.medicine = {
            OR: [
                { name: { contains: q, mode: "insensitive" } },
                { serialNumber: { contains: q, mode: "insensitive" } },
            ],
        };
    }
    return where;
};
/**
 * The expiry report answers ONE question: what expires when, and how
 * much. So it shows ONE line per (medicine, storage, unit of measure,
 * expiration day, manufacturing day) with the units SUMMED — internal
 * batch rows that differ only in per-unit packing are a stockroom
 * detail, not a reason for a second line on this screen. When the
 * packing is uniform the line shows it (× N); when mixed it shows —.
 */
const groupExpirationRows = (rows) => {
    var _a, _b;
    const bucket = (d) => d ? Math.round(d.getTime() / 86400000) : -1;
    const addrOf = (x) => [x.addressRoom, x.addressSec, x.addressRow, x.addressCol, x.container].join("|");
    const groups = new Map();
    for (const r of rows) {
        const k = [
            (_a = r.medicineId) !== null && _a !== void 0 ? _a : "-",
            (_b = r.medicineStorageId) !== null && _b !== void 0 ? _b : "-",
            r.quality,
            bucket(r.expiration),
            bucket(r.manufacturingDate),
        ].join("|");
        const g = groups.get(k);
        if (!g) {
            groups.set(k, {
                first: r,
                units: r.actualStock,
                qty: r.quantity,
                batchCount: 1,
                addrAgree: true,
                perAgree: true,
            });
        }
        else {
            g.units += r.actualStock;
            g.qty += r.quantity;
            g.batchCount += 1;
            if (addrOf(r) !== addrOf(g.first))
                g.addrAgree = false;
            if (r.perQuantity !== g.first.perQuantity)
                g.perAgree = false;
        }
    }
    return [...groups.values()];
};
/**
 * Paginated list of stock batches that are either expiring within 6
 * months ("soon") or already expired ("expired"), ordered by closest
 * expiration first. Lines are GROUPED per (medicine, storage, unit,
 * expiry day) — see groupExpirationRows.
 */
const expirationList = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    const params = req.query;
    if (!params.lineId)
        throw new errors_1.ValidationError("INVALID REQUIRED ID");
    const mode = params.mode === "expired" ? "expired" : "soon";
    const limit = params.limit ? parseInt(params.limit, 10) : 20;
    try {
        const where = expirationWhere(params.lineId, mode, params.query);
        // Pull the full (bounded) window and group — pagination and the header
        // totals both describe the GROUPED lines, not internal batch rows.
        const rows = yield prisma_1.prisma.medicineStock.findMany({
            where,
            take: 1000,
            orderBy: { expiration: mode === "soon" ? "asc" : "desc" },
            include: {
                medicine: { select: { id: true, name: true, serialNumber: true } },
                MedicineStorage: {
                    select: { id: true, name: true, refNumber: true },
                },
            },
        });
        const now = new Date();
        const grouped = groupExpirationRows(rows).map((g) => {
            const exp = g.first.expiration ? new Date(g.first.expiration) : null;
            const daysToExpire = exp
                ? Math.ceil((exp.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
                : null;
            return Object.assign(Object.assign({}, g.first), { actualStock: g.units, quantity: g.qty, batchCount: g.batchCount, 
                // Uniform packing → show it; mixed packing → null (renders "—").
                perQuantity: g.perAgree ? g.first.perQuantity : null, daysToExpire });
        });
        const byQuality = new Map();
        for (const g of grouped) {
            const q = (_a = byQuality.get(g.quality)) !== null && _a !== void 0 ? _a : { batches: 0, units: 0 };
            q.batches += 1;
            q.units += g.actualStock;
            byQuality.set(g.quality, q);
        }
        const summary = {
            totalBatches: grouped.length,
            totalUnits: grouped.reduce((s, g) => s + g.actualStock, 0),
            byQuality: [...byQuality.entries()]
                .filter(([, v]) => v.units > 0)
                .map(([quality, v]) => ({
                quality,
                batches: v.batches,
                units: v.units,
            }))
                .sort((a, b) => b.units - a.units),
        };
        const start = params.lastCursor
            ? grouped.findIndex((g) => g.id === params.lastCursor) + 1
            : 0;
        const page = grouped.slice(start, start + limit);
        const lastCursor = page.length > 0 ? page[page.length - 1].id : null;
        const hasMore = start + page.length < grouped.length;
        return res
            .code(200)
            .send({ list: page, lastCursor, hasMore, mode, summary });
    }
    catch (error) {
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw (0, errors_1.dbError)(error);
        }
        throw error;
    }
});
exports.expirationList = expirationList;
/**
 * Excel export of the expiration list (whole result set, no pagination).
 */
const exportExpirationList = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c;
    const params = req.query;
    if (!params.lineId)
        throw new errors_1.ValidationError("INVALID REQUIRED ID");
    const mode = params.mode === "expired" ? "expired" : "soon";
    try {
        const rows = yield prisma_1.prisma.medicineStock.findMany({
            where: expirationWhere(params.lineId, mode, params.query),
            orderBy: { expiration: mode === "soon" ? "asc" : "desc" },
            include: {
                medicine: { select: { name: true, serialNumber: true } },
                MedicineStorage: { select: { name: true, refNumber: true } },
            },
        });
        const now = new Date();
        const wb = new exceljs_1.default.Workbook();
        wb.creator = "GMITP";
        wb.created = new Date();
        const sheetTitle = mode === "soon" ? "Expiring Soon" : "Expired Medicines";
        const ws = wb.addWorksheet(sheetTitle, {
            views: [{ state: "frozen", ySplit: 5 }],
        });
        ws.columns = [
            { width: 6 }, // A No.
            { width: 16 }, // B Serial
            { width: 32 }, // C Medicine
            { width: 22 }, // D Storage
            { width: 8 }, // E Unit
            { width: 10 }, // F On-hand
            { width: 12 }, // G Manufactured
            { width: 12 }, // H Expires
            { width: 12 }, // I Days to Expire
            { width: 16 }, // J Shelf Address
        ];
        // Letterhead
        const header = [
            { row: 1, text: "Republic of the Philippines", bold: false, size: 11 },
            { row: 2, text: "Province of Marinduque", bold: false, size: 11 },
            { row: 3, text: "MUNICIPALITY OF GASAN", bold: true, size: 11 },
            {
                row: 4,
                text: mode === "soon"
                    ? "MEDICINES EXPIRING WITHIN 6 MONTHS"
                    : "EXPIRED MEDICINES — REQUIRES DISPOSAL",
                bold: true,
                size: 13,
            },
        ];
        header.forEach(({ row, text, bold, size }) => {
            const r = ws.getRow(row);
            r.getCell(1).value = text;
            ws.mergeCells(row, 1, row, 10);
            r.alignment = { horizontal: "center", vertical: "middle" };
            r.font = { name: "Arial", bold, size };
        });
        ws.getRow(5).values = [
            "No.",
            "Serial #",
            "Medicine",
            "Storage",
            "Unit",
            "On-hand",
            "Manufactured",
            "Expires",
            "Days to Expire",
            "Shelf Address",
        ];
        ws.getRow(5).font = { name: "Arial", bold: true, size: 10 };
        ws.getRow(5).alignment = { horizontal: "center", vertical: "middle" };
        ws.getRow(5).eachCell((c) => {
            c.fill = {
                type: "pattern",
                pattern: "solid",
                fgColor: { argb: "FFE5E7EB" },
            };
            c.border = {
                top: { style: "thin" },
                left: { style: "thin" },
                right: { style: "thin" },
                bottom: { style: "thin" },
            };
        });
        const fmtDate = (d) => d ? d.toISOString().slice(0, 10) : "—";
        // Same grouping as the on-screen list: one line per
        // (medicine, storage, unit, expiry day), units summed.
        groupExpirationRows(rows).forEach((g, i) => {
            var _a, _b, _c, _d, _e, _f, _g, _h;
            const s = g.first;
            const exp = s.expiration ? new Date(s.expiration) : null;
            const days = exp
                ? Math.ceil((exp.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
                : null;
            const address = [s.addressRoom, s.addressSec, s.addressRow, s.addressCol]
                .filter(Boolean)
                .join(" / ");
            const row = ws.addRow([
                i + 1,
                (_b = (_a = s.medicine) === null || _a === void 0 ? void 0 : _a.serialNumber) !== null && _b !== void 0 ? _b : "—",
                (_d = (_c = s.medicine) === null || _c === void 0 ? void 0 : _c.name) !== null && _d !== void 0 ? _d : "—",
                (_f = (_e = s.MedicineStorage) === null || _e === void 0 ? void 0 : _e.name) !== null && _f !== void 0 ? _f : "—",
                (_g = s.quality) !== null && _g !== void 0 ? _g : "—",
                g.units,
                fmtDate(s.manufacturingDate ? new Date(s.manufacturingDate) : null),
                fmtDate(exp),
                days !== null && days !== void 0 ? days : "—",
                g.addrAgree ? address || ((_h = s.container) !== null && _h !== void 0 ? _h : "—") : "— (mixed)",
            ]);
            row.font = { name: "Arial", size: 10 };
            row.alignment = { vertical: "middle" };
            row.eachCell((c) => {
                c.border = {
                    top: { style: "hair" },
                    left: { style: "hair" },
                    right: { style: "hair" },
                    bottom: { style: "hair" },
                };
            });
            // Highlight already-expired rows in red.
            if (mode === "expired" || (days !== null && days <= 0)) {
                row.getCell(9).font = {
                    name: "Arial",
                    size: 10,
                    bold: true,
                    color: { argb: "FFC2410C" },
                };
            }
        });
        if (rows.length === 0) {
            const r = ws.addRow(["No records found"]);
            ws.mergeCells(r.number, 1, r.number, 10);
            r.alignment = { horizontal: "center" };
            r.font = { name: "Arial", italic: true, color: { argb: "FF9CA3AF" } };
        }
        else {
            // ── Summary footer: total units + per-quality breakdown ──────────
            ws.addRow([]);
            const totalUnits = rows.reduce((s, r) => { var _a; return s + ((_a = r.actualStock) !== null && _a !== void 0 ? _a : 0); }, 0);
            const byQuality = new Map();
            for (const r of rows) {
                const key = (_a = r.quality) !== null && _a !== void 0 ? _a : "—";
                const cur = (_b = byQuality.get(key)) !== null && _b !== void 0 ? _b : { units: 0, batches: 0 };
                cur.units += (_c = r.actualStock) !== null && _c !== void 0 ? _c : 0;
                cur.batches += 1;
                byQuality.set(key, cur);
            }
            const totalRow = ws.addRow([
                "",
                "",
                "TOTAL",
                `${rows.length} batches`,
                "",
                totalUnits,
                "",
                "",
                "",
                "",
            ]);
            totalRow.font = { name: "Arial", bold: true, size: 10 };
            totalRow.getCell(3).alignment = { horizontal: "right" };
            totalRow.getCell(6).alignment = { horizontal: "center" };
            totalRow.eachCell((c) => {
                c.border = { top: { style: "thin" }, bottom: { style: "thin" } };
            });
            // Per-quality rows
            [...byQuality.entries()]
                .sort((a, b) => b[1].units - a[1].units)
                .forEach(([q, v]) => {
                const r = ws.addRow([
                    "",
                    "",
                    `By unit: ${q}`,
                    `${v.batches} batch${v.batches === 1 ? "" : "es"}`,
                    "",
                    v.units,
                    "",
                    "",
                    "",
                    "",
                ]);
                r.font = { name: "Arial", size: 10 };
                r.getCell(3).alignment = { horizontal: "right" };
                r.getCell(3).font = {
                    name: "Arial",
                    italic: true,
                    size: 10,
                    color: { argb: "FF6B7280" },
                };
                r.getCell(6).alignment = { horizontal: "center" };
            });
        }
        const buffer = yield wb.xlsx.writeBuffer();
        const filename = `medicines_${mode === "soon" ? "expiring_soon" : "expired"}_${now
            .toISOString()
            .slice(0, 10)}.xlsx`;
        res.header("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
        res.header("Content-Disposition", `attachment; filename="${filename}"`);
        return res.code(200).send(Buffer.from(buffer));
    }
    catch (error) {
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw (0, errors_1.dbError)(error);
        }
        throw error;
    }
});
exports.exportExpirationList = exportExpirationList;
/**
 * Storage detail view.
 *
 * Returns the storage location with its unit/department + line, plus a
 * lightweight stats block (medicineCount, totalStockUnits, lowStockCount,
 * expiringSoonCount, accessCount) so the Information tab can render without
 * extra round-trips. Stock-level counts are computed server-side from the
 * MedicineStock rows scoped to this storage.
 */
const storageData = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    const params = req.query;
    if (!params.id)
        throw new errors_1.ValidationError("INVALID REQUIRED ID");
    try {
        const storage = yield prisma_1.prisma.medicineStorage.findUnique({
            where: { id: params.id },
            include: {
                unit: { select: { id: true, name: true } },
                line: { select: { id: true, name: true } },
                _count: { select: { MedicineStorageAccess: true } },
            },
        });
        if (!storage)
            throw new errors_1.NotFoundError("STORAGE NOT FOUND!");
        const sixMonths = new Date();
        sixMonths.setMonth(sixMonths.getMonth() + 6);
        // Pull the stock rows once and aggregate in memory — keeps the response
        // shape simple and avoids three separate aggregate queries.
        const stocks = yield prisma_1.prisma.medicineStock.findMany({
            where: { medicineStorageId: params.id },
            select: {
                medicineId: true,
                actualStock: true,
                threshold: true,
                expiration: true,
            },
        });
        const totalStockUnits = stocks.reduce((sum, s) => { var _a; return sum + ((_a = s.actualStock) !== null && _a !== void 0 ? _a : 0); }, 0);
        const lowStockCount = stocks.filter((s) => { var _a, _b; return ((_a = s.actualStock) !== null && _a !== void 0 ? _a : 0) <= ((_b = s.threshold) !== null && _b !== void 0 ? _b : 0); }).length;
        const expiringSoonCount = stocks.filter((s) => s.expiration && new Date(s.expiration) <= sixMonths).length;
        const medicineCount = new Set(stocks.map((s) => s.medicineId).filter(Boolean)).size;
        return res.code(200).send(Object.assign(Object.assign({}, storage), { stats: {
                medicineCount,
                totalStockUnits,
                lowStockCount,
                expiringSoonCount,
                accessCount: (_b = (_a = storage._count) === null || _a === void 0 ? void 0 : _a.MedicineStorageAccess) !== null && _b !== void 0 ? _b : 0,
            } }));
    }
    catch (error) {
        if (error instanceof errors_1.NotFoundError)
            throw error;
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw (0, errors_1.dbError)(error);
        }
        throw error;
    }
});
exports.storageData = storageData;
/**
 * Soft-delete a storage location.
 *
 * Sets `status: 0` instead of hard-deleting so the audit trail and any
 * historical transactions / stock rows remain intact. Refuses to remove a
 * storage that still has on-hand stock — the user must transfer or zero
 * out stock first.
 */
const removeStorage = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c;
    const params = req.query;
    if (!params.id)
        throw new errors_1.ValidationError("INVALID REQUIRED ID");
    // Identity from the TOKEN — removing a storage is a write to it, so only the
    // creator or a Dispense & Stock Access holder may do it (never trust the
    // client-supplied userId for the access decision).
    const accountId = (_a = req.user) === null || _a === void 0 ? void 0 : _a.id;
    const authAccount = accountId
        ? yield prisma_1.prisma.account.findUnique({
            where: { id: accountId },
            select: { User: { select: { id: true } } },
        })
        : null;
    const actorId = (_c = (_b = authAccount === null || authAccount === void 0 ? void 0 : authAccount.User) === null || _b === void 0 ? void 0 : _b.id) !== null && _c !== void 0 ? _c : null;
    yield (0, storageAccessController_1.assertStorageAccess)(actorId, [params.id], "remove");
    try {
        const response = yield prisma_1.prisma.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            var _a;
            const storage = yield tx.medicineStorage.findUnique({
                where: { id: params.id },
            });
            if (!storage)
                throw new errors_1.NotFoundError("STORAGE NOT FOUND");
            // Block removal while there is on-hand stock to avoid orphaning units.
            const onHand = yield tx.medicineStock.aggregate({
                where: { medicineStorageId: params.id },
                _sum: { actualStock: true },
            });
            if (((_a = onHand._sum.actualStock) !== null && _a !== void 0 ? _a : 0) > 0) {
                throw new errors_1.ValidationError("Storage still has on-hand stock. Transfer or zero out the stock before removing.");
            }
            const updated = yield tx.medicineStorage.update({
                where: { id: params.id },
                data: { status: 0 },
            });
            yield tx.activityLogs.create({
                data: {
                    action: 1,
                    desc: `REMOVE MEDICINE STORAGE: ${updated.name}`,
                    userId: params.userId,
                    lineId: params.lineId,
                },
            });
            yield tx.medicineLogs.create({
                data: {
                    action: 0,
                    lineId: params.lineId,
                    message: `STORAGE: ${updated.name}-${updated.refNumber}, has been removed`,
                    userId: params.userId,
                },
            });
            return { message: "OK", id: updated.id };
        }));
        return res.code(200).send(response);
    }
    catch (error) {
        if (error instanceof errors_1.NotFoundError)
            throw error;
        if (error instanceof errors_1.ValidationError)
            throw error;
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw (0, errors_1.dbError)(error);
        }
        throw error;
    }
});
exports.removeStorage = removeStorage;
/**
 * Manual rescan: walks every stock row in the line and emits low-stock
 * notifications for ones below threshold that aren't already alerted.
 *
 * Useful for the first run after enabling alerts (no historical events
 * would have fired the inline triggers) and as a "are we current?" check
 * the UI can call periodically.
 */
const scanLowStock = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const params = req.query;
    if (!params.lineId)
        throw new errors_1.ValidationError("INVALID REQUIRED ID");
    try {
        const candidates = yield prisma_1.prisma.medicineStock.findMany({
            where: {
                lineId: params.lineId,
                threshold: { gt: 0 },
            },
            select: { id: true, actualStock: true, threshold: true },
        });
        const below = candidates.filter((s) => s.actualStock <= s.threshold);
        let notified = 0;
        let scanned = 0;
        // Run each check inside its own short transaction so one failure
        // doesn't poison the whole sweep.
        for (const s of below) {
            scanned += 1;
            try {
                const r = yield prisma_1.prisma.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
                    return (0, medicineAlerts_1.checkAndNotifyLowStock)(tx, s.id);
                }));
                if (r === null || r === void 0 ? void 0 : r.notified)
                    notified += r.notified;
            }
            catch (e) {
                console.warn("[scanLowStock] failed for", s.id, e);
            }
        }
        return res.code(200).send({
            message: "OK",
            totalStocks: candidates.length,
            belowThreshold: below.length,
            scanned,
            notified,
        });
    }
    catch (error) {
        if (error instanceof errors_1.ValidationError)
            throw error;
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw (0, errors_1.dbError)(error);
        }
        throw error;
    }
});
exports.scanLowStock = scanLowStock;
/**
 * Mobile offline-scan upload.
 *
 * The mobile app captures (barcode, name) pairs offline and flushes the
 * queue here. We treat (serialNumber = barcode, lineId) as the natural
 * key: if a Medicine row already exists we update its name + desc,
 * otherwise we create a new draft (phase = 0). The caller persists the
 * returned `id` locally so subsequent re-syncs of the same row are
 * idempotent rather than creating duplicates.
 */
const recordMedicineScan = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    const body = req.body;
    if (!(body === null || body === void 0 ? void 0 : body.barcode) || !(body === null || body === void 0 ? void 0 : body.name)) {
        throw new errors_1.ValidationError("BAD_REQUEST: barcode and name are required");
    }
    if (!body.lineId) {
        throw new errors_1.ValidationError("BAD_REQUEST: lineId is required");
    }
    try {
        // Same canonical reading as attach-barcode — a QR scanned here and a
        // barcode scanned there must land on ONE medicine.
        const scanned = (0, scanCode_1.readScannedCode)(body.barcode);
        if (scanned.rejected)
            throw new errors_1.ValidationError(scanned.rejected);
        const barcode = scanned.code;
        const name = body.name.trim();
        const desc = ((_a = body.notes) === null || _a === void 0 ? void 0 : _a.trim()) || undefined;
        // Match on barcode first (the natural scanner key), then fall back to
        // a legacy match on serialNumber so older "barcode = serial" rows are
        // still picked up instead of duplicated.
        const candidates = (0, scanCode_1.barcodeLookupCandidates)(body.barcode);
        const existing = yield prisma_1.prisma.medicine.findFirst({
            where: {
                lineId: body.lineId,
                OR: [
                    { barcode: { in: candidates } },
                    { serialNumber: { in: candidates } },
                ],
            },
            select: { id: true, barcode: true },
        });
        let saved;
        if (existing) {
            saved = yield prisma_1.prisma.medicine.update({
                where: { id: existing.id },
                data: Object.assign(Object.assign({ name }, (desc ? { desc } : {})), (existing.barcode ? {} : { barcode })),
                select: { id: true, serialNumber: true, barcode: true, name: true },
            });
        }
        else {
            const serialNumber = yield (0, handler_1.generateMedRef)();
            saved = yield prisma_1.prisma.medicine.create({
                data: Object.assign(Object.assign({}, (body.id ? { id: body.id } : {})), { serialNumber,
                    barcode,
                    name, desc: desc !== null && desc !== void 0 ? desc : "None", lineId: body.lineId }),
                select: { id: true, serialNumber: true, barcode: true, name: true },
            });
            // Same audit entry the web's Add Medicine writes.
            if (body.scannedByUserId) {
                try {
                    yield prisma_1.prisma.medicineLogs.create({
                        data: {
                            action: 1,
                            userId: body.scannedByUserId,
                            lineId: body.lineId,
                            message: `Added new medicine in the list; Med. Serial Ref.: ${saved.serialNumber} - Label: ${saved.name}`,
                        },
                    });
                }
                catch (_b) {
                    /* audit is best-effort */
                }
            }
        }
        return res.code(200).send({
            id: saved.id,
            serialNumber: saved.serialNumber,
            barcode: saved.barcode,
            name: saved.name,
            mode: existing ? "updated" : "created",
        });
    }
    catch (error) {
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            // Surface the REAL cause (e.g. "That barcode already exists") — the
            // old blanket DB_CONNECTION_FAILED masked every constraint error as
            // a 500 and left the mobile queue undebuggable.
            throw (0, errors_1.dbError)(error);
        }
        throw error;
    }
});
exports.recordMedicineScan = recordMedicineScan;
/**
 * Bulk pull for the mobile "morning check for updates" flow.
 *
 * Returns every Medicine in the user's line along with its MedicineStock
 * rows. Mobile mirrors these into local SQLite so the scanner and stock
 * screens work offline until the next sync. The caller passes `since`
 * (Unix ms) to get an incremental pull; omit it to download everything.
 *
 *   GET /medicine/sync?lineId=<id>&since=<unix-ms>
 *
 * Response shape:
 *   {
 *     fetchedAt: <unix-ms>,
 *     medicines: Medicine[],          // with `stocks: MedicineStock[]`
 *   }
 */
const medicineSync = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const params = req.query;
    if (!params.lineId)
        throw new errors_1.ValidationError("BAD_REQUEST: lineId required");
    const sinceMs = params.since ? parseInt(params.since, 10) : 0;
    const sinceDate = sinceMs > 0 ? new Date(sinceMs) : undefined;
    try {
        const medicines = yield prisma_1.prisma.medicine.findMany({
            where: Object.assign({ lineId: params.lineId }, (sinceDate ? { timestamp: { gt: sinceDate } } : {})),
            orderBy: { timestamp: "desc" },
            select: {
                id: true,
                serialNumber: true,
                barcode: true,
                name: true,
                desc: true,
                phase: true,
                timestamp: true,
                lineId: true,
                MedicineStock: {
                    select: {
                        id: true,
                        medicineId: true,
                        medicineStorageId: true,
                        quantity: true,
                        perQuantity: true,
                        quality: true,
                        actualStock: true,
                        threshold: true,
                        quarter: true,
                        timestamp: true,
                        expiration: true,
                        manufacturingDate: true,
                        addressRoom: true,
                        addressCol: true,
                        addressRow: true,
                        addressSec: true,
                        container: true,
                        remainingOpenedBox: true,
                        remainingPieces: true,
                    },
                },
            },
        });
        return res.code(200).send({
            fetchedAt: Date.now(),
            medicines: medicines.map((m) => ({
                id: m.id,
                serialNumber: m.serialNumber,
                barcode: m.barcode,
                name: m.name,
                desc: m.desc,
                phase: m.phase,
                timestamp: m.timestamp,
                lineId: m.lineId,
                stocks: m.MedicineStock,
            })),
        });
    }
    catch (error) {
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw (0, errors_1.dbError)(error);
        }
        throw error;
    }
});
exports.medicineSync = medicineSync;
/**
 * Mobile bulk-upload endpoint. Accepts an array of queued Add Stock
 * operations and applies them one at a time, returning a per-row outcome
 * (created / restocked / duplicate / error). Each op carries its own
 * `clientOpId` so the backend's idempotency log still dedupes within
 * the batch.
 *
 * Why a dedicated endpoint instead of looping client-side:
 *   - one TCP/TLS handshake instead of N
 *   - the failure-mode is observable per-row in a single response
 *   - keeps the mobile happy on flaky connections — partial success is
 *     reported cleanly rather than half-failing a long sequence
 */
const bulkAddMedicineStock = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m;
    const body = req.body;
    if (!(body === null || body === void 0 ? void 0 : body.ops) || !Array.isArray(body.ops) || body.ops.length === 0) {
        throw new errors_1.ValidationError("BAD_REQUEST: ops array required");
    }
    // Identity comes from the TOKEN, never from the payload. A client-supplied
    // userId can be stale or plain wrong — and a missing one used to make
    // assertStorageAccess SKIP the storage check entirely, letting scanned
    // stock land in whichever storage the app happened to preselect.
    const accountId = (_a = req.user) === null || _a === void 0 ? void 0 : _a.id;
    const authAccount = accountId
        ? yield prisma_1.prisma.account.findUnique({
            where: { id: accountId },
            select: { User: { select: { id: true } } },
        })
        : null;
    const authUserId = (_c = (_b = authAccount === null || authAccount === void 0 ? void 0 : authAccount.User) === null || _b === void 0 ? void 0 : _b.id) !== null && _c !== void 0 ? _c : null;
    // Self-heal: if this line has exactly one storage and the scanner user has
    // no grant yet, assign it now so the upload doesn't bounce needlessly.
    yield (0, storageAccessController_1.autoGrantSoleStorageAccess)(authUserId, (_d = body.ops[0]) === null || _d === void 0 ? void 0 : _d.lineId);
    const results = [];
    for (const op of body.ops) {
        if (!(op === null || op === void 0 ? void 0 : op.clientOpId)) {
            results.push({
                clientOpId: (_e = op === null || op === void 0 ? void 0 : op.clientOpId) !== null && _e !== void 0 ? _e : "",
                status: "error",
                message: "Missing clientOpId",
            });
            continue;
        }
        // Idempotency short-circuit — same logic as the single endpoint.
        const prior = yield prisma_1.prisma.mobileUploadLog.findUnique({
            where: { clientOpId: op.clientOpId },
            select: { resultId: true, message: true },
        });
        if (prior) {
            results.push({
                clientOpId: op.clientOpId,
                status: "duplicate",
                stockId: (_f = prior.resultId) !== null && _f !== void 0 ? _f : undefined,
                message: (_g = prior.message) !== null && _g !== void 0 ? _g : "Already processed",
            });
            continue;
        }
        if (op.quantity <= 0 || op.perUnit <= 0) {
            results.push({
                clientOpId: op.clientOpId,
                status: "error",
                message: "Quantity and per-unit must be positive.",
            });
            continue;
        }
        if (!op.expiration || !op.manufacturingDate) {
            results.push({
                clientOpId: op.clientOpId,
                status: "error",
                message: "Manufacturing and expiration dates are required.",
            });
            continue;
        }
        const expiration = normalizeBatchDay(new Date(op.expiration));
        const manufacturingDate = normalizeBatchDay(new Date(op.manufacturingDate));
        if (!(expiration > manufacturingDate)) {
            results.push({
                clientOpId: op.clientOpId,
                status: "error",
                message: "Expiration must be after manufacturing date.",
            });
            continue;
        }
        const price = Math.max(0, Number((_h = op.price) !== null && _h !== void 0 ? _h : 0));
        try {
            // Storage access: same rule as the web add-stock endpoint — but bound
            // to the AUTHENTICATED user. Never skipped: no resolvable identity
            // means no write.
            const actorId = authUserId !== null && authUserId !== void 0 ? authUserId : op.userId;
            if (!actorId) {
                results.push({
                    clientOpId: op.clientOpId,
                    status: "error",
                    message: "Could not resolve your user account — sign in again.",
                });
                continue;
            }
            yield (0, storageAccessController_1.assertStorageAccess)(actorId, [op.storageId], "add or restock");
            const txResult = yield prisma_1.prisma.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
                var _a, _b;
                const [medicine, storage] = yield Promise.all([
                    tx.medicine.findUnique({ where: { id: op.medicineId } }),
                    tx.medicineStorage.findUnique({ where: { id: op.storageId } }),
                ]);
                if (!medicine)
                    throw new errors_1.NotFoundError("ITEM_NOT_FOUND");
                if (!storage)
                    throw new errors_1.NotFoundError("STORAGE_NOT_FOUND");
                // Day-windowed match + absorb — same merge rules as the web path.
                const matches = yield tx.medicineStock.findMany({
                    where: {
                        medicineId: op.medicineId,
                        medicineStorageId: op.storageId,
                        expiration: batchDayWindow(expiration),
                        manufacturingDate: batchDayWindow(manufacturingDate),
                        quality: op.unitOfMeasure,
                        perQuantity: op.perUnit,
                    },
                    orderBy: { timestamp: "asc" },
                });
                const existing = (_a = matches[0]) !== null && _a !== void 0 ? _a : null;
                const absorbed = existing
                    ? yield absorbDuplicateStocks(tx, existing.id, matches.slice(1))
                    : { addQty: 0, addItems: 0 };
                const totalItems = op.perUnit * op.quantity;
                let mode;
                let stockId;
                if (existing) {
                    mode = "restock";
                    yield (0, medicineAlerts_1.clearLowStockAlerts)(tx, existing.id);
                    const updated = yield tx.medicineStock.update({
                        where: { id: existing.id },
                        data: Object.assign(Object.assign(Object.assign(Object.assign(Object.assign(Object.assign({ actualStock: existing.actualStock + absorbed.addItems + totalItems, quantity: existing.quantity + absorbed.addQty + op.quantity, threshold: op.thresHold !== undefined ? op.thresHold : existing.threshold }, (op.addressRoom ? { addressRoom: op.addressRoom } : {})), (op.addressCol ? { addressCol: op.addressCol } : {})), (op.addressRow ? { addressRow: op.addressRow } : {})), (op.addressSec ? { addressSec: op.addressSec } : {})), (op.container ? { container: op.container } : {})), { price: { create: { value: price } } }),
                    });
                    stockId = updated.id;
                }
                else {
                    mode = "new";
                    const created = yield tx.medicineStock.create({
                        data: {
                            quantity: op.quantity,
                            medicineId: medicine.id,
                            threshold: (_b = op.thresHold) !== null && _b !== void 0 ? _b : 0,
                            medicineStorageId: op.storageId,
                            actualStock: totalItems,
                            lineId: op.lineId,
                            quarter: (0, date_1.getQuarter)(),
                            quality: op.unitOfMeasure,
                            perQuantity: op.perUnit,
                            expiration,
                            manufacturingDate,
                            addressRoom: op.addressRoom || null,
                            addressCol: op.addressCol || null,
                            addressRow: op.addressRow || null,
                            addressSec: op.addressSec || null,
                            container: op.container || null,
                            price: { create: { value: price } },
                        },
                    });
                    stockId = created.id;
                }
                yield (0, medicineAlerts_1.checkAndNotifyLowStock)(tx, stockId);
                yield tx.medicineLogs.create({
                    data: {
                        action: mode === "restock" ? 2 : 1,
                        message: `${mode === "restock" ? "Restocked" : "Added new batch:"} ${medicine.name} ` +
                            `(${medicine.serialNumber}) — qty ${op.quantity} × ${op.perUnit} ${op.unitOfMeasure} ` +
                            `(${totalItems} items) → storage ${storage.refNumber} [mobile]`,
                        userId: actorId,
                        lineId: op.lineId,
                    },
                });
                return { mode, stockId };
            }));
            yield prisma_1.prisma.mobileUploadLog
                .create({
                data: {
                    clientOpId: op.clientOpId,
                    kind: "medicine.addStock",
                    userId: actorId,
                    lineId: op.lineId,
                    resultId: txResult.stockId,
                    message: txResult.mode === "restock" ? "Restocked" : "New batch",
                },
            })
                .catch(() => undefined);
            results.push({
                clientOpId: op.clientOpId,
                status: txResult.mode === "restock" ? "restocked" : "created",
                stockId: txResult.stockId,
            });
        }
        catch (e) {
            const message = (_j = e === null || e === void 0 ? void 0 : e.message) !== null && _j !== void 0 ? _j : String((_m = (_l = (_k = e === null || e === void 0 ? void 0 : e.response) === null || _k === void 0 ? void 0 : _k.data) === null || _l === void 0 ? void 0 : _l.message) !== null && _m !== void 0 ? _m : "Failed");
            results.push({
                clientOpId: op.clientOpId,
                status: "error",
                message,
            });
        }
    }
    return res.code(200).send({
        attempted: body.ops.length,
        succeeded: results.filter((r) => ["created", "restocked", "duplicate"].includes(r.status)).length,
        failed: results.filter((r) => r.status === "error").length,
        results,
    });
});
exports.bulkAddMedicineStock = bulkAddMedicineStock;
/** Resolve the dispenser (User) from the auth token — id, username, and
 *  display name — for the denormalized dispense-history snapshot. */
const resolveDispenser = (accountId) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d;
    if (!accountId)
        return { id: null, username: null, name: null };
    const acct = yield prisma_1.prisma.account.findUnique({
        where: { id: accountId },
        select: {
            User: { select: { id: true, username: true, firstName: true, lastName: true } },
        },
    });
    const u = acct === null || acct === void 0 ? void 0 : acct.User;
    return {
        id: (_a = u === null || u === void 0 ? void 0 : u.id) !== null && _a !== void 0 ? _a : null,
        username: (_b = u === null || u === void 0 ? void 0 : u.username) !== null && _b !== void 0 ? _b : null,
        name: u ? `${(_c = u.firstName) !== null && _c !== void 0 ? _c : ""} ${(_d = u.lastName) !== null && _d !== void 0 ? _d : ""}`.trim() || null : null,
    };
});
/** Write ONE dispense-history record (with its item snapshots) inside an
 *  existing transaction. Best-effort at the caller: a history-write failure
 *  must never roll back an actual stock deduction. */
const createDispenseRecord = (tx, data) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d, _e, _f;
    const totalUnits = data.items.reduce((s, it) => s + (it.quantity || 0), 0);
    return tx.dispenseRecord.create({
        data: {
            lineId: data.lineId,
            kind: data.kind,
            dispensedById: data.dispenser.id,
            dispenserName: data.dispenser.name,
            dispenserUsername: data.dispenser.username,
            patientName: (_a = data.patientName) !== null && _a !== void 0 ? _a : null,
            patientId: (_b = data.patientId) !== null && _b !== void 0 ? _b : null,
            note: (_c = data.note) !== null && _c !== void 0 ? _c : null,
            external: !!data.external,
            externalSource: (_d = data.externalSource) !== null && _d !== void 0 ? _d : null,
            prescriptionId: (_e = data.prescriptionId) !== null && _e !== void 0 ? _e : null,
            refNumber: (_f = data.refNumber) !== null && _f !== void 0 ? _f : null,
            totalUnits,
            items: {
                create: data.items.map((it) => {
                    var _a, _b, _c, _d, _e, _f, _g;
                    return ({
                        medicineId: (_a = it.medicineId) !== null && _a !== void 0 ? _a : null,
                        medicineName: it.medicineName,
                        serialNumber: (_b = it.serialNumber) !== null && _b !== void 0 ? _b : null,
                        barcode: (_c = it.barcode) !== null && _c !== void 0 ? _c : null,
                        quantity: it.quantity,
                        unit: (_d = it.unit) !== null && _d !== void 0 ? _d : null,
                        storageId: (_e = it.storageId) !== null && _e !== void 0 ? _e : null,
                        storageName: (_f = it.storageName) !== null && _f !== void 0 ? _f : null,
                        storageRef: (_g = it.storageRef) !== null && _g !== void 0 ? _g : null,
                    });
                }),
            },
        },
        select: { id: true },
    });
});
exports.createDispenseRecord = createDispenseRecord;
/**
 * POST /medicine/direct-dispense/bulk — dispense WITHOUT a prescription.
 *
 * Walk-in / counter releases: deducts stock FEFO (earliest expiry first,
 * never from expired batches) from ONE storage, writes an audit row in
 * Medicine Logs, and is idempotent per op (clientOpId) so the mobile's
 * offline queue can retry safely. The actor comes from the AUTH TOKEN and
 * must hold Dispense & Stock Access on the storage — no exceptions.
 * The web/desktop call it with a single op; the mobile flushes its queue.
 * Each op also writes a single-item DispenseRecord for the history tab.
 */
const directDispenseBulk = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d;
    const body = req.body;
    if (!(body === null || body === void 0 ? void 0 : body.ops) || !Array.isArray(body.ops) || body.ops.length === 0) {
        throw new errors_1.ValidationError("BAD_REQUEST: ops array required");
    }
    // STRICT identity: the dispenser is whoever the token belongs to.
    const accountId = (_a = req.user) === null || _a === void 0 ? void 0 : _a.id;
    const dispenser = yield resolveDispenser(accountId);
    const actorId = dispenser.id;
    const results = [];
    for (const op of body.ops) {
        if (!(op === null || op === void 0 ? void 0 : op.clientOpId)) {
            results.push({ clientOpId: (_b = op === null || op === void 0 ? void 0 : op.clientOpId) !== null && _b !== void 0 ? _b : "", status: "error", message: "Missing clientOpId" });
            continue;
        }
        const prior = yield prisma_1.prisma.mobileUploadLog.findUnique({
            where: { clientOpId: op.clientOpId },
            select: { message: true },
        });
        if (prior) {
            results.push({ clientOpId: op.clientOpId, status: "duplicate", message: (_c = prior.message) !== null && _c !== void 0 ? _c : "Already processed" });
            continue;
        }
        if (!actorId) {
            results.push({ clientOpId: op.clientOpId, status: "error", message: "Could not resolve your user account — sign in again." });
            continue;
        }
        const qty = Math.floor(Number(op.quantity));
        if (!Number.isFinite(qty) || qty <= 0) {
            results.push({ clientOpId: op.clientOpId, status: "error", message: "Quantity must be a positive number." });
            continue;
        }
        if (!op.storageId || !op.lineId || (!op.medicineId && !op.barcode)) {
            results.push({ clientOpId: op.clientOpId, status: "error", message: "storageId, lineId and a medicine (id or barcode) are required." });
            continue;
        }
        try {
            // The user's rule, verbatim: storage access is STRICTLY enforced.
            yield (0, storageAccessController_1.assertStorageAccess)(actorId, [op.storageId], "dispense");
            const summary = yield prisma_1.prisma.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
                var _a, _b, _c, _d, _e, _f, _g;
                const medicine = op.medicineId
                    ? yield tx.medicine.findUnique({ where: { id: op.medicineId } })
                    : yield tx.medicine.findFirst({
                        where: {
                            barcode: { in: (0, scanCode_1.barcodeLookupCandidates)((_a = op.barcode) !== null && _a !== void 0 ? _a : "") },
                            lineId: op.lineId,
                        },
                    });
                if (!medicine)
                    throw new errors_1.NotFoundError("MEDICINE_NOT_FOUND");
                const storage = yield tx.medicineStorage.findUnique({
                    where: { id: op.storageId },
                    select: { id: true, name: true, refNumber: true },
                });
                if (!storage)
                    throw new errors_1.NotFoundError("STORAGE_NOT_FOUND");
                // FEFO over NON-EXPIRED batches only.
                const today = new Date();
                today.setHours(0, 0, 0, 0);
                const batches = yield tx.medicineStock.findMany({
                    where: {
                        medicineId: medicine.id,
                        medicineStorageId: op.storageId,
                        actualStock: { gt: 0 },
                    },
                    orderBy: { expiration: "asc" },
                });
                const usable = batches.filter((b) => !b.expiration || b.expiration >= today);
                const available = usable.reduce((s, b) => { var _a; return s + ((_a = b.actualStock) !== null && _a !== void 0 ? _a : 0); }, 0);
                if (available < qty) {
                    throw new errors_1.ValidationError(`Only ${available} non-expired unit(s) of ${medicine.name} in ${storage.name} — cannot dispense ${qty}.`);
                }
                let remaining = qty;
                for (const b of usable) {
                    if (remaining <= 0)
                        break;
                    const take = Math.min(remaining, (_b = b.actualStock) !== null && _b !== void 0 ? _b : 0);
                    if (take <= 0)
                        continue;
                    yield (0, medicineAlerts_1.clearLowStockAlerts)(tx, b.id);
                    yield tx.medicineStock.update({
                        where: { id: b.id },
                        data: { actualStock: ((_c = b.actualStock) !== null && _c !== void 0 ? _c : 0) - take },
                    });
                    yield (0, medicineAlerts_1.checkAndNotifyLowStock)(tx, b.id);
                    remaining -= take;
                }
                const extras = [
                    ((_d = op.patientName) === null || _d === void 0 ? void 0 : _d.trim()) ? `patient: ${op.patientName.trim()}` : null,
                    ((_e = op.note) === null || _e === void 0 ? void 0 : _e.trim()) ? `note: ${op.note.trim()}` : null,
                ]
                    .filter(Boolean)
                    .join(" · ");
                const message = `Direct dispense (no prescription): ${medicine.name} ` +
                    `(${medicine.serialNumber}) — ${qty} unit(s) from storage ` +
                    `${storage.refNumber}${extras ? " · " + extras : ""}`;
                yield tx.medicineLogs.create({
                    data: { action: 4, message, userId: actorId, lineId: op.lineId },
                });
                // Structured history record (single item per op → the Dispense
                // History tab and its detail view).
                yield (0, exports.createDispenseRecord)(tx, {
                    lineId: op.lineId,
                    kind: 0,
                    dispenser,
                    patientName: ((_f = op.patientName) === null || _f === void 0 ? void 0 : _f.trim()) || null,
                    note: ((_g = op.note) === null || _g === void 0 ? void 0 : _g.trim()) || null,
                    items: [
                        {
                            medicineId: medicine.id,
                            medicineName: medicine.name,
                            serialNumber: medicine.serialNumber,
                            barcode: medicine.barcode,
                            quantity: qty,
                            storageId: storage.id,
                            storageName: storage.name,
                            storageRef: storage.refNumber,
                        },
                    ],
                });
                return message;
            }));
            yield prisma_1.prisma.mobileUploadLog
                .create({
                data: {
                    clientOpId: op.clientOpId,
                    kind: "medicine.directDispense",
                    userId: actorId,
                    lineId: op.lineId,
                    resultId: null,
                    message: summary,
                },
            })
                .catch(() => undefined);
            results.push({ clientOpId: op.clientOpId, status: "dispensed", message: summary });
        }
        catch (e) {
            results.push({
                clientOpId: op.clientOpId,
                status: "error",
                message: (_d = e === null || e === void 0 ? void 0 : e.message) !== null && _d !== void 0 ? _d : "Failed",
            });
        }
    }
    return res.code(200).send({
        attempted: body.ops.length,
        succeeded: results.filter((r) => r.status !== "error").length,
        failed: results.filter((r) => r.status === "error").length,
        results,
    });
});
exports.directDispenseBulk = directDispenseBulk;
/**
 * POST /medicine/direct-dispense/multi — bulk direct dispense for ONE
 * patient across MANY scanned items. The whole request is atomic: every
 * line is dispensed (FEFO, non-expired, strict storage access) or NOTHING
 * is, and it produces a SINGLE DispenseRecord with one item per line —
 * which is exactly what the Dispense History detail shows.
 *
 * Body: { lineId, patientName?, note?, external?, externalSource?,
 *         items: [{ storageId, medicineId?|barcode?, quantity }] }
 */
const directDispenseMulti = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    const body = req.body;
    if (!body.lineId)
        throw new errors_1.ValidationError("lineId is required");
    if (!body.items || !Array.isArray(body.items) || body.items.length === 0)
        throw new errors_1.ValidationError("At least one item is required.");
    const dispenser = yield resolveDispenser((_a = req.user) === null || _a === void 0 ? void 0 : _a.id);
    const actorId = dispenser.id;
    if (!actorId)
        throw new errors_1.ValidationError("Could not resolve your user account — sign in again.");
    // Validate every line up front so a bad one fails the batch cleanly.
    const items = body.items.map((it, i) => {
        const qty = Math.floor(Number(it.quantity));
        if (!it.storageId || (!it.medicineId && !it.barcode))
            throw new errors_1.ValidationError(`Item ${i + 1}: a storage and a medicine (id or barcode) are required.`);
        if (!Number.isFinite(qty) || qty <= 0)
            throw new errors_1.ValidationError(`Item ${i + 1}: quantity must be positive.`);
        return Object.assign(Object.assign({}, it), { quantity: qty });
    });
    try {
        // ONE storage-access assertion covering every storage touched.
        yield (0, storageAccessController_1.assertStorageAccess)(actorId, [...new Set(items.map((it) => it.storageId))], "dispense");
        const result = yield prisma_1.prisma.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            var _a, _b, _c, _d, _e, _f, _g;
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const recordItems = [];
            const logLines = [];
            for (const [idx, it] of items.entries()) {
                const medicine = it.medicineId
                    ? yield tx.medicine.findUnique({ where: { id: it.medicineId } })
                    : yield tx.medicine.findFirst({
                        where: {
                            barcode: { in: (0, scanCode_1.barcodeLookupCandidates)((_a = it.barcode) !== null && _a !== void 0 ? _a : "") },
                            lineId: body.lineId,
                        },
                    });
                if (!medicine)
                    throw new errors_1.ValidationError(`Item ${idx + 1}: medicine not found.`);
                const storage = yield tx.medicineStorage.findUnique({
                    where: { id: it.storageId },
                    select: { id: true, name: true, refNumber: true },
                });
                if (!storage)
                    throw new errors_1.ValidationError(`Item ${idx + 1}: storage not found.`);
                const batches = yield tx.medicineStock.findMany({
                    where: {
                        medicineId: medicine.id,
                        medicineStorageId: it.storageId,
                        actualStock: { gt: 0 },
                    },
                    orderBy: { expiration: "asc" },
                });
                const usable = batches.filter((b) => !b.expiration || b.expiration >= today);
                const available = usable.reduce((s, b) => { var _a; return s + ((_a = b.actualStock) !== null && _a !== void 0 ? _a : 0); }, 0);
                if (available < it.quantity)
                    throw new errors_1.ValidationError(`${medicine.name}: only ${available} non-expired unit(s) in ${storage.name} — cannot dispense ${it.quantity}.`);
                let remaining = it.quantity;
                let unit = null;
                for (const b of usable) {
                    if (remaining <= 0)
                        break;
                    const take = Math.min(remaining, (_b = b.actualStock) !== null && _b !== void 0 ? _b : 0);
                    if (take <= 0)
                        continue;
                    if (!unit)
                        unit = b.quality;
                    yield (0, medicineAlerts_1.clearLowStockAlerts)(tx, b.id);
                    yield tx.medicineStock.update({
                        where: { id: b.id },
                        data: { actualStock: ((_c = b.actualStock) !== null && _c !== void 0 ? _c : 0) - take },
                    });
                    yield (0, medicineAlerts_1.checkAndNotifyLowStock)(tx, b.id);
                    remaining -= take;
                }
                recordItems.push({
                    medicineId: medicine.id,
                    medicineName: medicine.name,
                    serialNumber: medicine.serialNumber,
                    barcode: medicine.barcode,
                    quantity: it.quantity,
                    unit,
                    storageId: storage.id,
                    storageName: storage.name,
                    storageRef: storage.refNumber,
                });
                logLines.push(`${medicine.name} (${medicine.serialNumber}) ×${it.quantity} from ${storage.refNumber}`);
            }
            const record = yield (0, exports.createDispenseRecord)(tx, {
                lineId: body.lineId,
                kind: 0,
                dispenser,
                patientName: ((_d = body.patientName) === null || _d === void 0 ? void 0 : _d.trim()) || null,
                note: ((_e = body.note) === null || _e === void 0 ? void 0 : _e.trim()) || null,
                external: !!body.external,
                externalSource: ((_f = body.externalSource) === null || _f === void 0 ? void 0 : _f.trim()) || null,
                items: recordItems,
            });
            yield tx.medicineLogs.create({
                data: {
                    action: 4,
                    userId: actorId,
                    lineId: body.lineId,
                    message: `Bulk direct dispense (no prescription)` +
                        (((_g = body.patientName) === null || _g === void 0 ? void 0 : _g.trim())
                            ? ` to ${body.patientName.trim()}`
                            : "") +
                        `: ${recordItems.length} item(s) — ${logLines.join("; ")}`,
                },
            });
            return { recordId: record.id, count: recordItems.length };
        }));
        return res.code(200).send({
            message: "OK",
            recordId: result.recordId,
            itemCount: result.count,
        });
    }
    catch (error) {
        if (error instanceof errors_1.ValidationError || error instanceof errors_1.NotFoundError)
            throw error;
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError)
            throw (0, errors_1.dbError)(error);
        throw error;
    }
});
exports.directDispenseMulti = directDispenseMulti;
/** GET /medicine/dispense-history — paginated list of dispense events. */
// Build a Prisma timestamp filter from inclusive calendar-day bounds
// (yyyy-MM-dd). Returns undefined when neither bound is given.
const dispenseDateRange = (dateFrom, dateTo) => {
    if (!dateFrom && !dateTo)
        return undefined;
    const range = {};
    if (dateFrom) {
        const s = new Date(dateFrom);
        if (!isNaN(s.getTime())) {
            s.setHours(0, 0, 0, 0);
            range.gte = s;
        }
    }
    if (dateTo) {
        const e = new Date(dateTo);
        if (!isNaN(e.getTime())) {
            e.setHours(23, 59, 59, 999);
            range.lte = e;
        }
    }
    return range.gte || range.lte ? range : undefined;
};
const dispenseHistoryList = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    const params = req.query;
    if (!params.lineId)
        throw new errors_1.ValidationError("INVALID REQUIRED ID");
    const limit = params.limit ? parseInt(params.limit, 10) : 20;
    const cursor = params.lastCursor ? { id: params.lastCursor } : undefined;
    try {
        const where = { lineId: params.lineId };
        if (params.kind === "direct")
            where.kind = 0;
        else if (params.kind === "prescription")
            where.kind = 1;
        // Inclusive day bounds: dateFrom = start of that day, dateTo = end of it.
        const range = dispenseDateRange(params.dateFrom, params.dateTo);
        if (range)
            where.timestamp = range;
        if ((_a = params.query) === null || _a === void 0 ? void 0 : _a.trim()) {
            const q = params.query.trim();
            where.OR = [
                { patientName: { contains: q, mode: "insensitive" } },
                { refNumber: { contains: q, mode: "insensitive" } },
                { dispenserName: { contains: q, mode: "insensitive" } },
                { items: { some: { medicineName: { contains: q, mode: "insensitive" } } } },
            ];
        }
        const rows = yield prisma_1.prisma.dispenseRecord.findMany({
            where,
            take: limit,
            skip: cursor ? 1 : 0,
            cursor,
            orderBy: { timestamp: "desc" },
            include: {
                items: {
                    select: { medicineName: true, quantity: true, unit: true },
                    orderBy: { medicineName: "asc" },
                },
            },
        });
        const list = rows.map((r) => ({
            id: r.id,
            kind: r.kind,
            patientName: r.patientName,
            dispenserName: r.dispenserName,
            dispenserUsername: r.dispenserUsername,
            external: r.external,
            externalSource: r.externalSource,
            refNumber: r.refNumber,
            totalUnits: r.totalUnits,
            itemCount: r.items.length,
            preview: r.items
                .slice(0, 3)
                .map((it) => `${it.medicineName} ×${it.quantity}`)
                .join(", "),
            timestamp: r.timestamp,
        }));
        const lastCursorId = rows.length > 0 ? rows[rows.length - 1].id : null;
        const hasMore = rows.length === limit;
        return res.code(200).send({ list, lastCursor: lastCursorId, hasMore });
    }
    catch (error) {
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError)
            throw (0, errors_1.dbError)(error);
        throw error;
    }
});
exports.dispenseHistoryList = dispenseHistoryList;
/** GET /medicine/dispense-history/detail?id= — one dispense event + items. */
const dispenseHistoryDetail = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const params = req.query;
    if (!params.id)
        throw new errors_1.ValidationError("INVALID REQUIRED ID");
    try {
        const record = yield prisma_1.prisma.dispenseRecord.findUnique({
            where: { id: params.id },
            include: { items: { orderBy: { medicineName: "asc" } } },
        });
        if (!record)
            throw new errors_1.NotFoundError("DISPENSE_RECORD_NOT_FOUND");
        return res.code(200).send({ record });
    }
    catch (error) {
        if (error instanceof errors_1.NotFoundError)
            throw error;
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError)
            throw (0, errors_1.dbError)(error);
        throw error;
    }
});
exports.dispenseHistoryDetail = dispenseHistoryDetail;
/**
 * GET /medicine/dispense-history/export
 *   ?lineId= &dateFrom= &dateTo= &query= &kind= &periodLabel=
 *
 * A per-PATIENT summary of dispensing over the selected period, streamed as an
 * .xlsx: columns No, Full Name, Address, No. of Medicines Dispensed. Honors the
 * SAME filters as the Dispense History list (search / kind / date range).
 *
 * "Medicines dispensed" = total medicine UNITS the patient received in the
 * period (sum of each dispense's totalUnits). Records are grouped by the linked
 * patient when there is one (prescription dispenses → address resolved from the
 * Patient's barangay/municipal/province); walk-in direct dispenses group by the
 * typed name and have no address on file.
 */
const dispenseHistoryExport = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d;
    const params = req.query;
    if (!params.lineId)
        throw new errors_1.ValidationError("INVALID REQUIRED ID");
    try {
        const where = { lineId: params.lineId };
        if (params.kind === "direct")
            where.kind = 0;
        else if (params.kind === "prescription")
            where.kind = 1;
        const range = dispenseDateRange(params.dateFrom, params.dateTo);
        if (range)
            where.timestamp = range;
        if ((_a = params.query) === null || _a === void 0 ? void 0 : _a.trim()) {
            const q = params.query.trim();
            where.OR = [
                { patientName: { contains: q, mode: "insensitive" } },
                { refNumber: { contains: q, mode: "insensitive" } },
                { dispenserName: { contains: q, mode: "insensitive" } },
                { items: { some: { medicineName: { contains: q, mode: "insensitive" } } } },
            ];
        }
        const records = yield prisma_1.prisma.dispenseRecord.findMany({
            where,
            select: {
                patientName: true,
                patientId: true,
                totalUnits: true,
            },
            orderBy: { timestamp: "desc" },
            take: 100000, // safety cap; a period export never realistically hits this
        });
        // Resolve addresses for the linked patients in one batch.
        const patientIds = Array.from(new Set(records.map((r) => r.patientId).filter((x) => !!x)));
        const patients = patientIds.length
            ? yield prisma_1.prisma.patient.findMany({
                where: { id: { in: patientIds } },
                select: {
                    id: true,
                    firstname: true,
                    lastname: true,
                    middlename: true,
                    barangay: { select: { name: true } },
                    municipal: { select: { name: true } },
                    province: { select: { name: true } },
                },
            })
            : [];
        const pmap = new Map(patients.map((p) => [p.id, p]));
        const fullName = (p) => {
            const mid = p.middlename && p.middlename !== "N/A" ? p.middlename : "";
            const given = [p.firstname, mid].filter(Boolean).join(" ").trim();
            return [p.lastname, given].filter(Boolean).join(", ").trim();
        };
        const addressOf = (p) => {
            var _a, _b, _c;
            return [(_a = p.barangay) === null || _a === void 0 ? void 0 : _a.name, (_b = p.municipal) === null || _b === void 0 ? void 0 : _b.name, (_c = p.province) === null || _c === void 0 ? void 0 : _c.name]
                .filter(Boolean)
                .join(", ");
        };
        const agg = new Map();
        for (const r of records) {
            const p = r.patientId ? pmap.get(r.patientId) : undefined;
            let key, name, address;
            if (p) {
                key = "id:" + p.id;
                name = fullName(p);
                address = addressOf(p);
            }
            else {
                const nm = ((_b = r.patientName) !== null && _b !== void 0 ? _b : "").trim();
                key = nm ? "name:" + nm.toLowerCase() : "unnamed";
                name = nm || "Walk-in / unnamed";
                address = "";
            }
            const cur = (_c = agg.get(key)) !== null && _c !== void 0 ? _c : { name, address, units: 0 };
            cur.units += r.totalUnits || 0;
            if (!cur.address && address)
                cur.address = address;
            agg.set(key, cur);
        }
        const rows = Array.from(agg.values()).sort((a, b) => b.units - a.units || a.name.localeCompare(b.name));
        // ── build the workbook ────────────────────────────────────────────────
        const label = ((_d = params.periodLabel) !== null && _d !== void 0 ? _d : "").trim() || "All time";
        const workbook = new exceljs_1.default.Workbook();
        workbook.created = new Date();
        const ws = workbook.addWorksheet("Dispense Report", {
            pageSetup: { paperSize: 9, orientation: "portrait", fitToPage: true },
        });
        ws.columns = [
            { header: "No", key: "no", width: 6 },
            { header: "Full Name", key: "name", width: 34 },
            { header: "Address", key: "address", width: 40 },
            { header: "No. of Medicines Dispensed", key: "units", width: 26 },
        ];
        // Title band above the header row.
        ws.spliceRows(1, 0, ["DISPENSE HISTORY REPORT"], [`Period: ${label}`], []);
        ws.mergeCells("A1:D1");
        ws.mergeCells("A2:D2");
        ws.getCell("A1").font = { bold: true, size: 14 };
        ws.getCell("A1").alignment = { horizontal: "center" };
        ws.getCell("A2").font = { italic: true, size: 10 };
        ws.getCell("A2").alignment = { horizontal: "center" };
        // The column headers now live on row 4 (after the 3 spliced rows).
        const headerRow = ws.getRow(4);
        headerRow.eachCell((cell) => {
            cell.font = { bold: true };
            cell.alignment = { horizontal: "center", vertical: "middle" };
            cell.border = {
                top: { style: "thin" },
                left: { style: "thin" },
                bottom: { style: "thin" },
                right: { style: "thin" },
            };
            cell.fill = {
                type: "pattern",
                pattern: "solid",
                fgColor: { argb: "FFF3F4F6" },
            };
        });
        let total = 0;
        rows.forEach((r, i) => {
            total += r.units;
            const row = ws.addRow({
                no: i + 1,
                name: r.name,
                address: r.address || "—",
                units: r.units,
            });
            row.getCell("units").alignment = { horizontal: "center" };
            row.getCell("no").alignment = { horizontal: "center" };
        });
        // Total row.
        const totalRow = ws.addRow({ name: "TOTAL", units: total });
        totalRow.getCell("name").font = { bold: true };
        totalRow.getCell("name").alignment = { horizontal: "right" };
        totalRow.getCell("units").font = { bold: true };
        totalRow.getCell("units").alignment = { horizontal: "center" };
        const safeLabel = label.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, "");
        res.header("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
        res.header("Content-Disposition", `attachment; filename="Dispense_Report_${safeLabel || "All"}.xlsx"`);
        res.header("Access-Control-Expose-Headers", "Content-Disposition");
        const buffer = yield workbook.xlsx.writeBuffer();
        return res.send(buffer);
    }
    catch (error) {
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError)
            throw (0, errors_1.dbError)(error);
        throw error;
    }
});
exports.dispenseHistoryExport = dispenseHistoryExport;
/**
 * GET /medicine/insights?lineId=&days=90 — procurement decision-support.
 *
 * Aggregates how much of each medicine was actually DISPENSED over a
 * window, from BOTH sources without double counting:
 *   - prescription dispenses → MedicineTransactionItem.releasedQuantity
 *   - direct (no-Rx) dispenses → DispenseItem.quantity (record.kind = 0)
 * then joins current on-hand per medicine so the RHU can see what to buy
 * more of (fast-moving, and demand-exceeds-stock) and what to hold off on
 * (slow-moving with stock still sitting).
 */
const medicineDispenseInsights = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    const q = req.query;
    if (!q.lineId)
        throw new errors_1.ValidationError("INVALID REQUIRED ID");
    let days = q.days ? parseInt(q.days, 10) : 90;
    if (!Number.isFinite(days) || days <= 0)
        days = 90;
    days = Math.min(days, 730);
    const since = new Date(Date.now() - days * 86400000);
    try {
        const [rxItems, directItems, stockGroups, meds] = yield Promise.all([
            // Prescription dispenses (full history).
            prisma_1.prisma.medicineTransactionItem.findMany({
                where: {
                    releasedQuantity: { gt: 0 },
                    medicineId: { not: null },
                    presTranscription: { lineId: q.lineId, timestamp: { gte: since } },
                },
                select: {
                    medicineId: true,
                    releasedQuantity: true,
                    presTranscription: { select: { timestamp: true } },
                },
            }),
            // Direct dispenses (kind 0) — prescription ones (kind 1) are counted
            // above via MedicineTransactionItem, so only direct here (no double).
            prisma_1.prisma.dispenseItem.findMany({
                where: {
                    medicineId: { not: null },
                    quantity: { gt: 0 },
                    record: { lineId: q.lineId, kind: 0, timestamp: { gte: since } },
                },
                select: {
                    medicineId: true,
                    quantity: true,
                    record: { select: { timestamp: true } },
                },
            }),
            // Current on-hand per medicine (line-wide).
            prisma_1.prisma.medicineStock.groupBy({
                by: ["medicineId"],
                where: { lineId: q.lineId },
                _sum: { actualStock: true },
            }),
            prisma_1.prisma.medicine.findMany({
                where: { lineId: q.lineId, phase: { not: -1 } },
                select: { id: true, name: true, serialNumber: true },
            }),
        ]);
        const nameById = new Map(meds.map((m) => [m.id, m]));
        const onHandById = new Map();
        for (const g of stockGroups)
            if (g.medicineId)
                onHandById.set(g.medicineId, (_a = g._sum.actualStock) !== null && _a !== void 0 ? _a : 0);
        // ── per-medicine dispensed totals ──────────────────────────────────
        const agg = new Map();
        const bump = (id, units) => {
            var _a;
            if (!id)
                return;
            const cur = (_a = agg.get(id)) !== null && _a !== void 0 ? _a : { units: 0, events: 0 };
            cur.units += units;
            cur.events += 1;
            agg.set(id, cur);
        };
        for (const r of rxItems)
            bump(r.medicineId, r.releasedQuantity);
        for (const d of directItems)
            bump(d.medicineId, d.quantity);
        const dispensedRows = [...agg.entries()]
            .filter(([id]) => nameById.has(id))
            .map(([id, v]) => {
            var _a;
            return ({
                medicineId: id,
                name: nameById.get(id).name,
                serialNumber: nameById.get(id).serialNumber,
                units: v.units,
                events: v.events,
                onHand: (_a = onHandById.get(id)) !== null && _a !== void 0 ? _a : 0,
            });
        });
        const top = [...dispensedRows]
            .sort((a, b) => b.units - a.units)
            .slice(0, 12);
        // Slow-moving: medicines that STILL HAVE STOCK but barely moved (incl.
        // zero) — capital sitting on the shelf. Zero-dispensed-but-in-stock
        // items are the clearest "review before reordering" candidates.
        const dispensedMap = new Map(dispensedRows.map((r) => [r.medicineId, r.units]));
        const slow = meds
            .map((m) => {
            var _a, _b;
            return ({
                medicineId: m.id,
                name: m.name,
                serialNumber: m.serialNumber,
                units: (_a = dispensedMap.get(m.id)) !== null && _a !== void 0 ? _a : 0,
                onHand: (_b = onHandById.get(m.id)) !== null && _b !== void 0 ? _b : 0,
            });
        })
            .filter((m) => m.onHand > 0)
            .sort((a, b) => a.units - b.units || b.onHand - a.onHand)
            .slice(0, 12);
        // Reorder priority: demand in the window EXCEEDS what's on hand now.
        const reorder = dispensedRows
            .filter((r) => r.units > r.onHand)
            .sort((a, b) => b.units - a.units - (a.onHand - b.onHand))
            .slice(0, 12)
            .map((r) => (Object.assign(Object.assign({}, r), { shortfall: r.units - r.onHand })));
        // ── trend buckets (weekly for short windows, else monthly) ─────────
        const weekly = days <= 120;
        const buckets = new Map();
        const keyOf = (d) => {
            if (weekly) {
                const ms = Math.floor(d.getTime() / (7 * 86400000));
                const start = new Date(ms * 7 * 86400000);
                return {
                    key: ms,
                    label: start.toLocaleDateString("en-PH", { month: "short", day: "numeric" }),
                };
            }
            return {
                key: d.getFullYear() * 12 + d.getMonth(),
                label: d.toLocaleDateString("en-PH", { month: "short", year: "2-digit" }),
            };
        };
        const addTrend = (ts, units) => {
            var _a;
            const { key, label } = keyOf(ts);
            const b = (_a = buckets.get(String(key))) !== null && _a !== void 0 ? _a : { key, label, units: 0 };
            b.units += units;
            buckets.set(String(key), b);
        };
        for (const r of rxItems)
            addTrend(r.presTranscription.timestamp, r.releasedQuantity);
        for (const d of directItems)
            addTrend(d.record.timestamp, d.quantity);
        const trend = [...buckets.values()]
            .sort((a, b) => a.key - b.key)
            .map((b) => ({ label: b.label, units: b.units }));
        return res.code(200).send({
            windowDays: days,
            totalDispensedUnits: dispensedRows.reduce((s, r) => s + r.units, 0),
            distinctMedicinesDispensed: dispensedRows.length,
            top,
            slow,
            reorder,
            trend,
        });
    }
    catch (error) {
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError)
            throw (0, errors_1.dbError)(error);
        throw error;
    }
});
exports.medicineDispenseInsights = medicineDispenseInsights;
const exportMedicineReport = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const params = req.query;
    if (!params.storgeId) {
        throw new errors_1.ValidationError("INVALID REQUIRED ID");
    }
    try {
        let limit = 20;
        const result = yield prisma_1.prisma.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            let allMedicines = [];
            let currentPage = 0;
            let hasMoreData = true;
            // Get storage info
            const storage = yield tx.medicineStorage.findUnique({
                where: {
                    id: params.storgeId,
                },
            });
            if (!storage) {
                throw new errors_1.NotFoundError("STORAGE NOT FOUND");
            }
            // Fetch all medicines with pagination
            while (hasMoreData) {
                const skipping = currentPage * limit;
                const medicines = yield tx.medicineStock.findMany({
                    where: {
                        medicineStorageId: params.storgeId,
                    },
                    take: limit,
                    skip: skipping,
                    include: {
                        medicine: {
                            select: {
                                name: true,
                            },
                        },
                    },
                });
                if (medicines.length === 0) {
                    hasMoreData = false;
                }
                else {
                    allMedicines.push(...medicines);
                    currentPage++;
                    if (medicines.length < limit) {
                        hasMoreData = false;
                    }
                }
            }
            return { medicines: allMedicines, storage };
        }));
        // Load and process template
        const medicineReportTemplateLink = "https://res.cloudinary.com/drhkb0ubf/raw/upload/v1776245651/Medicine_Report_Template_ewezx3.xlsx";
        const response = yield fetch(medicineReportTemplateLink);
        const arrayBuffer = yield response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        const stream = stream_1.Readable.from(buffer);
        const workbook = new exceljs_1.default.Workbook();
        yield workbook.xlsx.read(stream);
        const worksheet = workbook.worksheets[0];
        if (!worksheet) {
            throw new Error("Worksheet not found in template");
        }
        let initRow = 4;
        let rowIndex = 0;
        result.medicines.forEach((item, i) => {
            var _a;
            initRow++;
            rowIndex++;
            let row = worksheet.getRow(initRow);
            row.getCell("A").value = rowIndex;
            row.getCell("B").value = ((_a = item.medicine) === null || _a === void 0 ? void 0 : _a.name) || "N/A";
            row.getCell("F").value = item.manufacturingDate || "N/A";
            row.getCell("G").value = item.expiration || "N/A";
            row.getCell("H").value = item.actualStock;
            row.getCell("I").value =
                item.perQuantity > 1
                    ? `${item.perQuantity}/${item.quality}`
                    : item.quality;
        });
        const excelBuffer = yield workbook.xlsx.writeBuffer();
        res.header("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
        res.header("Content-Disposition", `attachment; filename="MedicineReport_${result.storage.name || "export"}.xlsx"`);
        return res.send(excelBuffer);
    }
    catch (error) {
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw (0, errors_1.dbError)(error);
        }
        throw error;
    }
});
exports.exportMedicineReport = exportMedicineReport;
/**
 * Bulk-import medicines from an uploaded spreadsheet.
 *
 * Multipart form: `file` (.xlsx/.xls/.csv) + `lineId` (+ optional `userId`).
 *
 * ONLY the medicine name matters. We read the **first column** of every
 * sheet — one medicine name per row. An optional header cell on row 1
 * (e.g. "Name", "Medicine", "Item", "Product") is skipped automatically.
 * Names are de-duplicated within the file and against medicines that
 * already exist in the same line, then the new ones are inserted (each
 * with a generated serial number) scoped to that line.
 */
const medicineBulkUpload = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, e_1, _b, _c, _d, e_2, _e, _f;
    if (!req.isMultipart()) {
        throw new errors_1.ValidationError("INVALID MULTI-PART");
    }
    try {
        const parts = req.parts();
        const formData = {};
        let fileBuffer = null;
        try {
            for (var _g = true, parts_1 = __asyncValues(parts), parts_1_1; parts_1_1 = yield parts_1.next(), _a = parts_1_1.done, !_a; _g = true) {
                _c = parts_1_1.value;
                _g = false;
                const part = _c;
                if (part.type === "file") {
                    const buffers = [];
                    try {
                        for (var _h = true, _j = (e_2 = void 0, __asyncValues(part.file)), _k; _k = yield _j.next(), _d = _k.done, !_d; _h = true) {
                            _f = _k.value;
                            _h = false;
                            const chunk = _f;
                            buffers.push(chunk);
                        }
                    }
                    catch (e_2_1) { e_2 = { error: e_2_1 }; }
                    finally {
                        try {
                            if (!_h && !_d && (_e = _j.return)) yield _e.call(_j);
                        }
                        finally { if (e_2) throw e_2.error; }
                    }
                    fileBuffer = Buffer.concat(buffers);
                }
                else {
                    formData[part.fieldname] = part.value;
                }
            }
        }
        catch (e_1_1) { e_1 = { error: e_1_1 }; }
        finally {
            try {
                if (!_g && !_a && (_b = parts_1.return)) yield _b.call(parts_1);
            }
            finally { if (e_1) throw e_1.error; }
        }
        if (!fileBuffer) {
            throw new errors_1.ValidationError("INVALID FILE");
        }
        if (!formData.lineId) {
            throw new errors_1.ValidationError("lineId is required");
        }
        const workbook = new exceljs_1.default.Workbook();
        const stream = stream_1.Readable.from(fileBuffer);
        yield workbook.xlsx.read(stream);
        // Header words to ignore if they appear in the first cell of a sheet.
        const HEADER_WORDS = new Set([
            "name",
            "medicine",
            "medicine name",
            "item",
            "item name",
            "product",
        ]);
        // Collect unique names (case-insensitive) from column 1 of every sheet.
        const names = [];
        const seen = new Set();
        workbook.eachSheet((sheet) => {
            sheet.eachRow((row, rowNumber) => {
                const raw = row.getCell(1).value;
                const name = raw != null ? raw.toString().trim() : "";
                if (!name)
                    return;
                // Skip an optional header label on the first row.
                if (rowNumber === 1 && HEADER_WORDS.has(name.toLowerCase()))
                    return;
                const key = name.toLowerCase();
                if (seen.has(key))
                    return;
                seen.add(key);
                names.push(name);
            });
        });
        if (names.length === 0) {
            throw new errors_1.ValidationError("No medicine names found in the file.");
        }
        // Skip names that already exist in THIS line (case-insensitive).
        // `name: { in: names }` is case-SENSITIVE in Postgres, so a row stored as
        // "CEFALEXIN 125MG/5ML" never came back and the lowercase check below could
        // not see it — importing "Cefalexin 125mg/5ml" then created a SECOND row,
        // splitting that medicine's stock across two catalog entries. Compare
        // against every name in the line instead.
        const existing = yield prisma_1.prisma.medicine.findMany({
            where: { lineId: formData.lineId },
            select: { name: true },
        });
        const existingSet = new Set(existing.map((m) => m.name.trim().toLowerCase()));
        const newNames = names.filter((n) => !existingSet.has(n.trim().toLowerCase()));
        if (newNames.length === 0) {
            return res.status(200).send({
                message: "All medicines already exist. Nothing to import.",
                total: names.length,
                inserted: 0,
                skipped: names.length,
            });
        }
        const rows = [];
        for (const name of newNames) {
            const serialNumber = yield (0, handler_1.generateMedRef)();
            rows.push({ name, serialNumber, lineId: formData.lineId });
        }
        const result = yield prisma_1.prisma.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            const inserted = yield tx.medicine.createMany({
                data: rows,
                skipDuplicates: true,
            });
            // Audit log is best-effort — only when we know who performed it.
            if (formData.userId) {
                yield tx.medicineLogs.create({
                    data: {
                        lineId: formData.lineId,
                        userId: formData.userId,
                        message: `BULK IMPORT: ${inserted.count} medicine/s added.`,
                        action: 1,
                    },
                });
            }
            return inserted;
        }));
        return res.status(200).send({
            message: "Bulk upload completed",
            total: names.length,
            inserted: result.count,
            skipped: names.length - result.count,
        });
    }
    catch (error) {
        console.error("Bulk upload error:", error);
        if (error instanceof errors_1.ValidationError)
            throw error;
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw (0, errors_1.dbError)(error);
        }
        throw error;
    }
});
exports.medicineBulkUpload = medicineBulkUpload;
// PATCH /medicine/threshold { medicineId, storageId, threshold, lineId, userId }
// Update the low-stock threshold for every stock batch of a medicine within a
// storage location (the "medicine's threshold").
const updateMedicineThreshold = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    const body = req.body;
    if (!body.medicineId || !body.storageId || !body.lineId) {
        throw new errors_1.ValidationError("INVALID REQUIRED FIELDS");
    }
    const threshold = Math.max(0, parseInt(String((_a = body.threshold) !== null && _a !== void 0 ? _a : 0), 10) || 0);
    const { medicineId, storageId, lineId, userId } = body;
    // A low-stock THRESHOLD is a benign alert setting — not a dispense or a stock
    // move — and per-storage Dispense Access grants are rarely configured, so
    // gating it exactly like dispensing blocked even the storage's own pharmacy
    // staff. Allow it for EITHER an explicit storage grant OR any Pharmacy-module
    // user in this line (the same audience that receives the low-stock alerts).
    // Dispense / restock keep the stricter assertStorageAccess check.
    if (userId) {
        const [grant, mod] = yield Promise.all([
            prisma_1.prisma.medicineStorageAccess.findFirst({
                where: { userId, medicineStorageId: storageId },
                select: { id: true },
            }),
            prisma_1.prisma.module.findFirst({
                where: {
                    userId,
                    lineId,
                    OR: [
                        { moduleName: { equals: "medicine", mode: "insensitive" } },
                        { moduleName: { equals: "Pharmacy", mode: "insensitive" } },
                    ],
                },
                select: { id: true },
            }),
        ]);
        if (!grant && !mod) {
            throw new errors_1.ValidationError("You need the Pharmacy module (or Dispense Access on this storage) " +
                "to change its low-stock threshold. Ask your admin to grant it.");
        }
    }
    try {
        const result = yield prisma_1.prisma.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            var _a;
            // Grab the affected rows first so we can re-evaluate low-stock against
            // the *new* threshold below.
            const stocks = yield tx.medicineStock.findMany({
                where: { medicineId, medicineStorageId: storageId, lineId },
                select: { id: true, actualStock: true },
            });
            const updated = yield tx.medicineStock.updateMany({
                where: {
                    medicineId,
                    medicineStorageId: storageId,
                    lineId,
                },
                data: { threshold },
            });
            // Changing the threshold can itself put a row "below threshold" — fire
            // the alert now instead of waiting for the next dispense. Rows that are
            // now above the new threshold get their alert cleared so a future dip
            // notifies again.
            for (const s of stocks) {
                if (threshold > 0 && s.actualStock <= threshold) {
                    yield (0, medicineAlerts_1.checkAndNotifyLowStock)(tx, s.id);
                }
                else {
                    yield (0, medicineAlerts_1.clearLowStockAlerts)(tx, s.id);
                }
            }
            if (userId && updated.count > 0) {
                const med = yield tx.medicine.findUnique({
                    where: { id: medicineId },
                    select: { name: true },
                });
                yield tx.medicineLogs.create({
                    data: {
                        action: 2,
                        userId,
                        lineId,
                        message: `Updated low-stock threshold to ${threshold} for "${(_a = med === null || med === void 0 ? void 0 : med.name) !== null && _a !== void 0 ? _a : "medicine"}"`,
                    },
                });
            }
            return updated;
        }));
        return res
            .code(200)
            .send({ message: "OK", count: result.count, threshold });
    }
    catch (error) {
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw (0, errors_1.dbError)(error);
        }
        throw error;
    }
});
exports.updateMedicineThreshold = updateMedicineThreshold;
