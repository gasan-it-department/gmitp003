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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.revokeAttendanceAccess = exports.grantAttendanceAccess = exports.listAttendanceAccess = exports.exportAttendance = exports.confirmAttendanceBulk = exports.confirmAttendance = exports.resolveAttendanceScan = exports.mobileAttendanceEvents = exports.deleteAttendanceRecord = exports.attendanceRecords = exports.deleteAttendanceEvent = exports.updateAttendanceEvent = exports.attendanceEventDetail = exports.listAttendanceEvents = exports.createAttendanceEvent = exports.attendanceFields = exports.resolveEntry = exports.sanitizeEntries = exports.SCAN_COOLDOWN_MS = exports.DEFAULT_ENTRY = exports.extractVerifyCode = void 0;
const prisma_1 = require("../barrel/prisma");
const errors_1 = require("../errors/errors");
const exceljs_1 = __importDefault(require("exceljs"));
const attendanceFields_1 = require("../service/attendanceFields");
const storageAccessController_1 = require("./storageAccessController");
const encryption_1 = require("../service/encryption");
/** Decrypts a PII column, tolerating rows written before encryption. */
const dec = (d, iv) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    if (!d)
        return "";
    if (!iv)
        return d;
    try {
        return (_a = (yield encryption_1.EncryptionService.decrypt(d, iv))) !== null && _a !== void 0 ? _a : "";
    }
    catch (_b) {
        return d;
    }
});
const callerOf = (req) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d, _e, _f;
    const accountId = (_a = req.user) === null || _a === void 0 ? void 0 : _a.id;
    if (!accountId)
        return { userId: null, lineId: null };
    const account = yield prisma_1.prisma.account.findUnique({
        where: { id: accountId },
        select: { lineId: true, User: { select: { id: true, lineId: true } } },
    });
    return {
        userId: (_c = (_b = account === null || account === void 0 ? void 0 : account.User) === null || _b === void 0 ? void 0 : _b.id) !== null && _c !== void 0 ? _c : null,
        lineId: (_f = (_d = account === null || account === void 0 ? void 0 : account.lineId) !== null && _d !== void 0 ? _d : (_e = account === null || account === void 0 ? void 0 : account.User) === null || _e === void 0 ? void 0 : _e.lineId) !== null && _f !== void 0 ? _f : null,
    };
});
/**
 * Resolves which line a request may act on.
 *
 * Every attendance endpoint used to do `body.lineId || callerLine`, which
 * trusts a value the CLIENT sends: passing another office's lineId in the
 * query string returned that office's attendance sheets, and on the write
 * paths created sheets and granted scanner access inside it. The caller's own
 * line is the only line they get, and a super-admin — who legitimately drives
 * other lines from the admin panel — is the single exception.
 */
const lineForCaller = (req, requested) => __awaiter(void 0, void 0, void 0, function* () {
    const { userId, lineId } = yield callerOf(req);
    const want = (requested || "").trim();
    if (!want || want === lineId) {
        if (!lineId)
            throw new errors_1.ValidationError("lineId is required");
        return lineId;
    }
    const sup = userId ? yield (0, storageAccessController_1.isSuperAdmin)(userId) : false;
    if (!sup)
        throw new errors_1.UnauthorizedError("Not your line");
    return want;
});
/** Resolves the event and refuses to serve it across a line boundary. */
const eventForCaller = (eventId, req) => __awaiter(void 0, void 0, void 0, function* () {
    const event = yield prisma_1.prisma.attendanceEvent.findUnique({
        where: { id: eventId },
    });
    if (!event)
        throw new errors_1.NotFoundError("Attendance sheet not found");
    const { lineId, userId } = yield callerOf(req);
    if (event.lineId !== lineId) {
        // A super-admin managing another line still gets through.
        const sup = userId ? yield (0, storageAccessController_1.isSuperAdmin)(userId) : false;
        if (!sup)
            throw new errors_1.UnauthorizedError("Not your attendance sheet");
    }
    return event;
});
/**
 * Pulls the verify code out of whatever the camera read. Accepts the full
 * ID-card URL (`https://portal.gasan.ph/verify-id?code=abc`), a bare
 * `verify-id?code=abc`, or the raw code on its own.
 */
const extractVerifyCode = (raw) => {
    const s = (raw || "").trim();
    if (!s)
        return null;
    const m = s.match(/[?&]code=([^&\s]+)/i);
    if (m)
        return decodeURIComponent(m[1]);
    // A bare code: hex uuid-without-dashes as minted by idCardController.
    if (/^[A-Za-z0-9_-]{8,64}$/.test(s))
        return s;
    return null;
};
exports.extractVerifyCode = extractVerifyCode;
// ── field catalogue ────────────────────────────────────────────────────────
/** The label a sheet falls back to when HR did not define any entries. */
exports.DEFAULT_ENTRY = "Attendance";
/**
 * How long a person must wait before the same entry accepts them again.
 *
 * A sheet used to allow exactly one row per person per entry, so a second
 * tap was silently swallowed forever. That is wrong in both directions: it
 * blocks someone who legitimately re-taps later in the shift, and it hides
 * the fact that a badge was scanned twice at all. A cool-down catches the
 * accident — a badge left in front of the lens, an operator tapping twice —
 * without pretending the person can only ever appear once.
 */
exports.SCAN_COOLDOWN_MS = 3 * 60000;
/** More than a working day's worth of segments is a data-entry mistake. */
const MAX_ENTRIES = 8;
/**
 * Cleans HR's scan-entry list: trimmed, de-duplicated case-insensitively,
 * order preserved, capped. An empty list becomes the single default entry, so
 * a sheet always has at least one thing to scan into.
 */
