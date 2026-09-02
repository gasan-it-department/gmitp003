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
exports.applicationDeleteMany = exports.deleteApplication = exports.applicationRegisterUser = exports.concludeApplication = exports.updateApplicationStatus = exports.updatePublicApplication = exports.editApplicationContact = exports.reuploadApplicationFile = exports.withdrawApplication = exports.sendPublicApplicationMessage = exports.adminApplicationSendConversation = exports.applicationConvertion = exports.exportPersonalDataSheet = exports.contactManyApplicants = exports.contactApplicant = exports.applicationData = exports.applicationList = exports.submitApplication = exports.jobPost = exports.postJobRequirementsRemoveAsset = exports.removePostJobRequirements = exports.updatePostJobRequiments = exports.postJobRequirements = exports.createPobJobRequirements = exports.updatePostJob = exports.updatePostApplication = exports.postJob = exports.applications = void 0;
const prisma_1 = require("../barrel/prisma");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const Cloundinary_1 = __importDefault(require("../class/Cloundinary"));
const argon2_1 = __importDefault(require("argon2"));
const encryption_1 = require("../service/encryption");
const errors_1 = require("../errors/errors");
const Semaphore_1 = require("../class/Semaphore");
const handler_1 = require("../middleware/handler");
const positionController_1 = require("./positionController");
const __1 = require("..");
const Semaphore_2 = require("../class/Semaphore");
const axios_1 = __importDefault(require("axios"));
const officialUrl = process.env.VITE_LOCAL_FRONTEND_URL;
const applications = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const params = req.query;
    if (!params.id) {
        throw new errors_1.ValidationError("BAD_REQUEST");
    }
    try {
        const cursor = params.lastCursor ? { id: params.lastCursor } : null;
        const limit = params.limit ? parseInt(params.limit) : 20;
        const response = yield prisma_1.prisma.application.findMany({
            where: {
                lineId: params.id,
            },
            take: limit,
            skip: cursor ? 1 : 0,
            orderBy: {
                createdAt: "desc",
            },
        });
        const newLastCursorId = response.length > 0 ? response[response.length - 1].id : null;
        const hasMore = limit === response.length;
        return res
            .code(200)
            .send({ list: response, hasMore, lastCursor: newLastCursorId });
    }
    catch (error) {
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw new errors_1.AppError("DATABASE_CONNECTION_FAILED", 500, "DB_ERROR");
        }
        throw error;
    }
});
exports.applications = applications;
const postJob = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const body = req.body;
    if (!body.id || !body.lineId)
        throw new errors_1.ValidationError("BAD_REQUEST");
    try {
        const response = yield prisma_1.prisma.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            const position = yield tx.unitPosition.findUnique({
                where: {
                    id: body.id,
                },
                include: {
                    position: {
                        select: {
                            name: true,
                        },
                    },
                },
            });
            if (!position)
                throw new errors_1.NotFoundError("Position not found!");
            const check = yield tx.jobPost.findFirst({
                where: {
                    positionId: position.positionId,
                    lineId: body.lineId,
                    status: 1,
                },
            });
            let jobPost;
            if (!check) {
                jobPost = yield tx.jobPost.create({
                    data: {
                        positionId: position.positionId,
                        hideSG: body.hideSG ? body.hideSG : false,
                        slot: 1,
                        status: 0,
                        salaryGradeId: null,
                        location: body.location ? body.location : "N/A",
                        showApplicationCount: body.showApplicationCount
                            ? body.showApplicationCount
                            : false,
                        lineId: body.lineId,
                        unitPositionId: position.id,
                    },
                });
                yield tx.humanResourcesLogs.create({
                    data: {
                        action: "ADDED",
                        userId: body.userId,
                        lineId: body.lineId,
                        desc: `New job posting created: ${position.position.name || position.designation} | Location: ${body.location || "N/A"} | Hide SG: ${body.hideSG ? "Yes" : "No"} | Show App Count: ${body.showApplicationCount ? "Yes" : "No"}`,
                    },
                });
                console.log({ check });
            }
            else {
                jobPost = check;
            }
            return jobPost.id;
        }));
        if (!response)
            throw new errors_1.AppError("Something went wrong", 500, "DB_ERROR");
        return res.code(200).send({ message: "OK", id: response });
    }
    catch (error) {
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw new errors_1.AppError("DATABASE_CONNECTION_FAILED", 500, "DB_ERROR");
        }
        throw error;
    }
});
exports.postJob = postJob;
const updatePostApplication = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const body = req.body;
    if (!body.id || !body.userId || !body.lineId)
        throw new errors_1.ValidationError("INVALID REQUIRED ID");
    try {
        const response = yield prisma_1.prisma.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            var _a, _b;
            const post = yield tx.jobPost.update({
                where: {
                    id: body.id,
                },
                data: {
                    status: body.status,
                },
                include: {
                    position: {
                        select: {
                            name: true,
                        },
                    },
                },
            });
            console.log({ post });
            yield tx.humanResourcesLogs.create({
                data: {
                    userId: body.userId,
                    action: "UPDATE",
                    lineId: body.lineId,
                    desc: `UPDATED JOB POST STATUS: ${(_b = (_a = post.position) === null || _a === void 0 ? void 0 : _a.name) !== null && _b !== void 0 ? _b : "N/A"}`,
                },
            });
            return true;
        }));
        if (!response)
            throw new errors_1.ValidationError("TRANSACTION FAILED");
        return res.code(200).send({ message: "OK" });
    }
    catch (error) {
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw new errors_1.AppError("DATABASE_CONNECTION_FAILED", 500, "DB_ERROR");
        }
        throw error;
    }
});
exports.updatePostApplication = updatePostApplication;
/**
 * Update a job posting's editable fields.
 *
 * Caller sends only what changed (undefined = leave alone). To CLEAR a
 * deadline, send `deadline: null`. Status transitions are validated
 * against a small whitelist (draft → published, published ↔ paused).
 */
