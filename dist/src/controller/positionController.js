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
exports.updateUnitPosition = exports.removeUnitPosition = exports.unitPositionRecord = exports.positionApplications = exports.positionRecords = exports.submitApplication = exports.vacantPosition = exports.positionQuickRegister = exports.claimSlot = exports.resolveVacantSlot = exports.positionRegister = exports.positionCheckInvitation = exports.cancelPositionInvitation = exports.listPositionInvitations = exports.inviteFromApplication = exports.fillPositionInvite = exports.publicJobPost = exports.linePositions = exports.positionData = exports.positionSelectionList = exports.updatePosition = exports.confirmDeletePosition = exports.deletePosition = exports.createNewUnitPosition = exports.addPosition = exports.positionList = void 0;
const prisma_1 = require("../barrel/prisma");
const errors_1 = require("../errors/errors");
const argon2_1 = __importDefault(require("argon2"));
const handler_1 = require("../middleware/handler");
const notificationEvents_1 = require("../service/notificationEvents");
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
                        // Occupant info so the Vacant flow can list filled slots with
                        // the person currently sitting in each one.
                        userId: true,
                        user: {
                            select: {
                                id: true,
                                firstName: true,
                                lastName: true,
                                accountId: true,
                            },
                        },
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
            throw (0, errors_1.dbError)(error);
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
        if (!slot || slot.length === 0) {
            throw new errors_1.ValidationError("Add at least one position slot.");
        }
        // Validate the salary grade on EVERY slot up front. The web form defaults a
        // slot's salaryGrade to a placeholder ("1"), not a real id — if it isn't
        // changed, that placeholder lands in the `salaryGradeId` foreign key and the
        // whole create fails with an opaque 500. Catch it here with a clear message.
        const gradeIds = slot.map((s) => s.salaryGrade).filter(Boolean);
        if (gradeIds.length !== slot.length) {
            throw new errors_1.ValidationError("Choose a salary grade for every slot.");
        }
        const validGrades = yield prisma_1.prisma.salaryGrade.findMany({
            where: { id: { in: gradeIds } },
            select: { id: true },
        });
        const validSet = new Set(validGrades.map((g) => g.id));
        if (slot.some((s) => !validSet.has(s.salaryGrade))) {
            throw new errors_1.ValidationError("One of the selected salary grades doesn't exist. Re-pick the salary grade for each slot.");
        }
        const unit = yield prisma_1.prisma.department.findUnique({
            where: { id: body.unitId },
            select: { id: true, name: true },
        });
        if (!unit)
            throw new errors_1.NotFoundError("UNIT NOT FOUND!");
        const response = yield prisma_1.prisma.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            var _a, _b, _c;
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
            return {
                name: (_a = craetedPosition === null || craetedPosition === void 0 ? void 0 : craetedPosition.name) !== null && _a !== void 0 ? _a : title,
                id: (_c = (_b = craetedPosition === null || craetedPosition === void 0 ? void 0 : craetedPosition.id) !== null && _b !== void 0 ? _b : slots === null || slots === void 0 ? void 0 : slots.id) !== null && _c !== void 0 ? _c : null,
            };
        }));
        // Audit is best-effort and OUTSIDE the transaction, so a logging failure can
        // never roll back the position that was just created.
        try {
            yield prisma_1.prisma.humanResourcesLogs.create({
                data: {
                    tab: 7,
                    lineId: lineId,
                    action: "Added",
                    userId: userId,
                    desc: `Added new position: ${response.name} (${response.id}) to Unit ` +
                        `${unit.name} on Line ${body.lineId}. Created ${body.slot.length} ` +
                        `position slot(s) with item number: ${body.itemNumber || "N/A"}.`,
                },
            });
        }
        catch (e) {
            console.warn("[addPosition] audit log skipped:", e);
        }
        return res.code(200).send({ message: "OK" });
    }
    catch (error) {
        if (error instanceof errors_1.ValidationError || error instanceof errors_1.NotFoundError)
            throw error;
        throw (0, errors_1.dbError)(error, "add position");
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
            throw (0, errors_1.dbError)(error);
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
            throw (0, errors_1.dbError)(error);
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
            throw (0, errors_1.dbError)(error);
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
            throw (0, errors_1.dbError)(error);
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
            throw (0, errors_1.dbError)(error);
        }
        throw error;
    }
});
exports.publicJobPost = publicJobPost;
// Default invitation lifetime — long enough for an applicant to schedule
// a registration session, short enough that HR can re-send if it lapses.
const INVITE_TTL_DAYS = 7;
const isValidEmail = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
/**
 * Send a Fill Position invitation.
 *
 * What this enforces (the legacy version skipped most of these and was
 * easy to misuse from the dashboard):
 *
 *   1. The target slot belongs to the named unitPosition.
 *   2. The slot is still VACANT — can't invite into an occupied chair.
 *   3. No active (non-concluded, non-expired) invite already exists for
 *      the same email + slot — prevents accidental duplicate emails.
 *   4. Email is syntactically valid.
 *   5. The persisted row carries `message`, `expiresAt`, and the canonical
 *      front-end origin so the registration link is reconstructable.
 *   6. HR logs the action with the slot id for traceability.
 */