const sanitizeEntries = (raw) => {
    const arr = Array.isArray(raw) ? raw : [];
    const out = [];
    const seen = new Set();
    for (const v of arr) {
        const label = String(v !== null && v !== void 0 ? v : "").trim().slice(0, 40);
        if (!label)
            continue;
        const key = label.toLowerCase();
        if (seen.has(key))
            continue;
        seen.add(key);
        out.push(label);
        if (out.length >= MAX_ENTRIES)
            break;
    }
    return out.length ? out : [exports.DEFAULT_ENTRY];
};
exports.sanitizeEntries = sanitizeEntries;
/**
 * Resolves which entry a scan belongs to.
 *
 * Matching is case-insensitive so a scanner sending "am in" lands on "AM In".
 * With one entry defined the argument is optional — a single-scan sheet should
 * not force every caller to name it. With several, an unknown or missing entry
 * is an error rather than a silent write into the first one: putting someone's
 * PM Out under AM In would be worse than refusing.
 */
const resolveEntry = (entries, wanted) => {
    const list = entries.length ? entries : [exports.DEFAULT_ENTRY];
    const want = (wanted !== null && wanted !== void 0 ? wanted : "").trim();
    if (!want) {
        if (list.length === 1)
            return list[0];
        throw new errors_1.ValidationError(`This sheet records ${list.length} entries (${list.join(", ")}). Say which one this scan is for.`);
    }
    const hit = list.find((e) => e.toLowerCase() === want.toLowerCase());
    if (!hit)
        throw new errors_1.ValidationError(`"${want}" is not an entry on this sheet. Expected one of: ${list.join(", ")}.`);
    return hit;
};
exports.resolveEntry = resolveEntry;
// GET /attendance/fields — drives the web column picker.
const attendanceFields = (_req, res) => __awaiter(void 0, void 0, void 0, function* () {
    return res.code(200).send({
        fields: attendanceFields_1.ATTENDANCE_FIELDS,
        defaults: attendanceFields_1.DEFAULT_ATTENDANCE_FIELDS,
    });
});
exports.attendanceFields = attendanceFields;
// ── events (HR/web) ────────────────────────────────────────────────────────
// POST /attendance/event
const createAttendanceEvent = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    const body = req.body;
    const title = (body.title || "").trim();
    if (!title)
        throw new errors_1.ValidationError("Title is required");
    const { userId } = yield callerOf(req);
    const lineId = yield lineForCaller(req, body.lineId);
    const fields = (0, attendanceFields_1.sanitizeAttendanceFields)(body.fields);
    if (!fields.length)
        throw new errors_1.ValidationError("Pick at least one column to capture");
    // HR decides the scan entries per sheet: one for a simple headcount, or
    // AM In / AM Out / PM In / PM Out for a full day.
    const entries = (0, exports.sanitizeEntries)(body.entries);
    try {
        const event = yield prisma_1.prisma.attendanceEvent.create({
            data: {
                lineId,
                title,
                entries,
                description: ((_a = body.description) === null || _a === void 0 ? void 0 : _a.trim()) || null,
                location: ((_b = body.location) === null || _b === void 0 ? void 0 : _b.trim()) || null,
                startAt: body.startAt ? new Date(body.startAt) : new Date(),
                endAt: body.endAt ? new Date(body.endAt) : null,
                fields,
                createdById: userId,
            },
        });
        return res.code(201).send(event);
    }
    catch (error) {
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError)
            throw (0, errors_1.dbError)(error);
        throw error;
    }
});
exports.createAttendanceEvent = createAttendanceEvent;
// GET /attendance/events?lineId&page&search&status
const listAttendanceEvents = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    const q = req.query;
    const lineId = yield lineForCaller(req, q.lineId);
    const page = Math.max(0, Number((_a = q.page) !== null && _a !== void 0 ? _a : 0) || 0);
    const take = 20;
    const search = (q.search || "").trim();
    const where = Object.assign(Object.assign({ lineId }, (q.status && q.status !== "all" ? { status: q.status } : {})), (search
        ? {
            OR: [
                { title: { contains: search, mode: "insensitive" } },
                { location: { contains: search, mode: "insensitive" } },
            ],
        }
        : {}));
    try {
        const [rows, total] = yield Promise.all([
            prisma_1.prisma.attendanceEvent.findMany({
                where,
                orderBy: { startAt: "desc" },
                skip: page * take,
                take,
                include: {
                    _count: { select: { records: true } },
                    createdBy: { select: { firstName: true, lastName: true } },
                },
            }),
            prisma_1.prisma.attendanceEvent.count({ where }),
        ]);
        const people = yield peoplePerEvent(rows.map((e) => e.id));
        return res.code(200).send({
            events: rows.map((e) => {
                var _a;
                return (Object.assign(Object.assign({}, e), { attendees: (_a = people.get(e.id)) !== null && _a !== void 0 ? _a : 0 }));
            }),
            total,
            page,
            pages: Math.ceil(total / take),
        });
    }
    catch (error) {
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError)
            throw (0, errors_1.dbError)(error);
        throw error;
    }
});
exports.listAttendanceEvents = listAttendanceEvents;
// GET /attendance/event/:eventId
const attendanceEventDetail = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { eventId } = req.params;
    const event = yield eventForCaller(eventId, req);
    const attendees = yield countPeople({ eventId });
    return res.code(200).send(Object.assign(Object.assign({}, event), { attendees, columns: event.fields.map((k) => ({ key: k, label: (0, attendanceFields_1.attendanceFieldLabel)(k) })) }));
});
exports.attendanceEventDetail = attendanceEventDetail;
// PATCH /attendance/event/:eventId
const updateAttendanceEvent = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    const { eventId } = req.params;
    yield eventForCaller(eventId, req);
    const body = req.body;
    const data = {};
    if (body.title !== undefined) {
        const t = body.title.trim();
        if (!t)
            throw new errors_1.ValidationError("Title is required");
        data.title = t;
    }
    if (body.description !== undefined)
        data.description = ((_a = body.description) === null || _a === void 0 ? void 0 : _a.trim()) || null;
    if (body.location !== undefined)
        data.location = ((_b = body.location) === null || _b === void 0 ? void 0 : _b.trim()) || null;
    if (body.startAt !== undefined)
        data.startAt = new Date(body.startAt);
    if (body.endAt !== undefined)
        data.endAt = body.endAt ? new Date(body.endAt) : null;
    if (body.status !== undefined) {
        if (!["open", "closed"].includes(body.status))
            throw new errors_1.ValidationError("status must be 'open' or 'closed'");
        data.status = body.status;
    }
    if (body.fields !== undefined) {
        const f = (0, attendanceFields_1.sanitizeAttendanceFields)(body.fields);
        if (!f.length)
            throw new errors_1.ValidationError("Pick at least one column");
        data.fields = f;
    }
    try {
        const event = yield prisma_1.prisma.attendanceEvent.update({
            where: { id: eventId },
            data,
        });
        return res.code(200).send(event);
    }
    catch (error) {
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError)
            throw (0, errors_1.dbError)(error);
        throw error;
    }
});
exports.updateAttendanceEvent = updateAttendanceEvent;
// DELETE /attendance/event/:eventId
const deleteAttendanceEvent = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { eventId } = req.params;
    yield eventForCaller(eventId, req);
    try {
        yield prisma_1.prisma.attendanceEvent.delete({ where: { id: eventId } });
        return res.code(200).send({ message: "OK" });
    }
    catch (error) {
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError)
            throw (0, errors_1.dbError)(error);
        throw error;
    }
});
exports.deleteAttendanceEvent = deleteAttendanceEvent;
// ── records ────────────────────────────────────────────────────────────────
const snapshotOf = (r) => r.snapshot && typeof r.snapshot === "object" && !Array.isArray(r.snapshot)
    ? r.snapshot
    : {};
