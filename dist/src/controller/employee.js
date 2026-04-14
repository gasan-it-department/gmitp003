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
exports.deleteUser = exports.userModuleAccess = exports.supsendAccount = exports.decryptUserData = exports.viewUserProfile = exports.employees = exports.searchUser = exports.getAllEmpoyees = void 0;
const prisma_1 = require("../barrel/prisma");
const errors_1 = require("../errors/errors");
const date_1 = require("../utils/date");
const encryption_1 = require("../service/encryption");
const handler_1 = require("../middleware/handler");
const getAllEmpoyees = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { page, office, sgFrom, sgTo, year, dateApp, dateLast, lastCursorId, query, } = req.body;
        if (!page) {
            return res.code(400).send({ message: "Bad request" });
        }
        const filter = {};
        if (office) {
            filter.departmentId = office;
        }
        if (sgFrom || sgTo) {
            if (sgFrom) {
                filter.SalaryGrade = {
                    grade: { equals: sgFrom },
                };
            }
            if (sgTo) {
                filter.SalaryGrade = {
                    grade: { equals: sgTo },
                };
            }
            if (sgFrom && sgTo) {
                filter.SalaryGrade = {
                    AND: [{ grade: { gte: sgFrom } }, { grade: { lte: sgTo } }],
                };
            }
        }
        const yearFilter = year !== "all"
            ? {
                Promotions: {
                    some: {
                        timestamp: (0, date_1.getYearRange)(year),
                    },
                },
            }
            : {};
        if (query) {
            const searchTerms = query.trim().split(/\s+/); // Split on any whitespace
            if (searchTerms.length === 1) {
                filter.OR = [
                    { lastName: { contains: searchTerms[0], mode: "insensitive" } },
                    { firstName: { contains: searchTerms[0], mode: "insensitive" } },
                    { middleName: { contains: searchTerms[0], mode: "insensitive" } },
                ];
            }
            else {
                filter.AND = searchTerms.map((term) => ({
                    OR: [
                        { firstname: { contains: term, mode: "insensitive" } },
                        { lastname: { contains: term, mode: "insensitive" } },
                    ],
                }));
                filter.OR = [
                    { AND: filter.AND },
                    { middleName: { contains: query.trim(), mode: "insensitive" } },
                ];
                delete filter.AND; // Remove the AND since we've incorporated it into OR
            }
        }
        const cursor = lastCursorId ? { id: lastCursorId } : undefined;
        const response = yield prisma_1.prisma.user.findMany({
            where: Object.assign(Object.assign({}, filter), yearFilter),
            cursor,
            take: 20,
            include: {
                department: true,
                SalaryGrade: true,
                Promotions: true,
            },
        });
        const newLastCursorId = response.length > 0 ? response[response.length - 1].id : null;
        const hasMore = response.length === 20;
        return res
            .code(200)
            .send({ list: response, lastCursorId: newLastCursorId, hasMore });
    }
    catch (error) {
        console.log(error);
        res.code(500).send({ message: "Internal Server Error" });
    }
});
exports.getAllEmpoyees = getAllEmpoyees;
const searchUser = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { query, limit, lastCursor, inUnitOnly, departId } = req.query;
        console.log(query, limit, lastCursor, inUnitOnly, departId);
        const filter = {};
        if (inUnitOnly && departId) {
            filter.departmentId = departId;
        }
        if (query) {
            const searchTerms = query.trim().split(/\s+/); // Split on any whitespace
            if (searchTerms.length === 1) {
                filter.OR = [
                    { lastName: { contains: searchTerms[0], mode: "insensitive" } },
                    { firstName: { contains: searchTerms[0], mode: "insensitive" } },
                    { middleName: { contains: searchTerms[0], mode: "insensitive" } },
                ];
            }
            else {
                filter.AND = searchTerms.map((term) => ({
                    OR: [
                        { firstname: { contains: term, mode: "insensitive" } },
                        { lastname: { contains: term, mode: "insensitive" } },
                    ],
                }));
                filter.OR = [
                    { AND: filter.AND },
                    { middleName: { contains: query.trim(), mode: "insensitive" } },
                ];
                delete filter.AND; // Remove the AND since we've incorporated it into OR
            }
        }
        const cursor = lastCursor ? { id: lastCursor } : undefined;
        const response = yield prisma_1.prisma.user.findMany({
            where: filter,
            cursor,
            take: parseInt(limit, 10),
            skip: parseInt(limit, 10),
            include: {
                userProfilePictures: {
                    select: {
                        file_name: true,
                        file_url: true,
                        file_size: true,
                    },
                },
            },
        });
        const newLastCursorId = response.length > 0 ? response[response.length - 1].id : null;
        const hasMore = response.length === parseInt(limit, 10);
        return res
            .code(200)
            .send({ list: response, lastCursor: newLastCursorId, hasMore });
    }
    catch (error) {
        res.code(500).send({ message: "Internal Server Error" });
    }
});
exports.searchUser = searchUser;
const employees = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const params = req.query;
    if (!params.id)
        throw new errors_1.ValidationError("BAD_REQUEST");
    try {
        const cursor = params.lastCursor ? { id: params.lastCursor } : undefined;
        const filter = {};
        const limit = params.limit ? parseInt(params.limit, 10) : 20;
        if (params.query) {
            const searchTerms = params.query.trim().split(/\s+/); // Split on any whitespace
            if (searchTerms.length === 1) {
                filter.OR = [
                    { lastName: { contains: searchTerms[0], mode: "insensitive" } },
                    { firstName: { contains: searchTerms[0], mode: "insensitive" } },
                    { middleName: { contains: searchTerms[0], mode: "insensitive" } },
                    { username: { contains: searchTerms[0], mode: "insensitive" } },
                    { email: { contains: searchTerms[0], mode: "insensitive" } },
                ];
            }
            else {
                filter.AND = searchTerms.map((term) => ({
                    OR: [
                        { firstName: { contains: term, mode: "insensitive" } },
                        { lastName: { contains: term, mode: "insensitive" } },
                        { middleName: { contains: term, mode: "insensitive" } },
                        { username: { contains: term, mode: "insensitive" } },
                        { email: { contains: term, mode: "insensitive" } },
                    ],
                }));
                filter.OR = [
                    { AND: filter.AND },
                    {
                        middleName: { contains: params.query.trim(), mode: "insensitive" },
                    },
                ];
                delete filter.AND;
            }
        }
        if (params.departId && params.departId !== "all") {
            filter.departmentId = params.departId;
        }
        const response = yield prisma_1.prisma.user.findMany({
            where: Object.assign({ lineId: params.id }, filter),
            skip: cursor ? 1 : 0,
            take: limit,
            cursor,
            select: {
                userProfilePictures: {
                    select: {
                        file_name: true,
                        file_size: true,
                        file_url: true,
                    },
                },
                id: true,
                firstName: true,
                lastName: true,
                username: true,
                PositionSlot: {
                    select: {
                        pos: {
                            select: {
                                name: true,
                            },
                        },
                    },
                },
                Position: {
                    select: {
                        name: true,
                    },
                },
                department: {
                    select: {
                        name: true,
                        id: true,
                    },
                },
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
            throw new errors_1.AppError("DATABASE_CONNECTION_ERROR", 500, "DB_FAILED");
        }
        throw error;
    }
});
exports.employees = employees;
const viewUserProfile = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const params = req.query;
    if (!params.userProfileId || !params.userId)
        throw new errors_1.ValidationError("INVALID REQUIRED ID");
    try {
        const response = prisma_1.prisma.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            const currUser = yield tx.user.findUnique({
                where: {
                    id: params.userId,
                },
            });
            const targetUser = yield tx.user.findUnique({
                where: {
                    id: params.userProfileId,
                },
            });
            if (!currUser || !targetUser)
                throw new errors_1.ValidationError("USER NOT FOUND");
            yield tx.profileView.create({
                data: {
                    userId: currUser.id,
                    targetUserId: targetUser.id,
                    descryption: true,
                },
            });
            return "OK";
        }));
        if (!response)
            throw new errors_1.ValidationError("FAILED TO VIEW");
        return res.code(200).send({ message: "OK" });
    }
    catch (error) {
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw new errors_1.AppError("DATABASE_CONNECTION_ERROR", 500, "DB_FAILED");
        }
        throw error;
    }
});
exports.viewUserProfile = viewUserProfile;
const decryptUserData = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const params = req.query;
    if (!params.userProfileId)
        throw new errors_1.ValidationError("INVALID REQUIRED ID");
    try {
        const targetUser = yield prisma_1.prisma.user.findUnique({
            where: {
                id: params.userProfileId,
            },
            select: {
                username: true,
                createdAt: true,
                accountId: true,
                status: true,
                firstName: true,
                lastName: true,
                account: {
                    select: {
                        status: true,
                    },
                },
                department: {
                    select: {
                        name: true,
                    },
                },
                email: true,
                emailIv: true,
                submittedApplications: {
                    select: {
                        firstname: true,
                        lastname: true,
                        middleName: true,
                        email: true,
                        emailIv: true,
                        birthDate: true,
                        bdayIv: true,
                        mobileNo: true,
                        ivMobileNo: true,
                        agencyNo: true,
                        agencyNoIv: true,
                        cvilStatus: true,
                        cvilStatusIv: true,
                        pagIbigNo: true,
                        pagIbigNoIv: true,
                        tinNo: true,
                        tinNoIv: true,
                        philSys: true,
                        philSysIv: true,
                        umidNo: true,
                        umidNoIv: true,
                        elementary: true,
                        secondary: true,
                        vocational: true,
                        college: true,
                        graduateCollege: true,
                        civilService: true,
                        children: true,
                        childrenIv: true,
                        fatherFirstname: true,
                        fatherFirstnameIv: true,
                        fatherMiddlename: true,
                        fatherSurname: true,
                        fatherSurnameIv: true,
                        motherFirstname: true,
                        motherFirstnameIv: true,
                        motherMiddlename: true,
                        motherMiddlenameIv: true,
                        motherSurname: true,
                        motherSurnameIv: true,
                        spouseFirstname: true,
                        spouseFirstnameIv: true,
                        spouseMiddle: true,
                        spouseMiddleIv: true,
                        spouseSurname: true,
                        spouseSurnameIv: true,
                        resBarangay: true,
                        resBarangayIv: true,
                        resCity: true,
                        resCityIv: true,
                        resProvince: true,
                        resProvinceIv: true,
                        reshouseBlock: true,
                        reshouseBlockIv: true,
                        resStreet: true,
                        resZipCode: true,
                        resZipCodeIv: true,
                        resStreetIv: true,
                        permaBarangay: true,
                        permaBarangayIv: true,
                        permaCity: true,
                        permaCityIv: true,
                        permaProvince: true,
                        permaStreet: true,
                        permaStreetIv: true,
                        permaZipCode: true,
                        permaZipCodeIv: true,
                        permahouseBlock: true,
                        permahouseBlockIv: true,
                        permaProvinceIv: true,
                        permaSub: true,
                        permaSubIv: true,
                        experience: true,
                    },
                },
                modules: {
                    select: {
                        moduleName: true,
                        id: true,
                    },
                },
            },
        });
        if (!targetUser)
            throw new errors_1.NotFoundError("USER NOT FOUND!");
        console.log({ targetUser });
        // Create a mutable copy of the user object with proper typing
        const decryptedUser = {
            username: targetUser.username,
            createdAt: targetUser.createdAt,
            accountId: targetUser.accountId,
            status: targetUser.status,
            account: targetUser.account,
            modules: targetUser.modules,
            firstName: targetUser.firstName,
            lastName: targetUser.lastName,
            department: targetUser.department,
        };
        // Decrypt submitted application if it exists
        if (targetUser.submittedApplications) {
            const application = targetUser.submittedApplications;
            // Helper function to decrypt field if it exists
            const decryptField = (encryptedData, iv) => __awaiter(void 0, void 0, void 0, function* () {
                if (encryptedData && iv) {
                    try {
                        return yield encryption_1.EncryptionService.decrypt(encryptedData, iv);
                    }
                    catch (error) {
                        console.log(encryptedData, "das", iv);
                        console.error(`Failed to decrypt field:`, error);
                        return encryptedData; // Return original if decryption fails
                    }
                }
                return encryptedData;
            });
            // Create decrypted application object
            const decryptedApplication = {
                firstname: targetUser.submittedApplications.firstname,
                lastname: targetUser.submittedApplications.lastname,
                middleName: targetUser.submittedApplications.middleName,
                elementary: targetUser.submittedApplications.elementary,
                secondary: targetUser.submittedApplications.secondary,
                vocational: targetUser.submittedApplications.vocational,
                college: targetUser.submittedApplications.college,
                graduateCollege: targetUser.submittedApplications.graduateCollege,
                civilService: targetUser.submittedApplications.civilService,
                fatherMiddlename: targetUser.submittedApplications.fatherMiddlename,
                reshouseBlock: targetUser.submittedApplications.reshouseBlock,
                resStreet: targetUser.submittedApplications.resStreet,
                resZipCode: targetUser.submittedApplications.resZipCode,
                permaStreet: targetUser.submittedApplications.permaStreet,
                permaZipCode: targetUser.submittedApplications.permaZipCode,
                permahouseBlock: targetUser.submittedApplications.permahouseBlock,
                permaSub: targetUser.submittedApplications.permaSub,
                experience: targetUser.submittedApplications.experience,
            };
            const permaBarangayCode = yield decryptField(targetUser.submittedApplications.permaBarangay, targetUser.submittedApplications.permaBarangayIv);
            const permaMunicipalCode = yield decryptField(targetUser.submittedApplications.permaCity, targetUser.submittedApplications.permaCityIv);
            const permaProvinceCode = yield decryptField(targetUser.submittedApplications.permaProvince, targetUser.submittedApplications.permaProvinceIv);
            const resBarangayCode = yield decryptField(targetUser.submittedApplications.resBarangay, targetUser.submittedApplications.resBarangayIv);
            const resMuicipalCode = yield decryptField(targetUser.submittedApplications.resCity, targetUser.submittedApplications.resCityIv);
            const resProvinceCode = yield decryptField(targetUser.submittedApplications.resProvince, targetUser.submittedApplications.resProvinceIv);
            // Decrypt each field and assign to decryptedApplication
            decryptedApplication.email = yield decryptField(targetUser.email, targetUser.emailIv);
            decryptedApplication.birthDate = yield decryptField(application.birthDate, application.bdayIv);
            decryptedApplication.mobileNo = yield decryptField(application.mobileNo, application.ivMobileNo);
            decryptedApplication.agencyNo = yield decryptField(application.agencyNo, application.agencyNoIv);
            decryptedApplication.cvilStatus = yield decryptField(application.cvilStatus, application.cvilStatusIv);
            decryptedApplication.pagIbigNo = yield decryptField(application.pagIbigNo, application.pagIbigNoIv);
            decryptedApplication.tinNo = yield decryptField(application.tinNo, application.tinNoIv);
            decryptedApplication.philSys = yield decryptField(application.philSys, application.philSysIv);
            decryptedApplication.umidNo = yield decryptField(application.umidNo, application.umidNoIv);
            decryptedApplication.children = yield decryptField(application.children, application.childrenIv);
            decryptedApplication.fatherFirstname = yield decryptField(application.fatherFirstname, application.fatherFirstnameIv);
            decryptedApplication.fatherSurname = yield decryptField(application.fatherSurname, application.fatherSurnameIv);
            decryptedApplication.motherFirstname = yield decryptField(application.motherFirstname, application.motherFirstnameIv);
            decryptedApplication.motherMiddlename = yield decryptField(application.motherMiddlename, application.motherMiddlenameIv);
            decryptedApplication.motherSurname = yield decryptField(application.motherSurname, application.motherSurnameIv);
            decryptedApplication.spouseFirstname = yield decryptField(application.spouseFirstname, application.spouseFirstnameIv);
            decryptedApplication.spouseMiddle = yield decryptField(application.spouseMiddle, application.spouseMiddleIv);
            decryptedApplication.spouseSurname = yield decryptField(application.spouseSurname, application.spouseSurnameIv);
            const resProvince = resProvinceCode
                ? yield (0, handler_1.getAreaData)(resProvinceCode, 0)
                : null;
            const resMunicipal = resMuicipalCode
                ? yield (0, handler_1.getAreaData)(resMuicipalCode, 1)
                : null;
            const resBarangay = resBarangayCode
                ? yield (0, handler_1.getAreaData)(resBarangayCode, 2)
                : null;
            const permaBarangay = permaBarangayCode
                ? yield (0, handler_1.getAreaData)(permaBarangayCode, 2)
                : null;
            const permaMunicipa = permaMunicipalCode
                ? yield (0, handler_1.getAreaData)(permaMunicipalCode, 1)
                : null;
            const permaProvince = permaProvinceCode
                ? yield (0, handler_1.getAreaData)(permaProvinceCode, 0)
                : null;
            decryptedApplication.resBarangay = resBarangay === null || resBarangay === void 0 ? void 0 : resBarangay.name;
            decryptedApplication.resCity = resMunicipal === null || resMunicipal === void 0 ? void 0 : resMunicipal.name;
            decryptedApplication.resProvince = resProvince === null || resProvince === void 0 ? void 0 : resProvince.name;
            decryptedApplication.permaBarangay = permaBarangay === null || permaBarangay === void 0 ? void 0 : permaBarangay.name;
            decryptedApplication.permaCity = permaMunicipa === null || permaMunicipa === void 0 ? void 0 : permaMunicipa.name;
            decryptedApplication.permaProvince = permaProvince === null || permaProvince === void 0 ? void 0 : permaProvince.name;
            decryptedUser.submittedApplications = decryptedApplication;
        }
        return res.code(200).send(decryptedUser);
    }
    catch (error) {
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw new errors_1.AppError("DATABASE_CONNECTION_ERROR", 500, "DB_FAILED");
        }
        throw error;
    }
});
exports.decryptUserData = decryptUserData;
const supsendAccount = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const body = req.body;
    console.log({ body });
    if (!body.accountId || !body.userId || !body.lineId)
        throw new errors_1.ValidationError("INVALID REQUIRED ID");
    try {
        const response = yield prisma_1.prisma.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            const targetuser = yield tx.account.findUnique({
                where: {
                    id: body.accountId,
                },
            });
            if (!targetuser)
                throw new errors_1.NotFoundError("USER NOT FOUND!");
            if (targetuser.status === 0)
                throw new errors_1.ValidationError("ALREADY SUSPENDED");
            const updated = yield tx.account.update({
                where: {
                    id: targetuser.id,
                },
                data: {
                    status: 2,
                },
            });
            yield tx.humanResourcesLogs.create({
                data: {
                    desc: `Suspend ${updated.username} account.`,
                    userId: body.userId,
                    lineId: body.lineId,
                    action: "UPDATE",
                },
            });
            return "OK";
        }));
        if (!response)
            throw new errors_1.ValidationError("FAILED TO FETCH");
        return res.code(200).send({ message: "OK" });
    }
    catch (error) {
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw new errors_1.AppError("DB_CONNECTION_ERROR", 500, "DB_FAILED");
        }
        throw error;
    }
});
exports.supsendAccount = supsendAccount;
const userModuleAccess = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const params = req.query;
    console.log({ params });
    if (!params.userId || !params.moduleName)
        throw new errors_1.ValidationError("INVALID REQUIRED FIELD");
    try {
        const paths = params.moduleName.split("/");
        console.log({ paths });
        const response = yield prisma_1.prisma.module.findFirst({
            where: {
                moduleName: paths[2],
                userId: params.userId,
            },
        });
        console.log({ response });
        if (!response) {
            yield prisma_1.prisma.activityLogs.create({
                data: {
                    userId: params.userId,
                    action: 2,
                    desc: `Unauthorized access attempt to module: ${params.moduleName}`,
                    lineId: params.lineId,
                },
            });
            return res.code(401).send({ message: "UNAUTHORIZED ACCESS" });
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
exports.userModuleAccess = userModuleAccess;
const deleteUser = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const params = req.query;
    console.log({ params });
    if (!params.id || !params.lineId || !params.userId) {
        throw new errors_1.ValidationError("INVALID REQUIRED ID");
    }
    if (params.id === params.userId) {
        throw new errors_1.ValidationError("INVALID ID");
    }
    try {
        const response = yield prisma_1.prisma.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            const account = yield tx.account.delete({
                where: {
                    id: params.id,
                },
            });
            yield tx.humanResourcesLogs.create({
                data: {
                    userId: params.userId,
                    lineId: params.lineId,
                    action: "DELETE",
                    desc: `REMOVE USER: ${account.username} `,
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
exports.deleteUser = deleteUser;
