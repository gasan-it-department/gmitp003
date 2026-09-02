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
exports.pesoJobData = exports.pesoJobList = exports.updatePesoJob = exports.createPesoJob = void 0;
const prisma_1 = require("../barrel/prisma");
const errors_1 = require("../errors/errors");
const normalizeApplyMode = (v) => v === "EXTERNAL" ? "EXTERNAL" : "INTERNAL";
/** Create a PESO external job post (starts as a draft, status = 0). */
const createPesoJob = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const body = req.body;
    if (!body.lineId || !body.userId)
        throw new errors_1.ValidationError("INVALID REQUIRED ID");
    if (!body.jobTitle || !body.jobTitle.trim())
        throw new errors_1.ValidationError("Job title is required");
    const applyMode = normalizeApplyMode(body.applyMode);
    if (applyMode === "EXTERNAL" && !body.applyUrl && !body.contactInfo) {
        throw new errors_1.ValidationError("External jobs need an application link or contact info.");
    }
    try {
        const id = yield prisma_1.prisma.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l;
            const post = yield tx.jobPost.create({
                data: {
                    postType: "PESO",
                    applyMode,
                    positionId: null,
                    salaryGradeId: null,
                    unitPositionId: null,
                    lineId: body.lineId,
                    status: 0,
                    slot: body.slot && body.slot > 0 ? body.slot : 1,
                    showApplicationCount: (_a = body.showApplicationCount) !== null && _a !== void 0 ? _a : false,
                    hideSG: (_b = body.hideSG) !== null && _b !== void 0 ? _b : false,
                    location: ((_c = body.location) === null || _c === void 0 ? void 0 : _c.trim()) || "N/A",
                    desc: ((_d = body.desc) === null || _d === void 0 ? void 0 : _d.trim()) || "N/A",
                    jobTitle: body.jobTitle.trim(),
                    employerName: ((_e = body.employerName) === null || _e === void 0 ? void 0 : _e.trim()) || null,
                    employmentType: ((_f = body.employmentType) === null || _f === void 0 ? void 0 : _f.trim()) || null,
                    salaryText: ((_g = body.salaryText) === null || _g === void 0 ? void 0 : _g.trim()) || null,
                    applyUrl: applyMode === "EXTERNAL" ? ((_h = body.applyUrl) === null || _h === void 0 ? void 0 : _h.trim()) || null : null,
                    contactInfo: applyMode === "EXTERNAL" ? ((_j = body.contactInfo) === null || _j === void 0 ? void 0 : _j.trim()) || null : null,
                    deadline: body.deadline ? new Date(body.deadline) : null,
                },
                select: { id: true },
            });
            yield tx.humanResourcesLogs.create({
                data: {
                    action: "ADDED",
                    userId: body.userId,
                    lineId: body.lineId,
                    desc: `PESO job created: ${(_k = body.jobTitle) === null || _k === void 0 ? void 0 : _k.trim()} | ` +
                        `Employer: ${((_l = body.employerName) === null || _l === void 0 ? void 0 : _l.trim()) || "N/A"} | ` +
                        `Apply: ${applyMode}`,
                },
            });
            return post.id;
        }));
        if (!id)
            throw new errors_1.AppError("Something went wrong", 500, "DB_ERROR");
        return res.code(200).send({ message: "OK", id });
    }
    catch (error) {
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw new errors_1.AppError("DATABASE_CONNECTION_FAILED", 500, "DB_ERROR");
        }
        throw error;
    }
});
exports.createPesoJob = createPesoJob;
/**
 * Update a PESO job post. Caller sends only what changed (undefined = leave
 * alone; send `deadline: null` to clear it). Status transitions follow the same
 * whitelist as HR posts: 0 draft → 1 published → 3 paused.
 */