/**
 * Fills gaps for columns HR added AFTER a scan happened: the old snapshot has
 * no value for the new key, so we resolve those users live (once each) rather
 * than printing blanks. Values already frozen are never overwritten.
 */
const withBackfill = (records, fields) => __awaiter(void 0, void 0, void 0, function* () {
    const missing = new Map();
    for (const r of records) {
        const snap = snapshotOf(r);
        const gaps = fields.filter((f) => snap[f] === undefined);
        if (gaps.length)
            missing.set(r.userId, gaps);
    }
    const resolved = new Map();
    for (const [userId, gaps] of missing) {
        const u = yield (0, attendanceFields_1.resolveAttendanceUser)(userId, gaps);
        if (u)
            resolved.set(userId, u.values);
    }
    return records.map((r) => {
        var _a, _b, _c;
        const snap = snapshotOf(r);
        const extra = (_a = resolved.get(r.userId)) !== null && _a !== void 0 ? _a : {};
        const values = {};
        for (const f of fields)
            values[f] = (_c = (_b = snap[f]) !== null && _b !== void 0 ? _b : extra[f]) !== null && _c !== void 0 ? _c : "";
        return Object.assign(Object.assign({}, r), { values });
    });
});
/**
 * Turns the query string into a Prisma filter.
 *
 * Date and office are real SQL filters. Office keys off the employee's CURRENT
 * department rather than the frozen snapshot, because `office` is only in the
 * snapshot if HR happened to pick that column — filtering must work either way.
 */
