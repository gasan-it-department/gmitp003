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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.removeStorage = exports.storageData = exports.medicineOverview = exports.removeMedicine = exports.medicineTransactions = exports.updateMedicineStock = exports.removeStock = exports.updateStock = exports.transferMedicine = exports.viewNotification = exports.medicineNotification = exports.newPrescriptionCount = exports.storageMedList = exports.addStorageMedInList = exports.storageMeds = exports.medicineLogList = exports.addStorageMed = exports.multiAddMed = exports.addMedFromExcel = exports.medicineList = exports.addMedicineStorage = exports.medicineStorage = void 0;
const prisma_1 = require("../barrel/prisma");
const errors_1 = require("../errors/errors");
//
const path_1 = __importDefault(require("path"));
const exceljs_1 = __importDefault(require("exceljs"));
const xlsx_1 = __importDefault(require("xlsx"));
//
const handler_1 = require("../middleware/handler");
const date_1 = require("../utils/date");
const medicineStorage = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const params = req.query;
    if (!params.id)
        throw new errors_1.ValidationError("BAD_REQUEST");
    try {
        const cursor = params.lastCursor ? { id: params.lastCursor } : undefined;
        const limit = params.limit ? parseInt(params.limit.toString()) : 10;
        const response = yield prisma_1.prisma.medicineStorage.findMany({
            where: {
                lineId: params.id,
            },
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
    const body = req.body;
    console.log(body);
    if (!body.name || !body.lineId || !body.departmentId) {
        throw new errors_1.ValidationError("BAD_REQUEST");
    }
    try {
        const refNumber = yield (0, handler_1.generateStorageRef)();
        yield prisma_1.prisma.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            const storage = yield prisma_1.prisma.medicineStorage.create({
                data: {
                    name: body.name,
                    desc: body.desc,
                    lineId: body.lineId,
                    departmentId: body.departmentId,
                    refNumber: refNumber,
                    timestamp: new Date().toISOString(),
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
const medicineList = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const params = req.query;
    console.log("dasda", { params });
    if (!params.id)
        throw new errors_1.ValidationError("BAD_REQUEST");
    try {
        const cursor = params.lastCursor ? { id: params.lastCursor } : undefined;
        const limit = params.limit ? parseInt(params.limit, 10) : 20;
        const filter = { lineId: params.id };
        if (params.query) {
            filter.name = {
                contains: params.query,
                mode: "insensitive",
            };
        }
        const response = yield prisma_1.prisma.medicine.findMany({
            where: filter,
            skip: cursor ? 1 : 0,
            take: limit,
            cursor,
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
exports.medicineList = medicineList;
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
        yield prisma_1.prisma.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            const med = yield tx.medicine.findFirst({
                where: {
                    name: {
                        contains: body.name,
                        mode: "insensitive",
                    },
                },
            });
            if (med)
                throw new errors_1.ValidationError("ALREADY_EXIST");
            const serialNumber = yield (0, handler_1.generateMedRef)();
            const medicine = yield tx.medicine.create({
                data: {
                    lineId: body.lineId,
                    name: body.name,
                    desc: body.desc,
                    serialNumber,
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
        }));
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
const storageMeds = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const params = req.query;
    console.log(params);
    if (!params.id)
        throw new errors_1.ValidationError("BAD_REQUEST");
    try {
        const cursor = params.lastCursor ? { id: params.lastCursor } : undefined;
        const limit = params.limit ? parseInt(params.limit, 10) : 10;
        const filter = { medicineStorageId: params.id };
        if (params.query) {
            const searchTerms = params.query.trim().split(/\s+/);
            if (searchTerms.length === 1) {
                filter.OR = [
                    {
                        name: {
                            contains: searchTerms[0],
                            mode: "insensitive",
                        },
                    },
                    {
                        serialNumber: {
                            contains: searchTerms[0],
                            mode: "insensitive",
                        },
                    },
                ];
            }
            else {
                filter.AND = searchTerms.map((term) => ({
                    OR: [
                        {
                            name: {
                                contains: term,
                                mode: "insensitive",
                            },
                        },
                        {
                            serialNumber: {
                                contains: term,
                                mode: "insensitive",
                            },
                        },
                    ],
                }));
            }
        }
        const response = yield prisma_1.prisma.medicineStock.findMany({
            where: filter,
            take: limit,
            skip: cursor ? 1 : 0,
            cursor,
            include: {
                stock: {
                    select: {
                        unit: true,
                        quantity: true,
                        perUnit: true,
                    },
                },
                price: {
                    select: {
                        value: true,
                    },
                },
                medicine: {
                    select: {
                        name: true,
                        serialNumber: true,
                        id: true,
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
exports.storageMeds = storageMeds;
const addStorageMedInList = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const body = req.body;
    console.log({ body });
    if (!body.storageId)
        throw new errors_1.ValidationError("BAD_REQUEST");
    try {
        const response = yield prisma_1.prisma.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            var _a;
            const medicine = yield tx.medicine.findUnique({
                where: {
                    id: body.medicineId,
                },
            });
            // FIXED: Add storageId to the where clause to find stock in the SPECIFIC storage
            const stock = yield tx.medicineStock.findFirst({
                where: {
                    medicineId: body.medicineId,
                    medicineStorageId: body.storageId, // This is the key fix
                    expiration: new Date(body.expiration),
                    manufacturingDate: new Date(body.manufacturingDate),
                    quality: body.unitOfMeasure,
                    perQuantity: body.perUnit,
                },
                include: {
                    price: {
                        take: 1,
                        orderBy: {
                            timestamp: "desc",
                        },
                    },
                },
            });
            const storage = yield tx.medicineStorage.findUnique({
                where: {
                    id: body.storageId,
                },
            });
            if (!medicine)
                throw new errors_1.NotFoundError("ITEM_NOT_FOUND");
            if (!storage)
                throw new errors_1.NotFoundError("STORAGE_NOT_FOUND");
            const total = body.perUnit * body.quantity;
            // Debug logging
            console.log("Stock expiration:", stock === null || stock === void 0 ? void 0 : stock.expiration);
            console.log("Body expiration:", new Date(body.expiration));
            if (stock) {
                console.log("Found existing stock in the same storage with matching criteria");
                const stockExpirationISO = (_a = stock.expiration) === null || _a === void 0 ? void 0 : _a.toISOString().split("T")[0];
                const bodyExpirationISO = new Date(body.expiration)
                    .toISOString()
                    .split("T")[0];
                const sameDate = stockExpirationISO === bodyExpirationISO;
                console.log("Quantity total: ", body.quantity);
                console.log("Stock unit of measure:", stock === null || stock === void 0 ? void 0 : stock.quality);
                console.log("Body unit of measure:", body.unitOfMeasure);
                console.log("Units equal?", body.unitOfMeasure === (stock === null || stock === void 0 ? void 0 : stock.quality));
                console.log("Stock per quantity:", stock === null || stock === void 0 ? void 0 : stock.perQuantity);
                console.log("Body per unit:", body.perUnit);
                console.log("Per unit equal?", body.perUnit === (stock === null || stock === void 0 ? void 0 : stock.perQuantity));
                console.log("Same storage?", stock.medicineStorageId === body.storageId);
            }
            else {
                console.log("No matching stock found in this storage, creating new");
            }
            if (stock &&
                stock.medicineStorageId === body.storageId // Check if it's the same storage
            ) {
                // FIXED: Already filtered by all criteria in the findFirst query
                // So we can be confident this is a matching stock
                const currStock = stock.actualStock;
                const currQuantity = stock.quantity;
                const newActualStock = currStock + total;
                yield tx.medicineStock.update({
                    where: {
                        id: stock.id,
                    },
                    data: {
                        actualStock: newActualStock,
                        quantity: currQuantity + body.quantity,
                        price: {
                            create: {
                                value: body.price,
                            },
                        },
                    },
                });
            }
            else {
                yield tx.medicineStock.create({
                    data: {
                        quantity: body.quantity,
                        medicineId: medicine.id,
                        threshold: body.thresHold,
                        medicineStorageId: body.storageId,
                        actualStock: total,
                        lineId: body.lineId,
                        quarter: (0, date_1.getQuarter)(),
                        quality: body.unitOfMeasure,
                        perQuantity: body.perUnit,
                        price: {
                            create: {
                                value: body.price,
                            },
                        },
                        expiration: new Date(body.expiration),
                    },
                });
            }
            yield tx.medicineLogs.create({
                data: {
                    action: 1,
                    message: `Added Item: ${medicine.name} - Serial Ref.: ${medicine.serialNumber}; Quantity: ${body.quantity}; Per Unit: ${body.perUnit}; UoM: ${body.unitOfMeasure} to storage: ${storage.refNumber}`,
                    userId: body.userId,
                    lineId: body.lineId,
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
const transferMedicine = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const body = req.body;
    console.log({ body });
    if (!body.departId || !body.quantity || !body.fromId || !body.userId) {
        throw new errors_1.ValidationError("INVALID REQUIRED ID");
    }
    try {
        const response = yield prisma_1.prisma.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            var _a, _b;
            const stock = yield tx.medicineStock.findUnique({
                where: {
                    id: body.stockId,
                },
                include: {
                    medicine: {
                        select: {
                            name: true,
                            serialNumber: true,
                        },
                    },
                },
            });
            const to = yield tx.medicineStorage.findUnique({
                where: {
                    id: body.departId,
                },
            });
            const from = yield tx.medicineStorage.findUnique({
                where: {
                    id: body.fromId,
                },
            });
            if (!stock)
                throw new errors_1.NotFoundError("STOCK NOT FOUND");
            if (!to)
                throw new errors_1.NotFoundError("TARGET STORAGE NOT FOUND");
            if (!from)
                throw new errors_1.NotFoundError("ORIGIN STORAGE NOT FOUND");
            const perQuantity = stock.perQuantity;
            const currStock = stock.quantity * stock.perQuantity;
            const toTransfer = body.quantity;
            const actualStockTransfered = perQuantity * toTransfer;
            if (currStock < actualStockTransfered)
                throw new errors_1.ValidationError("INVALID QUANTITY");
            yield tx.medicineStock.update({
                where: {
                    id: stock.id,
                },
                data: {
                    medicineStorageId: to.id,
                    actualStock: actualStockTransfered,
                    quality: stock.quality,
                    quantity: toTransfer,
                    perQuantity: perQuantity,
                },
            });
            yield tx.medicineLogs.create({
                data: {
                    action: 2,
                    message: `Trasnfered ${((_a = stock.medicine) === null || _a === void 0 ? void 0 : _a.name) || "Unknown Medicine"} (${((_b = stock.medicine) === null || _b === void 0 ? void 0 : _b.serialNumber) || "Unknown Medicine"}) ${body.quantity} stock/s from ${from.name} to ${to.name}`,
                    userId: body.userId,
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
        console.log(error);
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw new errors_1.AppError("DB_CONNECTION_ERROR", 500, "DB_FAILED");
        }
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
            throw new errors_1.AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
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
            throw new errors_1.AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
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
        const response = yield prisma_1.prisma.medicineTransaction.findMany({
            where: {
                lineId: params.id,
            },
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
            throw new errors_1.AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
        }
        throw error;
    }
});
exports.medicineTransactions = medicineTransactions;
const removeMedicine = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const params = req.query;
    if (!params.id || !params.userId) {
        throw new errors_1.ValidationError("INVALID REQUIRED ID");
    }
    try {
        const response = yield prisma_1.prisma.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            const medicine = yield tx.medicine.findUnique({
                where: {
                    id: params.id,
                },
            });
            if (!medicine)
                throw new errors_1.NotFoundError("Medicine not found!");
            yield tx.medicine.delete({
                where: {
                    id: params.id,
                },
            });
            yield tx.medicineLogs.create({
                data: {
                    action: 0,
                    userId: params.userId,
                    message: `REMOVED MEDICINE - ${medicine.name}`,
                },
            });
            return true;
        }));
        if (!response) {
            throw new errors_1.ValidationError("TRANSACTION FAILED");
        }
        return res.code(200).send({ message: "OK" });
    }
    catch (error) {
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw new errors_1.AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
        }
        throw error;
    }
});
exports.removeMedicine = removeMedicine;
const medicineOverview = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const params = req.query;
    if (!params.lineId) {
        throw new errors_1.ValidationError("INVALID REQUIRED ID");
    }
    try {
        const response = yield prisma_1.prisma.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            // Total medicines count
            const medicines = yield tx.medicineStock.count({
                where: {
                    lineId: params.lineId,
                },
            });
            // Low stock: where actualStock is less than or equal to threshold
            const lowStock = yield tx.medicineStock.count({
                where: {
                    lineId: params.lineId,
                    actualStock: {
                        lte: tx.medicineStock.fields.threshold, // actualStock <= threshold
                    },
                },
            });
            // Storage count
            const storage = yield tx.medicineStorage.count({
                where: {
                    lineId: params.lineId,
                },
            });
            // Near expiration: medicines expiring within 6 months from now
            const sixMonthsFromNow = new Date();
            sixMonthsFromNow.setMonth(sixMonthsFromNow.getMonth() + 6);
            const nearExpiration = yield tx.medicineStock.count({
                where: {
                    lineId: params.lineId,
                    expiration: {
                        not: null,
                        lte: sixMonthsFromNow, // expiration date <= 6 months from now
                        gte: new Date(), // optional: only future expirations (not already expired)
                    },
                },
            });
            // Optional: Get the actual near-expiration medicine details
            return {
                medicines: {
                    total: medicines,
                    lowStock,
                },
                storage,
                nearExpiration,
            };
        }));
        return res.send(response);
    }
    catch (error) {
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw new errors_1.AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
        }
        throw error;
    }
});
exports.medicineOverview = medicineOverview;
const storageData = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const params = req.query;
    if (!params.id)
        throw new errors_1.ValidationError("INVALID REQUIRED ID");
    try {
        const response = yield prisma_1.prisma.medicineStorage.findUnique({
            where: {
                id: params.id,
            },
        });
        if (!response) {
            throw new errors_1.NotFoundError("STORAGE NOT FOUND!");
        }
        return res.code(200).send(response);
    }
    catch (error) {
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw new errors_1.AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
        }
        throw error;
    }
});
exports.storageData = storageData;
const removeStorage = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const params = req.query;
    if (!params.id) {
        throw new errors_1.ValidationError("INVALID REQUIRED ID");
    }
    try {
        const response = yield prisma_1.prisma.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            const storage = yield tx.medicineStorage.delete({
                where: {
                    id: params.id,
                },
            });
            yield tx.activityLogs.create({
                data: {
                    action: 1,
                    desc: `REMOVE MEDICINE STORAGE: ${storage.name}`,
                    userId: params.userId,
                    lineId: params.lineId,
                },
            });
            yield tx.medicineLogs.create({
                data: {
                    action: 3,
                    lineId: params.lineId,
                    message: `STORAGE: ${storage.name}-${storage.refNumber}, has been removed`,
                    userId: params.userId,
                },
            });
            return "OK";
        }));
        return res.code(200).send(response);
    }
    catch (error) {
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw new errors_1.AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
        }
        throw error;
    }
});
exports.removeStorage = removeStorage;
