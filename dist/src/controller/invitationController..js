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
exports.submitToInvitationLink = exports.suspendInvitationLink = exports.deleteInvitationLink = exports.containerOverview = exports.invitations = exports.invitationAuth = exports.createInvitationLink = void 0;
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
/**
 * Generate a unique 6-digit invitation code. Retries until findFirst returns
 * null for the candidate. Kept short because the previous implementation
 * picked a single number and looped against the same value forever.
 */
const generateInvitationCode = (tx) => __awaiter(void 0, void 0, void 0, function* () {
    for (let attempt = 0; attempt < 20; attempt++) {
        const candidate = Math.floor(100000 + Math.random() * 900000).toString();
        const clash = yield tx.invitationLink.findFirst({
            where: { code: candidate },
            select: { id: true },
        });
        if (!clash)
            return candidate;
    }
    throw new errors_1.AppError("CODE_GEN_FAILED", 500, "Could not generate a unique invitation code.");
});
const createInvitationLink = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const body = req.body;
        if (!body || !body.lineId) {
            throw new errors_1.ValidationError("Line is required");
        }
        // Build expiresAt. Default is 24 h from now if the caller didn't pick
        // a date.
        let expiresAt;
        if (body.date && body.time) {
            expiresAt = new Date(`${body.date}T${body.time}:00`);
        }
        else if (body.date) {
            expiresAt = new Date(`${body.date}T23:59:59`);
        }
        else {
            expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
        }
        if (Number.isNaN(expiresAt.getTime())) {
            throw new errors_1.ValidationError("Invalid expiration date.");
        }
        if (expiresAt <= new Date()) {
            throw new errors_1.ValidationError("Expiration must be in the future.");
        }
        const created = yield prisma_1.prisma.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            const code = yield generateInvitationCode(tx);
            const row = yield tx.invitationLink.create({
                data: {
                    code,
                    expiresAt,
                    url: "",
                    used: false,
                    lineId: body.lineId,
                    status: 1,
                },
            });
            // Persist the public URL using the row id we just created.
            return tx.invitationLink.update({
                where: { id: row.id },
                data: { url: `/invitation/${row.id}` },
            });
        }));
        return res.code(200).send({
            message: "OK",
            id: created.id,
            code: created.code,
            url: created.url,
            expiresAt: created.expiresAt,
        });
    }
    catch (error) {
        if (error instanceof errors_1.ValidationError)
            throw error;
        if (error instanceof errors_1.AppError)
            throw error;
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw (0, errors_1.dbError)(error);
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
/**
 * Paginated list of active invitation links for a line.
 *
 * Excludes soft-deleted rows (status = 0). Computes an effective status
 * on the fly: any non-suspended row whose expiresAt has passed is
 * surfaced as `effectiveStatus: 3` (expired) so the UI can label it
 * accurately without needing a cron sweep.
 *
 * Status convention (matches utils/helper.inviteLinkStatus on the FE):
 *   0 = removed (filtered out)
 *   1 = active
 *   2 = suspended
 *   3 = expired
 */
const invitations = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const params = req.query;
    if (!params.id)
        throw new errors_1.ValidationError("BAD_REQUEST");
    try {
        const cursor = params.lastCursor ? { id: params.lastCursor } : undefined;
        const limit = params.limit ? parseInt(params.limit, 10) : 30;
        const where = { lineId: params.id, status: { not: 0 } };
        if (params.query) {
            where.code = { contains: params.query.trim(), mode: "insensitive" };
        }
        const rows = yield prisma_1.prisma.invitationLink.findMany({
            where,
            take: limit,
            skip: cursor ? 1 : 0,
            orderBy: { createdAt: "desc" },
            cursor,
        });
        const now = new Date();
        const list = rows.map((r) => (Object.assign(Object.assign({}, r), { effectiveStatus: r.status === 1 && r.expiresAt && r.expiresAt <= now ? 3 : r.status })));
        const newLastCursorId = list.length ? list[list.length - 1].id : null;
        const hasMore = list.length === limit;
        return res.code(200).send({
            list,
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
/**
 * Soft-delete an invitation link. Marks status = 0 so the row disappears
 * from the list but stays in the DB for any historical references (e.g.
 * a registration that used this code).
 */
const deleteInvitationLink = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const params = req.query;
    if (!params.id || !params.lineId || !params.userId) {
        throw new errors_1.ValidationError("BAD_REQUEST");
    }
    try {
        const link = yield prisma_1.prisma.invitationLink.findUnique({
            where: { id: params.id },
        });
        if (!link)
            throw new errors_1.NotFoundError("Invitation link not found");
        if (link.status === 0)
            return res.code(200).send({ message: "OK" });
        yield prisma_1.prisma.invitationLink.update({
            where: { id: link.id },
            data: { status: 0 },
        });
        return res.code(200).send({ message: "OK", id: link.id });
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
exports.deleteInvitationLink = deleteInvitationLink;
/**
 * Toggle an invitation link between active (1) and suspended (2).
 * Refuses to flip a removed (0) or expired link.
 */
const suspendInvitationLink = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const body = req.body;
    if (!body.id || !body.lineId)
        throw new errors_1.ValidationError("BAD_REQUEST");
    try {
        const link = yield prisma_1.prisma.invitationLink.findUnique({
            where: { id: body.id },
        });
        if (!link)
            throw new errors_1.NotFoundError("Invitation link not found");
        if (link.status === 0) {
            throw new errors_1.ValidationError("Cannot modify a removed link.");
        }
        const nextStatus = body.suspend ? 2 : 1;
        if (link.status === nextStatus) {
            return res.code(200).send({ message: "OK", status: link.status });
        }
        const updated = yield prisma_1.prisma.invitationLink.update({
            where: { id: link.id },
            data: { status: nextStatus },
        });
        return res.code(200).send({ message: "OK", status: updated.status });
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
exports.suspendInvitationLink = suspendInvitationLink;
const submitToInvitationLink = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, e_1, _b, _c, _d, e_2, _e, _f;
    var _g, _h;
    if (!req.isMultipart())
        throw new Error("NOT MULTI PARTS");
    try {
        const parts = req.parts();
        const formData = {};
        const files = [];
        const uploads = [];
        let profilePicture = null;
        try {
            for (var _j = true, parts_1 = __asyncValues(parts), parts_1_1; parts_1_1 = yield parts_1.next(), _a = parts_1_1.done, !_a; _j = true) {
                _c = parts_1_1.value;
                _j = false;
                const part = _c;
                if (part.type === "file") {
                    const buffers = [];
                    try {
                        for (var _k = true, _l = (e_2 = void 0, __asyncValues(part.file)), _m; _m = yield _l.next(), _d = _m.done, !_d; _k = true) {
                            _f = _m.value;
                            _k = false;
                            const chunk = _f;
                            buffers.push(chunk);
                        }
                    }
                    catch (e_2_1) { e_2 = { error: e_2_1 }; }
                    finally {
                        try {
                            if (!_k && !_d && (_e = _l.return)) yield _e.call(_l);
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
                if (!_j && !_a && (_b = parts_1.return)) yield _b.call(parts_1);
            }
            finally { if (e_1) throw e_1.error; }
        }
        // Invitation-link registration is LINE-level (no specific job post /
        // position). Validate the invitation and use its line.
        const invitation = yield prisma_1.prisma.invitationLink.findUnique({
            where: { id: formData.invitationId },
            select: {
                id: true,
                lineId: true,
                status: true,
                line: { select: { id: true, name: true } },
            },
        });
        if (!invitation) {
            throw new errors_1.NotFoundError("INVITATION NOT FOUND");
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
                // spouse (top-level form fields)
                spouseSurname: formData.spouseSurname,
                spouseFirstname: formData.spouseFirstname,
                spouseMiddle: formData.spouseMiddle,
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
                // CS Form 212 sections VI–VIII + references + disclosures.
                voluntaryWork: parseArrayField("voluntaryWork", []),
                learningDev: parseArrayField("learningDev", []),
                otherInfo: parseArrayField("otherInfo", []),
                references: parseArrayField("references", []),
                disclosures: parseObjectField("disclosures", {}),
                // gov ID - use object parser
                govId: parseObjectField("govId", {
                    type: "",
                    number: "",
                    dateIssuance: "",
                    placeIssuance: "",
                }),
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
            spouseSurname: clean.spouseSurname,
            spouseFirstname: clean.spouseFirstname,
            spouseMiddle: clean.spouseMiddle,
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
            var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s, _t, _u, _v, _w, _x, _y, _z, _0, _1, _2, _3, _4, _5, _6, _7, _8, _9, _10, _11, _12, _13, _14, _15, _16, _17, _18, _19, _20, _21, _22, _23, _24, _25, _26;
            // Municipal is only used for the confirmation email greeting — it's
            // optional. A line-level invitation only needs the invitation's line.
            const municipal = formData.municipalId
                ? yield tx.municipal.findUnique({ where: { id: formData.municipalId } })
                : null;
            const orgName = (_c = (_a = municipal === null || municipal === void 0 ? void 0 : municipal.name) !== null && _a !== void 0 ? _a : (_b = invitation.line) === null || _b === void 0 ? void 0 : _b.name) !== null && _c !== void 0 ? _c : "the LGU";
            // Handle missing parent age fields safely
            const fatherAge = parseInt((_d = formData["father[age]"]) !== null && _d !== void 0 ? _d : "0") || 0;
            const motherAge = parseInt((_e = formData["mother[age]"]) !== null && _e !== void 0 ? _e : "0") || 0;
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
                email: ((_f = encrypted.email) === null || _f === void 0 ? void 0 : _f.encryptedData) || "",
                emailIv: ((_g = encrypted.email) === null || _g === void 0 ? void 0 : _g.iv) || "",
                cvilStatus: ((_h = encrypted.civilStatus) === null || _h === void 0 ? void 0 : _h.encryptedData) || "",
                cvilStatusIv: ((_j = encrypted.civilStatus) === null || _j === void 0 ? void 0 : _j.iv) || "",
                birthDate: ((_k = encrypted.birthDate) === null || _k === void 0 ? void 0 : _k.encryptedData) || "",
                bdayIv: ((_l = encrypted.birthDate) === null || _l === void 0 ? void 0 : _l.iv) || "",
                gender: formData.gender || "male",
                filipino: clean.citizenship === "filipino",
                dualCitizen: clean.citizenship === "dual",
                byBirth: String(clean.dualCitizen || "").toLowerCase().includes("birth"),
                byNatural: String(clean.dualCitizen || "")
                    .toLowerCase()
                    .includes("atural"),
                // REQUIRED → NO ENCRYPTION
                dualCitizenHalf: clean.country || "N/A",
                // RESIDENTIAL ADDRESS
                resProvince: ((_m = encrypted.resProvince) === null || _m === void 0 ? void 0 : _m.encryptedData) || "",
                resProvinceIv: ((_o = encrypted.resProvince) === null || _o === void 0 ? void 0 : _o.iv) || "",
                resCity: ((_p = encrypted.resCity) === null || _p === void 0 ? void 0 : _p.encryptedData) || "",
                resCityIv: ((_q = encrypted.resCity) === null || _q === void 0 ? void 0 : _q.iv) || "",
                resBarangay: ((_r = encrypted.resBarangay) === null || _r === void 0 ? void 0 : _r.encryptedData) || "",
                resBarangayIv: ((_s = encrypted.resBarangay) === null || _s === void 0 ? void 0 : _s.iv) || "",
                resZipCode: clean.resZipCode || "",
                resZipCodeIv: null,
                // PERMANENT ADDRESS
                permaProvince: ((_t = encrypted.permaProvince) === null || _t === void 0 ? void 0 : _t.encryptedData) || "",
                permaProvinceIv: ((_u = encrypted.permaProvince) === null || _u === void 0 ? void 0 : _u.iv) || "",
                permaCity: ((_v = encrypted.permaCity) === null || _v === void 0 ? void 0 : _v.encryptedData) || "",
                permaCityIv: ((_w = encrypted.permaCity) === null || _w === void 0 ? void 0 : _w.iv) || "",
                permaBarangay: ((_x = encrypted.permaBarangay) === null || _x === void 0 ? void 0 : _x.encryptedData) || "",
                permaBarangayIv: ((_y = encrypted.permaBarangay) === null || _y === void 0 ? void 0 : _y.iv) || "",
                permaZipCode: clean.permaZipCode || "",
                permaZipCodeIv: null,
                // CONTACTS
                mobileNo: ((_z = encrypted.mobileNo) === null || _z === void 0 ? void 0 : _z.encryptedData) || "",
                ivMobileNo: ((_0 = encrypted.mobileNo) === null || _0 === void 0 ? void 0 : _0.iv) || "",
                teleNo: formData.telephoneNumber || "",
                // PHYSICAL INFO
                height: parseFloat(formData.height) || 0,
                weight: parseFloat(formData.weight) || 0,
                bloodType: formData.bloodType || "N/A",
                // PARENTS — REQUIRED FIELDS
                fatherSurname: ((_1 = encrypted.fatherSurname) === null || _1 === void 0 ? void 0 : _1.encryptedData) || "N/A",
                fatherSurnameIv: ((_2 = encrypted.fatherSurname) === null || _2 === void 0 ? void 0 : _2.iv) || null,
                fatherFirstname: ((_3 = encrypted.fatherFirstname) === null || _3 === void 0 ? void 0 : _3.encryptedData) || "N/A",
                fatherFirstnameIv: ((_4 = encrypted.fatherFirstname) === null || _4 === void 0 ? void 0 : _4.iv) || null,
                fatherAge: fatherAge,
                motherSurname: ((_5 = encrypted.motherSurname) === null || _5 === void 0 ? void 0 : _5.encryptedData) || "N/A",
                motherSurnameIv: ((_6 = encrypted.motherSurname) === null || _6 === void 0 ? void 0 : _6.iv) || null,
                motherFirstname: ((_7 = encrypted.motherFirstname) === null || _7 === void 0 ? void 0 : _7.encryptedData) || "N/A",
                motherFirstnameIv: ((_8 = encrypted.motherFirstname) === null || _8 === void 0 ? void 0 : _8.iv) || null,
                motherAge: motherAge,
                // SPOUSE
                spouseSurname: ((_9 = encrypted.spouseSurname) === null || _9 === void 0 ? void 0 : _9.encryptedData) || "N/A",
                spouseSurnameIv: ((_10 = encrypted.spouseSurname) === null || _10 === void 0 ? void 0 : _10.iv) || null,
                spouseFirstname: ((_11 = encrypted.spouseFirstname) === null || _11 === void 0 ? void 0 : _11.encryptedData) || "N/A",
                spouseFirstnameIv: ((_12 = encrypted.spouseFirstname) === null || _12 === void 0 ? void 0 : _12.iv) || null,
                spouseMiddle: ((_13 = encrypted.spouseMiddle) === null || _13 === void 0 ? void 0 : _13.encryptedData) || "N/A",
                spouseMiddleIv: ((_14 = encrypted.spouseMiddle) === null || _14 === void 0 ? void 0 : _14.iv) || null,
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
                // CS Form 212 sections VI–VIII + references + disclosures (Json/Json[])
                voluntaryWork: clean.voluntaryWork,
                learningDev: clean.learningDev,
                otherInfo: clean.otherInfo,
                references: clean.references,
                disclosures: clean.disclosures,
                // GOV ID - This is a Json field (pass object directly)
                govId: clean.govId,
                umidNo: ((_15 = encrypted.umidNo) === null || _15 === void 0 ? void 0 : _15.encryptedData) || "N/A",
                umidNoIv: ((_16 = encrypted.umidNo) === null || _16 === void 0 ? void 0 : _16.iv) || null,
                pagIbigNo: ((_17 = encrypted.pagIbigNo) === null || _17 === void 0 ? void 0 : _17.encryptedData) || "N/A",
                pagIbigNoIv: ((_18 = encrypted.pagIbigNo) === null || _18 === void 0 ? void 0 : _18.iv) || null,
                philHealthNo: ((_19 = encrypted.philHealthNo) === null || _19 === void 0 ? void 0 : _19.encryptedData) || "N/A",
                philHealthNoIv: ((_20 = encrypted.philHealthNo) === null || _20 === void 0 ? void 0 : _20.iv) || null,
                philSys: ((_21 = encrypted.philSys) === null || _21 === void 0 ? void 0 : _21.encryptedData) || "N/A",
                philSysIv: ((_22 = encrypted.philSys) === null || _22 === void 0 ? void 0 : _22.iv) || null,
                tinNo: ((_23 = encrypted.tinNo) === null || _23 === void 0 ? void 0 : _23.encryptedData) || "N/A",
                tinNoIv: ((_24 = encrypted.tinNo) === null || _24 === void 0 ? void 0 : _24.iv) || null,
                agencyNo: ((_25 = encrypted.agencyNo) === null || _25 === void 0 ? void 0 : _25.encryptedData) || "N/A",
                agencyNoIv: ((_26 = encrypted.agencyNo) === null || _26 === void 0 ? void 0 : _26.iv) || null,
                // job linking — invitation registration is line-level (no position)
                lineId: invitation.lineId,
                positionId: null,
                unitPositionId: null,
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
            return { applicationId: application.id, orgName };
        }));
        // Confirmation email + SMS are NON-FATAL and run OUTSIDE the transaction:
        // the application is already committed, so a mail/SMS failure must never
        // roll it back or 500 the request.
        const lineName = (_h = (_g = invitation.line) === null || _g === void 0 ? void 0 : _g.name) !== null && _h !== void 0 ? _h : result.orgName;
        if (formData.email) {
            try {
                yield (0, handler_1.sendEmail)("Application Received", formData.email, `Dear ${formData.firstName} ${formData.lastName},

This is to confirm that we have successfully received your application at ${lineName}.

We will inform you of any further instructions regarding the next steps in the hiring process once your application has been reviewed.

You can check the status of your application by clicking this link: ${officialUrl}/public/application/${result.applicationId}

Sincerely,
The HR Team
${result.orgName}`, `${result.orgName} HR Team`);
            }
            catch (mailErr) {
                console.warn("[invitation submit] confirmation email failed:", mailErr instanceof Error ? mailErr.message : mailErr);
            }
        }
        if (formData.mobileNo && Semaphore_1.semaphoreKey) {
            try {
                const contact = (0, handler_1.phNumberFormat)(formData.mobileNo);
                yield axios_1.axios.post(`https://api.semaphore.co/api/v4/messages`, {
                    number: contact,
                    message: `Dear ${formData.firstName} ${formData.lastName},

This is to confirm that we have successfully received your application at ${lineName}.

We will inform you of any further instructions regarding the next steps in the hiring process once your application has been reviewed.

Sincerely,
The HR Team
${result.orgName}`,
                    apikey: Semaphore_1.semaphoreKey,
                }, { headers: { "Content-Type": "application/json" } });
            }
            catch (smsErr) {
                console.warn("[invitation submit] confirmation SMS failed:", smsErr instanceof Error ? smsErr.message : smsErr);
            }
        }
        return res.send({
            success: true,
            applicationId: result.applicationId,
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