const fillPositionInvite = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    const body = req.body;
    if (!body.email ||
        !body.lineId ||
        !body.unitPositionId ||
        !body.slotId ||
        !body.userId) {
        throw new errors_1.ValidationError("INVALID REQUIRED FIELDS");
    }
    if (!isValidEmail(body.email)) {
        throw new errors_1.ValidationError("Email address is not valid.");
    }
    if (!frontEnd) {
        throw new errors_1.ValidationError("Server misconfigured: FRONTEND_URL is not set.");
    }
    try {
        const result = yield prisma_1.prisma.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            var _a;
            // 1 + 2: slot must belong to this unitPosition and be vacant.
            const slot = yield tx.positionSlot.findUnique({
                where: { id: body.slotId },
                select: {
                    id: true,
                    occupied: true,
                    unitPositionId: true,
                    userId: true,
                    salaryGrade: { select: { grade: true, amount: true } },
                },
            });
            if (!slot || slot.unitPositionId !== body.unitPositionId) {
                throw new errors_1.ValidationError("Slot does not belong to this position.");
            }
            if (slot.occupied || !!slot.userId) {
                throw new errors_1.ValidationError("That slot is already filled.");
            }
            // 3: block duplicate active invites for the same email + slot.
            const now = new Date();
            const existingActive = yield tx.fillPositionInvitation.findFirst({
                where: {
                    email: body.email,
                    positionSlotId: body.slotId,
                    concluded: false,
                    OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
                },
            });
            if (existingActive) {
                throw new errors_1.ValidationError("An active invitation already exists for this email + slot. Cancel it first or wait for it to expire.");
            }
            const [line, position] = yield Promise.all([
                tx.line.findUnique({ where: { id: body.lineId } }),
                tx.unitPosition.findUnique({
                    where: { id: body.unitPositionId },
                    select: { id: true, position: { select: { name: true } } },
                }),
            ]);
            if (!line || !position)
                throw new errors_1.ValidationError("INVALID LINE");
            const [municipal, province] = yield Promise.all([
                (0, handler_1.getAreaData)(line.municipalId, 1),
                (0, handler_1.getAreaData)(line.provinceId, 0),
            ]);
            if (!municipal || !province) {
                throw new errors_1.ValidationError("INVALID AREA DATA");
            }
            const expiresAt = new Date(now.getTime() + INVITE_TTL_DAYS * 86400000);
            const link = yield tx.fillPositionInvitation.create({
                data: {
                    email: body.email,
                    message: ((_a = body.message) === null || _a === void 0 ? void 0 : _a.trim()) || null,
                    lineId: body.lineId,
                    unitPositionId: body.unitPositionId,
                    positionSlotId: body.slotId,
                    expiresAt,
                    mode: body.mode === "quick" ? "quick" : "full",
                },
            });
            yield tx.humanResourcesLogs.create({
                data: {
                    action: "ADD",
                    desc: `FILL POSITION (Invite -> email: ${body.email}, slot: ${body.slotId})`,
                    lineId: body.lineId,
                    userId: body.userId,
                },
            });
            return { link, municipal, province, position };
        }));
        // Email is fire-and-forget: a transient SMTP failure shouldn't roll
        // back the invitation row (HR can re-send from the dashboard).
        const personalMsg = ((_a = body.message) === null || _a === void 0 ? void 0 : _a.trim())
            ? `\n\nMessage from HR:\n${body.message.trim()}\n`
            : "";
        (0, handler_1.sendEmail)(`Registration Invitation for ${result.municipal.name} Portal Position: ${result.position.position.name}`, body.email, `
Good day,

You are invited to register and create an account on the Gasan Portal
for the position of ${result.position.position.name}.

Please click the link below to proceed with your registration. This
invitation expires on ${(_b = result.link.expiresAt) === null || _b === void 0 ? void 0 : _b.toLocaleString()}.

${frontEnd}/position/register/${result.link.id}
${personalMsg}
Best regards,
Human Resource Management Office (HRMO)
${result.municipal.name}, ${result.province.name}
`, "").catch((e) => console.warn("[fillPositionInvite] email send failed", e));
        return res.code(200).send({
            message: "OK",
            invitation: {
                id: result.link.id,
                email: result.link.email,
                expiresAt: result.link.expiresAt,
                slotId: result.link.positionSlotId,
            },
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
exports.fillPositionInvite = fillPositionInvite;
/**
 * Variant of fillPositionInvite that picks the recipient from an existing
 * SubmittedApplication instead of asking HR to type the email by hand.
 *
 * Why a separate endpoint instead of overloading fillPositionInvite:
 *   - the source-of-truth email lives encrypted on SubmittedApplication
 *     so the server has to decrypt it here (the dashboard never sees
 *     plaintext)
 *   - we link the invitation back to the source application via
 *     `submittedApplicationId`, which makes accept-link landing pages
 *     able to pre-fill the candidate's data
 *
 * Validation:
 *   - slot must belong to the named unitPosition and be vacant
 *   - application must exist and belong to the same line
 *   - dedupe by (resolved email + slot) so we don't spam the same person
 */
const inviteFromApplication = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    const body = req.body;
    if (!body.applicationId ||
        !body.slotId ||
        !body.unitPositionId ||
        !body.userId ||
        !body.lineId) {
        throw new errors_1.ValidationError("INVALID REQUIRED FIELDS");
    }
    if (!frontEnd) {
        throw new errors_1.ValidationError("Server misconfigured: FRONTEND_URL is not set.");
    }
    try {
        const result = yield prisma_1.prisma.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            var _a, _b;
            // 1. Slot must belong to this UnitPosition and be vacant.
            const slot = yield tx.positionSlot.findUnique({
                where: { id: body.slotId },
                select: {
                    id: true,
                    occupied: true,
                    unitPositionId: true,
                    userId: true,
                },
            });
            if (!slot || slot.unitPositionId !== body.unitPositionId) {
                throw new errors_1.ValidationError("Slot does not belong to this position.");
            }
            if (slot.occupied || !!slot.userId) {
                throw new errors_1.ValidationError("That slot is already filled.");
            }
            // 2. Application must exist and belong to the line, AND be eligible
            //    (no userId set, and any prior invite must be concluded as
            //    cancelled/expired — accepted/live invites can't be reused).
            const application = yield tx.submittedApplication.findUnique({
                where: { id: body.applicationId },
                select: {
                    id: true,
                    lineId: true,
                    firstname: true,
                    lastname: true,
                    email: true,
                    emailIv: true,
                    userId: true,
                    fillPositionInvitations: {
                        select: {
                            id: true,
                            concluded: true,
                            concludedReason: true,
                            expiresAt: true,
                        },
                    },
                },
            });
            if (!application)
                throw new errors_1.NotFoundError("Application not found.");
            if (application.lineId !== body.lineId) {
                throw new errors_1.ValidationError("Application is not in this line.");
            }
            if (application.userId) {
                throw new errors_1.ValidationError("This applicant has already completed registration.");
            }
            const prevInv = application.fillPositionInvitations;
            if (prevInv) {
                const prevExpired = !!(prevInv.expiresAt &&
                    new Date(prevInv.expiresAt).getTime() < Date.now());
                const reusable = prevInv.concluded &&
                    (prevInv.concludedReason === "cancelled" ||
                        prevInv.concludedReason === "expired" ||
                        prevExpired);
                if (!reusable) {
                    throw new errors_1.ValidationError(prevInv.concluded
                        ? "This application was already accepted — pick a different applicant."
                        : "This application already has a live invitation — cancel it first.");
                }
            }
            // 3. Decrypt the applicant's email so we can dedupe + send.
            let plainEmail = null;
            if (application.email && application.emailIv) {
                try {
                    plainEmail = yield encryption_1.EncryptionService.decrypt(application.email, application.emailIv);
                }
                catch (e) {
                    console.warn("[inviteFromApplication] failed to decrypt email", e);
                }
            }
            if (!plainEmail) {
                throw new errors_1.ValidationError("Couldn't read the applicant's email address.");
            }
            // 4. Block duplicate active invites for the same email + slot.
            const now = new Date();
            const existingActive = yield tx.fillPositionInvitation.findFirst({
                where: {
                    email: plainEmail,
                    positionSlotId: body.slotId,
                    concluded: false,
                    OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
                },
            });
            if (existingActive) {
                throw new errors_1.ValidationError("An active invitation already exists for this applicant + slot.");
            }
            // 5. Look up the line + area so we can address the email.
            const [line, position] = yield Promise.all([
                tx.line.findUnique({ where: { id: body.lineId } }),
                tx.unitPosition.findUnique({
                    where: { id: body.unitPositionId },
                    select: { id: true, position: { select: { name: true } } },
                }),
            ]);
            if (!line || !position)
                throw new errors_1.ValidationError("INVALID LINE");
            const [municipal, province] = yield Promise.all([
                (0, handler_1.getAreaData)(line.municipalId, 1),
                (0, handler_1.getAreaData)(line.provinceId, 0),
            ]);
            if (!municipal || !province) {
                throw new errors_1.ValidationError("INVALID AREA DATA");
            }
            const expiresAt = new Date(now.getTime() + INVITE_TTL_DAYS * 86400000);
            const link = yield tx.fillPositionInvitation.create({
                data: {
                    email: plainEmail,
                    message: ((_a = body.message) === null || _a === void 0 ? void 0 : _a.trim()) || null,
                    lineId: body.lineId,
                    unitPositionId: body.unitPositionId,
                    positionSlotId: body.slotId,
                    submittedApplicationId: body.applicationId,
                    expiresAt,
                    empType: ((_b = body.empType) === null || _b === void 0 ? void 0 : _b.trim()) || null,
                    term: body.term ? new Date(body.term) : null,
                },
            });
            yield tx.humanResourcesLogs.create({
                data: {
                    action: "ADD",
                    desc: `FILL POSITION (from application) -> applicant: ${application.firstname} ${application.lastname} (${plainEmail}), slot: ${body.slotId}`,
                    lineId: body.lineId,
                    userId: body.userId,
                },
            });
            return {
                link,
                plainEmail,
                applicant: application,
                line,
                municipal,
                province,
                position,
            };
        }));
        // Email — fire-and-forget.
        const personalMsg = ((_a = body.message) === null || _a === void 0 ? void 0 : _a.trim())
            ? `\n\nMessage from HR:\n${body.message.trim()}\n`
            : "";
        (0, handler_1.sendEmail)(`Registration Invitation for ${result.municipal.name} Portal Position: ${result.position.position.name}`, result.plainEmail, `
Good day ${result.applicant.firstname},

Based on your submitted application, you are invited to register and
create an account on the Gasan Portal for the position of
${result.position.position.name}.

Please click the link below to proceed with your registration. This
invitation expires on ${(_b = result.link.expiresAt) === null || _b === void 0 ? void 0 : _b.toLocaleString()}.

${frontEnd}/position/register/${result.link.id}
${personalMsg}
Best regards,
Human Resource Management Office (HRMO)
${result.municipal.name}, ${result.province.name}
`, "").catch((e) => console.warn("[inviteFromApplication] email send failed", e));
        return res.code(200).send({
            message: "OK",
            invitation: {
                id: result.link.id,
                email: result.link.email,
                expiresAt: result.link.expiresAt,
                slotId: result.link.positionSlotId,
                applicantName: `${result.applicant.firstname} ${result.applicant.lastname}`,
            },
        });
    }
    catch (error) {
        if (error instanceof errors_1.ValidationError)
            throw error;
        if (error instanceof errors_1.NotFoundError)
            throw error;
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw (0, errors_1.dbError)(error);
        }
        throw error;
    }
});
exports.inviteFromApplication = inviteFromApplication;
/**
 * List invitations for a given unitPosition (or for a specific slot).
 * Used by the Fill Position modal so HR can see who's already been
 * invited and avoid spamming candidates.
 */