const updatePesoJob = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const body = req.body;
    if (!body.id)
        throw new errors_1.ValidationError("INVALID REQUIRED ID");
    try {
        const result = yield prisma_1.prisma.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k;
            const post = yield tx.jobPost.findUnique({
                where: { id: body.id },
                select: { id: true, status: true, postType: true, jobTitle: true },
            });
            if (!post)
                throw new errors_1.NotFoundError("JOB POST NOT FOUND");
            if (post.postType !== "PESO")
                throw new errors_1.ValidationError("Not a PESO job post.");
            if (body.status !== undefined && body.status !== post.status) {
                const allowed = {
                    0: [1],
                    1: [3],
                    3: [1, 0],
                };
                const ok = (_b = (_a = allowed[post.status]) === null || _a === void 0 ? void 0 : _a.includes(body.status)) !== null && _b !== void 0 ? _b : false;
                if (!ok) {
                    throw new errors_1.ValidationError(`Cannot move status from ${post.status} to ${body.status}.`);
                }
            }
            const data = {};
            if (body.jobTitle !== undefined)
                data.jobTitle = body.jobTitle.trim();
            if (body.employerName !== undefined)
                data.employerName = ((_c = body.employerName) === null || _c === void 0 ? void 0 : _c.trim()) || null;
            if (body.location !== undefined)
                data.location = ((_d = body.location) === null || _d === void 0 ? void 0 : _d.trim()) || "N/A";
            if (body.employmentType !== undefined)
                data.employmentType = ((_e = body.employmentType) === null || _e === void 0 ? void 0 : _e.trim()) || null;
            if (body.salaryText !== undefined)
                data.salaryText = ((_f = body.salaryText) === null || _f === void 0 ? void 0 : _f.trim()) || null;
            if (body.desc !== undefined)
                data.desc = ((_g = body.desc) === null || _g === void 0 ? void 0 : _g.trim()) || "N/A";
            if (body.slot !== undefined && body.slot > 0)
                data.slot = body.slot;
            if (body.showApplicationCount !== undefined)
                data.showApplicationCount = body.showApplicationCount;
            if (body.applyMode !== undefined) {
                const mode = normalizeApplyMode(body.applyMode);
                data.applyMode = mode;
                if (mode === "INTERNAL") {
                    data.applyUrl = null;
                    data.contactInfo = null;
                }
            }
            if (body.applyUrl !== undefined)
                data.applyUrl = ((_h = body.applyUrl) === null || _h === void 0 ? void 0 : _h.trim()) || null;
            if (body.contactInfo !== undefined)
                data.contactInfo = ((_j = body.contactInfo) === null || _j === void 0 ? void 0 : _j.trim()) || null;
            if (body.status !== undefined)
                data.status = body.status;
            if (body.deadline !== undefined)
                data.deadline = body.deadline ? new Date(body.deadline) : null;
            if (Object.keys(data).length > 0) {
                yield tx.jobPost.update({ where: { id: post.id }, data });
            }
            const wasStatusChange = body.status !== undefined && body.status !== post.status;
            yield tx.humanResourcesLogs.create({
                data: {
                    action: wasStatusChange ? "STATUS" : "UPDATED",
                    userId: body.userId,
                    lineId: body.lineId,
                    desc: `PESO job "${(_k = post.jobTitle) !== null && _k !== void 0 ? _k : "N/A"}" ` +
                        (wasStatusChange
                            ? `status ${post.status} → ${body.status}`
                            : "details updated"),
                },
            });
            return true;
        }));
        if (!result)
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
exports.updatePesoJob = updatePesoJob;
/** Paginated management list of a line's PESO posts (all statuses). */
const pesoJobList = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const params = req.query;
    if (!params.id)
        throw new errors_1.ValidationError("INVALID ID");
    try {
        const cursor = params.lastCursor ? { id: params.lastCursor } : undefined;
        const limit = params.limit ? parseInt(params.limit, 10) : 20;
        const andClauses = [
            { postType: "PESO" },
            { lineId: params.id },
        ];
        if (params.query && params.query.trim()) {
            const q = params.query.trim();
            andClauses.push({
                OR: [
                    { jobTitle: { contains: q, mode: "insensitive" } },
                    { employerName: { contains: q, mode: "insensitive" } },
                    { desc: { contains: q, mode: "insensitive" } },
                ],
            });
        }
        const list = yield prisma_1.prisma.jobPost.findMany({
            where: { AND: andClauses },
            include: {
                _count: { select: { submittedApplications: true } },
                requirements: { select: { id: true } },
            },
            skip: cursor ? 1 : 0,
            take: limit,
            orderBy: { timestamp: "desc" },
            cursor,
        });
        const shaped = list.map((j) => {
            var _a, _b;
            return (Object.assign(Object.assign({}, j), { _count: { application: (_b = (_a = j._count) === null || _a === void 0 ? void 0 : _a.submittedApplications) !== null && _b !== void 0 ? _b : 0 } }));
        });
        const lastCursor = shaped.length > 0 ? shaped[shaped.length - 1].id : null;
        const hasMore = shaped.length === limit;
        return res.code(200).send({ list: shaped, hasMore, lastCursor });
    }
    catch (error) {
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw new errors_1.AppError("DATABASE_CONNECTION_FAILED", 500, "DB_ERROR");
        }
        throw error;
    }
});
exports.pesoJobList = pesoJobList;
/** Single PESO post (for the edit form). */
const pesoJobData = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    const params = req.query;
    if (!params.id)
        throw new errors_1.ValidationError("INVALID ID");
    try {
        const post = yield prisma_1.prisma.jobPost.findUnique({
            where: { id: params.id },
            include: {
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
                _count: { select: { submittedApplications: true } },
            },
        });
        if (!post)
            throw new errors_1.NotFoundError("JOB POST NOT FOUND");
        if (post.postType !== "PESO")
            throw new errors_1.ValidationError("Not a PESO job post.");
        return res.code(200).send(Object.assign(Object.assign({}, post), { _count: { application: (_b = (_a = post._count) === null || _a === void 0 ? void 0 : _a.submittedApplications) !== null && _b !== void 0 ? _b : 0 } }));
    }
    catch (error) {
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw new errors_1.AppError("DATABASE_CONNECTION_FAILED", 500, "DB_ERROR");
        }
        throw error;
    }
});
exports.pesoJobData = pesoJobData;