const updatePostJob = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const param = req.body;
    if (!param.id)
        throw new errors_1.ValidationError("INVALID REQUIRED ID");
    try {
        const result = yield prisma_1.prisma.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            var _a, _b, _c, _d, _e, _f;
            const jobPost = yield tx.jobPost.findUnique({
                where: { id: param.id },
                include: { position: { select: { id: true, name: true } } },
            });
            if (!jobPost)
                throw new errors_1.NotFoundError("JOB POST NOT FOUND");
            // Validate status transition. 0 = draft, 1 = published, 3 = paused.
            if (param.status !== undefined && param.status !== jobPost.status) {
                const allowed = {
                    0: [1], // draft → published
                    1: [3], // published → paused
                    3: [1, 0], // paused → published or back to draft
                };
                const ok = (_b = (_a = allowed[jobPost.status]) === null || _a === void 0 ? void 0 : _a.includes(param.status)) !== null && _b !== void 0 ? _b : false;
                if (!ok) {
                    throw new errors_1.ValidationError(`Cannot move status from ${jobPost.status} to ${param.status}.`);
                }
            }
            const data = {};
            if (param.desc !== undefined)
                data.desc = param.desc;
            if (param.hideSG !== undefined)
                data.hideSG = param.hideSG;
            if (param.showApplicationCount !== undefined)
                data.showApplicationCount = param.showApplicationCount;
            if (param.salaryGrade !== undefined)
                data.salaryGradeId = param.salaryGrade || null;
            if (param.status !== undefined)
                data.status = param.status;
            if (param.deadline !== undefined) {
                data.deadline = param.deadline ? new Date(param.deadline) : null;
            }
            if (param.location !== undefined)
                data.location = param.location;
            if (Object.keys(data).length > 0) {
                yield tx.jobPost.update({ where: { id: jobPost.id }, data });
            }
            const wasStatusChange = param.status !== undefined && param.status !== jobPost.status;
            yield tx.humanResourcesLogs.create({
                data: {
                    action: wasStatusChange ? "STATUS" : "UPDATED",
                    userId: param.userId,
                    lineId: param.lineId,
                    desc: `Job posting "${(_d = (_c = jobPost.position) === null || _c === void 0 ? void 0 : _c.name) !== null && _d !== void 0 ? _d : "N/A"}" ` +
                        (wasStatusChange
                            ? `status ${jobPost.status} → ${param.status}`
                            : `updated (hideSG=${(_e = param.hideSG) !== null && _e !== void 0 ? _e : jobPost.hideSG}, ` +
                                `showCount=${(_f = param.showApplicationCount) !== null && _f !== void 0 ? _f : jobPost.showApplicationCount})`),
                },
            });
            return { id: jobPost.id, fields: Object.keys(data) };
        }));
        return res.code(200).send(Object.assign({ message: "OK" }, result));
    }
    catch (error) {
        if (error instanceof errors_1.NotFoundError)
            throw error;
        if (error instanceof errors_1.ValidationError)
            throw error;
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw new errors_1.AppError("DATABASE_CONNECTION_FAILED", 500, "DB_ERROR");
        }
        throw error;
    }
});
exports.updatePostJob = updatePostJob;
const createPobJobRequirements = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    if (!req.isMultipart()) {
        return res.status(400).send({ error: "Not multipart" });
    }
    const fields = {};
    const uploadedFiles = [];
    try {
        yield prisma_1.prisma.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            var _a, e_1, _b, _c, _d, e_2, _e, _f;
            try {
                for (var _g = true, _h = __asyncValues(req.parts()), _j; _j = yield _h.next(), _a = _j.done, !_a; _g = true) {
                    _c = _j.value;
                    _g = false;
                    const part = _c;
                    if (part.type === "file") {
                        // Read file buffer
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
                        const buffer = Buffer.concat(buffers);
                        // Save temporarily to disk
                        const tmpDir = path_1.default.join(process.cwd(), "tmp_uploads");
                        if (!fs_1.default.existsSync(tmpDir))
                            fs_1.default.mkdirSync(tmpDir, { recursive: true });
                        const safeName = part.filename.replace(/[^\w.-]/g, "_");
                        const tmpPath = path_1.default.join(tmpDir, safeName);
                        fs_1.default.writeFileSync(tmpPath, buffer);
                        try {
                            const fileExtension = path_1.default.extname(part.filename).toLowerCase();
                            const isDocument = [
                                ".pdf",
                                ".doc",
                                ".docx",
                                ".txt",
                                ".xls",
                                ".xlsx",
                            ].includes(fileExtension);
                            const result = yield Cloundinary_1.default.uploader.upload(tmpPath, {
                                folder: "job_requirements_assets",
                                resource_type: isDocument ? "raw" : "auto",
                                type: "upload",
                                use_filename: true,
                                unique_filename: true,
                            });
                            uploadedFiles.push({
                                filename: part.filename,
                                url: result.secure_url,
                                size: buffer.length,
                                publicId: result.public_id,
                            });
                            // console.log(`Uploaded file: ${part.filename}`);
                            // console.log(`Cloudinary URL: ${result.secure_url}`);
                            // console.log(`Resource type: ${result.resource_type}`);
                        }
                        catch (err) {
                            throw new errors_1.AppError(`Failed to upload file "${part.filename}" to Cloudinary`, 500, "UPLOAD_FAILED");
                        }
                        finally {
                            // Always remove temp file
                            if (fs_1.default.existsSync(tmpPath))
                                fs_1.default.unlinkSync(tmpPath);
                        }
                    }
                    else if (part.type === "field") {
                        fields[part.fieldname] = part.value;
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
            // Insert requirement record
            const requirements = yield tx.jobPostRequirements.create({
                data: {
                    jobPostId: fields.postId,
                    title: fields.title,
                },
            });
            // Insert all uploaded files
            yield tx.jobPostAssets.createMany({
                data: uploadedFiles.map((item) => ({
                    fileName: item.filename,
                    fileSize: item.size.toString(),
                    fileUrl: item.url,
                    jobPostRequirementsId: requirements.id,
                    fileType: path_1.default.extname(item.filename),
                    filePublicId: item.publicId,
                })),
            });
        }));
        return res.code(200).send({
            message: "Success",
            files: uploadedFiles, // Return uploaded files info
        });
    }
    catch (error) {
        return res.status(500).send({
            message: "Failed to create job requirement",
            error: error instanceof Error ? error.message : "Unknown error",
        });
    }
});
exports.createPobJobRequirements = createPobJobRequirements;
const postJobRequirements = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const params = req.query;
    if (!params.id)
        throw new errors_1.ValidationError("REQUIRED ID NOT FOUND!");
    try {
        const cursor = params.lastCursor ? { id: params.id } : undefined;
        const limit = params.limit ? parseInt(params.limit) : 20;
        const response = yield prisma_1.prisma.jobPostRequirements.findMany({
            where: {
                jobPostId: params.id,
            },
            include: {
                asset: {
                    select: {
                        id: true,
                        fileName: true,
                        fileSize: true,
                        fileUrl: true,
                    },
                },
            },
            skip: cursor ? 1 : 0,
            take: limit,
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
exports.postJobRequirements = postJobRequirements;
const updatePostJobRequiments = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    if (!req.isMultipart()) {
        return res.status(400).send({ error: "Not multipart" });
    }
    const fields = {};
    const uploadedFiles = [];
    try {
        yield prisma_1.prisma.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            var _a, e_3, _b, _c, _d, e_4, _e, _f;
            try {
                for (var _g = true, _h = __asyncValues(req.parts()), _j; _j = yield _h.next(), _a = _j.done, !_a; _g = true) {
                    _c = _j.value;
                    _g = false;
                    const part = _c;
                    if (part.type === "file") {
                        // Read file buffer
                        const buffers = [];
                        try {
                            for (var _k = true, _l = (e_4 = void 0, __asyncValues(part.file)), _m; _m = yield _l.next(), _d = _m.done, !_d; _k = true) {
                                _f = _m.value;
                                _k = false;
                                const chunk = _f;
                                buffers.push(chunk);
                            }
                        }
                        catch (e_4_1) { e_4 = { error: e_4_1 }; }
                        finally {
                            try {
                                if (!_k && !_d && (_e = _l.return)) yield _e.call(_l);
                            }
                            finally { if (e_4) throw e_4.error; }
                        }
                        const buffer = Buffer.concat(buffers);
                        // Save temporarily to disk
                        const tmpDir = path_1.default.join(process.cwd(), "tmp_uploads");
                        if (!fs_1.default.existsSync(tmpDir))
                            fs_1.default.mkdirSync(tmpDir, { recursive: true });
                        const safeName = part.filename.replace(/[^\w.-]/g, "_");
                        const tmpPath = path_1.default.join(tmpDir, safeName);
                        fs_1.default.writeFileSync(tmpPath, buffer);
                        try {
                            // Upload to Cloudinary
                            const result = yield Cloundinary_1.default.uploader.upload(tmpPath, {
                                folder: "job_requirements_assets",
                                resource_type: "auto",
                            });
                            uploadedFiles.push({
                                filename: part.filename,
                                url: result.secure_url,
                                size: buffer.length,
                                publicId: result.public_id,
                            });
                        }
                        catch (err) {
                            throw new errors_1.AppError(`Failed to upload file "${part.filename}" to Cloudinary`, 500, "UPLOAD_FAILED");
                        }
                        finally {
                            // Always remove temp file
                            if (fs_1.default.existsSync(tmpPath))
                                fs_1.default.unlinkSync(tmpPath);
                        }
                    }
                    else if (part.type === "field") {
                        fields[part.fieldname] = part.value;
                    }
                }
            }
            catch (e_3_1) { e_3 = { error: e_3_1 }; }
            finally {
                try {
                    if (!_g && !_a && (_b = _h.return)) yield _b.call(_h);
                }
                finally { if (e_3) throw e_3.error; }
            }
            // Insert requirement record
            const requirement = yield tx.jobPostRequirements.findUnique({
                where: {
                    id: fields.id,
                },
            });
            let requirements = {};
            if (requirement && requirement.desc !== fields.title) {
                requirements = yield tx.jobPostRequirements.update({
                    where: {
                        id: fields.id,
                    },
                    data: {
                        title: fields.title,
                    },
                });
            }
            if (uploadedFiles.length > 0) {
                yield tx.jobPostAssets.createMany({
                    data: uploadedFiles.map((item) => ({
                        fileName: item.filename,
                        fileSize: item.size.toString(),
                        fileUrl: item.url,
                        jobPostRequirementsId: requirements.id,
                        fileType: "",
                        filePublicId: item.publicId,
                    })),
                });
            }
        }));
        return res.code(200).send({
            message: "Success",
        });
    }
    catch (error) {
        return res.status(500).send({
            message: "Failed to create job requirement",
            error: error instanceof Error ? error.message : "Unknown error",
        });
    }
});
exports.updatePostJobRequiments = updatePostJobRequiments;
const removePostJobRequirements = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const params = req.query;
    if (!params.id)
        throw new errors_1.ValidationError("INVALID JOB POST ID");
    try {
        yield prisma_1.prisma.jobPostRequirements.delete({
            where: {
                id: params.id,
            },
        });
        return res.code(200).send({ message: "OK" });
    }
    catch (error) {
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw (0, errors_1.dbError)(error);
        }
        throw error;
    }
});
exports.removePostJobRequirements = removePostJobRequirements;
const postJobRequirementsRemoveAsset = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const params = req.query;
    if (!params.id)
        throw new errors_1.ValidationError("INVALID REQUIRED ID");
    try {
        const response = yield prisma_1.prisma.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            const jobPost = yield tx.jobPostAssets.findUnique({
                where: {
                    id: params.id,
                },
            });
            if (!jobPost)
                throw new errors_1.NotFoundError("FILE NOT FOUND");
            yield Cloundinary_1.default.uploader.destroy(jobPost.filePublicId);
            yield tx.jobPostAssets.delete({
                where: {
                    id: jobPost.id,
                },
            });
            return "OK";
        }));
        if (response !== "OK")
            throw new errors_1.AppError("Something went wrong.", 500, "DB_ERROR");
        return res.code(200).send({ message: "OK" });
    }
    catch (error) {
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw (0, errors_1.dbError)(error);
        }
        throw error;
    }
});
exports.postJobRequirementsRemoveAsset = postJobRequirementsRemoveAsset;
/**
 * Public job-board listing for one municipality.
 *
 * Returns only published posts (`status: 1`) whose deadline (if any) is
 * still in the future. Each row carries enough metadata (position, unit,
 * salary grade, requirements, submitted-application count, municipality
 * label) for the public board to render without secondary calls.
 *
 * `id` (query param) — the Municipal id taken from the route.
 */
