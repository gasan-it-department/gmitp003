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
exports.applicationDeleteMany = exports.deleteApplication = exports.applicationRegisterUser = exports.concludeApplication = exports.updateApplicationStatus = exports.sendPublicApplicationMessage = exports.adminApplicationSendConversation = exports.applicationConvertion = exports.exportPersonalDataSheet = exports.contactManyApplicants = exports.contactApplicant = exports.applicationData = exports.applicationList = exports.submitApplication = exports.jobPost = exports.postJobRequirementsRemoveAsset = exports.removePostJobRequirements = exports.updatePostJobRequiments = exports.postJobRequirements = exports.createPobJobRequirements = exports.updatePostJob = exports.updatePostApplication = exports.postJob = exports.applications = void 0;
const prisma_1 = require("../barrel/prisma");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const Cloundinary_1 = __importDefault(require("../class/Cloundinary"));
const argon2_1 = __importDefault(require("argon2"));
const encryption_1 = require("../service/encryption");
const errors_1 = require("../errors/errors");
const Semaphore_1 = require("../class/Semaphore");
const handler_1 = require("../middleware/handler");
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
                    desc: `UPDATED JOB POST STATUS: ${post.position.name}`,
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
const updatePostJob = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const param = req.body;
    if (!param.id)
        throw new errors_1.ValidationError("INVALID REQUIRED ID");
    try {
        const response = yield prisma_1.prisma.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            const jobPost = yield tx.jobPost.findUnique({
                where: {
                    id: param.id,
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
            if (!jobPost)
                throw new errors_1.NotFoundError("JOB POST NOT FOUND");
            const optional = {};
            if (jobPost.desc !== param.desc) {
                optional.desc = param.desc;
            }
            if (param.deadline) {
                optional.deadline = param.deadline;
            }
            yield tx.jobPost.update({
                where: {
                    id: jobPost.id,
                },
                data: Object.assign({ hideSG: param.hideSG, showApplicationCount: param.showApplicationCount, status: param.status, salaryGradeId: param.salaryGrade }, optional),
            });
            yield tx.humanResourcesLogs.create({
                data: {
                    action: "UPDATED",
                    userId: param.userId,
                    lineId: param.lineId,
                    desc: `New job posting created: ${jobPost.position.name || "N/A"} | Hide SG: ${param.hideSG ? "Yes" : "No"} | Show App Count: ${param.showApplicationCount ? "Yes" : "No"}`,
                },
            });
            return "OK";
        }));
        if (response !== "OK")
            throw new errors_1.AppError("DB_CONNECTION", 500, "DB_ERROR");
        return res.code(200).send({ message: "OK" });
    }
    catch (error) {
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
            throw new errors_1.AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
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
            throw new errors_1.AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
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
            throw new errors_1.AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
        return res.code(200).send({ message: "OK" });
    }
    catch (error) {
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw new errors_1.AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
        }
        throw error;
    }
});
exports.postJobRequirementsRemoveAsset = postJobRequirementsRemoveAsset;
const jobPost = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const params = req.query;
    if (!params.id)
        throw new errors_1.ValidationError("INVALID ID");
    try {
        const cursor = params.lastCursor ? { id: params.lastCursor } : undefined;
        const limit = params.limit ? parseInt(params.limit, 10) : 20;
        const filter = {};
        if (params.query) {
            filter.position = {
                name: {
                    contains: params.query,
                    mode: "insensitive",
                },
            };
        }
        const response = yield prisma_1.prisma.jobPost.findMany({
            where: Object.assign({ line: {
                    municipalId: params.id,
                }, status: 1 }, filter),
            include: {
                position: {
                    select: {
                        name: true,
                        id: true,
                    },
                },
                requirements: {
                    select: {
                        id: true,
                        title: true,
                        asset: {
                            select: {
                                fileName: true,
                                fileSize: true,
                                fileUrl: true,
                                id: true,
                            },
                        },
                    },
                },
                salaryGrade: {
                    select: {
                        grade: true,
                        id: true,
                    },
                },
                _count: {
                    select: {
                        application: {
                            where: {
                                status: "pending",
                            },
                        },
                    },
                },
                unitPos: {
                    select: {
                        unit: {
                            select: {
                                name: true,
                            },
                        },
                    },
                },
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
            throw new errors_1.AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
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
                yield axios_1.default.post(`https://api.semaphore.co/api/v4/messages`, {
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
exports.submitApplication = submitApplication;
const applicationList = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const params = req.query;
    if (!params.id)
        throw new errors_1.ValidationError("INVALID REQUIRED ID");
    try {
        const cursor = params.lastCursor ? { id: params.lastCursor } : undefined;
        const limit = params.limit ? parseInt(params.limit, 10) : 20;
        // Build the where clause conditionally
        const whereClause = {
            lineId: params.id,
        };
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
            },
        });
        const newLastCursorId = response.length > 0 ? response[response.length - 1].id : null;
        const hasMore = limit === response.length;
        return res.code(200).send({
            list: response,
            hasMore,
            lastCursor: newLastCursorId,
        });
    }
    catch (error) {
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw new errors_1.AppError("DB_CONNECTION_ERROR", 500, "DB_ERROR");
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
            throw new errors_1.AppError("DB_CONNECTION_ERROR", 500, "DB_ERROR");
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
            // Add SMS sending logic here if available
            // communicationPromises.push(sendSMS(phoneNumber, message));
            yield Semaphore_2.semaphoreService.sendSingleSMS(phoneNumber, "TEst", "Gasan");
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
        const BATCH_SIZE = 10;
        const communicationPromises = [];
        for (let i = 0; i < applicantsWithDecryptedInfo.length; i += BATCH_SIZE) {
            const batch = applicantsWithDecryptedInfo.slice(i, i + BATCH_SIZE);
            const batchPromises = batch.map((applicant) => {
                const individualPromises = [];
                if (sendTo === "email" || sendTo === "both") {
                    // Personalize message for each applicant
                    const personalizedMessage = message.replace(/{{name}}/g, applicant.name);
                    individualPromises.push((0, handler_1.sendEmail)(subject, applicant.email, personalizedMessage, "HR Team"));
                }
                if (sendTo === "phoneNumber" || sendTo === "both") {
                    // Add SMS sending logic here if available
                    // individualPromises.push(sendSMS(applicant.phoneNumber, message));
                }
                // Log each contact attempt
                return Promise.all(individualPromises);
            });
            communicationPromises.push(...batchPromises);
        }
        yield Promise.all(communicationPromises);
        return res.code(200).send({
            success: true,
            message: `Messages sent successfully to ${applicantsWithDecryptedInfo.length} applicants`,
            recipients: applicantsWithDecryptedInfo.length,
            sentTo: sendTo,
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
            throw new errors_1.AppError("DB_CONNECTION_ERROR", 500, "DB_ERROR");
        }
        throw error;
    }
});
exports.applicationConvertion = applicationConvertion;
const adminApplicationSendConversation = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
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
            yield tx.applicationConversation.create({
                data: {
                    message: encryptedMessage.encryptedData,
                    messageIv: encryptedMessage.iv,
                    userId: body.userId,
                    submittedApplicationId: body.applicationId,
                    title: "New message",
                    lineId: user.lineId,
                },
            });
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
            return "OK";
        }));
        if (response !== "OK") {
            throw new errors_1.AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
        }
        return res.code(200).send({ message: "OK" });
    }
    catch (error) {
        console.log(error);
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw new errors_1.AppError("DB_CONNECTION_ERROR", 500, "DB_ERROR");
        }
        throw error;
    }
});
exports.adminApplicationSendConversation = adminApplicationSendConversation;
const sendPublicApplicationMessage = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const body = req.body;
    if (!body.applicationId || !body.message) {
        throw new errors_1.ValidationError("INVALID REQUIRED FIELD");
    }
    try {
        const encryptedMessage = yield encryption_1.EncryptionService.encrypt(body.message);
        const response = yield prisma_1.prisma.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            var _a;
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
            yield tx.applicationConversation.create({
                data: {
                    message: encryptedMessage.encryptedData,
                    messageIv: encryptedMessage.iv,
                    lineId: (_a = application.forPosition) === null || _a === void 0 ? void 0 : _a.lineId,
                    title: "",
                    fromHr: false,
                    submittedApplicationId: body.applicationId,
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
            throw new errors_1.AppError("DB_CONNECTION_ERROR", 500, "DB_ERROR");
        }
        throw error;
    }
});
exports.sendPublicApplicationMessage = sendPublicApplicationMessage;
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
            throw new errors_1.AppError("DB_CONNECTION_ERROR", 500, "DB_ERROR");
        return res.code(200).send({ message: "OK" });
    }
    catch (error) {
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw new errors_1.AppError("DB_CONNECTION_ERROR", 500, "DB_ERROR");
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
            const link = `${officialUrl}public/${application.lineId}/application/${application.id}`;
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
            var _a, _b, _c, _d;
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
            const user = yield tx.user.create({
                data: {
                    username: newAccount.username,
                    lineId: body.lineId,
                    accountId: newAccount.id,
                    firstName: application.firstname,
                    lastName: application.lastname,
                    email: application.email,
                    emailIv: application.emailIv,
                    positionId: (_a = application.jobPost) === null || _a === void 0 ? void 0 : _a.position.id,
                    salaryGradeId: (_b = application.jobPost) === null || _b === void 0 ? void 0 : _b.salaryGradeId,
                },
            });
            yield tx.unitPosition.update({
                where: {
                    id: (_c = application.jobPost) === null || _c === void 0 ? void 0 : _c.unitPositionId,
                    positionId: application.positionId,
                },
                data: {
                    slot: {
                        update: {
                            where: {
                                occupied: false,
                                userId: undefined,
                            },
                            data: {
                                occupied: true,
                                userId: user.id,
                            },
                        },
                    },
                },
            });
            yield tx.positionSlot.update({
                where: {
                    userId: user.id,
                    salaryGradeId: (_d = application.jobPost) === null || _d === void 0 ? void 0 : _d.salaryGradeId,
                },
                data: {
                    userId: user.id,
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
            throw new errors_1.AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
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
            throw new errors_1.AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
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
            throw new errors_1.AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
        }
        throw error;
    }
});
exports.applicationDeleteMany = applicationDeleteMany;