const listPositionInvitations = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    const params = req.query;
    if (!params.unitPositionId && !params.slotId) {
        throw new errors_1.ValidationError("Either unitPositionId or slotId is required.");
    }
    const now = new Date();
    const where = {};
    if (params.unitPositionId)
        where.unitPositionId = params.unitPositionId;
    if (params.slotId)
        where.positionSlotId = params.slotId;
    if (((_a = params.status) !== null && _a !== void 0 ? _a : "active") === "active") {
        where.concluded = false;
        where.OR = [{ expiresAt: null }, { expiresAt: { gt: now } }];
    }
    try {
        const rows = yield prisma_1.prisma.fillPositionInvitation.findMany({
            where,
            orderBy: { timestamp: "desc" },
            select: {
                id: true,
                email: true,
                message: true,
                timestamp: true,
                expiresAt: true,
                concluded: true,
                concludedAt: true,
                concludedReason: true,
                positionSlotId: true,
                slot: {
                    select: {
                        id: true,
                        occupied: true,
                        salaryGrade: { select: { grade: true } },
                    },
                },
                submittedApplicationId: true,
            },
        });
        // Tag rows whose expiresAt has already passed but were never marked
        // concluded — keeps the dashboard counts honest without an extra job.
        const decorated = rows.map((r) => {
            var _a;
            const expired = !r.concluded && r.expiresAt && r.expiresAt.getTime() <= now.getTime();
            const status = r.concluded
                ? ((_a = r.concludedReason) !== null && _a !== void 0 ? _a : "concluded")
                : expired
                    ? "expired"
                    : "pending";
            return Object.assign(Object.assign({}, r), { status, isExpired: !!expired });
        });
        return res.code(200).send({ list: decorated });
    }
    catch (error) {
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw (0, errors_1.dbError)(error);
        }
        throw error;
    }
});
exports.listPositionInvitations = listPositionInvitations;
/**
 * Cancel (soft-conclude) a pending invitation. Safe no-op if already
 * concluded.
 */
