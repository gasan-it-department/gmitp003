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
exports.servePhoto = exports.updateProfilePicture = exports.verifyId = exports.userVerifyInfo = exports.restorePersonnel = exports.archivedPersonnel = exports.userRecord = exports.deleteUser = exports.userModuleAccess = exports.supsendAccount = exports.decryptUserData = exports.viewUserProfile = exports.employees = exports.searchUser = exports.getAllEmpoyees = void 0;
const prisma_1 = require("../barrel/prisma");
const errors_1 = require("../errors/errors");
const date_1 = require("../utils/date");
const encryption_1 = require("../service/encryption");
const handler_1 = require("../middleware/handler");
const provisionalController_1 = require("./provisionalController");
const qrcode_1 = __importDefault(require("qrcode"));
const crypto_1 = require("crypto");
const url_1 = require("../service/url");
const idCardController_1 = require("./idCardController");
const getAllEmpoyees = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { page, office, sgFrom, sgTo, year, dateApp, dateLast, lastCursorId, query, } = req.body;
        if (!page) {
            return res.code(400).send({ message: "Bad request" });
        }
        const filter = {};
        // Keep provisional (temporary/contract) staff — and ended provisional
        // engagements — out of the plantilla Employees list. They live in the
        // Provisional > Personnel tab.
        filter.status = { notIn: [...provisionalController_1.PROVISIONAL_STATUSES, provisionalController_1.PROVISIONAL_ENDED] };
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
            where: Object.assign({ lineId: params.id, 
                // Concluded/separated personnel live on the Archived page, not here.
                archivedAt: null }, filter),
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
                middleName: true,
                suffix: true,
                username: true,
                email: true,
                emailIv: true,
                birthDate: true,
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
        // Emails are stored ENCRYPTED — decrypt for display (the list used to
        // render raw ciphertext hex, which read like a meaningless id). A row
        // that can't decrypt (legacy plaintext or missing iv) falls back sanely.
        const list = yield Promise.all(response.map((u) => __awaiter(void 0, void 0, void 0, function* () {
            var _a;
            let email = (_a = u.email) !== null && _a !== void 0 ? _a : null;
            if (u.email && u.emailIv) {
                try {
                    email = yield encryption_1.EncryptionService.decrypt(u.email, u.emailIv);
                }
                catch (_b) {
                    email = null; // undecryptable — hide rather than show garbage
                }
            }
            else if (u.email && /^[0-9a-f]{32,}$/i.test(u.email)) {
                email = null; // ciphertext without iv — never show the hex
            }
            const { emailIv: _iv } = u, rest = __rest(u, ["emailIv"]);
            return Object.assign(Object.assign({}, rest), { email });
        })));
        return res
            .code(200)
            .send({ list, lastCursor: newLastCursorId, hasMore });
    }
    catch (error) {
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw (0, errors_1.dbError)(error);
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
        const response = yield prisma_1.prisma.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            const currUser = yield tx.user.findUnique({
                where: { id: params.userId },
            });
            const targetUser = yield tx.user.findUnique({
                where: { id: params.userProfileId },
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
            throw (0, errors_1.dbError)(error);
        }
        throw error;
    }
});
exports.viewUserProfile = viewUserProfile;
const decryptUserData = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c;
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
                // Position + salary grade so the profile can render the role and
                // level badges. Relations are PascalCase on the User model.
                Position: {
                    select: {
                        id: true,
                        name: true,
                    },
                },
                SalaryGrade: {
                    select: {
                        id: true,
                        grade: true,
                        amount: true,
                    },
                },
                userProfilePictures: { select: { file_url: true } },
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
        // ── Legacy application recovery ──────────────────────────────────
        // Some accounts have no linked SubmittedApplication — either they were
        // created before the application↔user link was wired, or their
        // application was submitted under a different line. Without the link
        // the mobile profile wrongly reports "HR application hasn't been
        // submitted." Recover it by matching the user's name + decrypted email
        // against orphaned applications (userId still null), then self-heal the
        // link so subsequent reads use the direct relation.
        if (!targetUser.submittedApplications) {
            try {
                const decOne = (d, iv) => __awaiter(void 0, void 0, void 0, function* () {
                    if (!d || !iv)
                        return null;
                    try {
                        return yield encryption_1.EncryptionService.decrypt(d, iv);
                    }
                    catch (_a) {
                        return null;
                    }
                });
                const userEmail = (_b = (_a = (yield decOne(targetUser.email, targetUser.emailIv))) === null || _a === void 0 ? void 0 : _a.toLowerCase()) !== null && _b !== void 0 ? _b : null;
                const candidates = yield prisma_1.prisma.submittedApplication.findMany({
                    where: {
                        userId: null,
                        firstname: { equals: targetUser.firstName, mode: "insensitive" },
                        lastname: { equals: targetUser.lastName, mode: "insensitive" },
                    },
                    orderBy: { id: "desc" }, // most-recent submission first
                });
                let recovered = null;
                for (const c of candidates) {
                    // Name + email is a strong identity match. If the user has no
                    // stored email to compare, fall back to the name match alone.
                    if (!userEmail) {
                        recovered = c;
                        break;
                    }
                    const e = (_c = (yield decOne(c.email, c.emailIv))) === null || _c === void 0 ? void 0 : _c.toLowerCase();
                    if (e && e === userEmail) {
                        recovered = c;
                        break;
                    }
                }
                if (recovered) {
                    // Best-effort self-heal — bind the application to this user so we
                    // never need to recover again (ignore unique-constraint races).
                    try {
                        yield prisma_1.prisma.submittedApplication.update({
                            where: { id: recovered.id },
                            data: { userId: params.userProfileId },
                        });
                    }
                    catch (e) {
                        console.warn("[decryptUserData] self-heal link failed:", e);
                    }
                    // Feed the recovered row into the decrypt pipeline below. It's a
                    // superset of the original select, so every field accessed there
                    // is present.
                    targetUser.submittedApplications = recovered;
                }
            }
            catch (e) {
                console.warn("[decryptUserData] application recovery failed:", e);
            }
        }
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
            // Position + salary grade. Expose under both the relation name the
            // web app already reads (Position/SalaryGrade) and a lowercase
            // `position` alias the mobile profile consumes.
            Position: targetUser.Position,
            position: targetUser.Position,
            SalaryGrade: targetUser.SalaryGrade,
            userProfilePictures: targetUser.userProfilePictures,
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
            throw (0, errors_1.dbError)(error);
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
            throw (0, errors_1.dbError)(error);
        }
        throw error;
    }
});
exports.supsendAccount = supsendAccount;
const userModuleAccess = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    // Super-admin impersonation session (imp:true) → full access; skip the
    // per-user module check so access never depends on the target line's setup.
    try {
        const authz = (_a = req.headers.authorization) === null || _a === void 0 ? void 0 : _a.split(" ")[1];
        const decoded = authz
            ? req.server.jwt.decode(authz)
            : null;
        if ((decoded === null || decoded === void 0 ? void 0 : decoded.imp) === true) {
            return res.code(200).send({ message: "OK" });
        }
    }
    catch (_b) {
        /* fall through to the normal per-user check */
    }
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
            throw (0, errors_1.dbError)(error);
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
            throw (0, errors_1.dbError)(error);
        }
        throw error;
    }
});
exports.deleteUser = deleteUser;
// GET /user/record?userId=&lineId=
// Read-only platform history for one person, merged into a single timeline:
//   • appointment — position/slot placements (UnitPositionHistory)
//   • employment  — provisional hire/renew/transfer/end. HR logs are keyed by
//                   the ACTOR, so we match the subject by their plain-text name
//                   inside the log description (how those actions write it).
//   • leave       — leave records (Leave)
//   • activity    — account/system activity (ActivityLogs)
const userRecord = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d, _e, _f;
    const q = req.query;
    if (!q.userId)
        throw new errors_1.ValidationError("INVALID REQUIRED USER ID");
    const user = yield prisma_1.prisma.user.findUnique({
        where: { id: q.userId },
        select: {
            id: true,
            firstName: true,
            lastName: true,
            status: true,
            term: true,
            lineId: true,
        },
    });
    if (!user)
        throw new errors_1.NotFoundError("USER NOT FOUND");
    const lineId = q.lineId || user.lineId || undefined;
    const TAKE = 100;
    const [appointments, leaves, activity, hrLogs] = yield Promise.all([
        prisma_1.prisma.unitPositionHistory.findMany({
            where: { userId: user.id },
            orderBy: { timestamp: "desc" },
            take: TAKE,
            select: {
                id: true,
                timestamp: true,
                unitPost: {
                    select: {
                        designation: true,
                        itemNumber: true,
                        position: { select: { name: true } },
                        unit: { select: { name: true } },
                    },
                },
            },
        }),
        prisma_1.prisma.leave.findMany({
            where: { userId: user.id },
            orderBy: { createdAt: "desc" },
            take: TAKE,
            select: {
                id: true,
                type: true,
                days: true,
                startDate: true,
                endDate: true,
                status: true,
                createdAt: true,
            },
        }),
        prisma_1.prisma.activityLogs.findMany({
            where: { userId: user.id },
            orderBy: { timestamp: "desc" },
            take: TAKE,
            select: { id: true, action: true, desc: true, timestamp: true },
        }),
        lineId
            ? prisma_1.prisma.humanResourcesLogs.findMany({
                where: {
                    lineId,
                    desc: {
                        contains: `${user.firstName} ${user.lastName}`,
                        mode: "insensitive",
                    },
                },
                orderBy: { timestamp: "desc" },
                take: TAKE,
                select: { id: true, action: true, desc: true, timestamp: true },
            })
            : Promise.resolve([]),
    ]);
    const timeline = [];
    for (const a of appointments) {
        const pos = ((_b = (_a = a.unitPost) === null || _a === void 0 ? void 0 : _a.position) === null || _b === void 0 ? void 0 : _b.name) || ((_c = a.unitPost) === null || _c === void 0 ? void 0 : _c.designation) || "a position";
        const bits = [
            (_e = (_d = a.unitPost) === null || _d === void 0 ? void 0 : _d.unit) === null || _e === void 0 ? void 0 : _e.name,
            ((_f = a.unitPost) === null || _f === void 0 ? void 0 : _f.itemNumber) && a.unitPost.itemNumber !== "N/A"
                ? `Item ${a.unitPost.itemNumber}`
                : null,
        ].filter(Boolean);
        timeline.push({
            id: `appt-${a.id}`,
            type: "appointment",
            title: `Appointed to ${pos}`,
            detail: bits.join(" · "),
            timestamp: a.timestamp,
        });
    }
    for (const l of leaves) {
        timeline.push({
            id: `leave-${l.id}`,
            type: "leave",
            title: `${l.type} leave — ${l.status}`,
            detail: `${l.days} day(s) · ${new Date(l.startDate).toLocaleDateString()} – ${new Date(l.endDate).toLocaleDateString()}`,
            timestamp: l.createdAt,
        });
    }
    for (const h of hrLogs) {
        timeline.push({
            id: `hr-${h.id}`,
            type: "employment",
            title: h.desc,
            detail: h.action,
            timestamp: h.timestamp,
        });
    }
    for (const ac of activity) {
        timeline.push({
            id: `act-${ac.id}`,
            type: "activity",
            title: ac.desc || `Activity #${ac.action}`,
            detail: "",
            timestamp: ac.timestamp,
        });
    }
    timeline.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
    return res.code(200).send({
        user: {
            id: user.id,
            firstName: user.firstName,
            lastName: user.lastName,
            status: user.status,
            term: user.term,
        },
        counts: {
            appointment: appointments.length,
            employment: hrLogs.length,
            leave: leaves.length,
            activity: activity.length,
        },
        timeline,
    });
});
exports.userRecord = userRecord;
// GET /archived-personnel?id=lineId&query&lastCursor&limit
// Concluded/separated personnel (plantilla + non-plantilla) — anyone with an
// archivedAt set. Mirrors the Employees select plus status/term/archive info.
const archivedPersonnel = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const params = req.query;
    if (!params.id)
        throw new errors_1.ValidationError("BAD_REQUEST");
    try {
        const cursor = params.lastCursor ? { id: params.lastCursor } : undefined;
        const limit = params.limit ? parseInt(params.limit, 10) : 20;
        const filter = {};
        if (params.query) {
            const q = params.query.trim();
            filter.OR = [
                { lastName: { contains: q, mode: "insensitive" } },
                { firstName: { contains: q, mode: "insensitive" } },
                { middleName: { contains: q, mode: "insensitive" } },
                { username: { contains: q, mode: "insensitive" } },
            ];
        }
        const response = yield prisma_1.prisma.user.findMany({
            where: Object.assign({ lineId: params.id, 
                // "archived" = archivedAt is set. Prisma 7 rejects { not: null }, so
                // express it as NOT { archivedAt: null }.
                NOT: { archivedAt: null } }, filter),
            skip: cursor ? 1 : 0,
            take: limit,
            cursor,
            orderBy: [{ archivedAt: "desc" }, { id: "desc" }],
            select: {
                id: true,
                firstName: true,
                lastName: true,
                middleName: true,
                username: true,
                status: true,
                term: true,
                archivedAt: true,
                archiveReason: true,
                userProfilePictures: { select: { file_url: true } },
                PositionSlot: { select: { pos: { select: { name: true } } } },
                Position: { select: { name: true } },
                department: { select: { name: true, id: true } },
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
            throw (0, errors_1.dbError)(error);
        }
        throw error;
    }
});
exports.archivedPersonnel = archivedPersonnel;
// POST /archived-personnel/restore  { userId, lineId, actorId }
// Un-archive a person and re-enable their account login.
const restorePersonnel = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const body = req.body;
    if (!body.userId || !body.lineId) {
        throw new errors_1.ValidationError("INVALID REQUIRED FIELDS");
    }
    const lineId = body.lineId;
    const actorId = body.actorId;
    const user = yield prisma_1.prisma.user.findFirst({
        where: { id: body.userId, lineId },
        select: {
            id: true,
            firstName: true,
            lastName: true,
            accountId: true,
        },
    });
    if (!user)
        throw new errors_1.NotFoundError("USER NOT FOUND");
    yield prisma_1.prisma.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
        yield tx.user.update({
            where: { id: user.id },
            data: { archivedAt: null, archiveReason: null },
        });
        if (user.accountId) {
            yield tx.account.update({
                where: { id: user.accountId },
                data: { active: true, status: 1 },
            });
        }
        if (actorId) {
            yield tx.humanResourcesLogs.create({
                data: {
                    action: "UPDATE",
                    desc: `RESTORED -> ${user.firstName} ${user.lastName} un-archived and account re-enabled`,
                    lineId,
                    userId: actorId,
                },
            });
        }
    }));
    return res.code(200).send({ message: "OK" });
});
exports.restorePersonnel = restorePersonnel;
// GET /user/verify-info?userId=   (authenticated)
// Returns the employee's verification QR (data URL) + the verify link. The code
// is a stable per-user token (generated once); the QR encodes the public
// /verify-id page so anyone can confirm the ID against the live record.
const userVerifyInfo = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const q = req.query;
    if (!q.userId)
        throw new errors_1.ValidationError("INVALID REQUIRED USER ID");
    const user = yield prisma_1.prisma.user.findUnique({
        where: { id: q.userId },
        select: { id: true, verifyCode: true },
    });
    if (!user)
        throw new errors_1.NotFoundError("USER NOT FOUND");
    let code = user.verifyCode;
    if (!code) {
        code = (0, crypto_1.randomUUID)().replace(/-/g, "");
        yield prisma_1.prisma.user.update({
            where: { id: user.id },
            data: { verifyCode: code },
        });
    }
    const base = ((0, url_1.tempURL)() || "").replace(/\/+$/, "");
    const verifyUrl = `${base}/verify-id?code=${code}`;
    const qr = yield qrcode_1.default.toDataURL(verifyUrl, { margin: 1, width: 1024 });
    // optional ID-card fields (PII) — safe here since this route is authenticated
    const extras = yield (0, idCardController_1.getCardExtras)(user.id);
    return res.code(200).send({ code, verifyUrl, qr, extras });
});
exports.userVerifyInfo = userVerifyInfo;
// GET /id/verify?code=   (PUBLIC — scanned from the ID's QR)
// Confirms whether the code maps to a real, currently-active employee.
const verifyId = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k;
    const q = req.query;
    if (!q.code)
        throw new errors_1.ValidationError("INVALID CODE");
    const user = yield prisma_1.prisma.user.findUnique({
        where: { verifyCode: q.code },
        select: {
            firstName: true,
            lastName: true,
            middleName: true,
            suffix: true,
            status: true,
            archivedAt: true,
            userProfilePictures: { select: { file_url: true } },
            account: { select: { active: true } },
            department: { select: { name: true } },
            Position: { select: { name: true } },
            PositionSlot: { select: { pos: { select: { name: true } } } },
            line: { select: { name: true } },
        },
    });
    if (!user)
        return res.code(200).send({ found: false, valid: false });
    const active = ((_a = user.account) === null || _a === void 0 ? void 0 : _a.active) !== false && !user.archivedAt;
    const position = ((_c = (_b = user.PositionSlot) === null || _b === void 0 ? void 0 : _b.pos) === null || _c === void 0 ? void 0 : _c.name) || ((_d = user.Position) === null || _d === void 0 ? void 0 : _d.name) || user.status || null;
    return res.code(200).send({
        found: true,
        valid: active,
        fullName: [user.firstName, user.middleName, user.lastName, user.suffix]
            .filter(Boolean)
            .join(" "),
        position,
        department: (_f = (_e = user.department) === null || _e === void 0 ? void 0 : _e.name) !== null && _f !== void 0 ? _f : null,
        line: (_h = (_g = user.line) === null || _g === void 0 ? void 0 : _g.name) !== null && _h !== void 0 ? _h : null,
        status: user.status,
        photoUrl: (_k = (_j = user.userProfilePictures) === null || _j === void 0 ? void 0 : _j.file_url) !== null && _k !== void 0 ? _k : null,
    });
});
exports.verifyId = verifyId;
// the API's own public base (so file_url resolves for <img> and the PDF fetch)
const selfBase = (req) => {
    const env = process.env.API_PUBLIC_URL;
    if (env)
        return env.replace(/\/+$/, "");
    const proto = String(req.headers["x-forwarded-proto"] || req.protocol || "http").split(",")[0];
    const host = req.headers["x-forwarded-host"] || req.headers.host;
    return `${proto}://${host}`;
};
// POST /user/profile-picture   (authenticated, multipart)
// Store the picture directly in Postgres (bytea). file_url points to the
// serve endpoint below so every existing consumer keeps working.
const updateProfilePicture = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, e_1, _b, _c, _d, e_2, _e, _f;
    if (!req.isMultipart())
        throw new errors_1.ValidationError("NOT_MULTIPART");
    let userId = "";
    let file = null;
    try {
        for (var _g = true, _h = __asyncValues(req.parts()), _j; _j = yield _h.next(), _a = _j.done, !_a; _g = true) {
            _c = _j.value;
            _g = false;
            const part = _c;
            if (part.type === "file") {
                const chunks = [];
                try {
                    for (var _k = true, _l = (e_2 = void 0, __asyncValues(part.file)), _m; _m = yield _l.next(), _d = _m.done, !_d; _k = true) {
                        _f = _m.value;
                        _k = false;
                        const chunk = _f;
                        chunks.push(chunk);
                    }
                }
                catch (e_2_1) { e_2 = { error: e_2_1 }; }
                finally {
                    try {
                        if (!_k && !_d && (_e = _l.return)) yield _e.call(_l);
                    }
                    finally { if (e_2) throw e_2.error; }
                }
                file = {
                    filename: part.filename,
                    mimetype: part.mimetype,
                    buffer: Buffer.concat(chunks),
                };
            }
            else if (part.fieldname === "userId") {
                userId = String(part.value);
            }
        }
    }
    catch (e_1_1) { e_1 = { error: e_1_1 }; }
    finally {
        try {
            if (!_g && !_a && (_b = _h.return)) yield _b.call(_h);
        }
        finally { if (e_1) throw e_1.error; }
    }
    if (!userId || !file)
        throw new errors_1.ValidationError("MISSING_FILE_OR_USER");
    if (!file.mimetype.startsWith("image/"))
        throw new errors_1.ValidationError("FILE_MUST_BE_AN_IMAGE");
    if (file.buffer.length > 8 * 1024 * 1024)
        throw new errors_1.ValidationError("IMAGE_TOO_LARGE");
    const user = yield prisma_1.prisma.user.findUnique({
        where: { id: userId },
        select: { id: true },
    });
    if (!user)
        throw new errors_1.NotFoundError("USER NOT FOUND");
    // cache-busting URL so the avatar refreshes after each re-upload
    const fileUrl = `${selfBase(req)}/user/photo/${userId}?v=${Date.now()}`;
    const data = {
        file_name: file.filename || "avatar",
        file_url: fileUrl,
        file_public_id: "",
        file_size: String(file.buffer.length),
        file_type: "image",
        mime: file.mimetype,
        bytes: file.buffer,
    };
    const saved = yield prisma_1.prisma.userProfilePicture.upsert({
        where: { userId },
        update: data,
        create: Object.assign({ userId }, data),
    });
    return res.code(200).send({ file_url: saved.file_url });
});
exports.updateProfilePicture = updateProfilePicture;
// GET /user/photo/:userId   (PUBLIC — used as an <img> src)
// Streams the bytea image stored in Postgres.
const servePhoto = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { userId } = req.params;
    if (!userId)
        throw new errors_1.ValidationError("BAD_REQUEST");
    const pic = yield prisma_1.prisma.userProfilePicture.findUnique({
        where: { userId },
        select: { bytes: true, mime: true },
    });
    if (!(pic === null || pic === void 0 ? void 0 : pic.bytes))
        return res.code(404).send({ message: "No photo" });
    return res
        .header("Content-Type", pic.mime || "image/jpeg")
        .header("Cache-Control", "public, max-age=300")
        .send(Buffer.from(pic.bytes));
});
exports.servePhoto = servePhoto;
