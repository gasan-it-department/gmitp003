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
exports.submitToInvitationLink = exports.deleteInvitationLink = exports.containerOverview = exports.invitations = exports.invitationAuth = exports.createInvitationLink = void 0;
const path_1 = __importDefault(require("path"));
const prisma_1 = require("../barrel/prisma");
const errors_1 = require("../errors/errors");
const handler_1 = require("../middleware/handler");
const encryption_1 = require("../service/encryption");
const fs_1 = __importDefault(require("fs"));
const Cloundinary_1 = __importDefault(require("../class/Cloundinary"));
const axios_1 = require("../db/axios");
const Semaphore_1 = require("../class/Semaphore");
const officialUrl = process.env.VITE_LOCAL_FRONTEND_URL;
const createInvitationLink = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const body = req.body;
        if (!body) {
            return res.code(400).send({ message: "Invalid request" });
        }
        // Calculate expiresAt based on date and time
        let expiresAt;
        if (body.date && body.time) {
            // Combine date "2025-10-25" and time "16:00" into ISO string
            const dateTimeString = `${body.date}T${body.time}:00`; // Add seconds
            expiresAt = new Date(dateTimeString);
        }
        else if (body.date) {
            // If only date is provided, set time to end of day (23:59:59)
            const dateTimeString = `${body.date}T23:59:59`;
            expiresAt = new Date(dateTimeString);
        }
        else {
            // If no date provided, use default expiration (24 hours from now)
            expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
        }
        // Validate that the expiration date is in the future
        if (expiresAt <= new Date()) {
            throw new errors_1.ValidationError("INVALID_DATA");
        }
        yield prisma_1.prisma.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            const generatedInvitationCode = () => __awaiter(void 0, void 0, void 0, function* () {
                let isUnique = false;
                const generated = Math.floor(100000 + Math.random() * 900000);
                while (!isUnique) {
                    const check = yield tx.invitationLink.findFirst({
                        where: {
                            code: generated.toString(),
                        },
                    });
                    if (!check)
                        isUnique = true;
                }
                return generated.toString();
            });
            const code = yield generatedInvitationCode();
            const newInviteLink = yield tx.invitationLink.create({
                data: {
                    code: code,
                    expiresAt: expiresAt,
                    url: "none",
                    used: false,
                    lineId: body.lineId,
                },
            });
            if (!newInviteLink)
                throw new errors_1.AppError("DB_CONNECTION_FAILED", 400, "DB_ERROR");
            yield tx.invitationLink.update({
                where: { id: newInviteLink.id },
                data: {
                    url: `/invitation/${newInviteLink.id}`,
                },
            });
        }));
        return res.code(201).send({
            message: "Invitation link created successfully",
            error: 0,
        });
    }
    catch (error) {
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw new errors_1.AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
        }
        throw error;
    }
});
exports.createInvitationLink = createInvitationLink;
const invitationAuth = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const body = req.query;
        console.log({ body });
        if (body.id === undefined || body.id === null) {
            throw new errors_1.ValidationError("BAD_REQUEST");
        }
        const invitations = yield prisma_1.prisma.invitationLink.findUnique({
            where: {
                id: body.id,
            },
            include: {
                line: {
                    select: {
                        barangay: {
                            select: {
                                name: true,
                            },
                        },
                        municipal: {
                            select: {
                                name: true,
                            },
                        },
                        province: {
                            select: {
                                name: true,
                            },
                        },
                        name: true,
                    },
                },
            },
        });
        const currentDate = new Date();
        let response;
        // if (!invitations) {
        //   response = {
        //     message: "Application link not found",
        //     error: 0,
        //     data: invitations,
        //   };
        // } else if (invitations?.expiresAt && invitations.expiresAt < currentDate) {
        //   response = {
        //     message: "Application link has expired",
        //     error: 1,
        //     data: invitations,
        //   };
        // } else if (invitations?.status === 2) {
        //   response = {
        //     message: "Application link maybe suspeded or removed",
        //     error: 2,
        //     data: invitations,
        //   };
        // } else {
        //   response = {
        //     message: "Invitation link is valid",
        //     data: {
        //       ...invitations,
        //     },
        //   };
        // }
        return res.code(200).send({ data: invitations });
    }
    catch (error) {
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw new errors_1.AppError("DB_CONNECTION_ERROR", 500, "DB_FAILED");
        }
        throw error;
    }
});
exports.invitationAuth = invitationAuth;
const invitations = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const params = req.query;
    if (!params.id)
        throw new errors_1.ValidationError("BAD_REQUEST");
    try {
        const cursor = params.lastCursor ? { id: params.lastCursor } : undefined;
        const limit = params.limit ? parseInt(params.limit, 10) : 30;
        const response = yield prisma_1.prisma.invitationLink.findMany({
            where: {
                lineId: params.id,
            },
            take: limit,
            skip: cursor ? 1 : 0,
            orderBy: {
                createdAt: "desc",
            },
            cursor,
        });
        const newLastCursorId = response.length
            ? response[response.length - 1].id
            : null;
        const hasMore = response.length === limit;
        res.code(200).send({
            list: response,
            lastCursor: newLastCursorId,
            hasMore,
        });
    }
    catch (error) {
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw new errors_1.AppError("DB_CONNECTION_ERROR", 500, "DB_FAILED");
        }
        throw error;
    }
});
exports.invitations = invitations;
const containerOverview = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const params = req.query;
    if (!params.inventoryBoxId)
        throw new errors_1.ValidationError("Required is missing!");
    try {
        const container = yield prisma_1.prisma.inventoryBox.findUnique({
            where: {
                id: params.inventoryBoxId,
            },
            include: {
                _count: {
                    select: {},
                },
            },
        });
        if (!container) {
            throw new errors_1.NotFoundError("Container not found!");
        }
        res.code(200).send({ data: container });
    }
    catch (error) {
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw new errors_1.AppError("DB CONNECTION FAILED", 500, "DB_ERROR");
        }
        throw error;
    }
});
exports.containerOverview = containerOverview;
const deleteInvitationLink = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const params = req.query;
    console.log("recieve", { params });
    if (!params.id || !params.lineId || !params.userId)
        throw new errors_1.ValidationError("BAD_REQUEST");
    try {
        const links = yield prisma_1.prisma.invitationLink.findMany();
        console.log({ links });
        yield prisma_1.prisma.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            yield tx.invitationLink.delete({
                where: {
                    id: params.id,
                },
            });
        }));
        return res.code(200).send({ message: "OK" });
    }
    catch (error) {
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw new errors_1.AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
        }
        throw error;
    }
});
exports.deleteInvitationLink = deleteInvitationLink;
const submitToInvitationLink = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
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
        const jobPost = yield prisma_1.prisma.jobPost.findUnique({
            where: {
                id: formData.jobPostId,
            },
            select: {
                id: true,
                unitPositionId: true,
            },
        });
        if (!jobPost) {
            throw new errors_1.NotFoundError("JOB POST NOT FOUND");
        }
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
        const result = yield prisma_1.prisma.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s, _t, _u, _v, _w, _x, _y, _z, _0, _1, _2, _3, _4, _5, _6, _7, _8, _9, _10, _11, _12, _13, _14, _15, _16, _17, _18;
            const municipal = yield tx.municipal.findUnique({
                where: { id: formData.municipalId },
            });
            const position = yield tx.position.findUnique({
                where: { id: formData.positionId },
                include: { line: true },
            });
            if (!municipal || !position) {
                throw new errors_1.ValidationError("INVALID REQUIRED DATA");
            }
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
                lineId: (_18 = position.line) === null || _18 === void 0 ? void 0 : _18.id,
                positionId: formData.positionId,
                unitPositionId: jobPost.unitPositionId,
                // REQUIRED Date
                batch: new Date(),
            };
            console.log("Application Data: ", { applicationData });
            // Add profile picture relation if it exists
            if (profilePicture) {
                applicationData.applicationProfilePicId = profilePicture.id;
            }
            const application = yield tx.submittedApplication.create({
                data: applicationData,
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
            if (formData.email) {
                const sebtEmail = yield (0, handler_1.sendEmail)("Application Received", formData.email, `
Dear ${formData.firstName} ${formData.lastName},
          
          This is to confirm that we have successfully received your application for the position of ${position.name} at ${municipal.name}.
          
          We will inform you of any further instructions regarding the next steps in the hiring process once your application has been reviewed.
          
          You can check the status of your application by clicking this link: ${officialUrl}public/application/${application.id}
          
          Sincerely,
          The HR Team
          ${municipal.name}
          `, `${municipal.name} HR Team <no-reply@${municipal.name}.gov.ph>`);
                // console.log({ sebtEmail });
            }
            if (formData.mobileNo && Semaphore_1.semaphoreKey) {
                const contact = (0, handler_1.phNumberFormat)(formData.mobileNo);
                yield axios_1.axios.post(`https://api.semaphore.co/api/v4/messages`, {
                    number: contact,
                    message: `Dear ${formData.firstName} ${formData.lastName},

This is to confirm that we have successfully received your application for the position of ${position.name} at ${municipal.name}.

We will inform you of any further instructions regarding the next steps in the hiring process once your application has been reviewed.

Sincerely,
The HR Team
${municipal.name}`,
                    apikey: Semaphore_1.semaphoreKey,
                }, {
                    headers: {
                        "Content-Type": "application/json",
                    },
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
        return res.status(500).send({
            success: false,
            message: "Failed to submit application",
            error: err instanceof Error ? err.message : "Unknown error",
        });
    }
});
exports.submitToInvitationLink = submitToInvitationLink;