const recordWhere = (eventId, f) => {
    const where = { eventId };
    if (f.dateFrom || f.dateTo) {
        const gte = f.dateFrom ? new Date(f.dateFrom) : undefined;
        // A bare YYYY-MM-DD means the WHOLE day, so push the end to 23:59:59.999.
        let lte;
        if (f.dateTo) {
            lte = new Date(f.dateTo);
            if (/^\d{4}-\d{2}-\d{2}$/.test(f.dateTo))
                lte.setHours(23, 59, 59, 999);
        }
        where.timestamp = Object.assign(Object.assign({}, (gte && !Number.isNaN(gte.getTime()) ? { gte } : {})), (lte && !Number.isNaN(lte.getTime()) ? { lte } : {}));
    }
    if (f.departmentId)
        where.user = { departmentId: f.departmentId };
    // Narrow to one scan entry, e.g. show only who has tapped "AM Out".
    if (f.entry)
        where.entry = f.entry;
    return where;
};
// GET /attendance/event/:eventId/records?page&search&dateFrom&dateTo&departmentId
const attendanceRecords = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d, _e;
    const { eventId } = req.params;
    const q = ((_a = req.query) !== null && _a !== void 0 ? _a : {});
    const event = yield eventForCaller(eventId, req);
    const page = Math.max(0, Number((_b = q.page) !== null && _b !== void 0 ? _b : 0) || 0);
    const take = 25;
    try {
        // Text search has to run AFTER the snapshot is materialised (the values
        // live in JSON, and the underlying User columns are encrypted at rest, so
        // there's nothing meaningful to LIKE against in SQL). An attendance sheet
        // is a bounded list, so we filter the sheet in memory and paginate the
        // result — that way search spans the whole sheet, not just one page.
        const rows = yield prisma_1.prisma.attendanceRecord.findMany({
            where: recordWhere(eventId, q),
            orderBy: { timestamp: "desc" },
            include: {
                user: {
                    select: {
                        id: true,
                        profilePicture: true,
                        department: { select: { id: true, name: true } },
                    },
                },
                scannedBy: {
                    select: {
                        id: true,
                        firstName: true,
                        firstNameIv: true,
                        lastName: true,
                        lastNameIv: true,
                    },
                },
            },
        });
        const filled = yield withBackfill(rows, event.fields);
        const search = (q.search || "").trim().toLowerCase();
        const visible = search
            ? filled.filter((r) => Object.values(r.values).some((v) => (v || "").toLowerCase().includes(search)))
            : filled;
        const total = visible.length;
        const pageRows = visible.slice(page * take, page * take + take);
        // Offices actually present on this sheet, so the dropdown can't offer a
        // choice that yields nothing. Built from the UNFILTERED sheet so the
        // options don't vanish as soon as you pick one.
        const allForFacet = q.departmentId
            ? yield prisma_1.prisma.attendanceRecord.findMany({
                where: recordWhere(eventId, Object.assign(Object.assign({}, q), { departmentId: undefined })),
                select: {
                    user: { select: { department: { select: { id: true, name: true } } } },
                },
            })
            : rows;
        const facet = new Map();
        for (const r of allForFacet) {
            const d = (_c = r.user) === null || _c === void 0 ? void 0 : _c.department;
            if (!(d === null || d === void 0 ? void 0 : d.id))
                continue;
            const hit = facet.get(d.id);
            if (hit)
                hit.count += 1;
            else
                facet.set(d.id, { id: d.id, name: (_d = d.name) !== null && _d !== void 0 ? _d : "Unnamed", count: 1 });
        }
        /**
         * The ATTENDEE's name, always — independent of which columns HR chose to
         * capture. A sheet that captures only, say, office and position has no
         * name anywhere on the row, which left "scanned by <operator>" as the only
         * human name in sight and made every row look like it belonged to the
         * operator. The row must state who it is FOR.
         */
        const attendeeNames = new Map();
        {
            const cache = new Map();
            for (const r of pageRows) {
                let name = cache.get(r.userId);
                if (name === undefined) {
                    const snap = snapshotOf(r);
                    // Prefer the frozen snapshot: it is what was true at scan time.
                    name =
                        (snap.fullName || "").trim() ||
                            ((_e = (yield (0, attendanceFields_1.resolveAttendanceUser)(r.userId, ["fullName"]))) === null || _e === void 0 ? void 0 : _e.fullName) ||
                            "";
                    cache.set(r.userId, name);
                }
                if (name)
                    attendeeNames.set(r.id, name);
            }
        }
        // One decrypt per distinct operator on this page, not per row.
        const scannedByNames = new Map();
        {
            const cache = new Map();
            for (const r of pageRows) {
                const sb = r.scannedBy;
                if (!sb)
                    continue;
                let name = cache.get(sb.id);
                if (name === undefined) {
                    const f = yield dec(sb.firstName, sb.firstNameIv);
                    const l = yield dec(sb.lastName, sb.lastNameIv);
                    name = `${f} ${l}`.trim();
                    cache.set(sb.id, name);
                }
                if (name)
                    scannedByNames.set(r.id, name);
            }
        }
        return res.code(200).send({
            entries: event.entries,
            columns: event.fields.map((k) => ({
                key: k,
                label: (0, attendanceFields_1.attendanceFieldLabel)(k),
            })),
            departments: [...facet.values()].sort((a, b) => a.name.localeCompare(b.name)),
            records: pageRows.map((r) => {
                var _a, _b, _c, _d, _e, _f, _g, _h, _j;
                return ({
                    id: r.id,
                    userId: r.userId,
                    /** Who this row is FOR. Always present, whatever columns HR picked. */
                    attendee: (_a = attendeeNames.get(r.id)) !== null && _a !== void 0 ? _a : "Unnamed employee",
                    entry: r.entry,
                    timestamp: r.timestamp,
                    remarks: r.remarks,
                    profilePicture: (_c = (_b = r.user) === null || _b === void 0 ? void 0 : _b.profilePicture) !== null && _c !== void 0 ? _c : null,
                    office: (_f = (_e = (_d = r.user) === null || _d === void 0 ? void 0 : _d.department) === null || _e === void 0 ? void 0 : _e.name) !== null && _f !== void 0 ? _f : null,
                    // Decrypted. Concatenating the raw columns emitted ciphertext for
                    // anyone whose name is encrypted at rest, and — worse — a readable
                    // OTHER PERSON's name for anyone whose is not, right next to the
                    // attendee's own row.
                    scannedBy: (_g = scannedByNames.get(r.id)) !== null && _g !== void 0 ? _g : null,
                    scannedById: (_j = (_h = r.scannedBy) === null || _h === void 0 ? void 0 : _h.id) !== null && _j !== void 0 ? _j : null,
                    values: r.values,
                });
            }),
            total,
            page,
            pages: Math.ceil(total / take),
        });
    }
    catch (error) {
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError)
            throw (0, errors_1.dbError)(error);
        throw error;
    }
});
exports.attendanceRecords = attendanceRecords;
// DELETE /attendance/record/:recordId — undo a mistaken scan
const deleteAttendanceRecord = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { recordId } = req.params;
    const record = yield prisma_1.prisma.attendanceRecord.findUnique({
        where: { id: recordId },
        select: { eventId: true },
    });
    if (!record)
        throw new errors_1.NotFoundError("Attendance record not found");
    yield eventForCaller(record.eventId, req);
    try {
        yield prisma_1.prisma.attendanceRecord.delete({ where: { id: recordId } });
        return res.code(200).send({ message: "OK" });
    }
    catch (error) {
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError)
            throw (0, errors_1.dbError)(error);
        throw error;
    }
});
exports.deleteAttendanceRecord = deleteAttendanceRecord;
// ── mobile: resolve → confirm ──────────────────────────────────────────────
// GET /attendance/mobile/events — open sheets the scanner may post to
const mobileAttendanceEvents = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { lineId } = yield callerOf(req);
    if (!lineId)
        throw new errors_1.UnauthorizedError("No line for this account");
    const rows = yield prisma_1.prisma.attendanceEvent.findMany({
        where: { lineId, status: "open" },
        orderBy: { startAt: "desc" },
        take: 50,
        include: { _count: { select: { records: true } } },
    });
    const people = yield peoplePerEvent(rows.map((e) => e.id));
    return res.code(200).send({
        events: rows.map((e) => {
            var _a;
            return ({
                id: e.id,
                title: e.title,
                location: e.location,
                startAt: e.startAt,
                endAt: e.endAt,
                attendees: (_a = people.get(e.id)) !== null && _a !== void 0 ? _a : 0,
                fields: e.fields,
                // The phone needs these to offer a segment picker; without them a
                // multi-entry sheet would refuse every scan it sends.
                entries: e.entries,
            });
        }),
    });
});
exports.mobileAttendanceEvents = mobileAttendanceEvents;
/**
 * POST /attendance/resolve  { eventId, code }
 * Read-only. Turns a scanned QR into the employee preview the scanner shows
 * before confirming. Writes nothing — confirming is a separate, explicit call.
 */
