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
exports.vacantPosition = exports.removeUnitPosition = exports.unitPositionRecord = exports.positionApplications = exports.positionRecords = exports.submitApplication = exports.vacentPosition = exports.positionRegister = exports.positionCheckInvitation = exports.fillPositionInvite = exports.publicJobPost = exports.linePositions = exports.positionData = exports.positionSelectionList = exports.updatePosition = exports.confirmDeletePosition = exports.deletePosition = exports.createNewUnitPosition = exports.addPosition = exports.positionList = void 0;
const prisma_1 = require("../barrel/prisma");
const errors_1 = require("../errors/errors");
const argon2_1 = __importDefault(require("argon2"));
const handler_1 = require("../middleware/handler");
const encryption_1 = require("../service/encryption");
const Cloundinary_1 = __importDefault(require("../class/Cloundinary"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const frontEnd = process.env.VITE_LOCAL_FRONTEND_URL;
const positionList = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const params = req.query;
    if (!params.id)
        throw new errors_1.ValidationError("BAD_REQUEST");
    try {
        const cursor = params.lastCursor ? { id: params.lastCursor } : undefined;
        const limit = params.limit ? parseInt(params.limit, 10) : 10;
        const response = yield prisma_1.prisma.unitPosition.findMany({
            where: {
                departmentId: params.id,
            },
            cursor,
            take: limit,
            skip: cursor ? 1 : 0,
            include: {
                slot: {
                    select: {
                        id: true,
                        salaryGrade: {
                            select: {
                                grade: true,
                            },
                        },
                        occupied: true,
                    },
                },
                position: {
                    select: {
                        name: true,
                        id: true,
                        itemNumber: true,
                    },
                },
            },
        });
        console.log(JSON.stringify(response, null, 2));
        const newLastCursor = response.length > 0 ? response[response.length - 1].id : null;
        const hasMore = response.length === 10;
        return res
            .code(200)
            .send({ list: response, lastCursor: newLastCursor, hasMore });
    }
    catch (error) {
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw new errors_1.AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
        }
        throw error;
    }
});
exports.positionList = positionList;
const addPosition = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const body = req.body;
        if (!body.unitId)
            throw new errors_1.ValidationError("INVALID_OFFICE");
        const { slot, title, plantilla, description, itemNumber, unitId, lineId, userId, } = body;
        if (!slot) {
            return;
        }
        const response = yield prisma_1.prisma.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            const unit = yield tx.department.findUnique({
                where: {
                    id: body.unitId,
                },
            });
            if (!unit)
                throw new errors_1.NotFoundError("UNIT NOT FOUND!");
            const slots = yield tx.position.findFirst({
                where: {
                    name: { contains: title, mode: "insensitive" },
                },
            });
            let craetedPosition;
            let createdUnitPos;
            if (!slots) {
                craetedPosition = yield tx.position.create({
                    data: {
                        name: title,
                        plantilla: plantilla,
                        description: description,
                        lineId: lineId,
                        PositionSlot: {
                            createMany: {
                                data: slot.map((item) => ({
                                    salaryGradeId: item.salaryGrade,
                                    occupied: item.status,
                                })),
                            },
                        },
                    },
                });
                createdUnitPos = yield tx.unitPosition.create({
                    data: {
                        positionId: craetedPosition.id,
                        departmentId: body.unitId,
                        lineId: body.lineId,
                        designation: body.designation,
                        itemNumber: body.itemNumber,
                        slot: {
                            createMany: {
                                data: body.slot.map((item) => ({
                                    salaryGradeId: item.salaryGrade,
                                    occupied: item.status,
                                })),
                            },
                        },
                        plantilla: body.plantilla,
                        fixToUnit: body.exclusive,
                    },
                });
            }
            else {
                createdUnitPos = yield tx.unitPosition.create({
                    data: {
                        positionId: slots.id,
                        departmentId: body.unitId,
                        lineId: body.lineId,
                        designation: body.designation,
                        itemNumber: body.itemNumber,
                        slot: {
                            createMany: {
                                data: body.slot.map((item) => ({
                                    salaryGradeId: item.salaryGrade,
                                    occupied: item.status,
                                })),
                            },
                        },
                        plantilla: body.plantilla,
                        fixToUnit: body.exclusive,
                    },
                });
            }
            // const checkedUnitPos = await tx.unitPosition.findFirst({
            //   where: {
            //     positionId: slots
            //   }
            // })
            yield tx.humanResourcesLogs.create({
                data: {
                    tab: 7,
                    lineId: lineId,
                    action: "Added",
                    userId: userId,
                    desc: `Added new position: ${(craetedPosition === null || craetedPosition === void 0 ? void 0 : craetedPosition.name) || "N/A"} (${craetedPosition === null || craetedPosition === void 0 ? void 0 : craetedPosition.id}) to Unit ${unit.name} on Line ${body.lineId}. Created ${body.slot.length} position slot(s) with item number: ${body.itemNumber || "N/A"}.`,
                },
            });
            return "OK";
        }));
        if (response !== "OK")
            throw new errors_1.AppError("SOMETHING_WENT_WRONG", 500, "DB_ERROR");
        return res.code(200).send({ message: "OK" });
    }
    catch (error) {
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw new errors_1.AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
        }
        throw error;
    }
});
exports.addPosition = addPosition;
const createNewUnitPosition = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const body = req.body;
    if (!body.id)
        throw new errors_1.ValidationError("BAD_REQUEST");
    try {
        const optional = {};
        if (body.itemNumber) {
            optional.itemNumber = {
                contains: body.itemNumber,
                mode: "insensitive",
            };
        }
        if (body.designation) {
            optional.designation = {
                contains: body.designation,
                mode: "insensitive",
            };
        }
        const response = yield prisma_1.prisma.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            const position = yield tx.position.findUnique({
                where: {
                    id: body.id,
                },
            });
            const unit = yield tx.department.findUnique({
                where: {
                    id: body.unitId,
                },
            });
            if (!unit)
                throw new errors_1.NotFoundError("UNIT NOT FOUND!");
            if (!position)
                throw new errors_1.NotFoundError("POSITION NOT FOUND!");
            const unitPos = yield tx.unitPosition.findFirst({
                where: Object.assign({ departmentId: body.unitId, positionId: position.id }, optional),
            });
            if (unitPos)
                throw new errors_1.ValidationError("ALREADY EXIST");
            yield tx.unitPosition.create({
                data: {
                    positionId: position.id,
                    departmentId: body.unitId,
                    lineId: body.lineId,
                    designation: body.designation,
                    itemNumber: body.itemNumber,
                    slot: {
                        createMany: {
                            data: body.slot.map((item) => ({
                                salaryGradeId: item.salaryGrade,
                                occupied: item.status,
                            })),
                        },
                    },
                    plantilla: body.plantilla,
                },
            });
            yield tx.humanResourcesLogs.create({
                data: {
                    tab: 7,
                    lineId: body.lineId,
                    action: "Added",
                    userId: body.userId,
                    desc: `Added new position: ${position.name} (${position.id}) to Unit ${unit.name} on Line ${body.lineId}. Created ${body.slot.length} position slot(s) with item number: ${body.itemNumber || "N/A"}.`,
                },
            });
            return "OK";
        }));
        if (response !== "OK")
            throw new errors_1.AppError("SOMETHING_WENT_WRONG", 500, "DB_ERROR");
        return res.code(200).send({ message: "OK" });
    }
    catch (error) {
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw new errors_1.AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
        }
        throw error;
    }
});
exports.createNewUnitPosition = createNewUnitPosition;
const deletePosition = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const body = req.body;
        if (!body || !body.id) {
            return res.code(400).send({ message: "Invalid request" });
        }
        const [occupied] = yield prisma_1.prisma.$transaction([
            prisma_1.prisma.positionSlot.findMany({
                where: {
                    userId: { not: null },
                    positionId: body.id,
                },
                include: {
                    user: {
                        select: {
                            id: true,
                            firstName: true,
                            lastName: true,
                            middleName: true,
                        },
                    },
                },
            }),
        ]);
        if (occupied.length === 0) {
            yield prisma_1.prisma.$transaction([
                prisma_1.prisma.positionSlot.deleteMany({
                    where: {
                        positionId: body.id,
                    },
                }),
                prisma_1.prisma.position.delete({
                    where: {
                        id: body.id,
                    },
                }),
            ]);
            return res.code(200).send({ message: "Position deleted successfully" });
        }
        return res
            .code(400)
            .send({ message: "Position is occupied by users", occupied });
    }
    catch (error) { }
});
exports.deletePosition = deletePosition;
const confirmDeletePosition = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const body = req.body;
        if (!body || !body.id) {
            return res.code(400).send({ message: "Invalid request" });
        }
        const [slot, position] = yield prisma_1.prisma.$transaction([
            prisma_1.prisma.positionSlot.findMany({
                where: {
                    userId: { not: null },
                    positionId: body.id,
                },
            }),
            prisma_1.prisma.position.findUnique({
                where: {
                    id: body.id,
                },
            }),
        ]);
        if (slot.length === 0 || position) {
            yield prisma_1.prisma.$transaction([
                prisma_1.prisma.position.delete({
                    where: {
                        id: body.id,
                    },
                }),
                prisma_1.prisma.positionSlot.deleteMany({
                    where: {
                        positionId: body.id,
                    },
                }),
            ]);
            return res.code(200).send({
                message: "Position can be deleted",
                position: position,
            });
        }
        return res
            .code(404)
            .send({ message: "Position and slot/s not found!", slot });
    }
    catch (error) {
        console.log(error);
        return { message: "Internal Server Error" };
    }
});
exports.confirmDeletePosition = confirmDeletePosition;
const updatePosition = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const body = req.body;
        if (!body) {
            return res.code(400).send({ message: "Invalid request" });
        }
        const { id, slot, title, plantilla, description, itemNumber } = body;
        if (!id || !slot) {
            return res.code(400).send({ message: "Invalid request" });
        }
        const position = yield prisma_1.prisma.position.findUnique({
            where: { id },
        });
        if (!position) {
            return res.code(404).send({ message: "Position not found" });
        }
        yield prisma_1.prisma.$transaction([
            prisma_1.prisma.position.update({
                where: { id },
                data: {
                    name: title,
                    plantilla,
                    description,
                    itemNumber: itemNumber ? itemNumber : undefined,
                },
            }),
            prisma_1.prisma.positionSlot.deleteMany({
                where: { positionId: id },
            }),
            prisma_1.prisma.positionSlot.createMany({
                data: slot.map((item) => ({
                    positionId: id,
                    salaryGradeId: "cdbd358a-183f-458f-a5dc-d8b8db3f4fa8",
                })),
            }),
        ]);
        return res.code(200).send({ message: "Position updated successfully" });
    }
    catch (error) {
        return { message: "Internal Server Error" };
    }
});
exports.updatePosition = updatePosition;
const positionSelectionList = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const params = req.query;
    console.log({ params });
    if (!params.id)
        throw new errors_1.ValidationError("BAD_REQUEST");
    try {
        const filter = { lineId: params.id };
        if (params.query) {
            filter.position = {
                name: {
                    contains: params.query,
                    mode: "insensitive",
                },
            };
        }
        const cursor = params.lastCursor ? { id: params.lastCursor } : undefined;
        const limit = params.limit ? parseInt(params.limit, 10) : 10;
        const response = yield prisma_1.prisma.unitPosition.findMany({
            where: filter,
            cursor,
            take: limit,
            skip: cursor ? 1 : 0,
            include: {
                unit: {
                    select: {
                        name: true,
                        id: true,
                    },
                },
                position: {
                    select: {
                        name: true,
                        id: true,
                    },
                },
                _count: {
                    select: {
                        slot: {
                            where: {
                                occupied: false,
                            },
                        },
                    },
                },
            },
        });
        const newLastCursor = response.length > 0 ? response[response.length - 1].id : null;
        const hasMore = response.length === 10;
        return res
            .code(200)
            .send({ list: response, lastCursor: newLastCursor, hasMore });
    }
    catch (error) {
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw new errors_1.AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
        }
        throw error;
    }
});
exports.positionSelectionList = positionSelectionList;
const positionData = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const params = req.query;
    console.log(params);
    if (!params.id)
        throw new errors_1.ValidationError("BAD_REQUEST");
    try {
        const response = yield prisma_1.prisma.jobPost.findUnique({
            where: {
                id: params.id,
            },
            include: {
                position: {
                    select: {
                        name: true,
                        id: true,
                    },
                },
            },
        });
        if (!response)
            throw new errors_1.NotFoundError("POSITION NOT FOUND!");
        return res.code(200).send(response);
    }
    catch (error) {
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw new errors_1.AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
        }
        throw error;
    }
});
exports.positionData = positionData;
const linePositions = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const params = req.query;
    console.log(params);
    if (!params.id)
        throw new errors_1.ValidationError("BAD_REQUEST");
    try {
        const cursor = params.lastCursor ? { id: params.id } : undefined;
        const limit = params.limit ? parseInt(params.limit, 10) : 20;
        const filter = {
            lineId: params.id,
        };
        if (params.query) {
            filter.name = {
                contains: params.query,
                mode: "insensitive",
            };
        }
        const response = yield prisma_1.prisma.position.findMany({
            where: Object.assign({}, filter),
            skip: cursor ? 1 : 0,
            take: limit,
            orderBy: {
                name: "desc",
            },
            include: {
                PositionSlot: {
                    select: {
                        id: true,
                        salaryGrade: {
                            select: {
                                grade: true,
                            },
                        },
                    },
                },
            },
        });
        console.log({ response });
        const newLastCursorId = response.length > 0 ? response[response.length - 1].id : null;
        const hasMore = response.length === limit;
        return res
            .code(200)
            .send({ list: response, hasMore, lastCursor: newLastCursorId });
    }
    catch (error) {
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw new errors_1.AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
        }
        throw error;
    }
});
exports.linePositions = linePositions;
const publicJobPost = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const params = req.query;
    console.log({ params });
    if (!params.id)
        throw new errors_1.ValidationError("INVALID REQUIRED ID");
    try {
        const response = yield prisma_1.prisma.jobPost.findUnique({
            where: {
                id: params.id,
            },
            include: {
                position: {
                    select: {
                        id: true,
                        name: true,
                    },
                },
            },
        });
        if (!response)
            throw new errors_1.NotFoundError("JOB POST NOT FOUND!");
        return res.code(200).send(response);
    }
    catch (error) {
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw new errors_1.AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
        }
        throw error;
    }
});
exports.publicJobPost = publicJobPost;
const fillPositionInvite = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const body = req.body;
    console.log({ body });
    if (!body.email || !body.lineId || !frontEnd) {
        throw new errors_1.ValidationError("INVALID REQUIRED FIELDS");
    }
    try {
        const response = yield prisma_1.prisma.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            const line = yield tx.line.findUnique({
                where: {
                    id: body.lineId,
                },
            });
            const position = yield tx.unitPosition.findUnique({
                where: {
                    id: body.unitPositionId,
                },
                select: {
                    id: true,
                    position: {
                        select: {
                            name: true,
                        },
                    },
                },
            });
            if (!line || !position)
                throw new errors_1.ValidationError("INVALID LINE");
            const [municipal, province] = yield Promise.all([
                (0, handler_1.getAreaData)(line.municipalId, 1),
                (0, handler_1.getAreaData)(line.provinceId, 0),
            ]);
            if (!municipal || !province) {
                throw new errors_1.ValidationError("INVALID AREA DATA");
            }
            const optional = {};
            if (body.message) {
                optional.message = body.message;
            }
            const link = yield tx.fillPositionInvitation.create({
                data: {
                    email: body.email,
                    lineId: body.lineId,
                    unitPositionId: body.unitPositionId,
                    positionSlotId: body.slotId,
                },
            });
            yield tx.humanResourcesLogs.create({
                data: {
                    action: "ADD",
                    desc: `FILL POSITION (Invite -> email: ${body.email})`,
                    lineId: body.lineId,
                    userId: body.userId,
                },
            });
            yield (0, handler_1.sendEmail)(`Registration Invitation for ${municipal.name} Portal Position: ${position.position.name}`, body.email, `
  Good day,

  You are invited to register and create an account on the Gasan Portal.

  Please click the link below to proceed with your registration:
  ${frontEnd}position/register/${link.id}

  Best regards,
  Human Resource Management Office (HRMO)
  ${municipal.name}, ${province.name}
  `, "");
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
exports.fillPositionInvite = fillPositionInvite;
const positionCheckInvitation = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const body = req.query;
    if (!body.id) {
        throw new errors_1.ValidationError("INVALID REQUIRED ID");
    }
    try {
        const response = yield prisma_1.prisma.fillPositionInvitation.findUnique({
            where: {
                id: body.id,
            },
            include: {
                unitPoistion: {
                    select: {
                        id: true,
                        position: {
                            select: {
                                id: true,
                                name: true,
                            },
                        },
                    },
                },
            },
        });
        if (!response) {
            throw new errors_1.NotFoundError("LINK NOT FOUND");
        }
        const invitationDate = new Date(response.timestamp);
        const currentDate = new Date();
        // Calculate the difference in days
        const timeDifference = currentDate.getTime() - invitationDate.getTime();
        const daysDifference = timeDifference / (1000 * 3600 * 24);
        // Check if 3 or more days have passed
        if (daysDifference >= 3) {
            throw new errors_1.ValidationError("INVITATION LINK HAS EXPIRED");
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
exports.positionCheckInvitation = positionCheckInvitation;
const positionRegister = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const body = req.body;
    console.log({ body });
    if (!body.lineId ||
        !body.password ||
        !body.username ||
        !body.slotId ||
        !body.applicationId ||
        !body.linkId) {
        throw new errors_1.ValidationError("INVALID REQUIRED DATA");
    }
    try {
        const response = yield prisma_1.prisma.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            var _a, _b;
            const slot = yield tx.positionSlot.findUnique({
                where: {
                    id: body.slotId,
                },
                select: {
                    id: true,
                    positionId: true,
                    unitPosition: {
                        select: {
                            departmentId: true,
                            position: {
                                select: {
                                    name: true,
                                },
                            },
                        },
                    },
                    occupied: true,
                    userId: true,
                },
            });
            const application = yield tx.submittedApplication.findUnique({
                where: {
                    id: body.applicationId,
                },
            });
            if (!slot) {
                throw new errors_1.ValidationError("SLOT NOT FOUND");
            }
            if (slot.userId) {
                throw new errors_1.ValidationError("ALREADY OCCUPIED");
            }
            if (!application) {
                throw new errors_1.ValidationError("APPLICATION NOT FOUND");
            }
            const hashedPassword = yield argon2_1.default.hash(body.password);
            const account = yield tx.account.create({
                data: {
                    username: body.username,
                    password: hashedPassword,
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
                    phoneNumber: application.mobileNo,
                    phoneNumberIv: application.ivMobileNo,
                },
            });
            yield tx.submittedApplication.update({
                where: {
                    id: body.applicationId,
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
            yield tx.notification.create({
                data: {
                    recipientId: user.id,
                    title: "Welcome to the Portal!",
                    content: `Welcome ${body.firstname} ${body.lastname}! You have been successfully registered as the ${((_b = slot.unitPosition) === null || _b === void 0 ? void 0 : _b.position.name) || "Unknown"}. Your username is: ${body.username}. You now have full access to the Human Resources module.`,
                    senderId: user.id,
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
        console.log(error);
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw new errors_1.AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
        }
        throw error;
    }
});
exports.positionRegister = positionRegister;
const vacentPosition = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const body = req.body;
    if (!body.lineId || !body.slotId || !body.userId) {
        throw new errors_1.ValidationError("INVALID REQUIRED ID");
    }
    try {
        const response = yield prisma_1.prisma.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            var _a;
            const slot = yield tx.positionSlot.update({
                where: {
                    id: body.slotId,
                },
                data: {
                    occupied: false,
                    userId: null,
                },
                include: {
                    pos: {
                        select: {
                            name: true,
                        },
                    },
                },
            });
            const user = yield tx.user.update({
                where: {
                    id: body.slotUserId,
                },
                data: {
                    departmentId: null,
                    positionId: null,
                    salaryGradeId: null,
                },
            });
            yield tx.humanResourcesLogs.create({
                data: {
                    userId: body.userId,
                    action: "UPDATE",
                    desc: `UPDATE POSITION SLOT: Vacant ${(_a = slot.pos) === null || _a === void 0 ? void 0 : _a.name}'s position slot'`,
                    lineId: body.lineId,
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
exports.vacentPosition = vacentPosition;
const submitApplication = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
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
        const inviteLink = yield prisma_1.prisma.fillPositionInvitation.findUnique({
            where: {
                id: formData.positionInviteLinkId,
            },
            select: {
                positionSlotId: true,
                id: true,
                unitPositionId: true,
                lineId: true,
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
            yield tx.fillPositionInvitation.update({
                where: {
                    id: inviteLink.id,
                },
                data: {
                    step: 1,
                    submittedApplicationId: application.id,
                    concluded: true,
                    concludedAt: new Date().toISOString(),
                },
            });
            yield tx.fillPositionInvitation.update({
                data: {
                    step: 1,
                },
                where: {
                    id: inviteLink.id,
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
exports.submitApplication = submitApplication;
const positionRecords = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const params = req.query;
    if (!params.id) {
        throw new errors_1.ValidationError("INVALID REQUIRED ID");
    }
    try {
        const response = yield prisma_1.prisma.unitPosition.findUnique({
            where: {
                id: params.id,
            },
            include: {
                position: {
                    select: {
                        name: true,
                        id: true,
                    },
                },
                unit: {
                    select: {
                        name: true,
                    },
                },
                _count: {
                    select: {
                        slot: true,
                        submittedApplications: true,
                    },
                },
            },
        });
        if (!response) {
            throw new errors_1.NotFoundError("UNIT POSITION NOT FOUND");
        }
        return res.code(200).send(response);
    }
    catch (error) {
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw new errors_1.AppError("Database operation failed", 500, "DB_ERROR");
        }
        throw error;
    }
});
exports.positionRecords = positionRecords;
const positionApplications = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const params = req.query;
    if (!params.id) {
        throw new errors_1.ValidationError("INVALID REQUIRED ID");
    }
    try {
        const cursor = params.lastCursor ? { id: params.lastCursor } : undefined;
        const limit = params.limit ? parseInt(params.limit, 10) : 20;
        const response = yield prisma_1.prisma.submittedApplication.findMany({
            where: {
                unitPositionId: params.id,
            },
            cursor,
            skip: cursor ? 1 : 0,
            take: limit,
            orderBy: {
                timestamp: "desc",
            },
        });
        const newLastCursorId = response.length > 0 ? response[response.length - 1].id : null;
        const hasMore = response.length === limit;
        return res
            .code(200)
            .send({ list: response, lastCursor: newLastCursorId, hasMore });
    }
    catch (error) {
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw new errors_1.AppError("Database operation failed", 500, "DB_ERROR");
        }
        throw error;
    }
});
exports.positionApplications = positionApplications;
const unitPositionRecord = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const params = req.query;
    if (!params.id) {
        throw new errors_1.ValidationError("INVALID REQUIRED ID");
    }
    try {
        const cursor = params.lastCursor ? { id: params.lastCursor } : undefined;
        const limit = params.limit ? parseInt(params.limit, 10) : 20;
        const response = yield prisma_1.prisma.unitPositionHistory.findMany({
            where: {
                unitPositionId: params.id,
            },
            include: {
                user: {
                    select: {
                        firstName: true,
                        lastName: true,
                    },
                },
            },
            cursor,
            skip: cursor ? 1 : 0,
            take: limit,
            orderBy: {
                timestamp: "desc",
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
            throw new errors_1.AppError("Database operation failed", 500, "DB_ERROR");
        }
        throw error;
    }
});
exports.unitPositionRecord = unitPositionRecord;
const removeUnitPosition = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const params = req.query;
    if (!params.id || !params.userId || !params.lineId) {
        throw new errors_1.ValidationError("INVALID REQUIRED ID");
    }
    try {
        yield prisma_1.prisma.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            yield tx.unitPosition.delete({
                where: {
                    id: params.id,
                },
            });
            yield tx.medicineLogs.create({
                data: {
                    action: 4,
                    message: `Removed unit position with ID ${params.id}`,
                    userId: params.userId,
                    lineId: params.lineId,
                },
            });
        }));
        return res
            .code(200)
            .send({ message: "Unit position removed successfully" });
    }
    catch (error) {
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw new errors_1.AppError("Database operation failed", 500, "DB_ERROR");
        }
        throw error;
    }
});
exports.removeUnitPosition = removeUnitPosition;
const vacantPosition = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const body = req.body;
});
exports.vacantPosition = vacantPosition;
