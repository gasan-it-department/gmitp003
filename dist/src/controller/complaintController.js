"use strict";
// Employee complaints — self-service ticketing.
//
// Any line user can file a complaint (no HR enrolment needed). HR can
// see/triage/respond via the same endpoints; visibility is governed by
// the `userId` filter — if the caller passes their own userId they only
// see theirs, if they pass just `lineId` they see all in the line.
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.removeComplaint = exports.updateComplaintStatus = exports.replyComplaint = exports.complaintDetail = exports.listComplaints = exports.removeEvidence = exports.streamEvidence = exports.addEvidence = exports.createComplaint = void 0;
const prisma_1 = require("../barrel/prisma");
const errors_1 = require("../errors/errors");
const CATEGORIES = new Set([
    "general",
    "hr",
    "facilities",
    "it",
    "payroll",
    "safety",
]);
const STATUSES = new Set(["open", "in_progress", "resolved", "closed"]);
const PRIORITIES = new Set(["low", "normal", "high"]);
// ─── Create (multipart: text fields + zero-to-many evidence files) ────
const EVIDENCE_MIMES = new Set([
    "image/png",
    "image/jpeg",
    "image/jpg",
    "image/webp",
    "image/gif",
    "application/pdf",
]);
const EVIDENCE_MAX_BYTES = 10 * 1024 * 1024; // 10 MB per file
const createComplaint = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, e_1, _b, _c, _d, e_2, _e, _f;
    var _g;
    // Accept either JSON (no files) or multipart (with files).
    let fields = {};
    const files = [];
    if (req.isMultipart()) {
        const parts = req.parts();
        try {
            for (var _h = true, parts_1 = __asyncValues(parts), parts_1_1; parts_1_1 = yield parts_1.next(), _a = parts_1_1.done, !_a; _h = true) {
                _c = parts_1_1.value;
                _h = false;
                const part = _c;
                if (part.type === "file") {
                    const chunks = [];
                    try {
                        for (var _j = true, _k = (e_2 = void 0, __asyncValues(part.file)), _l; _l = yield _k.next(), _d = _l.done, !_d; _j = true) {
                            _f = _l.value;
                            _j = false;
                            const chunk = _f;
                            chunks.push(chunk);
                        }
                    }
                    catch (e_2_1) { e_2 = { error: e_2_1 }; }
                    finally {
                        try {
                            if (!_j && !_d && (_e = _k.return)) yield _e.call(_k);
                        }
                        finally { if (e_2) throw e_2.error; }
                    }
                    const buf = Buffer.concat(chunks);
                    if (!EVIDENCE_MIMES.has(part.mimetype)) {
                        throw new errors_1.ValidationError(`Unsupported file type: ${part.mimetype}. PNG/JPG/WebP/GIF/PDF only.`);
                    }
                    if (buf.length > EVIDENCE_MAX_BYTES) {
                        throw new errors_1.ValidationError(`File ${part.filename} exceeds the 10MB limit.`);
                    }
                    files.push({
                        fileName: part.filename,
                        fileType: part.mimetype,
                        buffer: buf,
                    });
                }
                else {
                    fields[part.fieldname] = String(part.value);
                }
            }
        }
        catch (e_1_1) { e_1 = { error: e_1_1 }; }
        finally {
            try {
                if (!_h && !_a && (_b = parts_1.return)) yield _b.call(parts_1);
            }
            finally { if (e_1) throw e_1.error; }
        }
    }
    else {
        fields = (_g = req.body) !== null && _g !== void 0 ? _g : {};
    }
    const { userId, lineId, title, description, category, priority, againstUserId, } = fields;
    if (!userId || !lineId || !title || !description) {
        throw new errors_1.ValidationError("INVALID REQUIRED FIELDS");
    }
    const cat = category && CATEGORIES.has(category) ? category : "general";
    const pr = priority && PRIORITIES.has(priority) ? priority : "normal";
    if (againstUserId && againstUserId === userId) {
        throw new errors_1.ValidationError("You can't file a complaint against yourself.");
    }
    try {
        const created = yield prisma_1.prisma.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            const c = yield tx.complaint.create({
                data: {
                    userId,
                    lineId,
                    title,
                    description,
                    category: cat,
                    priority: pr,
                    status: "open",
                    againstUserId: againstUserId || null,
                },
            });
            if (files.length > 0) {
                yield tx.complaintEvidence.createMany({
                    data: files.map((f) => ({
                        complaintId: c.id,
                        fileName: f.fileName,
                        fileType: f.fileType,
                        fileSize: f.buffer.length,
                        data: f.buffer,
                        uploadedById: userId,
                    })),
                });
            }
            return c;
        }));
        return res.code(200).send({ message: "OK", complaint: created });
    }
    catch (error) {
        if (error instanceof errors_1.ValidationError)
            throw error;
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw new errors_1.AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
        }
        throw error;
    }
});
exports.createComplaint = createComplaint;
// ─── Evidence: add more files to an existing complaint ────────────────
const addEvidence = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, e_3, _b, _c, _d, e_4, _e, _f;
    if (!req.isMultipart())
        throw new errors_1.ValidationError("Multipart required");
    const fields = {};
    const files = [];
    const parts = req.parts();
    try {
        for (var _g = true, parts_2 = __asyncValues(parts), parts_2_1; parts_2_1 = yield parts_2.next(), _a = parts_2_1.done, !_a; _g = true) {
            _c = parts_2_1.value;
            _g = false;
            const part = _c;
            if (part.type === "file") {
                const chunks = [];
                try {
                    for (var _h = true, _j = (e_4 = void 0, __asyncValues(part.file)), _k; _k = yield _j.next(), _d = _k.done, !_d; _h = true) {
                        _f = _k.value;
                        _h = false;
                        const chunk = _f;
                        chunks.push(chunk);
                    }
                }
                catch (e_4_1) { e_4 = { error: e_4_1 }; }
                finally {
                    try {
                        if (!_h && !_d && (_e = _j.return)) yield _e.call(_j);
                    }
                    finally { if (e_4) throw e_4.error; }
                }
                const buf = Buffer.concat(chunks);
                if (!EVIDENCE_MIMES.has(part.mimetype)) {
                    throw new errors_1.ValidationError(`Unsupported file type: ${part.mimetype}.`);
                }
                if (buf.length > EVIDENCE_MAX_BYTES) {
                    throw new errors_1.ValidationError(`${part.filename} exceeds 10MB.`);
                }
                files.push({
                    fileName: part.filename,
                    fileType: part.mimetype,
                    buffer: buf,
                });
            }
            else {
                fields[part.fieldname] = String(part.value);
            }
        }
    }
    catch (e_3_1) { e_3 = { error: e_3_1 }; }
    finally {
        try {
            if (!_g && !_a && (_b = parts_2.return)) yield _b.call(parts_2);
        }
        finally { if (e_3) throw e_3.error; }
    }
    const { complaintId, userId } = fields;
    if (!complaintId || !userId || files.length === 0) {
        throw new errors_1.ValidationError("INVALID REQUIRED FIELDS");
    }
    try {
        yield prisma_1.prisma.complaintEvidence.createMany({
            data: files.map((f) => ({
                complaintId,
                fileName: f.fileName,
                fileType: f.fileType,
                fileSize: f.buffer.length,
                data: f.buffer,
                uploadedById: userId,
            })),
        });
        return res.code(200).send({ message: "OK", added: files.length });
    }
    catch (error) {
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw new errors_1.AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
        }
        throw error;
    }
});
exports.addEvidence = addEvidence;
// ─── Evidence: stream a single file ───────────────────────────────────
const streamEvidence = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const params = req.query;
    if (!params.id)
        throw new errors_1.ValidationError("INVALID REQUIRED ID");
    try {
        const row = yield prisma_1.prisma.complaintEvidence.findUnique({
            where: { id: params.id },
        });
        if (!row)
            throw new errors_1.NotFoundError("Evidence not found");
        const buf = Buffer.from(row.data);
        res.header("Content-Type", row.fileType || "application/octet-stream");
        res.header("Content-Disposition", `inline; filename="${row.fileName}"`);
        res.header("Content-Length", buf.length.toString());
        return res.code(200).send(buf);
    }
    catch (error) {
        if (error instanceof errors_1.NotFoundError)
            throw error;
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw new errors_1.AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
        }
        throw error;
    }
});
exports.streamEvidence = streamEvidence;
// ─── Evidence: remove (only the uploader can remove) ──────────────────
const removeEvidence = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const params = req.query;
    if (!params.id || !params.userId) {
        throw new errors_1.ValidationError("INVALID REQUIRED FIELDS");
    }
    try {
        const row = yield prisma_1.prisma.complaintEvidence.findUnique({
            where: { id: params.id },
            select: { uploadedById: true },
        });
        if (!row)
            throw new errors_1.NotFoundError("Evidence not found");
        if (row.uploadedById && row.uploadedById !== params.userId) {
            throw new errors_1.ValidationError("Only the uploader can remove this file.");
        }
        yield prisma_1.prisma.complaintEvidence.delete({ where: { id: params.id } });
        return res.code(200).send({ message: "OK" });
    }
    catch (error) {
        if (error instanceof errors_1.NotFoundError)
            throw error;
        if (error instanceof errors_1.ValidationError)
            throw error;
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw new errors_1.AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
        }
        throw error;
    }
});
exports.removeEvidence = removeEvidence;
// ─── List ──────────────────────────────────────────────────────────────
const listComplaints = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    const params = req.query;
    if (!params.userId && !params.lineId) {
        throw new errors_1.ValidationError("Provide userId or lineId");
    }
    try {
        const limit = params.limit ? parseInt(params.limit, 10) : 20;
        const cursor = params.lastCursor && params.lastCursor !== "null"
            ? { id: params.lastCursor }
            : undefined;
        const where = {};
        if (params.userId)
            where.userId = params.userId;
        if (params.lineId)
            where.lineId = params.lineId;
        if (params.status && params.status !== "all")
            where.status = params.status;
        if (params.category && params.category !== "all") {
            where.category = params.category;
        }
        if ((_a = params.query) === null || _a === void 0 ? void 0 : _a.trim()) {
            const q = params.query.trim();
            where.OR = [
                { title: { contains: q, mode: "insensitive" } },
                { description: { contains: q, mode: "insensitive" } },
            ];
        }
        const rows = yield prisma_1.prisma.complaint.findMany({
            where,
            take: limit,
            skip: cursor ? 1 : 0,
            cursor,
            orderBy: { createdAt: "desc" },
            include: {
                user: {
                    select: {
                        id: true,
                        firstName: true,
                        lastName: true,
                        username: true,
                        Position: { select: { name: true } },
                    },
                },
                againstUser: {
                    select: {
                        id: true,
                        firstName: true,
                        lastName: true,
                        username: true,
                        Position: { select: { name: true } },
                    },
                },
                assignedTo: {
                    select: { id: true, firstName: true, lastName: true },
                },
                _count: { select: { replies: true, evidence: true } },
            },
        });
        const lastCursor = rows.length ? rows[rows.length - 1].id : null;
        const hasMore = rows.length === limit;
        return res.code(200).send({ list: rows, lastCursor, hasMore });
    }
    catch (error) {
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw new errors_1.AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
        }
        throw error;
    }
});
exports.listComplaints = listComplaints;
// ─── Detail ────────────────────────────────────────────────────────────
const complaintDetail = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const params = req.query;
    if (!params.id)
        throw new errors_1.ValidationError("INVALID REQUIRED ID");
    try {
        const row = yield prisma_1.prisma.complaint.findUnique({
            where: { id: params.id },
            include: {
                user: {
                    select: {
                        id: true,
                        firstName: true,
                        lastName: true,
                        username: true,
                        Position: { select: { name: true } },
                    },
                },
                againstUser: {
                    select: {
                        id: true,
                        firstName: true,
                        lastName: true,
                        username: true,
                        Position: { select: { name: true } },
                    },
                },
                assignedTo: {
                    select: { id: true, firstName: true, lastName: true },
                },
                replies: {
                    orderBy: { createdAt: "asc" },
                    include: {
                        user: {
                            select: {
                                id: true,
                                firstName: true,
                                lastName: true,
                                Position: { select: { name: true } },
                            },
                        },
                    },
                },
                evidence: {
                    orderBy: { createdAt: "asc" },
                    select: {
                        id: true,
                        fileName: true,
                        fileType: true,
                        fileSize: true,
                        caption: true,
                        createdAt: true,
                        uploadedById: true,
                    },
                },
            },
        });
        if (!row)
            throw new errors_1.NotFoundError("Complaint not found");
        return res.code(200).send(row);
    }
    catch (error) {
        if (error instanceof errors_1.NotFoundError)
            throw error;
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw new errors_1.AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
        }
        throw error;
    }
});
exports.complaintDetail = complaintDetail;
// ─── Reply ─────────────────────────────────────────────────────────────
const replyComplaint = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    const body = req.body;
    if (!body.complaintId || !body.userId || !((_a = body.content) === null || _a === void 0 ? void 0 : _a.trim())) {
        throw new errors_1.ValidationError("INVALID REQUIRED FIELDS");
    }
    try {
        const reply = yield prisma_1.prisma.complaintReply.create({
            data: {
                complaintId: body.complaintId,
                userId: body.userId,
                content: body.content.trim(),
                internal: !!body.internal,
            },
            include: {
                user: {
                    select: { id: true, firstName: true, lastName: true },
                },
            },
        });
        // Bump updatedAt so it surfaces in listings sorted by activity.
        yield prisma_1.prisma.complaint.update({
            where: { id: body.complaintId },
            data: { updatedAt: new Date() },
        });
        return res.code(200).send({ message: "OK", reply });
    }
    catch (error) {
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw new errors_1.AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
        }
        throw error;
    }
});
exports.replyComplaint = replyComplaint;
// ─── Status / triage ───────────────────────────────────────────────────
const updateComplaintStatus = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const body = req.body;
    if (!body.id)
        throw new errors_1.ValidationError("INVALID REQUIRED ID");
    if (body.status && !STATUSES.has(body.status)) {
        throw new errors_1.ValidationError("INVALID STATUS");
    }
    if (body.priority && !PRIORITIES.has(body.priority)) {
        throw new errors_1.ValidationError("INVALID PRIORITY");
    }
    try {
        const data = {};
        if (body.status) {
            data.status = body.status;
            data.resolvedAt =
                body.status === "resolved" || body.status === "closed"
                    ? new Date()
                    : null;
        }
        if (body.priority)
            data.priority = body.priority;
        if (body.assignedToUserId !== undefined) {
            data.assignedTo = body.assignedToUserId
                ? { connect: { id: body.assignedToUserId } }
                : { disconnect: true };
        }
        const updated = yield prisma_1.prisma.complaint.update({
            where: { id: body.id },
            data,
        });
        return res.code(200).send({ message: "OK", complaint: updated });
    }
    catch (error) {
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw new errors_1.AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
        }
        throw error;
    }
});
exports.updateComplaintStatus = updateComplaintStatus;
// ─── Remove (author can withdraw while still open) ────────────────────
const removeComplaint = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const params = req.query;
    if (!params.id || !params.userId) {
        throw new errors_1.ValidationError("INVALID REQUIRED FIELDS");
    }
    try {
        const row = yield prisma_1.prisma.complaint.findUnique({
            where: { id: params.id },
        });
        if (!row)
            throw new errors_1.NotFoundError("Complaint not found");
        if (row.userId !== params.userId) {
            throw new errors_1.ValidationError("Only the author can withdraw a complaint.");
        }
        if (row.status !== "open") {
            throw new errors_1.ValidationError("Only open complaints can be withdrawn.");
        }
        yield prisma_1.prisma.complaint.delete({ where: { id: params.id } });
        return res.code(200).send({ message: "OK" });
    }
    catch (error) {
        if (error instanceof errors_1.NotFoundError)
            throw error;
        if (error instanceof errors_1.ValidationError)
            throw error;
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw new errors_1.AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
        }
        throw error;
    }
});
exports.removeComplaint = removeComplaint;