const jobPost = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    const params = req.query;
    if (!params.id)
        throw new errors_1.ValidationError("INVALID ID");
    try {
        const cursor = params.lastCursor ? { id: params.lastCursor } : undefined;
        const limit = params.limit ? parseInt(params.limit, 10) : 20;
        const now = new Date();
        // Build the where clause as a single AND list so combining OR-blocks
        // with other top-level fields can't be misinterpreted by Prisma.
        const andClauses = [
            { status: 1 },
            { line: { municipalId: params.id } },
            // Drop expired postings. Posts without a deadline are open-ended.
            { OR: [{ deadline: null }, { deadline: { gte: now } }] },
        ];
        if (params.query) {
            const q = params.query.trim();
            andClauses.push({
                OR: [
                    { position: { name: { contains: q, mode: "insensitive" } } },
                    { desc: { contains: q, mode: "insensitive" } },
                    { unitPos: { unit: { name: { contains: q, mode: "insensitive" } } } },
                    // PESO / external posts have no internal position — search their
                    // free-text title and employer instead.
                    { jobTitle: { contains: q, mode: "insensitive" } },
                    { employerName: { contains: q, mode: "insensitive" } },
                ],
            });
        }
        const where = { AND: andClauses };
        const [municipality, list] = yield Promise.all([
            prisma_1.prisma.municipal.findUnique({
                where: { id: params.id },
                select: {
                    id: true,
                    name: true,
                    Province: { select: { id: true, name: true } },
                },
            }),
            prisma_1.prisma.jobPost.findMany({
                where,
                include: {
                    position: { select: { id: true, name: true } },
                    requirements: {
                        select: {
                            id: true,
                            title: true,
                            asset: {
                                select: {
                                    id: true,
                                    fileName: true,
                                    fileSize: true,
                                    fileUrl: true,
                                },
                            },
                        },
                    },
                    salaryGrade: { select: { id: true, grade: true } },
                    _count: { select: { submittedApplications: true } },
                    unitPos: { select: { unit: { select: { name: true } } } },
                    line: { select: { id: true, name: true, municipalId: true } },
                },
                skip: cursor ? 1 : 0,
                take: limit,
                orderBy: { timestamp: "desc" },
                cursor,
            }),
        ]);
        // Normalize `_count` to the application-count shape the UI already
        // reads (`item._count.application`). Server now counts SUBMITTED
        // applications, which is what HR actually cares about.
        const shaped = list.map((j) => {
            var _a, _b;
            return (Object.assign(Object.assign({}, j), { _count: { application: (_b = (_a = j._count) === null || _a === void 0 ? void 0 : _a.submittedApplications) !== null && _b !== void 0 ? _b : 0 } }));
        });
        const lastCursor = shaped.length > 0 ? shaped[shaped.length - 1].id : null;
        const hasMore = shaped.length === limit;
        // ── Diagnostic block ────────────────────────────────────────────
        // Pulls a few signals so we can pinpoint exactly why a published post
        // might not surface here: wrong municipal id, deadline already past,
        // or simply nothing published.
        const [totalForMuni, publishedForMuni, allPublished] = yield Promise.all([
            prisma_1.prisma.jobPost.count({
                where: { line: { municipalId: params.id } },
            }),
            prisma_1.prisma.jobPost.count({
                where: { line: { municipalId: params.id }, status: 1 },
            }),
            prisma_1.prisma.jobPost.findMany({
                where: { status: 1 },
                select: {
                    id: true,
                    status: true,
                    deadline: true,
                    position: { select: { name: true } },
                    line: {
                        select: {
                            id: true,
                            name: true,
                            municipalId: true,
                        },
                    },
                },
                take: 20,
                orderBy: { timestamp: "desc" },
            }),
        ]);
        console.log(`[jobPost] muni=${params.id} q="${(_a = params.query) !== null && _a !== void 0 ? _a : ""}" ` +
            `published=${publishedForMuni}/${totalForMuni} returned=${shaped.length} now=${now.toISOString()}`);
        if (allPublished.length > 0) {
            console.log("[jobPost] published posts (any muni):", allPublished.map((p) => {
                var _a, _b, _c, _d;
                return ({
                    id: p.id.slice(0, 8),
                    name: (_a = p.position) === null || _a === void 0 ? void 0 : _a.name,
                    lineId: (_c = (_b = p.line) === null || _b === void 0 ? void 0 : _b.id) === null || _c === void 0 ? void 0 : _c.slice(0, 8),
                    lineMuni: (_d = p.line) === null || _d === void 0 ? void 0 : _d.municipalId,
                    deadline: p.deadline,
                    expired: p.deadline ? new Date(p.deadline) < now : false,
                });
            }));
        }
        else {
            console.log("[jobPost] no published posts in DB at all.");
        }
        return res.code(200).send({
            list: shaped,
            hasMore,
            lastCursor,
            municipality,
            debug: {
                totalForMuni,
                publishedForMuni,
                requestedMuni: params.id,
                // Surface the municipal IDs of every published post so the UI can
                // tell the operator "your post's municipality is X, you opened Y".
                publishedMunis: Array.from(new Set(allPublished
                    .map((p) => { var _a; return (_a = p.line) === null || _a === void 0 ? void 0 : _a.municipalId; })
                    .filter((m) => !!m))),
            },
        });
    }
    catch (error) {
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw (0, errors_1.dbError)(error);
        }
        throw error;
    }
});
exports.jobPost = jobPost;
const submitApplication = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, e_5, _b, _c, _d, e_6, _e, _f;
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
                        for (var _h = true, _j = (e_6 = void 0, __asyncValues(part.file)), _k; _k = yield _j.next(), _d = _k.done, !_d; _h = true) {
                            _f = _k.value;
                            _h = false;
                            const chunk = _f;
                            buffers.push(chunk);
                        }
                    }
                    catch (e_6_1) { e_6 = { error: e_6_1 }; }
                    finally {
                        try {
                            if (!_h && !_d && (_e = _j.return)) yield _e.call(_j);
                        }
                        finally { if (e_6) throw e_6.error; }
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
        catch (e_5_1) { e_5 = { error: e_5_1 }; }
        finally {
            try {
                if (!_g && !_a && (_b = parts_1.return)) yield _b.call(parts_1);
            }
            finally { if (e_5) throw e_5.error; }
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
                // CS Form 212 sections VI–VIII + references (stored as plain JSON,
                // same as the other structured sections above).
                voluntaryWork: parseArrayField("voluntaryWork", []),
                learningDev: parseArrayField("learningDev", []),
                otherInfo: parseArrayField("otherInfo", []),
                references: parseArrayField("references", []),
                // Page-4 disclosure questionnaire (Q34–40).
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
                byBirth: String(clean.dualCitizen || "").toLowerCase().includes("birth"),
                byNatural: String(clean.dualCitizen || "")
                    .toLowerCase()
                    .includes("atural"),
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
                // CS Form 212 sections VI–VIII + references + disclosures (Json/Json[])
                voluntaryWork: clean.voluntaryWork,
                learningDev: clean.learningDev,
                otherInfo: clean.otherInfo,
                references: clean.references,
                disclosures: clean.disclosures,
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
            return {
                applicationId: application.id,
                positionName: position.name,
                municipalName: municipal.name,
            };
        }));
        // Confirmation email + SMS are NON-FATAL and run OUTSIDE the transaction:
        // the application is already committed, so a mail/SMS failure must never
        // roll it back or 500 the request.
        if (formData.email) {
            try {
                yield (0, handler_1.sendEmail)("Application Received", formData.email, `Dear ${formData.firstName} ${formData.lastName},

This is to confirm that we have successfully received your application for the position of ${result.positionName} at ${result.municipalName}.

We will inform you of any further instructions regarding the next steps in the hiring process once your application has been reviewed.

You can check the status of your application by clicking this link: ${officialUrl}/public/application/${result.applicationId}

Sincerely,
The HR Team
${result.municipalName}`, `${result.municipalName} HR Team`);
            }
            catch (mailErr) {
                console.warn("[application submit] confirmation email failed:", mailErr instanceof Error ? mailErr.message : mailErr);
            }
        }
        if (formData.mobileNo && Semaphore_1.semaphoreKey) {
            try {
                const contact = (0, handler_1.phNumberFormat)(formData.mobileNo);
                yield axios_1.default.post(`https://api.semaphore.co/api/v4/messages`, {
                    number: contact,
                    message: `Dear ${formData.firstName} ${formData.lastName},

This is to confirm that we have successfully received your application for the position of ${result.positionName} at ${result.municipalName}.

We will inform you of any further instructions regarding the next steps in the hiring process once your application has been reviewed.

Sincerely,
The HR Team
${result.municipalName}`,
                    apikey: Semaphore_1.semaphoreKey,
                }, { headers: { "Content-Type": "application/json" } });
            }
            catch (smsErr) {
                console.warn("[application submit] confirmation SMS failed:", smsErr instanceof Error ? smsErr.message : smsErr);
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
exports.submitApplication = submitApplication;
const applicationList = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const params = req.query;
    if (!params.id)
        throw new errors_1.ValidationError("INVALID REQUIRED ID");
    try {
        const cursor = params.lastCursor ? { id: params.lastCursor } : undefined;
        const limit = params.limit ? parseInt(params.limit, 10) : 20;
        const eligibleOnly = params.eligibleOnly === true ||
            params.eligibleOnly === "true" ||
            params.eligibleOnly === "1";
        // Build the where clause conditionally
        const whereClause = {
            lineId: params.id,
        };
        if (eligibleOnly) {
            // Drop applications already converted into a User — at that point
            // the applicant has finished registration and shouldn't be invited
            // again. Live-invite dedup happens after the fetch (see below) so
            // the prisma where clause stays simple.
            whereClause.userId = null;
        }
        // Add positionId filter if provided
        if (params.positionId) {
            whereClause.positionId = params.positionId;
        }
        // Add text search filter if provided
        if (params.query) {
            whereClause.OR = [
                { firstname: { contains: params.query, mode: "insensitive" } },
                { lastname: { contains: params.query, mode: "insensitive" } },
            ];
        }
        // Add date range filter if provided - PROPERLY FIXED
        if (params.dateFrom || params.dateTo) {
            whereClause.timestamp = {};
            if (params.dateFrom && typeof params.dateFrom === "string") {
                // Start of the day for dateFrom
                const fromDate = new Date(params.dateFrom);
                fromDate.setHours(0, 0, 0, 0);
                whereClause.timestamp.gte = fromDate;
            }
            if (params.dateTo && typeof params.dateTo === "string") {
                // End of the day for dateTo
                const toDate = new Date(params.dateTo);
                toDate.setHours(23, 59, 59, 999);
                whereClause.timestamp.lte = toDate;
            }
        }
        // Normalize tags - handle both string and array cases
        const tagsParam = params["tags[]"];
        if (tagsParam) {
            // Convert to array if it's a string, otherwise use the array as-is
            const tagsArray = Array.isArray(tagsParam) ? tagsParam : [tagsParam];
            // Only add filter if we have valid tags
            if (tagsArray.length > 0 &&
                tagsArray.every((tag) => typeof tag === "string")) {
                whereClause.ApplicationSkillTags = {
                    some: {
                        tags: {
                            in: tagsArray,
                        },
                    },
                };
            }
        }
        console.log({ whereClause });
        const response = yield prisma_1.prisma.submittedApplication.findMany({
            where: whereClause,
            take: limit,
            skip: cursor ? 1 : 0,
            orderBy: {
                timestamp: "desc",
            },
            cursor,
            select: {
                id: true,
                firstname: true,
                lastname: true,
                status: true,
                userId: true,
                forPosition: {
                    select: {
                        name: true,
                    },
                },
                timestamp: true,
                profilePic: {
                    select: {
                        file_url: true,
                        file_name: true,
                    },
                },
                // Whether this application is currently tied to a live invitation.
                // The @unique on FillPositionInvitation.submittedApplicationId
                // means at most one row per application; we read it to flag the
                // row in the UI even when the caller didn't ask to filter.
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
        // "Has record" — does this applicant already have prior history in the
        // line? True when they were previously hired (linked to a User), have an
        // invitation (live or past), or applied more than once (same name). The
        // repeat-name set is one grouped query over the line's plain-text names.
        // Skipped for the eligible-only picker, which doesn't surface the badge.
        let repeatNames = new Set();
        if (!eligibleOnly) {
            const nameGroups = yield prisma_1.prisma.submittedApplication.groupBy({
                by: ["firstname", "lastname"],
                where: { lineId: params.id },
                _count: { _all: true },
            });
            repeatNames = new Set(nameGroups
                .filter((g) => { var _a, _b; return ((_b = (_a = g._count) === null || _a === void 0 ? void 0 : _a._all) !== null && _b !== void 0 ? _b : 0) > 1; })
                .map((g) => `${g.firstname}${g.lastname}`.toLowerCase()));
        }
        // ── Eligibility annotation + optional drop ─────────────────────────
        // An application's invitation is "live" when it isn't concluded AND
        // either has no expiresAt or hasn't expired yet. Once that's true,
        // the applicant can't be re-invited (FE disables the row; eligibleOnly
        // strips it from the list entirely).
        const now = Date.now();
        const decorated = response.map((row) => {
            const inv = row.fillPositionInvitations;
            const invExpired = !!((inv === null || inv === void 0 ? void 0 : inv.expiresAt) && new Date(inv.expiresAt).getTime() < now);
            const liveInvite = !!inv && !inv.concluded && !invExpired;
            const accepted = !!inv && inv.concluded && inv.concludedReason === "accepted";
            const converted = !!row.userId;
            const eligibility = converted
                ? "registered"
                : accepted
                    ? "accepted"
                    : liveInvite
                        ? "invited"
                        : "eligible";
            const hasRecord = converted ||
                !!inv ||
                repeatNames.has(`${row.firstname}${row.lastname}`.toLowerCase());
            return Object.assign(Object.assign({}, row), { eligibility, hasRecord });
        });
        const filtered = eligibleOnly
            ? decorated.filter((r) => r.eligibility === "eligible")
            : decorated;
        const newLastCursorId = filtered.length > 0 ? filtered[filtered.length - 1].id : null;
        const hasMore = limit === response.length;
        return res.code(200).send({
            list: filtered,
            hasMore,
            lastCursor: newLastCursorId,
        });
    }
    catch (error) {
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw (0, errors_1.dbError)(error);
        }
        throw error;
    }
});
exports.applicationList = applicationList;
const applicationData = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const params = req.query;
    console.log(params);
    if (!params.id)
        throw new errors_1.ValidationError("INVALID REQUIRED ID");
    try {
        const response = yield prisma_1.prisma.submittedApplication.findUnique({
            where: {
                id: params.id,
            },
            include: {
                forPosition: {
                    select: {
                        name: true,
                        id: true,
                    },
                },
                fileAttached: {
                    select: {
                        file_name: true,
                        file_size: true,
                    },
                },
                profilePic: {
                    select: {
                        file_url: true,
                        file_name: true,
                        id: true,
                    },
                },
                ApplicationSkillTags: {
                    select: {
                        id: true,
                        tags: true,
                    },
                },
            },
        });
        if (!response) {
            throw new errors_1.NotFoundError("DATA NOT FOUND!");
        }
        // Decrypt all encrypted fields in parallel
        const [email, civilStatus, mobileNo, resProvince, resCity, resBarangay, permaProvince, permaCity, permaBarangay, fatherSurname, fatherFirstname, motherSurname, motherFirstname, birthDate, umidNo, pagIbigNo, philHealthNo, philSys, tinNo, agencyNo,] = yield Promise.all([
            response.emailIv
                ? encryption_1.EncryptionService.decrypt(response.email, response.emailIv)
                : response.email,
            response.cvilStatusIv
                ? encryption_1.EncryptionService.decrypt(response.cvilStatus, response.cvilStatusIv)
                : response.cvilStatus,
            encryption_1.EncryptionService.decrypt(response.mobileNo, response.ivMobileNo),
            response.resProvinceIv
                ? encryption_1.EncryptionService.decrypt(response.resProvince, response.resProvinceIv)
                : response.resProvince,
            response.resCityIv
                ? encryption_1.EncryptionService.decrypt(response.resCity, response.resCityIv)
                : response.resCity,
            response.resBarangayIv
                ? encryption_1.EncryptionService.decrypt(response.resBarangay, response.resBarangayIv)
                : response.resBarangay,
            response.permaProvinceIv
                ? encryption_1.EncryptionService.decrypt(response.permaProvince, response.permaProvinceIv)
                : response.permaProvince,
            response.permaCityIv
                ? encryption_1.EncryptionService.decrypt(response.permaCity, response.permaCityIv)
                : response.permaCity,
            response.permaBarangayIv
                ? encryption_1.EncryptionService.decrypt(response.permaBarangay, response.permaBarangayIv)
                : response.permaBarangay,
            response.fatherSurname && response.fatherSurnameIv
                ? encryption_1.EncryptionService.decrypt(response.fatherSurname, response.fatherSurnameIv)
                : Promise.resolve(response.fatherSurname || ""),
            response.fatherFirstname && response.fatherFirstnameIv
                ? encryption_1.EncryptionService.decrypt(response.fatherFirstname, response.fatherFirstnameIv)
                : Promise.resolve(response.fatherFirstname || ""),
            response.motherSurname && response.motherSurnameIv
                ? encryption_1.EncryptionService.decrypt(response.motherSurname, response.motherSurnameIv)
                : Promise.resolve(response.motherSurname || ""),
            response.motherFirstname && response.motherFirstnameIv
                ? encryption_1.EncryptionService.decrypt(response.motherFirstname, response.motherFirstnameIv)
                : Promise.resolve(response.motherFirstname || ""),
            response.bdayIv
                ? encryption_1.EncryptionService.decrypt(response.birthDate, response.bdayIv)
                : response.birthDate,
            response.umidNoIv && response.umidNo
                ? encryption_1.EncryptionService.decrypt(response.umidNo, response.umidNoIv)
                : "N/A",
            response.pagIbigNo && response.pagIbigNoIv
                ? encryption_1.EncryptionService.decrypt(response.pagIbigNo, response.pagIbigNoIv)
                : "N/A",
            response.philHealthNo && response.philHealthNoIv
                ? encryption_1.EncryptionService.decrypt(response.philHealthNo, response.philHealthNoIv)
                : "N/A",
            response.philSys && response.philSysIv
                ? encryption_1.EncryptionService.decrypt(response.philSys, response.philSysIv)
                : "N/A",
            response.tinNo && response.tinNoIv
                ? encryption_1.EncryptionService.decrypt(response.tinNo, response.tinNoIv)
                : "N/A",
            response.agencyNo && response.agencyNoIv
                ? encryption_1.EncryptionService.decrypt(response.agencyNo, response.agencyNoIv)
                : "N/A",
        ]);
        // Create decrypted response object
        const decryptedResponse = {
            // Non-encrypted fields
            id: response.id,
            firstname: response.firstname,
            lastname: response.lastname,
            middleName: response.middleName,
            gender: response.gender,
            filipino: response.filipino,
            dualCitizen: response.dualCitizen,
            byBirth: response.byBirth,
            byNatural: response.byNatural,
            dualCitizenHalf: response.dualCitizenHalf,
            resZipCode: response.resZipCode,
            permaZipCode: response.permaZipCode,
            teleNo: response.teleNo,
            height: response.height,
            weight: response.weight,
            bloodType: response.bloodType,
            fatherAge: response.fatherAge,
            motherAge: response.motherAge,
            children: response.children,
            govId: response.govId,
            lineId: response.lineId,
            positionId: response.positionId,
            batch: response.batch,
            timestamp: response.timestamp,
            forPosition: response.forPosition,
            fileAttached: response.fileAttached,
            profilePic: response.profilePic,
            ApplicationSkillTags: response.ApplicationSkillTags,
            experience: response.experience,
            civilService: response.civilService,
            // CS Form 212 sections VI–VIII + references + disclosures (plain JSON).
            voluntaryWork: response.voluntaryWork,
            learningDev: response.learningDev,
            otherInfo: response.otherInfo,
            references: response.references,
            disclosures: response.disclosures,
            elementary: response.elementary,
            secondary: response.secondary,
            vocational: response.vocational,
            college: response.college,
            graduateCollege: response.graduateCollege,
            status: response.status,
            // Decrypted fields
            email,
            civilStatus,
            mobileNo,
            birthDate,
            // Residential address (decrypted)
            resProvince,
            resCity,
            resBarangay,
            // Permanent address (decrypted)
            permaProvince,
            permaCity,
            permaBarangay,
            // Parents (decrypted)
            fatherSurname,
            fatherFirstname,
            motherSurname,
            motherFirstname,
            umidNo,
            pagIbigNo,
            philHealthNo,
            philSys,
            tinNo,
            agencyNo,
        };
        return res.code(200).send(decryptedResponse);
    }
    catch (error) {
        console.log(error);
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw (0, errors_1.dbError)(error);
        }
        throw error;
    }
});
exports.applicationData = applicationData;
const contactApplicant = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { applicationId, message, subject, sendTo = "email", } = req.body;
    // Validate required fields
    if (!(applicationId === null || applicationId === void 0 ? void 0 : applicationId.trim()) || !(message === null || message === void 0 ? void 0 : message.trim()) || !(subject === null || subject === void 0 ? void 0 : subject.trim())) {
        throw new errors_1.ValidationError("Missing required fields: applicationId, message, and subject are required");
    }
    try {
        const application = yield prisma_1.prisma.submittedApplication.findUnique({
            where: { id: applicationId },
            select: {
                email: true,
                emailIv: true,
                mobileNo: true,
                ivMobileNo: true,
            },
        });
        if (!application) {
            throw new errors_1.NotFoundError("Application not found");
        }
        // Decrypt contact information in parallel
        const [email, phoneNumber] = yield Promise.all([
            application.emailIv
                ? encryption_1.EncryptionService.decrypt(application.email, application.emailIv)
                : application.email,
            application.ivMobileNo
                ? encryption_1.EncryptionService.decrypt(application.mobileNo, application.ivMobileNo)
                : application.mobileNo,
        ]);
        // Send communications based on preference
        const communicationPromises = [];
        if ((sendTo === "email" || sendTo === "both") && email) {
            communicationPromises.push((0, handler_1.sendEmail)(subject, email, message, "HR Team"));
        }
        if (sendTo === "phoneNumber" || sendTo === "both") {
            const formatted = (0, handler_1.phNumberFormat)(phoneNumber !== null && phoneNumber !== void 0 ? phoneNumber : "");
            if (formatted) {
                communicationPromises.push(Semaphore_2.semaphoreService.sendSingleSMS(formatted, message, "Gasan"));
            }
        }
        yield Promise.all(communicationPromises);
        // Log the contact attempt
        // await prisma.applicationConversation.create({
        //   data: {
        //     submittedApplicationId: applicationId,
        //     message: message,
        //     subject: subject,
        //     sentTo: sendTo,
        //     timestamp: new Date(),
        //   },
        // });
        return res.code(200).send({
            success: true,
            message: "Message sent successfully",
            sentTo: sendTo,
        });
    }
    catch (error) {
        console.error("Contact applicant error:", error);
        if (error instanceof errors_1.NotFoundError || error instanceof errors_1.ValidationError) {
            throw error;
        }
        throw new errors_1.AppError("CONTACT_FAILED", 500, "Failed to contact applicant");
    }
});
exports.contactApplicant = contactApplicant;
const contactManyApplicants = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { applicationId, message, subject, sendTo = "email", } = req.body;
    if (!(applicationId === null || applicationId === void 0 ? void 0 : applicationId.length) || !(message === null || message === void 0 ? void 0 : message.trim()) || !(subject === null || subject === void 0 ? void 0 : subject.trim())) {
        throw new errors_1.ValidationError("Missing required fields: applicationIds, message, and subject are required");
    }
    if (applicationId.length > 100) {
        throw new errors_1.ValidationError("Cannot contact more than 100 applicants at once");
    }
    try {
        const applications = yield prisma_1.prisma.submittedApplication.findMany({
            where: {
                id: { in: applicationId },
            },
            select: {
                id: true,
                email: true,
                emailIv: true,
                mobileNo: true,
                ivMobileNo: true,
                firstname: true,
                lastname: true,
                firsntameIv: true,
                lastnameIv: true,
                forPosition: {
                    select: {
                        name: true,
                    },
                },
            },
        });
        if (applications.length !== applicationId.length) {
            const foundIds = new Set(applications.map((app) => app.id));
            const missingIds = applicationId.filter((id) => !foundIds.has(id));
            throw new errors_1.NotFoundError(`Some applications not found: ${missingIds.join(", ")}`);
        }
        // Decrypt all contact information in parallel
        const applicantsWithDecryptedInfo = yield Promise.all(applications.map((app) => __awaiter(void 0, void 0, void 0, function* () {
            const [email, phoneNumber, firstName, lastName] = yield Promise.all([
                app.emailIv
                    ? encryption_1.EncryptionService.decrypt(app.email, app.emailIv)
                    : app.email,
                app.ivMobileNo
                    ? encryption_1.EncryptionService.decrypt(app.mobileNo, app.ivMobileNo)
                    : app.mobileNo,
                app.firsntameIv
                    ? encryption_1.EncryptionService.decrypt(app.firstname, app.firsntameIv)
                    : app.firstname,
                app.lastnameIv
                    ? encryption_1.EncryptionService.decrypt(app.lastname, app.lastnameIv)
                    : app.lastname,
            ]);
            return {
                id: app.id,
                email,
                phoneNumber,
                name: `${firstName} ${lastName}`.trim(),
            };
        })));
        // ── Dispatch per the chosen channel(s), shaped to each sender ──────────
        // Email: personalized per recipient, sent in small batches so we don't
        //   overwhelm the SMTP relay; failures are tolerated (not all-or-nothing).
        // SMS: Semaphore accepts a comma-joined list, so the whole transaction is
        //   ONE bulk call (it can't personalize, so {{name}} is generic there).
        const wantsEmail = sendTo === "email" || sendTo === "both";
        const wantsSms = sendTo === "phoneNumber" || sendTo === "both";
        let emailSent = 0;
        let emailFailed = 0;
        if (wantsEmail) {
            const targets = applicantsWithDecryptedInfo.filter((a) => a.email);
            const EMAIL_BATCH = 20;
            for (let i = 0; i < targets.length; i += EMAIL_BATCH) {
                const results = yield Promise.allSettled(targets
                    .slice(i, i + EMAIL_BATCH)
                    .map((a) => (0, handler_1.sendEmail)(subject, a.email, message.replace(/{{name}}/g, a.name), "HR Team")));
                emailSent += results.filter((r) => r.status === "fulfilled").length;
                emailFailed += results.filter((r) => r.status === "rejected").length;
            }
        }
        let smsSent = 0;
        let smsOk = true;
        if (wantsSms) {
            const numbers = applicantsWithDecryptedInfo
                .map((a) => { var _a; return (0, handler_1.phNumberFormat)((_a = a.phoneNumber) !== null && _a !== void 0 ? _a : ""); })
                .filter((n) => n.length > 0);
            if (numbers.length) {
                const smsResult = yield Semaphore_2.semaphoreService.sendBulkSMS(numbers, message.replace(/{{name}}/g, "Applicant"), "Gasan");
                smsOk = smsResult.success;
                smsSent = smsOk ? numbers.length : 0;
            }
        }
        return res.code(200).send({
            success: true,
            message: `Contacted ${applicantsWithDecryptedInfo.length} applicant(s)`,
            recipients: applicantsWithDecryptedInfo.length,
            sentTo: sendTo,
            emailSent,
            emailFailed,
            smsSent,
            smsOk,
        });
    }
    catch (error) {
        if (error instanceof errors_1.NotFoundError || error instanceof errors_1.ValidationError) {
            throw error;
        }
        throw new errors_1.AppError("BULK_CONTACT_FAILED", 500, "Failed to contact applicants");
    }
});
exports.contactManyApplicants = contactManyApplicants;
const exportPersonalDataSheet = () => __awaiter(void 0, void 0, void 0, function* () {
    try {
    }
    catch (error) { }
});
exports.exportPersonalDataSheet = exportPersonalDataSheet;
const applicationConvertion = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const params = req.query;
    if (!params.id)
        throw new errors_1.ValidationError("INVALID REQUIRED ID");
    try {
        const cursor = params.lastCursor ? { id: params.lastCursor } : undefined;
        const limit = params.limit ? parseInt(params.limit, 10) : 20;
        const response = yield prisma_1.prisma.applicationConversation.findMany({
            where: {
                submittedApplicationId: params.id,
            },
            take: limit,
            skip: cursor ? 1 : 0,
            orderBy: {
                timestamp: "asc",
            },
            cursor,
            select: {
                hrAdmin: {
                    select: {
                        firstName: true,
                        lastName: true,
                        id: true,
                    },
                },
                applicant: {
                    select: {
                        firstname: true,
                        lastname: true,
                    },
                },
                message: true,
                messageIv: true,
                timestamp: true,
                title: true,
                id: true,
                fromHr: true,
            },
        });
        const descryptedConversation = yield Promise.all(response.map((item) => __awaiter(void 0, void 0, void 0, function* () {
            try {
                const decryptedMessage = yield encryption_1.EncryptionService.decrypt(item.message, item.messageIv);
                return Object.assign({ messageContent: decryptedMessage }, item);
            }
            catch (err) {
                console.error("ERROR decrypting item:", item.id, err);
                throw err; // <--- VERY IMPORTANT (forces error to bubble)
            }
        })));
        const newLastCursorId = descryptedConversation.length > 0
            ? descryptedConversation[descryptedConversation.length - 1].id
            : null;
        const hasMore = limit === descryptedConversation.length;
        return res.code(200).send({
            list: descryptedConversation,
            hasMore,
            lastCursor: newLastCursorId,
        });
    }
    catch (error) {
        console.log(error);
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw (0, errors_1.dbError)(error);
        }
        throw error;
    }
});
exports.applicationConvertion = applicationConvertion;
const adminApplicationSendConversation = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    const body = req.body;
    // console.log({ body });
    if (!body.userId || !body.applicationId)
        throw new errors_1.ValidationError("INVALID REQUIRED ID");
    try {
        const encryptedMessage = yield encryption_1.EncryptionService.encrypt(body.message);
        const response = yield prisma_1.prisma.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            const user = yield tx.user.findUnique({
                where: {
                    id: body.userId,
                },
            });
            const applicant = yield tx.submittedApplication.findUnique({
                where: {
                    id: body.applicationId,
                },
            });
            if (!applicant || !user)
                throw new errors_1.NotFoundError("RECIPIENT or SENDER NOT FOUND");
            const [email] = yield Promise.all([
                applicant.emailIv &&
                    encryption_1.EncryptionService.decrypt(applicant.email, applicant.emailIv),
            ]);
            const created = yield tx.applicationConversation.create({
                data: {
                    message: encryptedMessage.encryptedData,
                    messageIv: encryptedMessage.iv,
                    userId: body.userId,
                    submittedApplicationId: body.applicationId,
                    title: "New message",
                    lineId: user.lineId,
                    fromHr: true,
                },
                select: {
                    id: true,
                    timestamp: true,
                    submittedApplicationId: true,
                    fromHr: true,
                    hrAdmin: {
                        select: { id: true, firstName: true, lastName: true },
                    },
                },
            });
            return created;
            //       if (email) {
            //         await sendEmail(
            //           "New Message Regarding Your Application",
            //           email,
            //           `
            // Dear ${applicant.firstname} ${applicant.lastname},
            // You have received a new message regarding your job application.
            // Message: ${body.message}
            // Please log in to your applicant portal to view the full message and respond if needed.
            // Best regards,
            // ${user.firstName} ${user.lastName}
            // HR Team
            //   `,
            //           `HR Team <${user.lastName}, ${user.firstName}>`
            //         );
            //       }
            return created;
        }));
        if (!response) {
            throw new errors_1.AppError("Something went wrong.", 500, "DB_ERROR");
        }
        // Emit real-time payload to anyone joined to this chat room (applicant
        // side + every HR session viewing this application). Plaintext is OK
        // because socket delivery is scoped to the room.
        try {
            __1.notificationSocket.emitChatMessage(body.applicationId, {
                id: response.id,
                messageContent: body.message,
                fromHr: (_a = response.fromHr) !== null && _a !== void 0 ? _a : true,
                timestamp: typeof response.timestamp === "string"
                    ? response.timestamp
                    : new Date(response.timestamp).toISOString(),
                submittedApplicationId: response.submittedApplicationId,
                hrAdmin: response.hrAdmin,
            });
        }
        catch (e) {
            console.warn("[chat] failed to emit admin message:", e);
        }
        return res.code(200).send({ message: "OK", id: response.id });
    }
    catch (error) {
        console.log(error);
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw (0, errors_1.dbError)(error);
        }
        throw error;
    }
});
exports.adminApplicationSendConversation = adminApplicationSendConversation;
const sendPublicApplicationMessage = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    const body = req.body;
    if (!body.applicationId || !body.message) {
        throw new errors_1.ValidationError("INVALID REQUIRED FIELD");
    }
    try {
        const encryptedMessage = yield encryption_1.EncryptionService.encrypt(body.message);
        const response = yield prisma_1.prisma.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            var _a, _b;
            const application = yield tx.submittedApplication.findUnique({
                where: {
                    id: body.applicationId,
                },
                include: {
                    forPosition: {
                        select: {
                            name: true,
                            lineId: true,
                        },
                    },
                },
            });
            if (!application)
                throw new errors_1.NotFoundError("APPLICATION NOT FOUND");
            const created = yield tx.applicationConversation.create({
                data: {
                    message: encryptedMessage.encryptedData,
                    messageIv: encryptedMessage.iv,
                    // SubmittedApplication.lineId is always set (required); forPosition is
                    // null for public/job-post applicants, so don't depend on it.
                    lineId: ((_a = application.lineId) !== null && _a !== void 0 ? _a : (_b = application.forPosition) === null || _b === void 0 ? void 0 : _b.lineId),
                    title: "",
                    fromHr: false,
                    submittedApplicationId: body.applicationId,
                },
                select: {
                    id: true,
                    timestamp: true,
                    submittedApplicationId: true,
                    fromHr: true,
                },
            });
            return created;
        }));
        if (!response)
            throw new errors_1.ValidationError("TRANSACTION FAILED");
        // Real-time push to anyone in this chat room (HR side).
        try {
            __1.notificationSocket.emitChatMessage(body.applicationId, {
                id: response.id,
                messageContent: body.message,
                fromHr: (_a = response.fromHr) !== null && _a !== void 0 ? _a : false,
                timestamp: typeof response.timestamp === "string"
                    ? response.timestamp
                    : new Date(response.timestamp).toISOString(),
                submittedApplicationId: response.submittedApplicationId,
                hrAdmin: null,
            });
        }
        catch (e) {
            console.warn("[chat] failed to emit applicant message:", e);
        }
        return res.code(200).send({ message: "OK", id: response.id });
    }
    catch (error) {
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw (0, errors_1.dbError)(error);
        }
        throw error;
    }
});
exports.sendPublicApplicationMessage = sendPublicApplicationMessage;
/**
 * PUBLIC applicant action: withdraw (cancel) a submitted application.
 *
 * Same trust model as the rest of the public applicant flow — the
 * `applicationId` (a UUID emailed only to the applicant) is the credential, so
 * no session gate. Sets status = 3 (Withdrawn). Refuses once the application is
 * already concluded (status 2); idempotent if already withdrawn. Posts a system
 * message into the existing HR conversation so the office sees it in real time.
 */