const resolveAttendanceScan = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    const body = req.body;
    if (!body.eventId)
        throw new errors_1.ValidationError("eventId is required");
    const code = (0, exports.extractVerifyCode)(body.code || "");
    if (!code)
        throw new errors_1.ValidationError("That QR isn't a Gasan LGU employee ID.");
    const event = yield eventForCaller(body.eventId, req);
    if (event.status !== "open")
        throw new errors_1.ValidationError("This attendance sheet is closed.");
    const target = yield prisma_1.prisma.user.findUnique({
        where: { verifyCode: code },
        select: { id: true, lineId: true, active: true, archivedAt: true },
    });
    if (!target)
        throw new errors_1.NotFoundError("No employee matches that QR code.");
    // Never let a scan cross a line boundary.
    if (target.lineId !== event.lineId)
        throw new errors_1.ValidationError("That employee belongs to a different office and can't be added to this sheet.");
    const resolved = yield (0, attendanceFields_1.resolveAttendanceUser)(target.id, event.fields);
    if (!resolved)
        throw new errors_1.NotFoundError("Employee record unavailable.");
    const entry = (0, exports.resolveEntry)(event.entries, body.entry);
    // The last time this person landed on this entry, and whether that was
    // recent enough that scanning right now would be refused. "Ever recorded"
    // would flag someone all day for a tap they made at 8am.
    const last = yield prisma_1.prisma.attendanceRecord.findFirst({
        where: { eventId: event.id, userId: target.id, entry },
        orderBy: { timestamp: "desc" },
        select: { id: true, timestamp: true },
    });
    const cooling = !!last && Date.now() - last.timestamp.getTime() < exports.SCAN_COOLDOWN_MS;
    return res.code(200).send({
        event: { id: event.id, title: event.title },
        user: {
            id: resolved.id,
            fullName: resolved.fullName,
            profilePicture: resolved.profilePicture,
            inactive: target.active === 0 || !!target.archivedAt,
        },
        columns: event.fields.map((k) => {
            var _a;
            return ({
                key: k,
                label: (0, attendanceFields_1.attendanceFieldLabel)(k),
                value: (_a = resolved.values[k]) !== null && _a !== void 0 ? _a : "",
            });
        }),
        entry,
        entries: event.entries,
        /** Within the cool-down — confirming now would be refused as a duplicate. */
        alreadyRecorded: cooling,
        recordedAt: (_a = last === null || last === void 0 ? void 0 : last.timestamp) !== null && _a !== void 0 ? _a : null,
        nextAllowedAt: last
            ? new Date(last.timestamp.getTime() + exports.SCAN_COOLDOWN_MS)
            : null,
        cooldownMs: exports.SCAN_COOLDOWN_MS,
    });
});
exports.resolveAttendanceScan = resolveAttendanceScan;
/**
 * How many DISTINCT people are on a sheet (or in one entry of it).
 *
 * Rows stopped being one-per-person when the cool-down replaced the unique
 * constraint, so a plain row count would report three scans by one person as
 * three attendees. HR reads this number to answer "has everyone tapped out",
 * which is a question about people, so it stays a question about people.
 */
