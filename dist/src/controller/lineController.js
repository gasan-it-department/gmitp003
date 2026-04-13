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
exports.userDataRegister = exports.checkLineInvitation = exports.backUpInventoryLineData = exports.registerLine = exports.deleteLine = exports.lineUpdateStatus = exports.newLineRegister = exports.getAllLine = exports.getLines = exports.createLine = void 0;
const prisma_1 = require("../barrel/prisma");
const errors_1 = require("../errors/errors");
const handler_1 = require("../middleware/handler");
const handler_2 = require("../middleware/handler");
const argon2_1 = __importDefault(require("argon2"));
const encryption_1 = require("../service/encryption");
const url_1 = require("../service/url");
const Cloundinary_1 = __importDefault(require("../class/Cloundinary"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const temp_url = process.env.VITE_LOCAL_FRONTEND_URL;
const createLine = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const body = req.body;
        const fronURL = (0, url_1.tempURL)();
        if (!fronURL) {
            throw new errors_1.ValidationError("INVALID CLIENT URL");
        }
        if (!body || !body.name || !body.email) {
            return res.code(400).send({ message: "Invalid request" });
        }
        const existingLine = yield prisma_1.prisma.line.findUnique({
            where: { name: body.name },
        });
        if (existingLine) {
            return res
                .code(400)
                .send({ message: "Line with this name already exists" });
        }
        const [province, municipal, barangay, region] = yield Promise.all([
            (0, handler_2.getAreaData)(body.provinceId, 0),
            (0, handler_2.getAreaData)(body.municipalId, 1),
            (0, handler_2.getAreaData)(body.barangayId, 2),
            (0, handler_2.getAreaData)(body.regionId, 3),
        ]);
        if (!province || !municipal || !barangay || !region) {
            throw new errors_1.ValidationError("INVALID AREA");
        }
        const response = yield prisma_1.prisma.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            let checkBarangay = yield tx.barangay.findUnique({
                where: {
                    id: barangay.code,
                },
            });
            let checkMunicipal = yield tx.municipal.findUnique({
                where: {
                    id: municipal.code,
                },
            });
            let checkProvince = yield tx.province.findUnique({
                where: {
                    id: province.code,
                },
            });
            let checkRegion = yield tx.region.findUnique({
                where: {
                    id: region.code,
                },
            });
            if (!checkProvince) {
                checkProvince = yield tx.province.create({
                    data: {
                        id: province.code,
                        name: province.name,
                    },
                });
            }
            if (!checkMunicipal) {
                checkMunicipal = yield tx.municipal.create({
                    data: {
                        id: municipal.code,
                        name: municipal.name,
                        provinceId: province.code,
                    },
                });
            }
            if (!checkBarangay) {
                checkBarangay = yield tx.barangay.create({
                    data: {
                        id: barangay.code,
                        name: barangay.name,
                        municipalId: municipal.code,
                    },
                });
            }
            if (!checkRegion) {
                checkRegion = yield tx.region.create({
                    data: {
                        id: region.code,
                        name: region.name,
                    },
                });
            }
            const newLine = yield prisma_1.prisma.line.create({
                data: {
                    name: body.name,
                    barangayId: checkBarangay.id,
                    municipalId: checkMunicipal.id,
                    provinceId: checkProvince.id,
                    regionId: checkRegion.id,
                },
            });
            const sg = yield tx.salaryGrade.createManyAndReturn({
                data: Array.from({ length: 33 }).map((_, i) => {
                    return {
                        grade: i + 1,
                        amount: 1,
                        lineId: newLine.id,
                    };
                }),
            });
            yield tx.salaryGradeHistory.createMany({
                data: sg.map((item) => {
                    return {
                        amount: 1,
                        userId: "",
                        effectiveDate: new Date(),
                        salaryGradeId: item.id,
                    };
                }),
            });
            const department = yield tx.department.create({
                data: {
                    name: "Human Resources",
                    lineId: newLine.id,
                },
            });
            const position = yield tx.position.create({
                data: {
                    name: "Human Resources Management Officer",
                    departmentId: department.id,
                    lineId: newLine.id,
                    unitPositions: {
                        create: {
                            departmentId: department.id,
                            lineId: newLine.id,
                            fixToUnit: true,
                            slot: {
                                create: {
                                    occupied: true,
                                },
                            },
                        },
                    },
                },
                include: {
                    unitPositions: {
                        where: {
                            departmentId: department.id,
                        },
                        select: {
                            id: true,
                            slot: {
                                where: {
                                    occupied: true,
                                    userId: null,
                                },
                            },
                        },
                    },
                },
            });
            const link = yield tx.lineInvitation.create({
                data: {
                    lineId: newLine.id,
                    positionSlotId: position.unitPositions[0].slot[0].id,
                    email: body.email,
                    unitPositionId: position.unitPositions[0].id,
                },
            });
            return {
                newLine,
                position,
                sgId: sg[0].id,
                invitationId: link.id,
                unitPosId: position.unitPositions[0].slot[0].id,
            };
        }));
        if (!province || !municipal || !barangay || !temp_url || !response) {
            throw new errors_1.ValidationError("TRANSACTION FAILED");
        }
        const emailContent = `New Line Registration

Hello,

Your new line "${body.name}" has been successfully registered in our system.

Line Details:
- Line Name: ${body.name}
- Location: ${barangay.name}, ${municipal.name}, ${province.name}

Next Steps to Manage Your Line:
1. Click the link below to complete your account registration:
   ${fronURL}line/register/user/${response.newLine.id}/${response.invitationId}/${response.unitPosId}/${response.sgId}

2. Once registered, you can:
   - Manage line operations
   - View reports and analytics
   - Access on Module: Human resources

If you have any questions, contact our support team.

Best regards,
Your Organization Team`;
        yield (0, handler_1.sendEmail)("New Line Registration", body.email, emailContent, "");
        return res.code(200).send({
            message: "Line created successfully",
            error: 0,
        });
    }
    catch (error) {
        console.log(error);
        res.code(500).send({ message: "Internal server error" });
        return;
    }
});
exports.createLine = createLine;
const getLines = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const response = yield prisma_1.prisma.line.findMany();
        yield prisma_1.prisma.account.updateMany({
            data: {
                lineId: "c039c8fd-8058-4e07-820e-7a3f36dc108d",
            },
        });
        return response;
    }
    catch (error) {
        console.log(error);
        res.code(500).send({ message: "Internal Server Error" });
    }
});
exports.getLines = getLines;
const getAllLine = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const params = req.query;
    console.log({ params });
    try {
        const cursor = params.lastCursor ? { id: params.id } : undefined;
        const limit = params.limit ? parseInt(params.limit, 10) : 20;
        const filter = {};
        if (params.query) {
            filter.name = {
                contains: params.query,
                mode: "insensitive",
            };
        }
        const response = yield prisma_1.prisma.line.findMany({
            where: filter,
            skip: cursor ? 1 : 0,
            take: limit,
            orderBy: {
                createdAt: "desc",
            },
            cursor,
            include: {
                _count: {
                    select: {
                        User: true,
                    },
                },
            },
        });
        console.log(response);
        const newLastCursor = response.length > 0 ? response[response.length - 1].id : null;
        const hasMore = limit === response.length;
        return res
            .code(200)
            .send({ list: response, hasMore, lastCursor: newLastCursor });
    }
    catch (error) {
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw new errors_1.AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
        }
        throw error;
    }
});
exports.getAllLine = getAllLine;
const newLineRegister = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
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
exports.newLineRegister = newLineRegister;
const lineUpdateStatus = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const body = req.body;
    console.log(body);
    if (!body.id || body.status > 2) {
        throw new errors_1.ValidationError("INVALID REQUEST");
    }
    try {
        const response = yield prisma_1.prisma.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            const line = yield tx.line.update({
                where: {
                    id: body.id,
                },
                data: {
                    status: body.status,
                },
            });
            yield tx.adminLogs.create({
                data: {
                    adminId: body.userId,
                    action: 0,
                    desc: `UPDATE LINE STATUS - ${line.name}: -> ${handler_1.lineStatus[body.status]}`,
                },
            });
            return line;
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
exports.lineUpdateStatus = lineUpdateStatus;
const deleteLine = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const body = req.query;
    if (!body.id || !body.userId) {
        throw new errors_1.ValidationError("INVALID REQUEST");
    }
    try {
        const response = yield prisma_1.prisma.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            const user = yield tx.admin.findUnique({
                where: {
                    id: body.userId,
                },
            });
            if (!user) {
                throw new errors_1.ValidationError("INVALID USER");
            }
            const line = yield tx.line.delete({
                where: {
                    id: body.id,
                },
            });
            yield tx.adminLogs.create({
                data: {
                    adminId: user.id,
                    action: 2,
                    desc: `REMOVED LINE: ${line.name}`,
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
exports.deleteLine = deleteLine;
const registerLine = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const body = req.body;
    console.log({ body });
    if (!body.teleNumber ||
        !body.email ||
        !body.username ||
        !body.lineId ||
        !body.password ||
        !body.unitPosId ||
        !body.lineInvitationId) {
        throw new errors_1.ValidationError("INVALID REQUIRED FIELD");
    }
    try {
        const response = yield prisma_1.prisma.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            var _a;
            const existedUser = yield tx.account.findFirst({
                where: {
                    username: {
                        contains: body.username,
                        mode: "insensitive",
                    },
                },
            });
            const invitation = yield tx.lineInvitation.findUnique({
                where: {
                    id: body.lineInvitationId,
                },
            });
            const slot = yield tx.positionSlot.findUnique({
                where: {
                    id: body.unitPosId,
                },
                include: {
                    unitPosition: {
                        select: {
                            departmentId: true,
                        },
                    },
                },
            });
            if (!slot) {
                throw new errors_1.NotFoundError("POSITION SLOT NOT FOUND");
            }
            if (!invitation) {
                throw new errors_1.NotFoundError("INVITATION NOT FOUND");
            }
            const application = yield tx.submittedApplication.findUnique({
                where: {
                    id: invitation.submittedApplicationId,
                },
            });
            if (!application) {
                throw new errors_1.NotFoundError("APPLICATION NOT FOUND");
            }
            if (existedUser) {
                return {
                    error: 1,
                    message: "Username already exist.",
                };
            }
            const hashed = yield argon2_1.default.hash(body.password);
            const account = yield tx.account.create({
                data: {
                    username: body.username,
                    password: hashed,
                    lineId: body.lineId,
                },
            });
            const user = yield tx.user.create({
                data: {
                    firstName: application.firstname,
                    lastName: application.lastname,
                    username: account.username,
                    accountId: account.id,
                    email: application.email,
                    emailIv: application.emailIv,
                    lineId: body.lineId,
                    positionId: slot.positionId,
                    departmentId: (_a = slot.unitPosition) === null || _a === void 0 ? void 0 : _a.departmentId,
                },
            });
            yield tx.submittedApplication.update({
                where: {
                    id: application.id,
                },
                data: {
                    userId: user.id,
                },
            });
            yield tx.positionSlot.update({
                where: {
                    id: slot.id,
                },
                data: {
                    userId: user.id,
                    salaryGradeId: body.sgId,
                    occupied: true,
                },
            });
            yield tx.module.create({
                data: {
                    moduleName: "human-resources",
                    userId: user.id,
                    lineId: body.lineId,
                    privilege: 1,
                    moduleIndex: "1",
                },
            });
            yield tx.line.update({
                where: {
                    id: body.lineId,
                },
                data: {
                    hrmoEmail: body.email,
                    hrmoTelePhone: body.teleNumber,
                    userId: user.id,
                },
            });
            yield tx.notification.create({
                data: {
                    recipientId: user.id,
                    title: "Module Access Granted",
                    content: "Module: Human resources",
                    senderId: user.id,
                },
            });
            yield tx.notification.create({
                data: {
                    recipientId: user.id,
                    title: "Welcome to the System!",
                    content: `Welcome ${body.firstname} ${body.lastname}! You have been successfully registered as the HRMO Administrator. Your username is: ${body.username}. You now have full access to the Human Resources module.`,
                    senderId: user.id,
                },
            });
            return {
                error: 0,
                message: "OK",
            };
        }));
        return res.code(200).send(response);
    }
    catch (error) {
        console.log(error);
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw new errors_1.AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
        }
        throw error;
    }
});
exports.registerLine = registerLine;
const backUpInventoryLineData = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const body = req.body;
    if (!body.lineId || !body.userId) {
        throw new errors_1.ValidationError("INVALID REQUIRED ID");
    }
    try {
        const response = yield prisma_1.prisma.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            const containers = yield tx.inventoryBox.findMany({
                where: {
                    lineId: body.lineId,
                },
            });
            const list = yield tx.supplyBatch.findMany({
                where: {
                    box: {
                        lineId: body.lineId,
                    },
                },
            });
            const order = yield tx.supplyBatchOrder.findMany({
                where: {
                    lineId: body.lineId,
                },
            });
            const orderItem = yield tx.supplyBatchOrder.findMany({
                where: {
                    lineId: body.lineId,
                },
            });
            const supplies = yield tx.supplies.findMany({
                where: {
                    lineId: body.lineId,
                },
            });
            const supplier = yield tx.supplier.findMany({
                where: {
                    lineId: body.lineId,
                },
            });
            const recievedSupply = yield tx.supplieRecieveHistory.findMany();
            const dispenseRecord = yield tx.supplyDispenseRecord.findMany({
                where: {
                    containerId: {
                        lineId: body.lineId,
                    },
                },
            });
            return {
                containers,
                list,
                order,
                orderItem,
                recievedSupply,
                dispenseRecord,
                supplies,
                supplier,
            };
        }));
        // Send as JSON with proper headers
        res
            .header("Content-Type", "application/json")
            .header("Content-Disposition", 'attachment; filename="inventory-backup.json"')
            .send(JSON.stringify(response, null, 2));
    }
    catch (error) {
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw new errors_1.AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
        }
        throw error;
    }
});
exports.backUpInventoryLineData = backUpInventoryLineData;
const checkLineInvitation = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const params = req.query;
    console.log({ params });
    if (!params.lineInvitationId) {
        throw new errors_1.ValidationError("INVALID REQUIRED ID");
    }
    try {
        const response = yield prisma_1.prisma.lineInvitation.findUnique({
            where: {
                id: params.lineInvitationId,
            },
            include: {
                unitPosition: {
                    select: {
                        position: {
                            select: {
                                name: true,
                            },
                        },
                    },
                },
            },
        });
        console.log(JSON.stringify(response, null, 2));
        if (!response) {
            throw new errors_1.NotFoundError("INVITATION LINK NOT FOUND");
        }
        return res.status(200).send(response);
    }
    catch (error) {
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw new errors_1.AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
        }
        throw error;
    }
});
exports.checkLineInvitation = checkLineInvitation;
const userDataRegister = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, e_1, _b, _c, _d, e_2, _e, _f;
    if (!req.isMultipart())
        throw new Error("NOT MULTI PARTS");
    try {
        const parts = req.parts();
        const formData = {};
        const files = [];
        const uploads = [];
        let profilePicture = null;
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
                    files.push({
                        fieldname: part.fieldname,
                        filename: part.filename,
                        mimetype: part.mimetype,
                        buffer: Buffer.concat(buffers),
                    });
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
        const inviteLink = yield prisma_1.prisma.lineInvitation.findUnique({
            where: {
                id: formData.lineInvitationId,
            },
            select: {
                positionSlotId: true,
                id: true,
                unitPositionId: true,
                lineId: true,
                line: {
                    select: {
                        hrmo: {
                            select: {
                                id: true,
                            },
                        },
                    },
                },
            },
        });
        if (!inviteLink) {
            throw new errors_1.NotFoundError("JOB POST NOT FOUND");
        }
        console.log({ inviteLink });
        const tmpDir = path_1.default.join(process.cwd(), "tmp_uploads");
        if (!fs_1.default.existsSync(tmpDir))
            fs_1.default.mkdirSync(tmpDir, { recursive: true });
        for (const f of files) {
            const safe = f.filename.replace(/[^\w.-]/g, "_");
            const tmpPath = path_1.default.join(tmpDir, safe);
            fs_1.default.writeFileSync(tmpPath, f.buffer);
            if (f.fieldname === "profilePicture") {
                const profile = yield Cloundinary_1.default.uploader.upload(tmpPath, {
                    folder: "job_requirements_assets",
                    resource_type: "auto",
                    use_filename: true,
                    unique_filename: true,
                });
                fs_1.default.unlinkSync(tmpPath);
                profilePicture = yield prisma_1.prisma.applicationProfilePic.create({
                    data: {
                        file_name: f.filename,
                        file_url: profile.url,
                        file_url_Iv: profile.public_id,
                        file_size: profile.bytes.toString(),
                        file_type: 1,
                    },
                });
            }
            else {
                uploads.push(Cloundinary_1.default.uploader
                    .upload(tmpPath, {
                    folder: "job_requirements_assets",
                    resource_type: "auto",
                    use_filename: true,
                    unique_filename: true,
                })
                    .then((r) => {
                    fs_1.default.unlinkSync(tmpPath); // Delete temp file after upload
                    return Object.assign(Object.assign({}, r), { originalName: f.filename, fieldname: f.fieldname });
                }));
            }
        }
        const uploaded = yield Promise.all(uploads);
        function normalizeForm(formData) {
            var _a, _b;
            const parseArrayField = (fieldName, defaultValue = []) => {
                if (!formData[fieldName])
                    return defaultValue;
                try {
                    const parsed = JSON.parse(formData[fieldName]);
                    return Array.isArray(parsed) ? parsed : defaultValue;
                }
                catch (e) {
                    console.warn(`Failed to parse ${fieldName}:`, e);
                    return defaultValue;
                }
            };
            const parseObjectField = (fieldName, defaultValue = {}) => {
                if (!formData[fieldName])
                    return defaultValue;
                try {
                    const parsed = JSON.parse(formData[fieldName]);
                    return typeof parsed === "object" && parsed !== null
                        ? parsed
                        : defaultValue;
                }
                catch (e) {
                    console.warn(`Failed to parse ${fieldName}:`, e);
                    return defaultValue;
                }
            };
            return {
                // personal
                firstName: formData.firstName,
                lastName: formData.lastName,
                middleName: formData.middleName || "N/A",
                birthDate: formData.birthDate,
                email: formData.email,
                civilStatus: formData.civilStatus,
                bloodType: formData.bloodType,
                height: formData.height,
                weight: formData.weight,
                umidNo: formData.umidNo,
                pagIbigNo: formData.pagIbigNo,
                philHealthNo: formData.philHealthNo,
                philSys: formData.philSys,
                tinNo: formData.tinNo,
                agencyNo: formData.agencyNo,
                // citizenship
                citizenship: formData["citizenship[citizenship]"],
                dualCitizen: formData["citizenship[by]"],
                country: formData["citizenship[country]"],
                // residential
                resProvince: formData["residentialAddress[province]"],
                resCity: formData["residentialAddress[cityMunicipality]"],
                resBarangay: formData["residentialAddress[barangay]"],
                resZipCode: formData["residentialAddress[zipCode]"],
                // permanent
                permaProvince: formData["permanentAddress[province]"],
                permaCity: formData["permanentAddress[cityMunicipality]"],
                permaBarangay: formData["permanentAddress[barangay]"],
                permaZipCode: formData["permanentAddress[zipCode]"],
                // contact
                mobileNo: formData.mobileNo,
                telephoneNumber: formData.telephoneNumber,
                // parents
                fatherSurname: formData["father[surname]"] || "N/A",
                fatherFirstname: formData["father[firstname]"] || "N/A",
                fatherAge: parseInt((_a = formData["father[age]"]) !== null && _a !== void 0 ? _a : "0"),
                motherSurname: formData["mother[surname]"] || "N/A",
                motherFirstname: formData["mother[firstname]"] || "N/A",
                motherAge: parseInt((_b = formData["mother[age]"]) !== null && _b !== void 0 ? _b : "0"),
                //education - ensure all fields have proper fallbacks
                elementary: {
                    to: formData["elementary[to]"] || "N/A",
                    from: formData["elementary[from]"] || "N/A",
                    name: formData["elementary[name]"] || "N/A",
                    course: formData["elementary[course]"] || "N/A",
                    highestAttained: formData["elementary[highestAttained]"] || "N/A",
                    yearGraduate: formData["elementary[yearGraduate]"] || "N/A",
                    records: formData["elementary[records]"] || "N/A",
                },
                secondary: {
                    to: formData["secondary[to]"] || "N/A",
                    from: formData["secondary[from]"] || "N/A",
                    name: formData["secondary[name]"] || "N/A",
                    course: formData["secondary[course]"] || "N/A",
                    highestAttained: formData["secondary[highestAttained]"] || "N/A",
                    yearGraduate: formData["secondary[yearGraduate]"] || "N/A",
                    records: formData["secondary[records]"] || "N/A",
                },
                vocational: {
                    to: formData["vocational[to]"] || "N/A",
                    from: formData["vocational[from]"] || "N/A",
                    name: formData["vocational[name]"] || "N/A",
                    course: formData["vocational[course]"] || "N/A",
                    highestAttained: formData["vocational[highestAttained]"] || "N/A",
                    yearGraduate: formData["vocational[yearGraduate]"] || "N/A",
                    records: formData["vocational[records]"] || "N/A",
                },
                college: {
                    to: formData["college[to]"] || "N/A",
                    from: formData["college[from]"] || "N/A",
                    name: formData["college[name]"] || "N/A",
                    course: formData["college[course]"] || "N/A",
                    highestAttained: formData["college[highestAttained]"] || "N/A",
                    yearGraduate: formData["college[yearGraduate]"] || "N/A",
                    records: formData["college[records]"] || "N/A",
                },
                graduateCollege: {
                    to: formData["graduateCollege[to]"] || "N/A",
                    from: formData["graduateCollege[from]"] || "N/A",
                    name: formData["graduateCollege[name]"] || "N/A",
                    course: formData["graduateCollege[course]"] || "N/A",
                    highestAttained: formData["graduateCollege[highestAttained]"] || "N/A",
                    yearGraduate: formData["graduateCollege[yearGraduate]"] || "N/A",
                    records: formData["graduateCollege[records]"] || "N/A",
                },
                // arrays - use helper function for safe parsing
                children: parseArrayField("children", []),
                civiService: parseArrayField("civiService", []),
                experience: parseArrayField("experience", []),
                tags: parseArrayField("tags", []),
                // gov ID - use object parser
                govId: parseObjectField("govId", { type: "", number: "" }),
                // job
                municipalId: formData.municipalId,
                positionId: formData.positionId,
                // other fields from form
                gender: formData.gender,
                suffix: formData.suffix,
            };
        }
        const clean = normalizeForm(formData);
        console.log("Normalized form data:", JSON.stringify(clean, null, 2));
        // -----------------------------------------
        // 3. Encrypt EVERYTHING BEFORE TX
        // -----------------------------------------
        const fieldsToEncrypt = {
            firstName: clean.firstName,
            lastName: clean.lastName,
            email: clean.email,
            civilStatus: clean.civilStatus,
            mobileNo: clean.mobileNo,
            resProvince: clean.resProvince,
            resCity: clean.resCity,
            resBarangay: clean.resBarangay,
            resZipCode: clean.resZipCode,
            permaProvince: clean.permaProvince,
            permaCity: clean.permaCity,
            permaBarangay: clean.permaBarangay,
            permaZipCode: clean.permaZipCode,
            fatherSurname: clean.fatherSurname,
            fatherFirstname: clean.fatherFirstname,
            motherSurname: clean.motherSurname,
            motherFirstname: clean.motherFirstname,
            birthDate: clean.birthDate,
            umidNo: clean.umidNo,
            pagIbigNo: clean.pagIbigNo,
            philHealthNo: clean.philHealthNo,
            philSys: clean.philSys,
            tinNo: clean.tinNo,
            agencyNo: clean.agencyNo,
        };
        const encrypted = {};
        const encPromises = [];
        for (const key in fieldsToEncrypt) {
            if (fieldsToEncrypt[key] === undefined || fieldsToEncrypt[key] === null)
                continue;
            encPromises.push(encryption_1.EncryptionService.encrypt(String(fieldsToEncrypt[key])).then((r) => {
                encrypted[key] = r;
            }));
        }
        yield Promise.all(encPromises);
        console.log({ encrypted });
        const result = yield prisma_1.prisma.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s, _t, _u, _v, _w, _x, _y, _z, _0, _1, _2, _3, _4, _5, _6, _7, _8, _9, _10, _11, _12, _13, _14, _15, _16, _17;
            // Handle missing parent age fields safely
            const fatherAge = parseInt((_a = formData["father[age]"]) !== null && _a !== void 0 ? _a : "0") || 0;
            const motherAge = parseInt((_b = formData["mother[age]"]) !== null && _b !== void 0 ? _b : "0") || 0;
            // Check if profile picture was created
            if (!profilePicture) {
                console.warn("No profile picture found for application");
            }
            const applicationData = {
                // PERSONAL INFO
                firstname: formData.firstName,
                firsntameIv: "",
                lastnameIv: "",
                lastname: formData.lastName,
                middleName: formData.middleName || "N/A",
                email: ((_c = encrypted.email) === null || _c === void 0 ? void 0 : _c.encryptedData) || "",
                emailIv: ((_d = encrypted.email) === null || _d === void 0 ? void 0 : _d.iv) || "",
                cvilStatus: ((_e = encrypted.civilStatus) === null || _e === void 0 ? void 0 : _e.encryptedData) || "",
                cvilStatusIv: ((_f = encrypted.civilStatus) === null || _f === void 0 ? void 0 : _f.iv) || "",
                birthDate: ((_g = encrypted.birthDate) === null || _g === void 0 ? void 0 : _g.encryptedData) || "",
                bdayIv: ((_h = encrypted.birthDate) === null || _h === void 0 ? void 0 : _h.iv) || "",
                gender: formData.gender || "male",
                filipino: clean.citizenship === "filipino",
                dualCitizen: clean.citizenship === "dual",
                byBirth: false,
                byNatural: false,
                // REQUIRED → NO ENCRYPTION
                dualCitizenHalf: clean.country || "N/A",
                // RESIDENTIAL ADDRESS
                resProvince: ((_j = encrypted.resProvince) === null || _j === void 0 ? void 0 : _j.encryptedData) || "",
                resProvinceIv: ((_k = encrypted.resProvince) === null || _k === void 0 ? void 0 : _k.iv) || "",
                resCity: ((_l = encrypted.resCity) === null || _l === void 0 ? void 0 : _l.encryptedData) || "",
                resCityIv: ((_m = encrypted.resCity) === null || _m === void 0 ? void 0 : _m.iv) || "",
                resBarangay: ((_o = encrypted.resBarangay) === null || _o === void 0 ? void 0 : _o.encryptedData) || "",
                resBarangayIv: ((_p = encrypted.resBarangay) === null || _p === void 0 ? void 0 : _p.iv) || "",
                resZipCode: clean.resZipCode || "",
                resZipCodeIv: null,
                // PERMANENT ADDRESS
                permaProvince: ((_q = encrypted.permaProvince) === null || _q === void 0 ? void 0 : _q.encryptedData) || "",
                permaProvinceIv: ((_r = encrypted.permaProvince) === null || _r === void 0 ? void 0 : _r.iv) || "",
                permaCity: ((_s = encrypted.permaCity) === null || _s === void 0 ? void 0 : _s.encryptedData) || "",
                permaCityIv: ((_t = encrypted.permaCity) === null || _t === void 0 ? void 0 : _t.iv) || "",
                permaBarangay: ((_u = encrypted.permaBarangay) === null || _u === void 0 ? void 0 : _u.encryptedData) || "",
                permaBarangayIv: ((_v = encrypted.permaBarangay) === null || _v === void 0 ? void 0 : _v.iv) || "",
                permaZipCode: clean.permaZipCode || "",
                permaZipCodeIv: null,
                // CONTACTS
                mobileNo: ((_w = encrypted.mobileNo) === null || _w === void 0 ? void 0 : _w.encryptedData) || "",
                ivMobileNo: ((_x = encrypted.mobileNo) === null || _x === void 0 ? void 0 : _x.iv) || "",
                teleNo: formData.telephoneNumber || "",
                // PHYSICAL INFO
                height: parseFloat(formData.height) || 0,
                weight: parseFloat(formData.weight) || 0,
                bloodType: formData.bloodType || "N/A",
                // PARENTS — REQUIRED FIELDS
                fatherSurname: ((_y = encrypted.fatherSurname) === null || _y === void 0 ? void 0 : _y.encryptedData) || "N/A",
                fatherSurnameIv: ((_z = encrypted.fatherSurname) === null || _z === void 0 ? void 0 : _z.iv) || null,
                fatherFirstname: ((_0 = encrypted.fatherFirstname) === null || _0 === void 0 ? void 0 : _0.encryptedData) || "N/A",
                fatherFirstnameIv: ((_1 = encrypted.fatherFirstname) === null || _1 === void 0 ? void 0 : _1.iv) || null,
                fatherAge: fatherAge,
                motherSurname: ((_2 = encrypted.motherSurname) === null || _2 === void 0 ? void 0 : _2.encryptedData) || "N/A",
                motherSurnameIv: ((_3 = encrypted.motherSurname) === null || _3 === void 0 ? void 0 : _3.iv) || null,
                motherFirstname: ((_4 = encrypted.motherFirstname) === null || _4 === void 0 ? void 0 : _4.encryptedData) || "N/A",
                motherFirstnameIv: ((_5 = encrypted.motherFirstname) === null || _5 === void 0 ? void 0 : _5.iv) || null,
                motherAge: motherAge,
                // EDUCATION - These are Json fields (pass objects directly)
                elementary: clean.elementary,
                secondary: clean.secondary,
                vocational: clean.vocational,
                college: clean.college,
                graduateCollege: clean.graduateCollege,
                // CHILDREN - This is a String field (must be stringified)
                children: JSON.stringify(clean.children),
                // CIVIL SERVICE AND EXPERIENCE - These are Json[] fields (pass arrays directly)
                civilService: clean.civiService,
                experience: clean.experience,
                // GOV ID - This is a Json field (pass object directly)
                govId: clean.govId,
                umidNo: ((_6 = encrypted.umidNo) === null || _6 === void 0 ? void 0 : _6.encryptedData) || "N/A",
                umidNoIv: ((_7 = encrypted.umidNo) === null || _7 === void 0 ? void 0 : _7.iv) || null,
                pagIbigNo: ((_8 = encrypted.pagIbigNo) === null || _8 === void 0 ? void 0 : _8.encryptedData) || "N/A",
                pagIbigNoIv: ((_9 = encrypted.pagIbigNo) === null || _9 === void 0 ? void 0 : _9.iv) || null,
                philHealthNo: ((_10 = encrypted.philHealthNo) === null || _10 === void 0 ? void 0 : _10.encryptedData) || "N/A",
                philHealthNoIv: ((_11 = encrypted.philHealthNo) === null || _11 === void 0 ? void 0 : _11.iv) || null,
                philSys: ((_12 = encrypted.philSys) === null || _12 === void 0 ? void 0 : _12.encryptedData) || "N/A",
                philSysIv: ((_13 = encrypted.philSys) === null || _13 === void 0 ? void 0 : _13.iv) || null,
                tinNo: ((_14 = encrypted.tinNo) === null || _14 === void 0 ? void 0 : _14.encryptedData) || "N/A",
                tinNoIv: ((_15 = encrypted.tinNo) === null || _15 === void 0 ? void 0 : _15.iv) || null,
                agencyNo: ((_16 = encrypted.agencyNo) === null || _16 === void 0 ? void 0 : _16.encryptedData) || "N/A",
                agencyNoIv: ((_17 = encrypted.agencyNo) === null || _17 === void 0 ? void 0 : _17.iv) || null,
                // job linking
                lineId: inviteLink.lineId,
                positionId: formData.positionId,
                unitPositionId: inviteLink.unitPositionId,
                // REQUIRED Date
                batch: new Date(),
                status: 2,
            };
            console.log("Application Data: ", { applicationData });
            // Add profile picture relation if it exists
            if (profilePicture) {
                applicationData.applicationProfilePicId = profilePicture.id;
            }
            const application = yield tx.submittedApplication.create({
                data: applicationData,
            });
            yield tx.lineInvitation.update({
                where: {
                    id: inviteLink.id,
                },
                data: {
                    status: 1,
                    submittedApplicationId: application.id,
                },
            });
            console.log("Submitted Application: ", { application });
            // Create skill tags if they exist
            if (clean.tags && clean.tags.length > 0) {
                yield tx.applicationSkillTags.createMany({
                    data: clean.tags.map((item) => ({
                        submittedApplicationId: application.id,
                        tags: item.tag, // Handle both object and string formats
                    })),
                });
            }
            // Create attached files if they exist
            if (uploaded.length > 0) {
                yield tx.applicationAttachedFile.createMany({
                    data: uploaded.map((u) => ({
                        submittedApplicationId: application.id,
                        file_name: u.originalName,
                        file_url: u.secure_url,
                        file_url_Iv: u.public_id,
                        file_size: u.bytes.toString(),
                        file_type: 0,
                    })),
                });
            }
            return application.id;
        }));
        return res.send({
            success: true,
            applicationId: result,
            filesUploaded: uploaded.length,
            profilePictureUploaded: !!profilePicture,
        });
    }
    catch (err) {
        console.log(err);
        return res.status(500).send({
            success: false,
            message: "Failed to submit application",
            error: err instanceof Error ? err.message : "Unknown error",
        });
    }
});
exports.userDataRegister = userDataRegister;