const withdrawApplication = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d, _e;
    const body = req.body;
    if (!body.applicationId)
        throw new errors_1.ValidationError("INVALID REQUIRED ID");
    try {
        const app = yield prisma_1.prisma.submittedApplication.findUnique({
            where: { id: body.applicationId },
            select: {
                id: true,
                status: true,
                firstname: true,
                lastname: true,
                lineId: true,
                forPosition: { select: { lineId: true } },
            },
        });
        if (!app)
            throw new errors_1.NotFoundError("APPLICATION NOT FOUND");
        if (app.status === 2)
            throw new errors_1.ValidationError("This application has already been concluded and can no longer be withdrawn.");
        if (app.status === 3)
            return res.code(200).send({ message: "OK", alreadyWithdrawn: true });
        yield prisma_1.prisma.submittedApplication.update({
            where: { id: app.id },
            data: { status: 3 },
        });
        // Leave a trace in the HR chat so the office notices (best-effort).
        try {
            const note = `${(_a = app.firstname) !== null && _a !== void 0 ? _a : "The applicant"} ${(_b = app.lastname) !== null && _b !== void 0 ? _b : ""}`.trim() +
                " withdrew this application." +
                (((_c = body.reason) === null || _c === void 0 ? void 0 : _c.trim()) ? ` Reason: ${body.reason.trim()}` : "");
            const enc = yield encryption_1.EncryptionService.encrypt(note);
            const msg = yield prisma_1.prisma.applicationConversation.create({
                data: {
                    message: enc.encryptedData,
                    messageIv: enc.iv,
                    lineId: ((_d = app.lineId) !== null && _d !== void 0 ? _d : (_e = app.forPosition) === null || _e === void 0 ? void 0 : _e.lineId),
                    title: "",
                    fromHr: false,
                    submittedApplicationId: app.id,
                },
                select: { id: true, timestamp: true, submittedApplicationId: true, fromHr: true },
            });
            __1.notificationSocket.emitChatMessage(app.id, {
                id: msg.id,
                messageContent: note,
                fromHr: false,
                timestamp: typeof msg.timestamp === "string"
                    ? msg.timestamp
                    : new Date(msg.timestamp).toISOString(),
                submittedApplicationId: msg.submittedApplicationId,
                hrAdmin: null,
            });
        }
        catch (e) {
            console.warn("[withdraw] notice failed:", e);
        }
        return res.code(200).send({ message: "OK", status: 3 });
    }
    catch (error) {
        if (error instanceof errors_1.NotFoundError || error instanceof errors_1.ValidationError)
            throw error;
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError)
            throw (0, errors_1.dbError)(error);
        throw error;
    }
});
exports.withdrawApplication = withdrawApplication;
/**
 * PUBLIC applicant action: replace the profile photo, or add/replace an
 * attached document, on a submitted application. Multipart:
 *   fields: applicationId (required), target = "profile" | "document",
 *           attachmentId (optional — replace that document)
 *   file:   the new file (any field name)
 * Same credential model as the rest of the public flow (applicationId is the
 * secret). Blocks edits once concluded/withdrawn. Old Cloudinary assets are
 * best-effort destroyed so they don't pile up.
 */