const countPeople = (where) => __awaiter(void 0, void 0, void 0, function* () { return (yield prisma_1.prisma.attendanceRecord.groupBy({ by: ["userId"], where })).length; });
/** Same, for many sheets at once — one query, not one per sheet. */
const peoplePerEvent = (eventIds) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    const out = new Map();
    if (!eventIds.length)
        return out;
    const rows = yield prisma_1.prisma.attendanceRecord.groupBy({
        by: ["eventId", "userId"],
        where: { eventId: { in: eventIds } },
    });
    for (const r of rows)
        out.set(r.eventId, ((_a = out.get(r.eventId)) !== null && _a !== void 0 ? _a : 0) + 1);
    return out;
});
/**
 * The shared write path for both the online confirm and the offline upload.
 * Identifies the employee by `userId` OR by a scanned `code`, and honours a
 * client-supplied `scannedAt` so a queued scan lands on the sheet at the time
 * it happened at the door, not the time the phone got signal back.
 */
const recordAttendance = (event, opts) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    if (event.status !== "open")
        throw new errors_1.ValidationError("This attendance sheet is closed.");
    let targetId = opts.userId;
    if (!targetId) {
        const code = (0, exports.extractVerifyCode)(opts.code || "");
        if (!code)
            throw new errors_1.ValidationError("That QR isn't a Gasan LGU employee ID.");
        const byCode = yield prisma_1.prisma.user.findUnique({
            where: { verifyCode: code },
            select: { id: true },
        });
        if (!byCode)
            throw new errors_1.NotFoundError("No employee matches that QR code.");
        targetId = byCode.id;
    }
    const target = yield prisma_1.prisma.user.findUnique({
        where: { id: targetId },
        select: { id: true, lineId: true },
    });
    if (!target)
        throw new errors_1.NotFoundError("Employee not found");
    if (target.lineId !== event.lineId)
        throw new errors_1.ValidationError("That employee belongs to a different office and can't be added to this sheet.");
    const resolved = yield (0, attendanceFields_1.resolveAttendanceUser)(target.id, event.fields);
    if (!resolved)
        throw new errors_1.NotFoundError("Employee record unavailable.");
    // Trust the device clock only when it's sane: never in the future, never
    // before the sheet's own start. Otherwise fall back to server time.
    let stamp;
    if (opts.scannedAt) {
        const d = new Date(opts.scannedAt);
        if (!Number.isNaN(d.getTime()) && d.getTime() <= Date.now() + 60000)
            stamp = d;
    }
    // Which segment of the day this scan belongs to. AM Out after AM In is a
    // different entry, so it is never measured against AM In's cool-down.
    const entry = (0, exports.resolveEntry)(event.entries, opts.entry);
    /**
     * Anything already on this entry within the cool-down of THIS scan's own
     * moment. Compared against the scan timestamp rather than "now" so a batch
     * of offline scans flushed hours later is judged by when it happened at
     * the door — and checked as a window on both sides, because a queued flush
     * can arrive out of order and an earlier scan must not be waved through
     * just because a later one landed first.
     */
    const at = stamp !== null && stamp !== void 0 ? stamp : new Date();
    const near = yield prisma_1.prisma.attendanceRecord.findFirst({
        where: {
            eventId: event.id,
            userId: target.id,
            entry,
            timestamp: {
                gt: new Date(at.getTime() - exports.SCAN_COOLDOWN_MS),
                lt: new Date(at.getTime() + exports.SCAN_COOLDOWN_MS),
            },
        },
        orderBy: { timestamp: "desc" },
        select: { id: true, userId: true, timestamp: true },
    });
    if (near)
        return {
            record: near,
            fullName: resolved.fullName,
            entry,
            duplicate: true,
            /** When this person may scan into this entry again. */
            nextAllowedAt: new Date(near.timestamp.getTime() + exports.SCAN_COOLDOWN_MS),
        };
    const record = yield prisma_1.prisma.attendanceRecord.create({
        data: Object.assign({ eventId: event.id, userId: target.id, entry, scannedById: opts.scannedById, remarks: ((_a = opts.remarks) === null || _a === void 0 ? void 0 : _a.trim()) || null, snapshot: resolved.values }, (stamp ? { timestamp: stamp } : {})),
        select: { id: true, userId: true, timestamp: true },
    });
    return {
        record,
        fullName: resolved.fullName,
        entry,
        duplicate: false,
        nextAllowedAt: new Date(record.timestamp.getTime() + exports.SCAN_COOLDOWN_MS),
    };
});
/**
 * POST /attendance/confirm  { eventId, userId|code, scannedAt?, remarks? }
 * Idempotent: a second confirm for the same person returns the existing
 * record instead of erroring, so a double-tap or a retry after a flaky
 * connection can't create duplicates or scare the operator.
 */