const cancelPositionInvitation = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const body = req.body;
    if (!body.id || !body.userId || !body.lineId) {
        throw new errors_1.ValidationError("INVALID REQUIRED FIELDS");
    }
    try {
        const updated = yield prisma_1.prisma.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            const row = yield tx.fillPositionInvitation.findUnique({
                where: { id: body.id },
                select: { id: true, concluded: true, email: true, lineId: true },
            });
            if (!row)
                throw new errors_1.NotFoundError("Invitation not found");
            if (row.lineId !== body.lineId) {
                throw new errors_1.ValidationError("Line mismatch.");
            }
            if (row.concluded)
                return row;
            const out = yield tx.fillPositionInvitation.update({
                where: { id: body.id },
                data: {
                    concluded: true,
                    concludedAt: new Date(),
                    concludedReason: "cancelled",
                    // Release the @unique link on submittedApplicationId so the
                    // same application can be picked again from the picker page.
                    // The cancelled row stays in history with its email, the rest
                    // of its metadata, and a `null` submittedApplicationId.
                    submittedApplicationId: null,
                },
            });
            yield tx.humanResourcesLogs.create({
                data: {
                    action: "DELETE",
                    desc: `CANCEL FILL POSITION INVITE -> email: ${row.email}`,
                    lineId: body.lineId,
                    userId: body.userId,
                },
            });
            return out;
        }));
        return res.code(200).send({ ok: true, id: updated.id });
    }
    catch (error) {
        if (error instanceof errors_1.ValidationError)
            throw error;
        if (error instanceof errors_1.NotFoundError)
            throw error;
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw (0, errors_1.dbError)(error);
        }
        throw error;
    }
});
exports.cancelPositionInvitation = cancelPositionInvitation;
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
                provisionalPosition: {
                    select: {
                        id: true,
                        title: true,
                        empType: true,
                        termMonths: true,
                    },
                },
                department: { select: { id: true, name: true } },
            },
        });
        if (!response) {
            throw new errors_1.NotFoundError("LINK NOT FOUND");
        }
        // One-time link: once registration completed (concluded = accepted), the
        // link is dead — surface that to the register page instead of loading it.
        if (response.concluded) {
            throw new errors_1.ValidationError(response.concludedReason === "accepted"
                ? "This registration link has already been used."
                : "This invitation link is no longer active.");
        }
        const currentDate = new Date();
        // Provisional invites carry an explicit `expiresAt` (7 days). Fall back to
        // the legacy 3-days-from-`timestamp` rule for older plantilla invites.
        if (response.expiresAt) {
            if (currentDate > new Date(response.expiresAt)) {
                throw new errors_1.ValidationError("INVITATION LINK HAS EXPIRED");
            }
        }
        else {
            const invitationDate = new Date(response.timestamp);
            const daysDifference = (currentDate.getTime() - invitationDate.getTime()) / (1000 * 3600 * 24);
            if (daysDifference >= 3) {
                throw new errors_1.ValidationError("INVITATION LINK HAS EXPIRED");
            }
        }
        return res.code(200).send(response);
    }
    catch (error) {
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw (0, errors_1.dbError)(error);
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
        !body.applicationId ||
        !body.linkId) {
        throw new errors_1.ValidationError("INVALID REQUIRED DATA");
    }
    try {
        const response = yield prisma_1.prisma.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s, _t, _u, _v, _w, _x, _y;
            // Load the invitation first: provisional (temp/contract) invites have no
            // PositionSlot and take a different create path — status = empType, term
            // computed from the ProvisionalPosition's termMonths, unit from the invite.
            const invite = yield tx.fillPositionInvitation.findUnique({
                where: { id: body.linkId },
                select: {
                    concluded: true,
                    concludedReason: true,
                    empType: true,
                    term: true,
                    mode: true,
                    provisionalPositionId: true,
                    departmentId: true,
                    unitPositionId: true,
                    provisionalPosition: {
                        select: { empType: true, termMonths: true, salaryGradeId: true },
                    },
                },
            });
            // One-time link: once a registration has completed, the invite is
            // concluded — block any reuse (double-submit, shared link, etc.).
            if (invite === null || invite === void 0 ? void 0 : invite.concluded) {
                throw new errors_1.ValidationError("This registration link has already been used.");
            }
            // Quick invites belong to the essentials-only endpoint — refuse them
            // here so a mixed-up client can't register a quick invite without the
            // quick flow's guarantees.
            if ((invite === null || invite === void 0 ? void 0 : invite.mode) === "quick") {
                throw new errors_1.ValidationError("This is a quick-registration link — open it in the browser and use the quick form.");
            }
            const application = yield tx.submittedApplication.findUnique({
                where: {
                    id: body.applicationId,
                },
            });
            if (!application) {
                throw new errors_1.ValidationError("APPLICATION NOT FOUND");
            }
            // ---- Provisional hire: no plantilla slot ----
            if (invite === null || invite === void 0 ? void 0 : invite.provisionalPositionId) {
                const empStatus = ((_b = (_a = invite.provisionalPosition) === null || _a === void 0 ? void 0 : _a.empType) === null || _b === void 0 ? void 0 : _b.trim()) ||
                    ((_c = invite.empType) === null || _c === void 0 ? void 0 : _c.trim()) ||
                    "Provisional";
                const months = (_e = (_d = invite.provisionalPosition) === null || _d === void 0 ? void 0 : _d.termMonths) !== null && _e !== void 0 ? _e : 0;
                let empTerm = (_f = invite.term) !== null && _f !== void 0 ? _f : null;
                if (months > 0) {
                    empTerm = new Date();
                    empTerm.setMonth(empTerm.getMonth() + months);
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
                    data: Object.assign(Object.assign(Object.assign({ firstName: application.firstname, lastName: application.lastname, username: account.username, accountId: account.id, email: application.email, emailIv: application.emailIv, lineId: body.lineId, departmentId: (_g = invite.departmentId) !== null && _g !== void 0 ? _g : null, status: empStatus }, (empTerm ? { term: empTerm } : {})), (((_h = invite.provisionalPosition) === null || _h === void 0 ? void 0 : _h.salaryGradeId)
                        ? { salaryGradeId: invite.provisionalPosition.salaryGradeId }
                        : {})), { phoneNumber: application.mobileNo, phoneNumberIv: application.ivMobileNo }),
                });
                yield tx.submittedApplication.update({
                    where: { id: body.applicationId },
                    data: { userId: user.id },
                });
                // ATOMIC single-use claim: only succeeds if the link is still
                // unused — two simultaneous submits can never both register.
                const claimedInv = yield tx.fillPositionInvitation.updateMany({
                    where: { id: body.linkId, concluded: false },
                    data: {
                        concluded: true,
                        concludedAt: new Date(),
                        concludedReason: "accepted",
                        step: 1,
                    },
                });
                if (claimedInv.count === 0)
                    throw new errors_1.ValidationError("This invitation link has already been used.");
                const provName = [application.firstname, application.lastname]
                    .filter(Boolean)
                    .join(" ")
                    .trim();
                yield (0, notificationEvents_1.createUserNotification)(tx, {
                    recipientId: user.id,
                    title: "Welcome to the Portal!",
                    content: `Welcome ${provName || body.username}! You have been registered as ${empStatus}${empTerm ? ` (until ${empTerm.toLocaleDateString()})` : ""}. Your username is: ${body.username}.`,
                    senderId: null,
                });
                return true;
            }
            // ---- Plantilla hire: requires a PositionSlot ----
            if (!body.slotId) {
                throw new errors_1.ValidationError("INVALID REQUIRED DATA");
            }
            // The invited slot if still vacant, else any vacant sibling slot of
            // the same position (several invites usually point at one open slot).
            const slot = yield (0, exports.resolveVacantSlot)(tx, body.slotId, invite === null || invite === void 0 ? void 0 : invite.unitPositionId);
            // Resolve the *effective* position / department / SG from the slot
            // OR its parent UnitPosition. `PositionSlot.positionId` is
            // optional in the schema and is usually NULL — the canonical
            // position id lives on the UnitPosition. Same for salary grade,
            // which is normally set on the Position row rather than per-slot.
            const effectivePositionId = (_l = (_j = slot.positionId) !== null && _j !== void 0 ? _j : (_k = slot.unitPosition) === null || _k === void 0 ? void 0 : _k.positionId) !== null && _l !== void 0 ? _l : null;
            const effectiveDepartmentId = (_o = (_m = slot.unitPosition) === null || _m === void 0 ? void 0 : _m.departmentId) !== null && _o !== void 0 ? _o : null;
            const effectiveSalaryGradeId = (_t = (_q = (_p = body.sgId) !== null && _p !== void 0 ? _p : slot.salaryGradeId) !== null && _q !== void 0 ? _q : (_s = (_r = slot.unitPosition) === null || _r === void 0 ? void 0 : _r.position) === null || _s === void 0 ? void 0 : _s.salaryGradeId) !== null && _t !== void 0 ? _t : null;
            if (!effectivePositionId) {
                // Shouldn't happen for a well-formed UnitPosition; bail loudly
                // so HR can fix the data instead of getting a silent "No position".
                throw new errors_1.ValidationError("Slot has no resolvable position — check that the UnitPosition references a Position.");
            }
            // Plantilla designations are "Regular"; a non-plantilla slot (rare path)
            // falls back to "Provisional". The `invite` was loaded at the top of the
            // transaction.
            const empStatus = ((_u = slot.unitPosition) === null || _u === void 0 ? void 0 : _u.plantilla) === false ? "Provisional" : "Regular";
            const empTerm = (_v = invite === null || invite === void 0 ? void 0 : invite.term) !== null && _v !== void 0 ? _v : null;
            const hashedPassword = yield argon2_1.default.hash(body.password);
            const account = yield tx.account.create({
                data: {
                    username: body.username,
                    password: hashedPassword,
                    lineId: body.lineId,
                },
            });
            const user = yield tx.user.create({
                data: Object.assign(Object.assign(Object.assign({ firstName: application.firstname, lastName: application.lastname, username: account.username, accountId: account.id, email: application.email, emailIv: application.emailIv, lineId: body.lineId, positionId: effectivePositionId, departmentId: effectiveDepartmentId, status: empStatus }, (empTerm ? { term: empTerm } : {})), (effectiveSalaryGradeId
                    ? { salaryGradeId: effectiveSalaryGradeId }
                    : {})), { phoneNumber: application.mobileNo, phoneNumberIv: application.ivMobileNo }),
            });
            yield tx.submittedApplication.update({
                where: {
                    id: body.applicationId,
                },
                data: {
                    userId: user.id,
                },
            });
            // Atomic claim: backfills positionId/salaryGradeId on the slot and
            // guards against a concurrent registrant taking it mid-transaction.
            yield (0, exports.claimSlot)(tx, slot.id, user.id, effectivePositionId, effectiveSalaryGradeId);
            // Name comes from the submitted application — the register body
            // doesn't carry firstname/lastname (that's why the old message
            // rendered "Welcome undefined undefined").
            const fullName = [application.firstname, application.lastname]
                .filter(Boolean)
                .join(" ")
                .trim();
            const positionName = (_y = (_x = (_w = slot.unitPosition) === null || _w === void 0 ? void 0 : _w.position) === null || _x === void 0 ? void 0 : _x.name) !== null && _y !== void 0 ? _y : "your new position";
            yield (0, notificationEvents_1.createUserNotification)(tx, {
                recipientId: user.id,
                title: "Welcome to the Portal!",
                content: `Welcome ${fullName || body.username}! You have been successfully registered as ${positionName}. Your username is: ${body.username}. You now have full access to the Human Resources module.`,
                senderId: null,
            });
            // Burn the one-time link so it can't be reused after registration.
            // ATOMIC: the claim only succeeds if the link is still unused, so two
            // simultaneous submits can never both register.
            const claimedInv = yield tx.fillPositionInvitation.updateMany({
                where: { id: body.linkId, concluded: false },
                data: {
                    concluded: true,
                    concludedAt: new Date(),
                    concludedReason: "accepted",
                    step: 1,
                },
            });
            if (claimedInv.count === 0)
                throw new errors_1.ValidationError("This invitation link has already been used.");
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
            throw (0, errors_1.dbError)(error);
        }
        throw error;
    }
});
exports.positionRegister = positionRegister;
/**
 * Resolve which PositionSlot a registrant actually receives.
 *
 * Invites bake a specific slotId at send time, but the slot stays VACANT
 * until someone registers — so when HR sends several invites for the same
 * position (rollout day!), they all point at the same open slot. The first
 * registrant wins that exact slot; without this fallback every later
 * registrant dies on a hard "ALREADY OCCUPIED" 400 even though the position
 * still has other vacant slots.
 *
 * Order: (1) the invited slot if still vacant, (2) any other vacant slot of
 * the same UnitPosition, (3) a clear error — either the slot id is unknown
 * or the position is genuinely full.
 */