const reuploadApplicationFile = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, e_7, _b, _c, _d, e_8, _e, _f;
    if (!req.isMultipart())
        throw new errors_1.ValidationError("NOT_MULTIPART");
    const tmpDir = path_1.default.join(process.cwd(), "tmp_uploads");
    let tmpPath = null;
    try {
        const fields = {};
        let file = null;
        try {
            for (var _g = true, _h = __asyncValues(req.parts()), _j; _j = yield _h.next(), _a = _j.done, !_a; _g = true) {
                _c = _j.value;
                _g = false;
                const part = _c;
                if (part.type === "file") {
                    const chunks = [];
                    try {
                        for (var _k = true, _l = (e_8 = void 0, __asyncValues(part.file)), _m; _m = yield _l.next(), _d = _m.done, !_d; _k = true) {
                            _f = _m.value;
                            _k = false;
                            const c = _f;
                            chunks.push(c);
                        }
                    }
                    catch (e_8_1) { e_8 = { error: e_8_1 }; }
                    finally {
                        try {
                            if (!_k && !_d && (_e = _l.return)) yield _e.call(_l);
                        }
                        finally { if (e_8) throw e_8.error; }
                    }
                    file = { filename: part.filename, buffer: Buffer.concat(chunks) };
                }
                else {
                    fields[part.fieldname] = part.value;
                }
            }
        }
        catch (e_7_1) { e_7 = { error: e_7_1 }; }
        finally {
            try {
                if (!_g && !_a && (_b = _h.return)) yield _b.call(_h);
            }
            finally { if (e_7) throw e_7.error; }
        }
        const applicationId = fields.applicationId;
        const target = fields.target || "profile";
        if (!applicationId)
            throw new errors_1.ValidationError("INVALID REQUIRED ID");
        if (!file)
            throw new errors_1.ValidationError("No file provided.");
        const app = yield prisma_1.prisma.submittedApplication.findUnique({
            where: { id: applicationId },
            select: { id: true, status: true, applicationProfilePicId: true },
        });
        if (!app)
            throw new errors_1.NotFoundError("APPLICATION NOT FOUND");
        if (app.status === 2 || app.status === 3)
            throw new errors_1.ValidationError("This application can no longer be changed (it was concluded or withdrawn).");
        if (!fs_1.default.existsSync(tmpDir))
            fs_1.default.mkdirSync(tmpDir, { recursive: true });
        const safe = file.filename.replace(/[^\w.-]/g, "_");
        tmpPath = path_1.default.join(tmpDir, Date.now() + "_" + safe);
        fs_1.default.writeFileSync(tmpPath, file.buffer);
        const uploaded = yield Cloundinary_1.default.uploader.upload(tmpPath, {
            folder: "job_requirements_assets",
            resource_type: "auto",
            use_filename: true,
            unique_filename: true,
        });
        fs_1.default.unlinkSync(tmpPath);
        tmpPath = null;
        const destroyOld = (publicId) => __awaiter(void 0, void 0, void 0, function* () {
            if (!publicId)
                return;
            try {
                yield Cloundinary_1.default.uploader.destroy(publicId);
            }
            catch (e) {
                console.warn("[reupload] old asset destroy failed:", e);
            }
        });
        if (target === "profile") {
            // link a fresh profile-pic record, drop the previous one + its asset
            const prev = app.applicationProfilePicId
                ? yield prisma_1.prisma.applicationProfilePic.findUnique({
                    where: { id: app.applicationProfilePicId },
                    select: { id: true, file_url_Iv: true },
                })
                : null;
            const pic = yield prisma_1.prisma.applicationProfilePic.create({
                data: {
                    file_name: file.filename,
                    file_url: uploaded.url,
                    file_url_Iv: uploaded.public_id,
                    file_size: uploaded.bytes.toString(),
                    file_type: 1,
                },
            });
            yield prisma_1.prisma.submittedApplication.update({
                where: { id: app.id },
                data: { applicationProfilePicId: pic.id },
            });
            if (prev) {
                yield destroyOld(prev.file_url_Iv);
                yield prisma_1.prisma.applicationProfilePic
                    .delete({ where: { id: prev.id } })
                    .catch(() => undefined);
            }
            return res
                .code(200)
                .send({ message: "OK", target: "profile", file_url: pic.file_url });
        }
        // document: replace an existing attachment when attachmentId is given,
        // otherwise add a new one to this application
        if (fields.attachmentId) {
            const existing = yield prisma_1.prisma.applicationAttachedFile.findFirst({
                where: { id: fields.attachmentId, submittedApplicationId: app.id },
                select: { id: true, file_url_Iv: true },
            });
            if (!existing)
                throw new errors_1.NotFoundError("ATTACHMENT NOT FOUND");
            yield prisma_1.prisma.applicationAttachedFile.update({
                where: { id: existing.id },
                data: {
                    file_name: file.filename,
                    file_url: uploaded.url,
                    file_url_Iv: uploaded.public_id,
                    file_size: uploaded.bytes.toString(),
                },
            });
            yield destroyOld(existing.file_url_Iv);
            return res
                .code(200)
                .send({ message: "OK", target: "document", id: existing.id });
        }
        const created = yield prisma_1.prisma.applicationAttachedFile.create({
            data: {
                submittedApplicationId: app.id,
                file_name: file.filename,
                file_url: uploaded.url,
                file_url_Iv: uploaded.public_id,
                file_size: uploaded.bytes.toString(),
                file_type: 0,
            },
            select: { id: true, file_url: true },
        });
        return res
            .code(200)
            .send({ message: "OK", target: "document", id: created.id });
    }
    catch (error) {
        if (tmpPath && fs_1.default.existsSync(tmpPath)) {
            try {
                fs_1.default.unlinkSync(tmpPath);
            }
            catch (_o) {
                /* temp cleanup best-effort */
            }
        }
        if (error instanceof errors_1.NotFoundError || error instanceof errors_1.ValidationError)
            throw error;
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError)
            throw (0, errors_1.dbError)(error);
        throw error;
    }
});
exports.reuploadApplicationFile = reuploadApplicationFile;
/**
 * PUBLIC applicant action: edit the core contact / identity fields on a
 * submitted application (name, email, mobile, telephone) — the details most
 * often mistyped and the ones HR uses to reach the applicant. Encrypted fields
 * (email, mobile) are re-encrypted on save, matching how they're read back.
 *
 * Scope is deliberately limited to these safe scalar fields. Editing the full
 * PDS (work history, education, eligibility, addresses, IDs) means reopening
 * the multi-step application form and is a separate, larger flow.
 */