const confirmAttendance = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const body = req.body;
    if (!body.eventId)
        throw new errors_1.ValidationError("eventId is required");
    if (!body.userId && !body.code)
        throw new errors_1.ValidationError("userId or code is required");
    const event = yield eventForCaller(body.eventId, req);
    const { userId: scannedById } = yield callerOf(req);
    try {
        const out = yield recordAttendance(event, {
            userId: body.userId,
            code: body.code,
            entry: body.entry,
            scannedById,
            scannedAt: body.scannedAt,
            remarks: body.remarks,
        });
        // Counted for the entry that was just scanned, not the whole sheet — on a
        // four-entry sheet a single total would tell HR nothing about whether
        // everyone has tapped out. People, not rows: one person tapping three
        // times is still one person present.
        const [attendees, entryCount] = yield Promise.all([
            countPeople({ eventId: event.id }),
            countPeople({ eventId: event.id, entry: out.entry }),
        ]);
        return res.code(200).send({
            record: out.record,
            fullName: out.fullName,
            entry: out.entry,
            duplicate: out.duplicate,
            attendees,
            entryCount,
            // So the scanner can hold the same badge off until it would count,
            // instead of re-warning about it every few seconds.
            nextAllowedAt: out.nextAllowedAt,
            cooldownMs: exports.SCAN_COOLDOWN_MS,
        });
    }
    catch (error) {
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError)
            throw (0, errors_1.dbError)(error);
        throw error;
    }
});
exports.confirmAttendance = confirmAttendance;
/**
 * POST /attendance/confirm/bulk  { rows: [{ clientOpId, eventId, code|userId,
 *                                           scannedAt, remarks? }] }
 * Flush path for scans taken with no signal. Each row is independent: one bad
 * row (wrong line, closed sheet, unknown QR) is reported against its own
 * clientOpId and never sinks the rest of the batch. Replays are safe — a row
 * already on the sheet comes back as `duplicate`, not an error, so the phone
 * can clear it from the queue.
 */