const REGISTER_SLOT_SELECT = {
    id: true,
    positionId: true,
    salaryGradeId: true,
    occupied: true,
    userId: true,
    unitPositionId: true,
    unitPosition: {
        select: {
            id: true,
            departmentId: true,
            positionId: true,
            plantilla: true,
            position: { select: { id: true, name: true, salaryGradeId: true } },
        },
    },
};
const resolveVacantSlot = (tx, slotId, fallbackUnitPositionId) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    const slot = slotId
        ? yield tx.positionSlot.findUnique({
            where: { id: slotId },
            select: REGISTER_SLOT_SELECT,
        })
        : null;
    if (slot && !slot.userId && !slot.occupied)
        return slot;
    const upId = (_b = (_a = slot === null || slot === void 0 ? void 0 : slot.unitPositionId) !== null && _a !== void 0 ? _a : fallbackUnitPositionId) !== null && _b !== void 0 ? _b : null;
    if (upId) {
        const alt = yield tx.positionSlot.findFirst({
            where: { unitPositionId: upId, occupied: false, userId: null },
            orderBy: { id: "asc" },
            select: REGISTER_SLOT_SELECT,
        });
        if (alt)
            return alt;
    }
    if (slotId && !slot)
        throw new errors_1.ValidationError("SLOT NOT FOUND");
    throw new errors_1.ValidationError("This position has already been fully filled — every slot is taken. " +
        "Please contact HR for an invitation to another position.");
});
exports.resolveVacantSlot = resolveVacantSlot;
/**
 * Atomically claim a slot for a newly registered user. The vacancy condition
 * in the WHERE guards against two registrants racing into the same slot —
 * the loser's transaction rolls back with a clear message instead of silently
 * overwriting the winner.
 */
const claimSlot = (tx, slotId, userId, effectivePositionId, effectiveSalaryGradeId) => __awaiter(void 0, void 0, void 0, function* () {
    const claimed = yield tx.positionSlot.updateMany({
        where: { id: slotId, occupied: false, userId: null },
        data: Object.assign(Object.assign({ userId, positionId: effectivePositionId }, (effectiveSalaryGradeId
            ? { salaryGradeId: effectiveSalaryGradeId }
            : {})), { occupied: true }),
    });
    if (claimed.count === 0) {
        throw new errors_1.ValidationError("Someone registered into this slot a moment ago — please submit again.");
    }
});
exports.claimSlot = claimSlot;
// Public base URL for building the served-photo link (mirrors employee.ts).
const selfBaseUrl = (req) => {
    const env = process.env.API_PUBLIC_URL;
    if (env)
        return env.replace(/\/+$/, "");
    const proto = String(req.headers["x-forwarded-proto"] || req.protocol || "http").split(",")[0];
    const host = req.headers["x-forwarded-host"] || req.headers.host;
    return `${proto}://${host}`;
};
/**
 * PUBLIC quick registration — the "quick invite" counterpart to
 * positionRegister. The candidate fills only the essentials (name, birthday,
 * sex, address, contact) + a photo; there is NO CS Form 212 PDS. Everything is
 * written straight to the User record, the slot is occupied, and the one-time
 * invite is burned. Multipart so the profile photo can ride along.
 *
 * Fields (multipart form-data): linkId, lineId, slotId, username, password,
 *   firstName, lastName, middleName?, suffix?, birthDate (ISO), gender,
 *   email, mobileNumber, regionId?, provinceId?, municipalId?, barangayId?
 *   photo (file, optional, image/*)
 */
const positionQuickRegister = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, e_1, _b, _c, _d, e_2, _e, _f;
    var _g;
    if (!req.isMultipart())
        throw new errors_1.ValidationError("NOT_MULTIPART");
    const f = {};
    let photo = null;
    try {
        for (var _h = true, _j = __asyncValues(req.parts()), _k; _k = yield _j.next(), _a = _k.done, !_a; _h = true) {
            _c = _k.value;
            _h = false;
            const part = _c;
            if (part.type === "file") {
                if (part.fieldname === "photo") {
                    const chunks = [];
                    try {
                        for (var _l = true, _m = (e_2 = void 0, __asyncValues(part.file)), _o; _o = yield _m.next(), _d = _o.done, !_d; _l = true) {
                            _f = _o.value;
                            _l = false;
                            const chunk = _f;
                            chunks.push(chunk);
                        }
                    }
                    catch (e_2_1) { e_2 = { error: e_2_1 }; }
                    finally {
                        try {
                            if (!_l && !_d && (_e = _m.return)) yield _e.call(_m);
                        }
                        finally { if (e_2) throw e_2.error; }
                    }
                    photo = {
                        filename: part.filename,
                        mimetype: part.mimetype,
                        buffer: Buffer.concat(chunks),
                    };
                }
                else {
                    // Drain unexpected file parts so the multipart stream can continue.
                    yield part.toBuffer();
                }
            }
            else {
                f[part.fieldname] = String((_g = part.value) !== null && _g !== void 0 ? _g : "");
            }
        }
    }
    catch (e_1_1) { e_1 = { error: e_1_1 }; }
    finally {
        try {
            if (!_h && !_a && (_b = _j.return)) yield _b.call(_j);
        }
        finally { if (e_1) throw e_1.error; }
    }
    if (!f.linkId ||
        !f.lineId ||
        !f.slotId ||
        !f.username ||
        !f.password ||
        !f.firstName ||
        !f.lastName ||
        !f.email) {
        throw new errors_1.ValidationError("INVALID REQUIRED DATA");
    }
    if (!isValidEmail(f.email)) {
        throw new errors_1.ValidationError("Email address is not valid.");
    }
    if (f.password.length < 8) {
        throw new errors_1.ValidationError("Password must be at least 8 characters.");
    }
    if (photo) {
        if (!photo.mimetype.startsWith("image/"))
            throw new errors_1.ValidationError("FILE_MUST_BE_AN_IMAGE");
        if (photo.buffer.length > 8 * 1024 * 1024)
            throw new errors_1.ValidationError("IMAGE_TOO_LARGE");
    }
    try {
        // Encrypt PII exactly like the rest of the app (email + phone).
        const encEmail = yield encryption_1.EncryptionService.encrypt(f.email);
        const encPhone = f.mobileNumber
            ? yield encryption_1.EncryptionService.encrypt(f.mobileNumber)
            : null;
        // The public form's address dropdowns are fed by the external PSGC API,
        // while User.regionId/provinceId/municipalId/barangayId are FOREIGN KEYS
        // into our own (partially seeded) tables — and the dropdowns' degenerate
        // rows ("loading", "noData", …) are selectable too. Keep an id only when
        // that row actually exists here; anything else becomes NULL. The address
        // is optional — it must NEVER fail a registration with a P2003 400.
        const junk = new Set(["loading", "noData", "error", "errors", "undefined", "null"]);
        const cleanId = (v) => (v && !junk.has(v) ? v : null);
        const keep = (id, find) => __awaiter(void 0, void 0, void 0, function* () { var _a, _b; return (id ? (_b = (_a = (yield find(id))) === null || _a === void 0 ? void 0 : _a.id) !== null && _b !== void 0 ? _b : null : null); });
        const [addrRegionId, addrProvinceId, addrMunicipalId, addrBarangayId] = yield Promise.all([
            keep(cleanId(f.regionId), (id) => prisma_1.prisma.region.findUnique({ where: { id }, select: { id: true } })),
            keep(cleanId(f.provinceId), (id) => prisma_1.prisma.province.findUnique({ where: { id }, select: { id: true } })),
            keep(cleanId(f.municipalId), (id) => prisma_1.prisma.municipal.findUnique({ where: { id }, select: { id: true } })),
            keep(cleanId(f.barangayId), (id) => prisma_1.prisma.barangay.findUnique({ where: { id }, select: { id: true } })),
        ]);
        const userId = yield prisma_1.prisma.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m;
            const invite = yield tx.fillPositionInvitation.findUnique({
                where: { id: f.linkId },
                select: { concluded: true, mode: true, unitPositionId: true },
            });
            if (!invite)
                throw new errors_1.NotFoundError("LINK NOT FOUND");
            if (invite.concluded)
                throw new errors_1.ValidationError("This registration link has already been used.");
            if (invite.mode !== "quick")
                throw new errors_1.ValidationError("This link is not a quick-registration link.");
            // The invited slot if still vacant, else any vacant sibling slot of
            // the same position (several invites usually point at one open slot).
            const slot = yield (0, exports.resolveVacantSlot)(tx, f.slotId, invite.unitPositionId);
            const effectivePositionId = (_c = (_a = slot.positionId) !== null && _a !== void 0 ? _a : (_b = slot.unitPosition) === null || _b === void 0 ? void 0 : _b.positionId) !== null && _c !== void 0 ? _c : null;
            const effectiveDepartmentId = (_e = (_d = slot.unitPosition) === null || _d === void 0 ? void 0 : _d.departmentId) !== null && _e !== void 0 ? _e : null;
            const effectiveSalaryGradeId = (_j = (_f = slot.salaryGradeId) !== null && _f !== void 0 ? _f : (_h = (_g = slot.unitPosition) === null || _g === void 0 ? void 0 : _g.position) === null || _h === void 0 ? void 0 : _h.salaryGradeId) !== null && _j !== void 0 ? _j : null;
            if (!effectivePositionId) {
                throw new errors_1.ValidationError("Slot has no resolvable position — check that the UnitPosition references a Position.");
            }
            const empStatus = ((_k = slot.unitPosition) === null || _k === void 0 ? void 0 : _k.plantilla) === false ? "Provisional" : "Regular";
            const hashedPassword = yield argon2_1.default.hash(f.password);
            const account = yield tx.account.create({
                data: { username: f.username, password: hashedPassword, lineId: f.lineId },
            });
            const user = yield tx.user.create({
                data: Object.assign(Object.assign(Object.assign(Object.assign(Object.assign(Object.assign({ firstName: f.firstName, lastName: f.lastName, middleName: ((_l = f.middleName) === null || _l === void 0 ? void 0 : _l.trim()) || null, suffix: ((_m = f.suffix) === null || _m === void 0 ? void 0 : _m.trim()) || null }, (f.birthDate ? { birthDate: new Date(f.birthDate) } : {})), (f.gender === "male" || f.gender === "female"
                    ? { gender: f.gender }
                    : {})), { username: account.username, accountId: account.id, email: encEmail.encryptedData, emailIv: encEmail.iv }), (encPhone
                    ? { phoneNumber: encPhone.encryptedData, phoneNumberIv: encPhone.iv }
                    : {})), { regionId: addrRegionId, provinceId: addrProvinceId, municipalId: addrMunicipalId, barangayId: addrBarangayId, lineId: f.lineId, positionId: effectivePositionId, departmentId: effectiveDepartmentId, status: empStatus }), (effectiveSalaryGradeId
                    ? { salaryGradeId: effectiveSalaryGradeId }
                    : {})),
            });
            yield (0, exports.claimSlot)(tx, slot.id, user.id, effectivePositionId, effectiveSalaryGradeId);
            // ATOMIC single-use claim: only succeeds if the link is still unused —
            // two simultaneous quick-register submits can never both register.
            const claimedInv = yield tx.fillPositionInvitation.updateMany({
                where: { id: f.linkId, concluded: false },
                data: {
                    concluded: true,
                    concludedAt: new Date(),
                    concludedReason: "accepted",
                    step: 1,
                },
            });
            if (claimedInv.count === 0)
                throw new errors_1.ValidationError("This invitation link has already been used.");
            yield (0, notificationEvents_1.createUserNotification)(tx, {
                recipientId: user.id,
                title: "Welcome to the Portal!",
                content: `Welcome ${f.firstName} ${f.lastName}! Your account has been created. Your username is: ${f.username}.`,
                senderId: null,
            });
            return user.id;
        }));
        // Photo is non-critical: store it AFTER the account commits so a photo
        // failure never rolls back a successful registration.
        if (photo) {
            try {
                const fileUrl = `${selfBaseUrl(req)}/user/photo/${userId}?v=${Date.now()}`;
                const picData = {
                    file_name: photo.filename || "avatar",
                    file_url: fileUrl,
                    file_public_id: "",
                    file_size: String(photo.buffer.length),
                    file_type: "image",
                    mime: photo.mimetype,
                    bytes: photo.buffer,
                };
                yield prisma_1.prisma.userProfilePicture.upsert({
                    where: { userId },
                    update: picData,
                    create: Object.assign({ userId }, picData),
                });
            }
            catch (e) {
                console.warn("[positionQuickRegister] photo save failed", e);
            }
        }
        return res.code(200).send({ message: "OK" });
    }
    catch (error) {
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            // Duplicate username → let the client show a friendly field error.
            if (error.code === "P2002") {
                return res.code(200).send({ error: 1, message: "Username already exists" });
            }
            throw (0, errors_1.dbError)(error);
        }
        throw error;
    }
});
exports.positionQuickRegister = positionQuickRegister;
/**
 * Vacate an occupied position slot.
 *
 * Body:
 *   slotId  — the PositionSlot to free up
 *   userId  — the ACTOR (HR user performing the action), for the audit log
 *   lineId  — line scope guard
 *   action  — what to do with the displaced occupant:
 *               0 "Remove User"     → unassign them from the slot/position
 *                                     (account stays active, becomes
 *                                     position-less)
 *               1 "Disable Access"  → also suspend their account so they
 *                                     can no longer sign in (data retained)
 *
 * Always: clears slot.userId + occupied, clears the occupant's
 * position/department/salaryGrade, records a UnitPositionHistory row and
 * an HR audit log, and notifies the displaced user.
 */
