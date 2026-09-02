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
exports.deletePatient = exports.addPatientRecord = exports.patientRecordData = exports.patientRecordList = exports.updatePatient = exports.addPatient = exports.patientData = exports.patientList = void 0;
const prisma_1 = require("../barrel/prisma");
const errors_1 = require("../errors/errors");
const patientList = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const params = req.query;
    if (!params.id)
        throw new errors_1.ValidationError("BAD_REQUEST");
    try {
        const cursor = params.lastCursor ? { id: params.lastCursor } : undefined;
        const limit = params.limit ? parseInt(params.limit, 10) : 20;
        const filter = { lineId: params.id };
        if (params.query) {
            const searchTerms = params.query.trim().split(/\s+/);
            if (searchTerms.length === 1) {
                filter.OR = [
                    { lastname: { contains: searchTerms[0], mode: "insensitive" } },
                    { firstname: { contains: searchTerms[0], mode: "insensitive" } },
                ];
            }
            else {
                filter.OR = [
                    {
                        AND: searchTerms.map((term) => ({
                            OR: [
                                { firstname: { contains: term, mode: "insensitive" } },
                                { lastname: { contains: term, mode: "insensitive" } },
                            ],
                        })),
                    },
                ];
            }
        }
        const response = yield prisma_1.prisma.patient.findMany({
            where: Object.assign({}, filter),
            take: limit,
            skip: cursor ? 1 : 0,
            orderBy: {
                timestamp: "desc",
            },
            cursor,
            include: {
                barangay: { select: { name: true } },
                municipal: { select: { name: true } },
                province: { select: { name: true } },
                region: { select: { name: true } },
                _count: { select: { record: true } },
            },
        });
        const newLastCursorId = response.length > 0 ? response[response.length - 1].id : null;
        const hasMore = response.length === limit;
        return res
            .code(200)
            .send({ list: response, hasMore, lastCursor: newLastCursorId });
    }
    catch (error) {
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw (0, errors_1.dbError)(error);
        }
        throw error;
    }
});
exports.patientList = patientList;
const patientData = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const params = req.query;
    if (!params.id)
        throw new errors_1.ValidationError("BAD_REQUEST");
    try {
        const response = yield prisma_1.prisma.patient.findUnique({
            where: { id: params.id },
            include: {
                barangay: { select: { name: true } },
                municipal: { select: { name: true } },
                province: { select: { name: true } },
                region: { select: { name: true } },
                _count: { select: { record: true } },
            },
        });
        if (!response)
            throw new errors_1.NotFoundError("PATIENT_NOT_FOUND");
        return res.code(200).send(response);
    }
    catch (error) {
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw (0, errors_1.dbError)(error);
        }
        throw error;
    }
});
exports.patientData = patientData;
const addPatient = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    const body = req.body;
    console.log(body);
    if (!body.firstname || !body.lastname || !body.lineId) {
        throw new errors_1.ValidationError("BAD_REQUEST");
    }
    try {
        const response = yield prisma_1.prisma.patient.create({
            data: {
                firstname: body.firstname,
                lastname: body.lastname,
                middlename: body.middlename,
                email: body.email,
                phoneNumber: body.phoneNumber,
                philHealthNo: body.philHealthNo || undefined,
                barangayId: body.barangayId,
                municipalId: body.municipalId,
                provinceId: body.provinceId,
                regionId: body.regionId,
                birthday: body.birthday ? new Date(body.birthday) : undefined,
                illi: (_a = body.illi) !== null && _a !== void 0 ? _a : false,
                lineId: body.lineId,
            },
        });
        return res.code(200).send({ message: "OK", data: response });
    }
    catch (error) {
        console.log(error);
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw (0, errors_1.dbError)(error);
        }
        throw error;
    }
});
exports.addPatient = addPatient;
const updatePatient = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const body = req.body;
    console.log(body);
    if (!body.id)
        throw new errors_1.ValidationError("BAD_REQUEST");
    try {
        const patient = yield prisma_1.prisma.patient.findUnique({
            where: { id: body.id },
        });
        if (!patient)
            throw new errors_1.NotFoundError("PATIENT_NOT_FOUND");
        const response = yield prisma_1.prisma.patient.update({
            where: { id: body.id },
            data: {
                firstname: body.firstname,
                lastname: body.lastname,
                middlename: body.middlename,
                email: body.email,
                phoneNumber: body.phoneNumber,
                philHealthNo: body.philHealthNo || null,
                barangayId: body.barangayId,
                municipalId: body.municipalId,
                provinceId: body.provinceId,
                regionId: body.regionId,
                birthday: body.birthday ? new Date(body.birthday) : undefined,
                illi: body.illi,
            },
        });
        return res.code(200).send({ message: "OK", data: response });
    }
    catch (error) {
        console.log(error);
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw (0, errors_1.dbError)(error);
        }
        throw error;
    }
});
exports.updatePatient = updatePatient;
const patientRecordList = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const params = req.query;
    if (!params.patientId)
        throw new errors_1.ValidationError("BAD_REQUEST");
    try {
        const cursor = params.lastCursor ? { id: params.lastCursor } : undefined;
        const limit = params.limit ? parseInt(params.limit, 10) : 10;
        const response = yield prisma_1.prisma.patientRecord.findMany({
            where: { patientId: params.patientId },
            take: limit,
            skip: cursor ? 1 : 0,
            orderBy: { timestamp: "desc" },
            cursor,
            include: {
                medicineTransaction: {
                    select: { id: true, quantity: true, unit: true, timestamp: true, remark: true },
                },
            },
        });
        const lastCursor = response.length > 0 ? response[response.length - 1].id : null;
        const hasMore = response.length === limit;
        return res.code(200).send({ list: response, hasMore, lastCursor });
    }
    catch (error) {
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw (0, errors_1.dbError)(error);
        }
        throw error;
    }
});
exports.patientRecordList = patientRecordList;
const patientRecordData = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c;
    const params = req.query;
    if (!params.id)
        throw new errors_1.ValidationError("BAD_REQUEST");
    try {
        const record = yield prisma_1.prisma.patientRecord.findUnique({
            where: { id: params.id },
            include: {
                patient: {
                    include: {
                        barangay: { select: { name: true } },
                        municipal: { select: { name: true } },
                        province: { select: { name: true } },
                        region: { select: { name: true } },
                    },
                },
                prescription: {
                    include: {
                        presMed: {
                            include: {
                                medicine: { select: { id: true, name: true, serialNumber: true } },
                            },
                        },
                        MedicineTransaction: {
                            include: {
                                user: {
                                    select: { id: true, username: true, firstName: true, lastName: true },
                                },
                                storage: { select: { id: true, name: true } },
                                MedicineTransactionItem: {
                                    include: {
                                        medicine: { select: { id: true, name: true, serialNumber: true } },
                                        storage: { select: { id: true, name: true } },
                                    },
                                },
                            },
                        },
                    },
                },
                medicineTransaction: {
                    include: {
                        user: {
                            select: { id: true, username: true, firstName: true, lastName: true },
                        },
                        storage: { select: { id: true, name: true } },
                        prescription: {
                            select: {
                                id: true,
                                refNumber: true,
                                condtion: true,
                                street: true,
                                timestamp: true,
                            },
                        },
                        MedicineTransactionItem: {
                            include: {
                                medicine: {
                                    select: { id: true, name: true, serialNumber: true },
                                },
                                storage: { select: { id: true, name: true } },
                            },
                        },
                    },
                },
            },
        });
        if (!record)
            throw new errors_1.NotFoundError("RECORD_NOT_FOUND");
        // ── Fallback: resolve prescription for legacy records that pre-date the
        // prescriptionId column. Look up by patientId + nearest prescription.
        let result = record;
        if (!record.prescription && record.patientId) {
            let derivedId = null;
            // Type 2: derive from the linked MedicineTransaction
            if ((_b = (_a = record.medicineTransaction) === null || _a === void 0 ? void 0 : _a.prescription) === null || _b === void 0 ? void 0 : _b.id) {
                derivedId = record.medicineTransaction.prescription.id;
            }
            // Type 1: find the prescription created closest in time to this record
            else if (record.type === 1) {
                const candidate = yield prisma_1.prisma.prescription.findFirst({
                    where: { patientId: record.patientId },
                    orderBy: { timestamp: "desc" },
                });
                derivedId = (_c = candidate === null || candidate === void 0 ? void 0 : candidate.id) !== null && _c !== void 0 ? _c : null;
            }
            if (derivedId) {
                const fullPrescription = yield prisma_1.prisma.prescription.findUnique({
                    where: { id: derivedId },
                    include: {
                        presMed: {
                            include: {
                                medicine: { select: { id: true, name: true, serialNumber: true } },
                            },
                        },
                        MedicineTransaction: {
                            include: {
                                user: {
                                    select: { id: true, username: true, firstName: true, lastName: true },
                                },
                                storage: { select: { id: true, name: true } },
                                MedicineTransactionItem: {
                                    include: {
                                        medicine: { select: { id: true, name: true, serialNumber: true } },
                                        storage: { select: { id: true, name: true } },
                                    },
                                },
                            },
                        },
                    },
                });
                if (fullPrescription) {
                    result = Object.assign(Object.assign({}, record), { prescription: fullPrescription });
                }
            }
        }
        return res.code(200).send(result);
    }
    catch (error) {
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw (0, errors_1.dbError)(error);
        }
        throw error;
    }
});
exports.patientRecordData = patientRecordData;
const addPatientRecord = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    const body = req.body;
    if (!body.patientId)
        throw new errors_1.ValidationError("BAD_REQUEST");
    try {
        const patient = yield prisma_1.prisma.patient.findUnique({
            where: { id: body.patientId },
        });
        if (!patient)
            throw new errors_1.NotFoundError("PATIENT_NOT_FOUND");
        const record = yield prisma_1.prisma.patientRecord.create({
            data: {
                patientId: body.patientId,
                diagnose: body.diagnose,
                type: (_a = body.type) !== null && _a !== void 0 ? _a : 0, // 0 = Diagnose (default)
            },
        });
        return res.code(200).send({ message: "OK", data: record });
    }
    catch (error) {
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw (0, errors_1.dbError)(error);
        }
        throw error;
    }
});
exports.addPatientRecord = addPatientRecord;
const deletePatient = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const params = req.query;
    if (!params.id)
        throw new errors_1.ValidationError("BAD_REQUEST");
    try {
        const patient = yield prisma_1.prisma.patient.findUnique({
            where: { id: params.id },
        });
        if (!patient)
            throw new errors_1.NotFoundError("PATIENT_NOT_FOUND");
        // ── Guard: refuse to delete a patient who still has non-dispensed
        // prescriptions. Otherwise the prescriptions would be orphaned (patientId
        // → null via SetNull) and could still be dispensed to a deleted patient.
        const pendingPrescriptions = yield prisma_1.prisma.prescription.count({
            where: {
                patientId: params.id,
                status: { lt: 2 }, // 0 = Pending, 1 = Processing, 2 = Dispensed
            },
        });
        if (pendingPrescriptions > 0) {
            throw new errors_1.ValidationError(`Cannot delete patient: ${pendingPrescriptions} pending prescription${pendingPrescriptions === 1 ? "" : "s"} must be dispensed or cancelled first.`);
        }
        yield prisma_1.prisma.patient.delete({
            where: { id: params.id },
        });
        return res.code(200).send({ message: "OK" });
    }
    catch (error) {
        console.log(error);
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw (0, errors_1.dbError)(error);
        }
        throw error;
    }
});
exports.deletePatient = deletePatient;