const confirmAttendanceBulk = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    const body = req.body;
    const rows = Array.isArray(body.rows) ? body.rows : [];
    if (!rows.length)
        throw new errors_1.ValidationError("rows is required");
    if (rows.length > 500)
        throw new errors_1.ValidationError("Too many rows in one upload (max 500)");
    const { userId: scannedById } = yield callerOf(req);
    // Resolve each distinct sheet once, not once per scan.
    const eventCache = new Map();
    const eventErr = new Map();
    const results = [];
    for (const row of rows) {
        const clientOpId = row.clientOpId || "";
        if (!clientOpId)
            continue;
        try {
            if (!row.eventId)
                throw new errors_1.ValidationError("eventId is required");
            if (!eventCache.has(row.eventId) && !eventErr.has(row.eventId)) {
                try {
                    eventCache.set(row.eventId, yield eventForCaller(row.eventId, req));
                }
                catch (e) {
                    eventErr.set(row.eventId, (_a = e === null || e === void 0 ? void 0 : e.message) !== null && _a !== void 0 ? _a : "Sheet unavailable");
                }
            }
            if (eventErr.has(row.eventId))
                throw new errors_1.ValidationError(eventErr.get(row.eventId));
            const out = yield recordAttendance(eventCache.get(row.eventId), {
                entry: row.entry,
                userId: row.userId,
                code: row.code,
                scannedById,
                scannedAt: row.scannedAt,
                remarks: row.remarks,
            });
            results.push({
                clientOpId,
                status: out.duplicate ? "duplicate" : "ok",
                fullName: out.fullName,
            });
        }
        catch (e) {
            results.push({
                clientOpId,
                status: "error",
                message: (_b = e === null || e === void 0 ? void 0 : e.message) !== null && _b !== void 0 ? _b : "Could not record this scan",
            });
        }
    }
    return res.code(200).send({ results });
});
exports.confirmAttendanceBulk = confirmAttendanceBulk;
// ── export ─────────────────────────────────────────────────────────────────
// GET /attendance/event/:eventId/export — Excel with exactly HR's columns
const exportAttendance = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c;
    const { eventId } = req.params;
    const q = ((_a = req.query) !== null && _a !== void 0 ? _a : {});
    const event = yield eventForCaller(eventId, req);
    try {
        // Same filters as the on-screen table — you export what you're looking at.
        const rows = yield prisma_1.prisma.attendanceRecord.findMany({
            where: recordWhere(eventId, q),
            orderBy: { timestamp: "asc" },
        });
        const all = yield withBackfill(rows, event.fields);
        const term = (q.search || "").trim().toLowerCase();
        const filled = term
            ? all.filter((r) => Object.values(r.values).some((v) => (v || "").toLowerCase().includes(term)))
            : all;
        const workbook = new exceljs_1.default.Workbook();
        workbook.creator = "Municipality of Gasan";
        const ws = workbook.addWorksheet("Attendance");
        // A sheet with several scan entries needs the entry named per row, or the
        // export is just an unexplained list of repeated names.
        const multiEntry = ((_c = (_b = event.entries) === null || _b === void 0 ? void 0 : _b.length) !== null && _c !== void 0 ? _c : 0) > 1;
        const columns = [
            { key: "no", label: "No." },
            ...event.fields.map((k) => ({ key: k, label: (0, attendanceFields_1.attendanceFieldLabel)(k) })),
            ...(multiEntry ? [{ key: "__entry", label: "Entry" }] : []),
            { key: "__time", label: "Time recorded" },
        ];
        const lastCol = columns.length;
        // Title band
        ws.mergeCells(1, 1, 1, lastCol);
        const t = ws.getCell(1, 1);
        t.value = event.title;
        t.font = { bold: true, size: 14 };
        t.alignment = { horizontal: "center" };
        ws.mergeCells(2, 1, 2, lastCol);
        const sub = ws.getCell(2, 1);
        const when = new Date(event.startAt).toLocaleString("en-PH");
        sub.value = [event.location, when].filter(Boolean).join(" — ");
        sub.alignment = { horizontal: "center" };
        sub.font = { size: 10, color: { argb: "FF666666" } };
        ws.addRow([]);
        const header = ws.addRow(columns.map((c) => c.label));
        header.font = { bold: true };
        header.alignment = { vertical: "middle", horizontal: "center" };
        header.eachCell((cell) => {
            cell.fill = {
                type: "pattern",
                pattern: "solid",
                fgColor: { argb: "FFEEF3F7" },
            };
            cell.border = {
                top: { style: "thin" },
                left: { style: "thin" },
                bottom: { style: "thin" },
                right: { style: "thin" },
            };
        });
        filled.forEach((r, i) => {
            const row = ws.addRow([
                i + 1,
                ...event.fields.map((f) => r.values[f] || ""),
                ...(multiEntry ? [r.entry] : []),
                new Date(r.timestamp).toLocaleString("en-PH"),
            ]);
            row.getCell(1).alignment = { horizontal: "center" };
            row.eachCell((cell) => {
                cell.border = {
                    top: { style: "thin" },
                    left: { style: "thin" },
                    bottom: { style: "thin" },
                    right: { style: "thin" },
                };
            });
        });
        const totalRow = ws.addRow([
            "",
            `TOTAL ATTENDEES: ${filled.length}`,
            ...Array(Math.max(0, lastCol - 2)).fill(""),
        ]);
        totalRow.font = { bold: true };
        // Width from the widest cell in each column, clamped to something sane.
        columns.forEach((c, idx) => {
            var _a;
            const col = ws.getColumn(idx + 1);
            let max = c.label.length;
            (_a = col.eachCell) === null || _a === void 0 ? void 0 : _a.call(col, { includeEmpty: false }, (cell) => {
                var _a;
                const len = String((_a = cell.value) !== null && _a !== void 0 ? _a : "").length;
                if (len > max)
                    max = len;
            });
            col.width = Math.min(42, Math.max(8, max + 2));
        });
        const safe = event.title.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, "") ||
            "Attendance";
        res.header("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
        res.header("Content-Disposition", `attachment; filename="Attendance_${safe}.xlsx"`);
        res.header("Access-Control-Expose-Headers", "Content-Disposition");
        const buffer = yield workbook.xlsx.writeBuffer();
        return res.send(buffer);
    }
    catch (error) {
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError)
            throw (0, errors_1.dbError)(error);
        throw error;
    }
});
exports.exportAttendance = exportAttendance;
// ── mobile access grants (mirrors Pharmacy/Document mobile access) ─────────
const grantName = (u) => `${u.lastName}, ${u.firstName}${u.middleName ? " " + u.middleName : ""}`;
// GET /attendance/mobile-access?lineId
const listAttendanceAccess = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const q = req.query;
    const lineId = yield lineForCaller(req, q.lineId);
    const rows = yield prisma_1.prisma.attendanceMobileAccess.findMany({
        where: { lineId },
        orderBy: { timestamp: "desc" },
        include: {
            user: {
                select: {
                    id: true,
                    firstName: true,
                    lastName: true,
                    middleName: true,
                    username: true,
                    department: { select: { name: true } },
                },
            },
            grantedBy: { select: { firstName: true, lastName: true } },
        },
    });
    return res.code(200).send({
        users: rows.map((r) => {
            var _a, _b;
            return ({
                id: r.id,
                userId: r.userId,
                name: grantName(r.user),
                office: (_b = (_a = r.user.department) === null || _a === void 0 ? void 0 : _a.name) !== null && _b !== void 0 ? _b : null,
                grantedBy: r.grantedBy
                    ? `${r.grantedBy.firstName} ${r.grantedBy.lastName}`.trim()
                    : null,
                timestamp: r.timestamp,
            });
        }),
    });
});
exports.listAttendanceAccess = listAttendanceAccess;
// POST /attendance/mobile-access  { lineId, userId }
const grantAttendanceAccess = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const body = req.body;
    const { userId: actorId } = yield callerOf(req);
    const lineId = yield lineForCaller(req, body.lineId);
    if (!body.userId)
        throw new errors_1.ValidationError("userId is required");
    const target = yield prisma_1.prisma.user.findUnique({
        where: { id: body.userId },
        select: { id: true, lineId: true },
    });
    if (!target)
        throw new errors_1.NotFoundError("User not found");
    if (target.lineId !== lineId)
        throw new errors_1.ValidationError("That user belongs to a different office.");
    try {
        const row = yield prisma_1.prisma.attendanceMobileAccess.upsert({
            where: { lineId_userId: { lineId, userId: body.userId } },
            update: { grantedById: actorId },
            create: { lineId, userId: body.userId, grantedById: actorId },
        });
        return res.code(201).send(row);
    }
    catch (error) {
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError)
            throw (0, errors_1.dbError)(error);
        throw error;
    }
});
exports.grantAttendanceAccess = grantAttendanceAccess;
// DELETE /attendance/mobile-access/:accessId
const revokeAttendanceAccess = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { accessId } = req.params;
    const row = yield prisma_1.prisma.attendanceMobileAccess.findUnique({
        where: { id: accessId },
        select: { lineId: true },
    });
    if (!row)
        throw new errors_1.NotFoundError("Grant not found");
    const { lineId, userId } = yield callerOf(req);
    if (row.lineId !== lineId) {
        const sup = userId ? yield (0, storageAccessController_1.isSuperAdmin)(userId) : false;
        if (!sup)
            throw new errors_1.UnauthorizedError("Not your office");
    }
    try {
        yield prisma_1.prisma.attendanceMobileAccess.delete({ where: { id: accessId } });
        return res.code(200).send({ message: "OK" });
    }
    catch (error) {
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError)
            throw (0, errors_1.dbError)(error);
        throw error;
    }
});
exports.revokeAttendanceAccess = revokeAttendanceAccess;