const vacantPosition = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    const body = req.body;
    if (!body.lineId || !body.slotId || !body.userId) {
        throw new errors_1.ValidationError("INVALID REQUIRED ID");
    }
    // Normalise action → 0 (remove) | 1 (disable access). Anything else
    // falls back to a plain unassign (0).
    const action = Number((_a = body.action) !== null && _a !== void 0 ? _a : 0) === 1 ? 1 : 0;
    try {
        const result = yield prisma_1.prisma.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            var _a, _b, _c, _d, _e;
            const slot = yield tx.positionSlot.findUnique({
                where: { id: body.slotId },
                select: {
                    id: true,
                    occupied: true,
                    userId: true,
                    unitPositionId: true,
                    pos: { select: { name: true } },
                    unitPosition: {
                        select: { lineId: true, position: { select: { name: true } } },
                    },
                    user: {
                        select: {
                            id: true,
                            firstName: true,
                            lastName: true,
                            accountId: true,
                        },
                    },
                },
            });
            if (!slot)
                throw new errors_1.NotFoundError("Slot not found.");
            if (slot.unitPosition && slot.unitPosition.lineId !== body.lineId) {
                throw new errors_1.ValidationError("Slot does not belong to this line.");
            }
            if (!slot.userId || !slot.user) {
                throw new errors_1.ValidationError("This slot is already vacant.");
            }
            // An HR officer must not vacate their OWN seat — doing so would strip
            // their position/department (and optionally suspend their account),
            // potentially locking the line out of its only HR administrator.
            // Only a *different* administrator may vacate this slot.
            if (slot.userId === body.userId) {
                throw new errors_1.ValidationError("You can't vacate your own seat. Ask another administrator to do this for you.");
            }
            const occupant = slot.user;
            const positionName = (_e = (_b = (_a = slot.pos) === null || _a === void 0 ? void 0 : _a.name) !== null && _b !== void 0 ? _b : (_d = (_c = slot.unitPosition) === null || _c === void 0 ? void 0 : _c.position) === null || _d === void 0 ? void 0 : _d.name) !== null && _e !== void 0 ? _e : "the position";
            // 1. Free the slot.
            yield tx.positionSlot.update({
                where: { id: slot.id },
                data: { occupied: false, userId: null },
            });
            // 2. Unassign the occupant from their position/department/SG. When the
            //    account is also being disabled (action 1 = separation), archive them
            //    so they leave the active Employees list for the Archived page.
            yield tx.user.update({
                where: { id: occupant.id },
                data: Object.assign({ departmentId: null, positionId: null, salaryGradeId: null }, (action === 1
                    ? {
                        archivedAt: new Date(),
                        archiveReason: `Vacated from ${positionName} and access disabled`,
                    }
                    : {})),
            });
            // 3. Optionally suspend the account (Disable Access).
            if (action === 1 && occupant.accountId) {
                yield tx.account.update({
                    where: { id: occupant.accountId },
                    data: { status: 2, active: false },
                });
            }
            // 4. History — record the vacancy against the unit position.
            if (slot.unitPositionId) {
                yield tx.unitPositionHistory.create({
                    data: {
                        unitPositionId: slot.unitPositionId,
                        positionSlotId: slot.id,
                        userId: occupant.id,
                    },
                });
            }
            // 5. HR audit log.
            yield tx.humanResourcesLogs.create({
                data: {
                    userId: body.userId,
                    action: action === 1 ? "DELETE" : "UPDATE",
                    desc: action === 1
                        ? `VACATE + DISABLE ACCESS: ${occupant.firstName} ${occupant.lastName} removed from ${positionName} and account suspended.`
                        : `VACATE SLOT: ${occupant.firstName} ${occupant.lastName} unassigned from ${positionName}.`,
                    lineId: body.lineId,
                },
            });
            return { occupant, positionName };
        }));
        // 6. Notify the displaced user (outside the tx isn't necessary — the
        //    helper participates in the tx — but we already committed, so
        //    fire a standalone notification here).
        try {
            yield prisma_1.prisma.notification.create({
                data: {
                    recipientId: result.occupant.id,
                    title: action === 1 ? "Account access disabled" : "Position vacated",
                    content: action === 1
                        ? `You have been removed from ${result.positionName} and your account access has been disabled. Contact HR for assistance.`
                        : `You have been unassigned from ${result.positionName}. Contact HR if you believe this is a mistake.`,
                },
            });
        }
        catch (e) {
            console.warn("[vacantPosition] notification failed:", e);
        }
        return res.code(200).send({ message: "OK" });
    }
    catch (error) {
        if (error instanceof errors_1.ValidationError)
            throw error;
        if (error instanceof errors_1.NotFoundError)
            throw error;
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw (0, errors_1.dbError)(error);
        }
        throw error;
    }
});
exports.vacantPosition = vacantPosition;
const submitApplication = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, e_3, _b, _c, _d, e_4, _e, _f;
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
                        for (var _h = true, _j = (e_4 = void 0, __asyncValues(part.file)), _k; _k = yield _j.next(), _d = _k.done, !_d; _h = true) {
                            _f = _k.value;
                            _h = false;
                            const chunk = _f;
                            buffers.push(chunk);
                        }
                    }
                    catch (e_4_1) { e_4 = { error: e_4_1 }; }
                    finally {
                        try {
                            if (!_h && !_d && (_e = _j.return)) yield _e.call(_j);
                        }
                        finally { if (e_4) throw e_4.error; }
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
        catch (e_3_1) { e_3 = { error: e_3_1 }; }
        finally {
            try {
                if (!_g && !_a && (_b = parts_1.return)) yield _b.call(parts_1);
            }
            finally { if (e_3) throw e_3.error; }
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
            // Mark the invite as accepted in one shot. The legacy code did
            // this twice (once with everything, then again with just step),
            // which was redundant and accidentally widened the failure window.
            yield tx.fillPositionInvitation.update({
                where: { id: inviteLink.id },
                data: {
                    step: 1,
                    submittedApplicationId: application.id,
                    concluded: true,
                    concludedAt: new Date(),
                    concludedReason: "accepted",
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
        // Pull as much useful detail as we can out of *whatever* was thrown
        // so the FE doesn't just see "Unknown error". Prisma's known errors
        // are Error instances but carry a `code` + `meta`; plain thrown
        // strings/numbers used to fall through and surface "Unknown error".
        const prismaCode = err === null || err === void 0 ? void 0 : err.code;
        const prismaMeta = err === null || err === void 0 ? void 0 : err.meta;
        const errorMsg = err instanceof Error
            ? err.message
            : typeof err === "string"
                ? err
                : (err === null || err === void 0 ? void 0 : err.message)
                    ? String(err.message)
                    : `Unhandled (${typeof err})`;
        console.error("[submitApplication] failed:", {
            message: errorMsg,
            prismaCode,
            prismaMeta,
            stack: err instanceof Error ? err.stack : undefined,
        });
        return res.status(500).send({
            success: false,
            message: "Failed to submit application",
            error: errorMsg,
            code: prismaCode !== null && prismaCode !== void 0 ? prismaCode : null,
            meta: prismaMeta !== null && prismaMeta !== void 0 ? prismaMeta : null,
        });
    }
});
exports.submitApplication = submitApplication;
const positionRecords = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d, _e;
    const params = req.query;
    if (!params.id) {
        throw new errors_1.ValidationError("INVALID REQUIRED ID");
    }
    try {
        // Pull everything the PositionDetail header needs in one shot:
        //  - line + unit (department) names (FE was rendering departmentId uuid)
        //  - slot fill ratio (occupied vs total) for the stats badge
        //  - submittedApplications count for the Applications tab badge
        //  - position.salaryGrade so the header can display the grade + amount
        const response = yield prisma_1.prisma.unitPosition.findUnique({
            where: {
                id: params.id,
            },
            include: {
                position: {
                    select: {
                        name: true,
                        id: true,
                        SalaryGrade: {
                            select: { id: true, grade: true, amount: true },
                        },
                    },
                },
                unit: {
                    select: { id: true, name: true },
                },
                line: {
                    select: { id: true, name: true },
                },
                slot: {
                    select: {
                        id: true,
                        occupied: true,
                        userId: true,
                    },
                    orderBy: { id: "asc" },
                },
                _count: {
                    select: {
                        slot: true,
                        submittedApplications: true,
                        unitPositionHistories: true,
                    },
                },
            },
        });
        if (!response) {
            throw new errors_1.NotFoundError("UNIT POSITION NOT FOUND");
        }
        // Convenience: occupied/total numbers so FE doesn't recompute.
        const occupiedSlots = ((_a = response.slot) !== null && _a !== void 0 ? _a : []).filter((s) => s.occupied || !!s.userId).length;
        return res.code(200).send(Object.assign(Object.assign({}, response), { occupiedSlots, totalSlots: (_e = (_c = (_b = response._count) === null || _b === void 0 ? void 0 : _b.slot) !== null && _c !== void 0 ? _c : (_d = response.slot) === null || _d === void 0 ? void 0 : _d.length) !== null && _e !== void 0 ? _e : 0 }));
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
        // Mirror what /line-applications returns so the FE can reuse
        // <ApplicationItem /> 1:1. The position view always filters by
        // unitPositionId, so the result is a strict subset.
        const response = yield prisma_1.prisma.submittedApplication.findMany({
            where: {
                unitPositionId: params.id,
            },
            include: {
                forPosition: { select: { id: true, name: true } },
                unitPos: { select: { id: true, designation: true } },
                ApplicationSkillTags: {
                    select: { id: true, tags: true },
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
        // Derive a stable slot "number" per UnitPosition: ordered by id, the
        // index inside that array. The PositionSlot model has no slotNumber
        // column, but the UI just needs a friendly handle ("Slot #2") instead
        // of the raw uuid.
        const slotOrder = yield prisma_1.prisma.positionSlot.findMany({
            where: { unitPositionId: params.id },
            orderBy: { id: "asc" },
            select: { id: true },
        });
        const slotNumberById = new Map(slotOrder.map((s, i) => [s.id, i + 1]));
        const response = yield prisma_1.prisma.unitPositionHistory.findMany({
            where: {
                unitPositionId: params.id,
            },
            include: {
                user: {
                    select: {
                        id: true,
                        firstName: true,
                        lastName: true,
                        username: true,
                    },
                },
                slot: {
                    select: {
                        id: true,
                        occupied: true,
                        userId: true,
                        designation: true,
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
        const list = response.map((row) => {
            var _a, _b, _c;
            const slotNumber = row.positionSlotId
                ? ((_a = slotNumberById.get(row.positionSlotId)) !== null && _a !== void 0 ? _a : null)
                : null;
            // Best-effort action label: if the slot is currently occupied by
            // this same user, this row likely represents the assignment; if a
            // newer history row exists for the same slot, this one is a vacate.
            // We don't track action explicitly, so the FE just renders
            // "Assigned" when the slot still belongs to the user.
            const currentlyHolds = ((_b = row.slot) === null || _b === void 0 ? void 0 : _b.userId) && ((_c = row.user) === null || _c === void 0 ? void 0 : _c.id) && row.slot.userId === row.user.id;
            return Object.assign(Object.assign({}, row), { slotNumber, action: currentlyHolds ? "assigned" : "vacated" });
        });
        const newLastCursorId = list.length > 0 ? list[list.length - 1].id : null;
        const hasMore = list.length === limit;
        return res
            .code(200)
            .send({ list, hasMore, lastCursor: newLastCursorId });
    }
    catch (error) {
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw new errors_1.AppError("Database operation failed", 500, "DB_ERROR");
        }
        throw error;
    }
});
exports.unitPositionRecord = unitPositionRecord;
/**
 * Remove a unit-position binding.
 *
 * Refuses if any slot is currently filled — would orphan the user.
 * Logged to humanResourcesLogs (was previously writing to medicineLogs
 * by mistake, which is the wrong audit table for HR actions).
 */
const removeUnitPosition = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const params = req.query;
    if (!params.id || !params.userId || !params.lineId) {
        throw new errors_1.ValidationError("INVALID REQUIRED ID");
    }
    try {
        const result = yield prisma_1.prisma.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            var _a, _b, _c;
            const target = yield tx.unitPosition.findUnique({
                where: { id: params.id },
                include: {
                    position: { select: { name: true } },
                    slot: { select: { id: true, occupied: true, userId: true } },
                },
            });
            if (!target)
                throw new errors_1.NotFoundError("Unit position not found");
            const filled = ((_a = target.slot) !== null && _a !== void 0 ? _a : []).filter((s) => s.occupied || !!s.userId).length;
            if (filled > 0) {
                throw new errors_1.ValidationError(`Cannot remove — ${filled} slot${filled === 1 ? " is" : "s are"} still occupied. Vacate or transfer first.`);
            }
            yield tx.unitPosition.delete({ where: { id: params.id } });
            yield tx.humanResourcesLogs.create({
                data: {
                    action: "REMOVE",
                    tab: 7,
                    userId: params.userId,
                    lineId: params.lineId,
                    desc: `Removed unit position: ${(_c = (_b = target.position) === null || _b === void 0 ? void 0 : _b.name) !== null && _c !== void 0 ? _c : params.id}`,
                },
            });
            return { id: params.id };
        }));
        return res
            .code(200)
            .send(Object.assign({ message: "OK" }, result));
    }
    catch (error) {
        if (error instanceof errors_1.NotFoundError)
            throw error;
        if (error instanceof errors_1.ValidationError)
            throw error;
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw new errors_1.AppError("Database operation failed", 500, "DB_ERROR");
        }
        throw error;
    }
});
exports.removeUnitPosition = removeUnitPosition;
// PATCH /position/unit/update
// Edit a unit position from PositionDetail: label/name, designation, item no.,
// salary grade, plantilla + fix-to-unit flags, and the slot count (adds vacant
// slots or removes vacant ones — never below the occupied count).
const updateUnitPosition = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const body = req.body;
    if (!body.unitPositionId || !body.lineId) {
        throw new errors_1.ValidationError("INVALID REQUIRED FIELDS");
    }
    const { unitPositionId, lineId, userId } = body;
    try {
        yield prisma_1.prisma.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            var _a, _b, _c, _d;
            const up = yield tx.unitPosition.findFirst({
                where: { id: unitPositionId, lineId },
                include: {
                    position: { select: { id: true } },
                    slot: { select: { id: true, occupied: true, userId: true } },
                },
            });
            if (!up)
                throw new errors_1.NotFoundError("Position not found");
            // Position-level fields (name, salary grade, plantilla).
            if (up.positionId) {
                yield tx.position.update({
                    where: { id: up.positionId },
                    data: Object.assign(Object.assign(Object.assign({}, (((_a = body.title) === null || _a === void 0 ? void 0 : _a.trim()) ? { name: body.title.trim() } : {})), (body.plantilla !== undefined
                        ? { plantilla: body.plantilla }
                        : {})), (body.salaryGradeId !== undefined
                        ? body.salaryGradeId
                            ? { SalaryGrade: { connect: { id: body.salaryGradeId } } }
                            : { SalaryGrade: { disconnect: true } }
                        : {})),
                });
            }
            // Unit-position-level fields.
            yield tx.unitPosition.update({
                where: { id: up.id },
                data: Object.assign(Object.assign(Object.assign(Object.assign({}, (body.designation !== undefined
                    ? { designation: ((_b = body.designation) === null || _b === void 0 ? void 0 : _b.trim()) || null }
                    : {})), (body.itemNumber !== undefined
                    ? { itemNumber: ((_c = body.itemNumber) === null || _c === void 0 ? void 0 : _c.trim()) || null }
                    : {})), (body.plantilla !== undefined ? { plantilla: body.plantilla } : {})), (body.fixToUnit !== undefined ? { fixToUnit: body.fixToUnit } : {})),
            });
            // Apply the salary grade to the vacant slots too.
            if (body.salaryGradeId !== undefined) {
                yield tx.positionSlot.updateMany({
                    where: { unitPositionId: up.id, occupied: false, userId: null },
                    data: { salaryGradeId: body.salaryGradeId || null },
                });
            }
            // Slot-count + occupied-status reconciliation. Slots filled by an
            // ASSIGNED USER (userId set) are managed via the invite/Vacate flow and
            // are never created/deleted/freed here — they're the lower bound for both
            // the total count and the occupied count. Everything else ("free" slots)
            // is HR-editable: count via `slots`, occupied flag via `occupied`.
            const userSlots = up.slot.filter((s) => !!s.userId);
            // (1) Total count — add/remove only FREE slots, keeping user slots intact.
            if (body.slots != null) {
                const want = Math.max(0, parseInt(String(body.slots), 10) || 0);
                if (want < userSlots.length) {
                    throw new errors_1.ValidationError(`Can't set fewer than ${userSlots.length} slot(s) — that many are filled by assigned users.`);
                }
                const free = up.slot.filter((s) => !s.userId);
                const targetFree = want - userSlots.length;
                if (targetFree > free.length) {
                    yield tx.positionSlot.createMany({
                        data: Array.from({ length: targetFree - free.length }, () => ({
                            unitPositionId: up.id,
                            positionId: up.positionId,
                            salaryGradeId: body.salaryGradeId || null,
                            occupied: false,
                        })),
                    });
                }
                else if (targetFree < free.length) {
                    // Remove free slots, vacant ones first so manual occupancy survives.
                    const removable = [...free]
                        .sort((a, b) => Number(a.occupied) - Number(b.occupied))
                        .slice(0, free.length - targetFree)
                        .map((s) => s.id);
                    if (removable.length) {
                        yield tx.positionSlot.deleteMany({ where: { id: { in: removable } } });
                    }
                }
            }
            // (2) Occupied status — flag how many FREE slots are occupied. User slots
            // always count as occupied and act as the floor.
            if (body.occupied != null) {
                const slots = yield tx.positionSlot.findMany({
                    where: { unitPositionId: up.id },
                    select: { id: true, userId: true },
                });
                const userCount = slots.filter((s) => !!s.userId).length;
                const free = slots.filter((s) => !s.userId);
                const target = Math.max(0, Math.min(slots.length, parseInt(String(body.occupied), 10) || 0));
                if (target < userCount) {
                    throw new errors_1.ValidationError(`${userCount} slot(s) are filled by assigned users — vacate them first to lower the occupied count.`);
                }
                const toMark = target - userCount; // free slots to flag occupied
                const occupyIds = free.slice(0, toMark).map((s) => s.id);
                const vacateIds = free.slice(toMark).map((s) => s.id);
                if (occupyIds.length) {
                    yield tx.positionSlot.updateMany({
                        where: { id: { in: occupyIds } },
                        data: { occupied: true },
                    });
                }
                if (vacateIds.length) {
                    yield tx.positionSlot.updateMany({
                        where: { id: { in: vacateIds } },
                        data: { occupied: false },
                    });
                }
            }
            if (userId) {
                yield tx.humanResourcesLogs.create({
                    data: {
                        tab: 7,
                        action: "Updated",
                        lineId,
                        userId,
                        desc: `Updated position "${(_d = body.title) !== null && _d !== void 0 ? _d : "—"}" (unitPosition ${up.id})`,
                    },
                });
            }
        }));
        return res.code(200).send({ message: "OK" });
    }
    catch (error) {
        if (error instanceof errors_1.NotFoundError || error instanceof errors_1.ValidationError) {
            throw error;
        }
        throw new errors_1.AppError("POSITION_UPDATE_FAILED", 500, "DB_ERROR");
    }
});
exports.updateUnitPosition = updateUnitPosition;