const editApplicationContact = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d, _e, _f, _g;
    const body = req.body;
    if (!body.applicationId)
        throw new errors_1.ValidationError("INVALID REQUIRED ID");
    const firstname = (_a = body.firstname) === null || _a === void 0 ? void 0 : _a.trim();
    const lastname = (_b = body.lastname) === null || _b === void 0 ? void 0 : _b.trim();
    const email = (_c = body.email) === null || _c === void 0 ? void 0 : _c.trim();
    const mobileNo = (_d = body.mobileNo) === null || _d === void 0 ? void 0 : _d.trim();
    if (!firstname || !lastname)
        throw new errors_1.ValidationError("Name is required.");
    if (!email)
        throw new errors_1.ValidationError("Email is required.");
    if (!mobileNo)
        throw new errors_1.ValidationError("Mobile number is required.");
    try {
        const app = yield prisma_1.prisma.submittedApplication.findUnique({
            where: { id: body.applicationId },
            select: { id: true, status: true },
        });
        if (!app)
            throw new errors_1.NotFoundError("APPLICATION NOT FOUND");
        if (app.status === 2 || app.status === 3)
            throw new errors_1.ValidationError("This application can no longer be changed (it was concluded or withdrawn).");
        const [encEmail, encMobile] = yield Promise.all([
            encryption_1.EncryptionService.encrypt(email),
            encryption_1.EncryptionService.encrypt(mobileNo),
        ]);
        yield prisma_1.prisma.submittedApplication.update({
            where: { id: app.id },
            data: {
                firstname,
                lastname,
                middleName: ((_e = body.middleName) === null || _e === void 0 ? void 0 : _e.trim()) || "N/A",
                suffix: ((_f = body.suffix) === null || _f === void 0 ? void 0 : _f.trim()) || null,
                teleNo: ((_g = body.teleNo) === null || _g === void 0 ? void 0 : _g.trim()) || "",
                email: encEmail.encryptedData,
                emailIv: encEmail.iv,
                mobileNo: encMobile.encryptedData,
                ivMobileNo: encMobile.iv,
            },
        });
        return res.code(200).send({ message: "OK" });
    }
    catch (error) {
        if (error instanceof errors_1.NotFoundError || error instanceof errors_1.ValidationError)
            throw error;
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError)
            throw (0, errors_1.dbError)(error);
        throw error;
    }
});
exports.editApplicationContact = editApplicationContact;
/**
 * PUBLIC applicant action: PARTIAL update of a submitted application.
 *
 * The safety guarantee for full-PDS editing: this only ever writes the keys
 * present in the request body, so a section the applicant didn't touch can
 * never be blanked. Each editable field is written EXACTLY the way
 * applicationData reads it back — the encrypted set below is the same set that
 * endpoint decrypts, so every edit round-trips. Unknown keys are ignored.
 * Blocked once concluded/withdrawn. applicationId is the credential.
 */
// Fields stored ENCRYPTED — value column -> its IV column. These are precisely
// the fields applicationData decrypts, so writes here match reads there.
const APP_ENCRYPTED = {
    email: "emailIv",
    cvilStatus: "cvilStatusIv",
    mobileNo: "ivMobileNo",
    resProvince: "resProvinceIv",
    resCity: "resCityIv",
    resBarangay: "resBarangayIv",
    permaProvince: "permaProvinceIv",
    permaCity: "permaCityIv",
    permaBarangay: "permaBarangayIv",
    fatherSurname: "fatherSurnameIv",
    fatherFirstname: "fatherFirstnameIv",
    motherSurname: "motherSurnameIv",
    motherFirstname: "motherFirstnameIv",
    birthDate: "bdayIv",
    umidNo: "umidNoIv",
    pagIbigNo: "pagIbigNoIv",
    philHealthNo: "philHealthNoIv",
    philSys: "philSysIv",
    tinNo: "tinNoIv",
    agencyNo: "agencyNoIv",
};
// Plain scalar strings (stored as-is).
const APP_PLAIN_STR = new Set([
    "firstname", "lastname", "middleName", "suffix", "gender", "teleNo",
    "height", "weight", "bloodType", "dualCitizenHalf",
    "resStreet", "resSub", "resZipCode", "reshouseBlock",
    "permaStreet", "permaSub", "permaZipCode", "permahouseBlock",
    "spouseSurname", "spouseFirstname", "spouseMiddle",
    "spouseBusinessAddress", "spouseTelephone",
    "children", // stored as a JSON string column
]);
const APP_BOOL = new Set(["filipino", "dualCitizen", "byBirth", "byNatural"]);
const APP_INT = new Set(["fatherAge", "motherAge"]);
// JSON columns (objects / arrays) written straight through.
const APP_JSON = new Set([
    "elementary", "secondary", "vocational", "college", "graduateCollege",
    "disclosures", "govId",
    "experience", "civilService", "voluntaryWork", "learningDev",
    "otherInfo", "references",
]);
const updatePublicApplication = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const body = req.body;
    const applicationId = body === null || body === void 0 ? void 0 : body.applicationId;
    if (!applicationId)
        throw new errors_1.ValidationError("INVALID REQUIRED ID");
    try {
        const app = yield prisma_1.prisma.submittedApplication.findUnique({
            where: { id: applicationId },
            select: { id: true, status: true },
        });
        if (!app)
            throw new errors_1.NotFoundError("APPLICATION NOT FOUND");
        if (app.status === 2 || app.status === 3)
            throw new errors_1.ValidationError("This application can no longer be changed (it was concluded or withdrawn).");
        const data = {};
        for (const [key, raw] of Object.entries(body)) {
            if (key === "applicationId")
                continue;
            if (APP_ENCRYPTED[key]) {
                // never store an empty ciphertext — treat blank as "clear to empty"
                const text = raw == null ? "" : String(raw);
                const enc = yield encryption_1.EncryptionService.encrypt(text);
                data[key] = enc.encryptedData;
                data[APP_ENCRYPTED[key]] = enc.iv;
            }
            else if (APP_PLAIN_STR.has(key)) {
                data[key] =
                    key === "children" && typeof raw !== "string"
                        ? JSON.stringify(raw !== null && raw !== void 0 ? raw : [])
                        : raw == null
                            ? ""
                            : String(raw);
            }
            else if (APP_BOOL.has(key)) {
                data[key] = raw === true || raw === "true";
            }
            else if (APP_INT.has(key)) {
                const n = parseInt(String(raw), 10);
                data[key] = Number.isFinite(n) ? n : 0;
            }
            else if (APP_JSON.has(key)) {
                data[key] = raw !== null && raw !== void 0 ? raw : (key === "disclosures" ? null : []);
            }
            // unknown keys ignored — cannot touch anything not whitelisted
        }
        if (Object.keys(data).length === 0)
            return res.code(200).send({ message: "OK", updated: 0 });
        yield prisma_1.prisma.submittedApplication.update({
            where: { id: app.id },
            data,
        });
        return res
            .code(200)
            .send({ message: "OK", updated: Object.keys(data).length });
    }
    catch (error) {
        if (error instanceof errors_1.NotFoundError || error instanceof errors_1.ValidationError)
            throw error;
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError)
            throw (0, errors_1.dbError)(error);
        throw error;
    }
});
exports.updatePublicApplication = updatePublicApplication;
const updateApplicationStatus = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const body = req.body;
    if (!body.userId || !body.applicantId)
        throw new errors_1.ValidationError("INVALID REQUIRED ID");
    try {
        const response = yield prisma_1.prisma.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            var _a;
            const user = yield tx.user.findUnique({
                where: {
                    id: body.userId,
                },
            });
            const applicant = yield tx.submittedApplication.findUnique({
                where: {
                    id: body.applicantId,
                },
                select: {
                    firstname: true,
                    lastname: true,
                    id: true,
                    forPosition: {
                        select: {
                            name: true,
                        },
                    },
                },
            });
            if (!applicant || !user)
                throw new errors_1.NotFoundError("ITEM_NOT_FOUND");
            yield tx.submittedApplication.update({
                where: {
                    id: applicant.id,
                },
                data: {
                    status: body.status,
                },
            });
            yield tx.humanResourcesLogs.create({
                data: {
                    userId: body.userId,
                    lineId: body.lineId,
                    action: "UPDATE",
                    desc: `UPDATE ${applicant.lastname}, ${applicant.firstname} application for ${(_a = applicant.forPosition) === null || _a === void 0 ? void 0 : _a.name}`,
                },
            });
            return "OK";
        }));
        if (response !== "OK")
            throw new errors_1.AppError("Something went wrong.", 500, "DB_ERROR");
        return res.code(200).send({ message: "OK" });
    }
    catch (error) {
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw (0, errors_1.dbError)(error);
        }
        throw error;
    }
});
exports.updateApplicationStatus = updateApplicationStatus;
const concludeApplication = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const body = req.body;
    if (!body.applicationId)
        throw new errors_1.ValidationError("INVALID REQUIRED ID");
    try {
        const response = yield prisma_1.prisma.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            var _a, _b;
            const application = yield tx.submittedApplication.findUnique({
                where: {
                    id: body.applicationId,
                },
                include: {
                    forPosition: {
                        select: {
                            name: true,
                        },
                    },
                    jobPost: {
                        select: {
                            salaryGrade: {
                                select: {
                                    grade: true,
                                    amount: true,
                                },
                            },
                            position: {
                                select: {
                                    name: true,
                                    id: true,
                                },
                            },
                        },
                    },
                },
            });
            if (!application) {
                throw new errors_1.NotFoundError("APPLICATION NOT FOUND");
            }
            const email = application.emailIv
                ? yield encryption_1.EncryptionService.decrypt(application.email, application.emailIv)
                : undefined;
            const mobileNo = application.ivMobileNo
                ? yield encryption_1.EncryptionService.decrypt(application.mobileNo, application.ivMobileNo)
                : undefined;
            if (!email)
                throw new errors_1.ValidationError("FAILED TO PARSE EMAIL");
            const link = `${officialUrl}/public/${application.lineId}/application/${application.id}`;
            yield tx.submittedApplication.update({
                where: {
                    id: application.id,
                },
                data: {
                    status: 3,
                },
            });
            // Generate professional text email content
            const emailContent = generateInvitationEmail(`${application.lastname}, ${application.firstname}` || "Applicant", ((_a = application.forPosition) === null || _a === void 0 ? void 0 : _a.name) || "the position", link);
            yield (0, handler_1.sendEmail)("Invitation to Complete Your Registration - Gasan Portal", email, emailContent, "HR Team -  Municipal Government");
            if (mobileNo) {
                const contact = (0, handler_1.phNumberFormat)(mobileNo);
                yield axios_1.default.post(`https://api.semaphore.co/api/v4/messages`, {
                    number: contact,
                    message: `
Your application for ${((_b = application.forPosition) === null || _b === void 0 ? void 0 : _b.name) || "{Error}"} has been approved, please check your email for the invitation link.

Sincerely,
The HR Team`,
                    apikey: Semaphore_1.semaphoreKey,
                }, {
                    headers: {
                        "Content-Type": "application/json",
                    },
                });
            }
            return "OK";
        }));
        return res
            .status(200)
            .send({ message: "Invitation sent successfully", data: response });
    }
    catch (error) {
        console.error("Error concluding application:", error);
        if (error instanceof errors_1.NotFoundError) {
            return res.status(404).send({ error: "Application not found" });
        }
        if (error instanceof errors_1.ValidationError) {
            return res.status(400).send({ error: "Failed to process email" });
        }
        return res.status(500).send({ error: "Internal server error" });
    }
});
exports.concludeApplication = concludeApplication;
// Helper function to generate professional text email content
const generateInvitationEmail = (applicantName, positionTitle, registrationLink) => {
    return `
INVITATION TO COMPLETE YOUR REGISTRATION
Municipal Government of Gasan

Dear ${applicantName},

We are pleased to inform you that your application for ${positionTitle} has been reviewed and we would like to invite you to complete your registration through our online portal.

NEXT STEPS:
Please use the link below to complete your registration and set up your account credentials:

REGISTRATION LINK: ${registrationLink}

REGISTRATION INSTRUCTIONS:
1. Click on the registration link above
2. Create your username and password
3. Set up your security preferences
4. Complete your profile information

IMPORTANT NOTES:
- This link is unique to your application and should not be shared with others
- Please complete your registration within 7 days
- Ensure you use a valid email address that you have access to
- Keep your login credentials secure

For security reasons, please do not share this link with anyone. If you did not apply for this position or believe you received this email in error, please contact us immediately.

If you encounter any issues during registration or have questions, please contact our HR Department at hr@gasan.gov.ph or call (042) 123-4567.

We look forward to having you as part of the Gasan Municipal Government community.

Best regards,

HR Team
Municipal Government of Gasan
Gasan, Marinduque
Email: hr@gasan.gov.ph
Phone: (042) 123-4567

CONFIDENTIALITY NOTICE:
This email and any attachments are confidential and intended solely for the use of the individual to whom they are addressed. If you are not the intended recipient, please notify us immediately and delete this email.
  `.trim();
};
const applicationRegisterUser = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const body = req.body;
    if (!body.applicationId || !body.username || !body.password || !body.lineId) {
        throw new errors_1.ValidationError("INVALID REQUIRED FIELD");
    }
    try {
        const response = yield prisma_1.prisma.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r;
            const check = yield tx.account.findFirst({
                where: {
                    username: {
                        contains: body.username,
                        mode: "insensitive",
                    },
                },
            });
            if (check)
                throw new errors_1.ValidationError("Username alrady exiist");
            const application = yield tx.submittedApplication.findUnique({
                where: {
                    id: body.applicationId,
                },
                select: {
                    id: true,
                    firstname: true,
                    lastname: true,
                    middleName: true,
                    email: true,
                    emailIv: true,
                    profilePic: {
                        select: {
                            file_name: true,
                            file_type: true,
                            file_size: true,
                            file_url: true,
                            file_url_Iv: true,
                        },
                    },
                    jobPost: {
                        select: {
                            id: true,
                            position: {
                                select: {
                                    name: true,
                                    id: true,
                                },
                            },
                            salaryGradeId: true,
                            unitPositionId: true,
                        },
                    },
                    positionId: true,
                },
            });
            if (!application)
                throw new errors_1.ValidationError("Application not found!");
            const hashedPassword = yield argon2_1.default.hash(body.password);
            const newAccount = yield tx.account.create({
                data: {
                    username: body.username,
                    password: hashedPassword,
                    lineId: body.lineId,
                },
            });
            const optional = {};
            if (application.profilePic) {
                optional.userProfilePictures = {
                    create: {
                        file_name: application.profilePic.file_name,
                        file_public_id: application.profilePic.file_url_Iv,
                        file_size: application.profilePic.file_size,
                        file_url: application.profilePic.file_url,
                    },
                };
            }
            // A vacant slot of the job post's unit position — the old nested
            // update used a non-unique `where { occupied: false }`, which Prisma
            // rejects at runtime, so this registration could never assign a slot.
            // resolveVacantSlot/claimSlot are the same proven helpers the invite
            // registrations use (atomic claim; clear "fully filled" message).
            const slot = yield (0, positionController_1.resolveVacantSlot)(tx, null, (_b = (_a = application.jobPost) === null || _a === void 0 ? void 0 : _a.unitPositionId) !== null && _b !== void 0 ? _b : null);
            const effectivePositionId = (_h = (_e = (_c = slot.positionId) !== null && _c !== void 0 ? _c : (_d = slot.unitPosition) === null || _d === void 0 ? void 0 : _d.positionId) !== null && _e !== void 0 ? _e : (_g = (_f = application.jobPost) === null || _f === void 0 ? void 0 : _f.position) === null || _g === void 0 ? void 0 : _g.id) !== null && _h !== void 0 ? _h : null;
            if (!effectivePositionId) {
                throw new errors_1.ValidationError("This job post has no resolvable position — contact HR.");
            }
            const effectiveSalaryGradeId = (_p = (_l = (_k = (_j = application.jobPost) === null || _j === void 0 ? void 0 : _j.salaryGradeId) !== null && _k !== void 0 ? _k : slot.salaryGradeId) !== null && _l !== void 0 ? _l : (_o = (_m = slot.unitPosition) === null || _m === void 0 ? void 0 : _m.position) === null || _o === void 0 ? void 0 : _o.salaryGradeId) !== null && _p !== void 0 ? _p : null;
            const user = yield tx.user.create({
                data: Object.assign(Object.assign({ username: newAccount.username, lineId: body.lineId, accountId: newAccount.id, firstName: application.firstname, lastName: application.lastname, email: application.email, emailIv: application.emailIv, positionId: effectivePositionId, departmentId: (_r = (_q = slot.unitPosition) === null || _q === void 0 ? void 0 : _q.departmentId) !== null && _r !== void 0 ? _r : null }, (effectiveSalaryGradeId
                    ? { salaryGradeId: effectiveSalaryGradeId }
                    : {})), optional),
            });
            yield (0, positionController_1.claimSlot)(tx, slot.id, user.id, effectivePositionId, effectiveSalaryGradeId);
            yield tx.submittedApplication.update({
                where: {
                    id: application.id,
                },
                data: {
                    userId: user.id,
                },
            });
            return "OK";
        }));
        if (response !== "OK") {
            throw new errors_1.ValidationError("FAILED TO CREATE ACCOUNT");
        }
        return res.code(200).send({ message: "OK" });
    }
    catch (error) {
        //console.log(error);
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw (0, errors_1.dbError)(error);
        }
        throw error;
    }
});
exports.applicationRegisterUser = applicationRegisterUser;
const deleteApplication = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const params = req.query;
    console.log(params);
    if (!params.id || !params.userId || !params.lineId) {
        throw new errors_1.ValidationError("INVALID REQUIRED PARAMETERS");
    }
    try {
        const response = yield prisma_1.prisma.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            const application = yield tx.submittedApplication.delete({
                where: {
                    id: params.id,
                },
            });
            yield tx.humanResourcesLogs.create({
                data: {
                    userId: params.userId,
                    action: "DELETE",
                    desc: `DELETE application of ${application.lastname}, ${application.firstname}`,
                    lineId: params.lineId,
                },
            });
            return "OK";
        }));
        if (response !== "OK") {
            throw new errors_1.ValidationError("FAILED TO DELETE APPLICATION");
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
exports.deleteApplication = deleteApplication;
const applicationDeleteMany = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    const body = req.body;
    console.log({ body });
    if (!((_a = body.ids) === null || _a === void 0 ? void 0 : _a.length) || !body.userId || !body.lineId) {
        throw new errors_1.ValidationError("INVALID REQUIRED PARAMETERS");
    }
    try {
        const ressponse = yield prisma_1.prisma.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            yield tx.submittedApplication.deleteMany({
                where: {
                    id: {
                        in: body.ids,
                    },
                },
            });
            yield tx.humanResourcesLogs.createMany({
                data: body.ids.map((id) => ({
                    userId: body.userId,
                    action: "DELETE",
                    desc: `DELETE application with id ${id}`,
                    lineId: body.lineId,
                })),
            });
            return true;
        }));
        if (!ressponse)
            throw new errors_1.ValidationError("FAILED TO DELETE APPLICATIONS");
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
exports.applicationDeleteMany = applicationDeleteMany;
