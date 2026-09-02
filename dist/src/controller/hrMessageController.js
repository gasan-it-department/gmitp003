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
exports.retryBatch = exports.sendBatch = exports.removeRecipient = exports.addRecipients = exports.batchDetail = exports.deleteBatch = exports.updateBatch = exports.createBatch = exports.listBatches = exports.searchEmployees = exports.deleteTemplate = exports.saveTemplate = exports.listTemplates = exports.previewMessage = exports.renderFor = exports.extractTokens = exports.placeholderCatalogue = exports.MAX_BATCH_RECIPIENTS = exports.MAX_PER_SEND = void 0;
const prisma_1 = require("../barrel/prisma");
const errors_1 = require("../errors/errors");
const handler_1 = require("../middleware/handler");
const Semaphore_1 = require("../class/Semaphore");
const encryption_1 = require("../service/encryption");
const provisionalController_1 = require("./provisionalController");
const attendanceFields_1 = require("../service/attendanceFields");
/**
 * HR Message Queue.
 *
 * A BATCH is the unit of work. HR creates one, writes the message on it, and
 * adds recipients (each becomes a row at status "pending"). Sending goes out
 * in waves of at most 20: each dispatched row flips to "sent" or "failed", so
 * the same list that was the recipient picker becomes the delivery report and
 * HR can see exactly who is still waiting.
 *
 * Lifecycle:
 *   draft    nothing dispatched yet - message and recipients fully editable
 *   sending  at least one wave out, some still pending
 *   sent     nobody is waiting right now
 *
 * "sent" is a resting state, NOT a closed one. More people can be added at
 * any time, and anyone already contacted can be deliberately messaged again
 * (a reminder, a correction to a bad number). What stays frozen for good is
 * the message TEXT once the first wave leaves: two people under one batch
 * must never receive different wording, or the record of what went out stops
 * being true. A different message means a new batch.
 */
/**
 * 20 is how many go out in ONE send, not how many a batch may hold. A batch
 * can carry the whole office; HR dispatches it in waves of 20 and watches the
 * indicator fill in. Both ceilings are enforced HERE, not only in the UI.
 */
exports.MAX_PER_SEND = 20;
/** Sanity bound on one batch, so a mis-click cannot queue the entire database. */
exports.MAX_BATCH_RECIPIENTS = 1000;
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
const callerLine = (req) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d;
    const accountId = (_a = req.user) === null || _a === void 0 ? void 0 : _a.id;
    if (!accountId)
        return null;
    const a = yield prisma_1.prisma.account.findUnique({
        where: { id: accountId },
        select: { lineId: true, User: { select: { lineId: true } } },
    });
    return (_d = (_b = a === null || a === void 0 ? void 0 : a.lineId) !== null && _b !== void 0 ? _b : (_c = a === null || a === void 0 ? void 0 : a.User) === null || _c === void 0 ? void 0 : _c.lineId) !== null && _d !== void 0 ? _d : null;
});
const isNonPlantilla = (status) => provisionalController_1.PROVISIONAL_STATUSES.some((s) => s.toLowerCase() === (status || "").trim().toLowerCase());
/** Gmail-only, as specified. */
const isGmail = (e) => /^[^@\s]+@gmail\.com$/i.test((e || "").trim());
/** Resolves a batch the caller is actually allowed to touch. */
const ownedBatch = (req, id) => __awaiter(void 0, void 0, void 0, function* () {
    const lineId = yield callerLine(req);
    if (!lineId)
        throw new errors_1.UnauthorizedError("No line for this account");
    const batch = yield prisma_1.prisma.hrMessageBatch.findFirst({
        where: { id, lineId },
    });
    if (!batch)
        throw new errors_1.NotFoundError("Batch not found");
    return { batch, lineId };
});
// -- Placeholders ----------------------------------------------------------
// Reuses the attendance field catalogue so there is ONE definition of what a
// user property is called and where its value comes from.
const placeholderCatalogue = (_req, res) => __awaiter(void 0, void 0, void 0, function* () {
    return res.code(200).send({
        placeholders: attendanceFields_1.ATTENDANCE_FIELDS.map((f) => ({
            key: f.key,
            label: f.label,
            group: f.group,
            token: "{{" + f.key + "}}",
        })),
    });
});
exports.placeholderCatalogue = placeholderCatalogue;
const TOKEN = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;
const extractTokens = (body) => [
    ...new Set([...(body || "").matchAll(TOKEN)].map((m) => m[1])),
];
exports.extractTokens = extractTokens;
/**
 * Substitutes {{tokens}} for one user.
 *
 * An unknown or empty token is left VISIBLE as {{token}} rather than blanked —
 * a silent gap in an official message is worse than an obvious one, and the
 * compose screen warns about it before sending.
 */
const renderFor = (body, userId) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    const keys = (0, exports.extractTokens)(body);
    if (!keys.length)
        return body;
    const resolved = yield (0, attendanceFields_1.resolveAttendanceUser)(userId, keys);
    const vals = (_a = resolved === null || resolved === void 0 ? void 0 : resolved.values) !== null && _a !== void 0 ? _a : {};
    return (body || "").replace(TOKEN, (whole, k) => vals[k] !== undefined && vals[k] !== "" ? vals[k] : whole);
});
exports.renderFor = renderFor;
/**
 * POST /hr/message/preview  { body, userId }
 *
 * Renders the message for ONE real employee so the compose screen shows the
 * exact text that will be sent, not an approximation built in the browser.
 */
const previewMessage = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const b = req.body;
    const lineId = yield callerLine(req);
    if (!lineId)
        throw new errors_1.UnauthorizedError("No line for this account");
    if (!b.userId)
        throw new errors_1.ValidationError("Pick someone to preview against");
    const u = yield prisma_1.prisma.user.findFirst({
        where: { id: b.userId, lineId },
        select: { id: true },
    });
    if (!u)
        throw new errors_1.NotFoundError("Employee not found");
    const rendered = yield (0, exports.renderFor)(b.body || "", b.userId);
    const unresolved = [
        ...new Set([...rendered.matchAll(TOKEN)].map((m) => m[1])),
    ];
    return res.code(200).send({ rendered, unresolved });
});
exports.previewMessage = previewMessage;
// -- Templates -------------------------------------------------------------
const listTemplates = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const lineId = yield callerLine(req);
    if (!lineId)
        throw new errors_1.UnauthorizedError("No line for this account");
    const rows = yield prisma_1.prisma.hrMessageTemplate.findMany({
        where: { lineId },
        orderBy: { updatedAt: "desc" },
        take: 100,
    });
    return res.code(200).send({ templates: rows });
});
exports.listTemplates = listTemplates;
const saveTemplate = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const b = req.body;
    const lineId = yield callerLine(req);
    const userId = yield (0, handler_1.callerUserId)(req);
    if (!lineId)
        throw new errors_1.UnauthorizedError("No line for this account");
    const name = (b.name || "").trim();
    const body = (b.body || "").trim();
    if (!name)
        throw new errors_1.ValidationError("Give the template a name");
    if (!body)
        throw new errors_1.ValidationError("The message body is empty");
    const channel = b.channel === "email" ? "email" : "sms";
    if (channel === "email" && !(b.subject || "").trim())
        throw new errors_1.ValidationError("Email templates need a subject");
    const data = {
        lineId,
        name,
        channel,
        subject: channel === "email" ? (b.subject || "").trim() : null,
        body,
        placeholders: (0, exports.extractTokens)(body),
    };
    try {
        if (b.id) {
            const owned = yield prisma_1.prisma.hrMessageTemplate.findFirst({
                where: { id: b.id, lineId },
                select: { id: true },
            });
            if (!owned)
                throw new errors_1.NotFoundError("Template not found");
            return res
                .code(200)
                .send(yield prisma_1.prisma.hrMessageTemplate.update({ where: { id: b.id }, data }));
        }
        return res.code(201).send(yield prisma_1.prisma.hrMessageTemplate.create({
            data: Object.assign(Object.assign({}, data), { createdById: userId }),
        }));
    }
    catch (e) {
        if (e instanceof prisma_1.Prisma.PrismaClientKnownRequestError)
            throw (0, errors_1.dbError)(e);
        throw e;
    }
});
exports.saveTemplate = saveTemplate;
const deleteTemplate = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { id } = req.params;
    const lineId = yield callerLine(req);
    const owned = yield prisma_1.prisma.hrMessageTemplate.findFirst({
        where: { id, lineId: lineId !== null && lineId !== void 0 ? lineId : "" },
        select: { id: true },
    });
    if (!owned)
        throw new errors_1.NotFoundError("Template not found");
    yield prisma_1.prisma.hrMessageTemplate.delete({ where: { id } });
    return res.code(200).send({ message: "OK" });
});
exports.deleteTemplate = deleteTemplate;
// -- Employee search (for adding recipients) -------------------------------
/**
 * GET /hr/message/employees?audience=&query=&channel=&batchId=
 *
 * `status` is encrypted at rest, so Plantilla / Non-Plantilla CANNOT be a SQL
 * filter — rows are decrypted and partitioned in memory.
 */
const searchEmployees = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d, _e, _f, _g, _h;
    const q = req.query;
    const lineId = yield callerLine(req);
    if (!lineId)
        throw new errors_1.UnauthorizedError("No line for this account");
    const channel = q.channel === "email" ? "email" : "sms";
    const term = (q.query || "").trim().toLowerCase();
    // Anyone already on the batch is marked so the picker shows them as added
    // rather than offering them a second time.
    const already = q.batchId
        ? new Set((yield prisma_1.prisma.hrMessageRecipient.findMany({
            where: { batchId: q.batchId },
            select: { userId: true },
        })).map((r) => r.userId))
        : new Set();
    const users = yield prisma_1.prisma.user.findMany({
        where: { lineId, active: 1, archivedAt: null },
        select: {
            id: true,
            firstName: true,
            firstNameIv: true,
            lastName: true,
            lastNameIv: true,
            status: true,
            statusIV: true,
            email: true,
            emailIv: true,
            phoneNumber: true,
            phoneNumberIv: true,
            Position: { select: { name: true } },
            department: { select: { name: true } },
        },
        take: 800,
    });
    const out = [];
    for (const u of users) {
        const status = yield dec(u.status, u.statusIV);
        const nonPlantilla = isNonPlantilla(status);
        if (q.audience === "plantilla" && nonPlantilla)
            continue;
        if (q.audience === "non-plantilla" && !nonPlantilla)
            continue;
        const first = yield dec(u.firstName, u.firstNameIv);
        const last = yield dec(u.lastName, u.lastNameIv);
        const name = `${last}, ${first}`.replace(/^,\s*|,\s*$/g, "").trim() || "Unnamed";
        if (term &&
            !`${name} ${(_b = (_a = u.Position) === null || _a === void 0 ? void 0 : _a.name) !== null && _b !== void 0 ? _b : ""} ${(_d = (_c = u.department) === null || _c === void 0 ? void 0 : _c.name) !== null && _d !== void 0 ? _d : ""}`
                .toLowerCase()
                .includes(term))
            continue;
        const to = channel === "email"
            ? yield dec(u.email, u.emailIv)
            : (0, handler_1.phNumberFormat)(yield dec(u.phoneNumber, u.phoneNumberIv));
        // Surface WHY someone cannot be messaged instead of hiding them — HR needs
        // to know a contact detail is missing so they can go and fix it.
        const reason = !to
            ? channel === "email"
                ? "No email on file"
                : "No mobile number on file"
            : channel === "email" && !isGmail(to)
                ? "Not a Gmail address"
                : null;
        out.push({
            id: u.id,
            name,
            status: status || "-",
            plantilla: !nonPlantilla,
            position: (_f = (_e = u.Position) === null || _e === void 0 ? void 0 : _e.name) !== null && _f !== void 0 ? _f : null,
            office: (_h = (_g = u.department) === null || _g === void 0 ? void 0 : _g.name) !== null && _h !== void 0 ? _h : null,
            to,
            sendable: !reason,
            reason,
            added: already.has(u.id),
        });
        if (out.length >= 300)
            break;
    }
    out.sort((a, b) => String(a.name).localeCompare(String(b.name)));
    return res.code(200).send({
        employees: out,
        maxPerSend: exports.MAX_PER_SEND,
        maxPerBatch: exports.MAX_BATCH_RECIPIENTS,
    });
});
exports.searchEmployees = searchEmployees;
// -- Batches ---------------------------------------------------------------
const listBatches = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    const q = req.query;
    const lineId = yield callerLine(req);
    if (!lineId)
        throw new errors_1.UnauthorizedError("No line for this account");
    const page = Math.max(0, Number((_a = q.page) !== null && _a !== void 0 ? _a : 0) || 0);
    const take = 20;
    const search = (q.search || "").trim();
    const where = Object.assign(Object.assign({ lineId }, (q.status === "draft" || q.status === "sent" ? { status: q.status } : {})), (search
        ? {
            OR: [
                { name: { contains: search, mode: "insensitive" } },
                { subject: { contains: search, mode: "insensitive" } },
                { body: { contains: search, mode: "insensitive" } },
            ],
        }
        : {}));
    const [rows, total] = yield Promise.all([
        prisma_1.prisma.hrMessageBatch.findMany({
            where,
            orderBy: { createdAt: "desc" },
            skip: page * take,
            take,
            include: { createdBy: { select: { firstName: true, lastName: true } } },
        }),
        prisma_1.prisma.hrMessageBatch.count({ where }),
    ]);
    return res.code(200).send({
        batches: rows.map((r) => (Object.assign(Object.assign({}, r), { createdByName: r.createdBy
                ? `${r.createdBy.firstName} ${r.createdBy.lastName}`.trim()
                : null }))),
        total,
        page,
        pages: Math.ceil(total / take),
    });
});
exports.listBatches = listBatches;
const createBatch = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const b = req.body;
    const lineId = yield callerLine(req);
    const actorId = yield (0, handler_1.callerUserId)(req);
    if (!lineId)
        throw new errors_1.UnauthorizedError("No line for this account");
    const channel = b.channel === "email" ? "email" : "sms";
    let subject = null;
    let body = "";
    // Starting from a template pre-fills the draft — the whole point of having
    // templates in the first place.
    if (b.templateId) {
        const t = yield prisma_1.prisma.hrMessageTemplate.findFirst({
            where: { id: b.templateId, lineId },
        });
        if (t) {
            subject = t.subject;
            body = t.body;
        }
    }
    try {
        const batch = yield prisma_1.prisma.hrMessageBatch.create({
            data: {
                lineId,
                name: (b.name || "").trim() || null,
                templateId: b.templateId || null,
                channel,
                subject,
                body,
                status: "draft",
                createdById: actorId,
            },
        });
        return res.code(201).send(batch);
    }
    catch (e) {
        if (e instanceof prisma_1.Prisma.PrismaClientKnownRequestError)
            throw (0, errors_1.dbError)(e);
        throw e;
    }
});
exports.createBatch = createBatch;
const updateBatch = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { id } = req.params;
    const b = req.body;
    const { batch } = yield ownedBatch(req, id);
    // Once one wave is out the text is frozen: two people under the same batch
    // must never receive different messages.
    if (batch.status !== "draft")
        throw new errors_1.ValidationError("This message has already gone out, so the wording can no longer be changed. Create a new batch to send something different.");
    const channel = b.channel === undefined
        ? batch.channel
        : b.channel === "email"
            ? "email"
            : "sms";
    const data = {};
    if (b.name !== undefined)
        data.name = b.name.trim() || null;
    if (b.channel !== undefined)
        data.channel = channel;
    if (b.body !== undefined)
        data.body = b.body;
    if (b.subject !== undefined)
        data.subject = channel === "email" ? b.subject : null;
    if (b.audience !== undefined)
        data.audience =
            b.audience === "plantilla" || b.audience === "non-plantilla"
                ? b.audience
                : "custom";
    // Switching to SMS drops a subject that no longer applies.
    if (b.channel === "sms")
        data.subject = null;
    const updated = yield prisma_1.prisma.hrMessageBatch.update({ where: { id }, data });
    // Changing channel changes which contact detail is used, so every pending
    // recipient's address is re-resolved. Rows already sent keep their frozen
    // address — that is the record of where the message actually went.
    if (b.channel !== undefined && b.channel !== batch.channel) {
        const pending = yield prisma_1.prisma.hrMessageRecipient.findMany({
            where: { batchId: id, status: "pending" },
            select: { id: true, userId: true },
        });
        for (const r of pending) {
            const u = yield prisma_1.prisma.user.findUnique({
                where: { id: r.userId },
                select: {
                    email: true,
                    emailIv: true,
                    phoneNumber: true,
                    phoneNumberIv: true,
                },
            });
            const to = channel === "email"
                ? yield dec(u === null || u === void 0 ? void 0 : u.email, u === null || u === void 0 ? void 0 : u.emailIv)
                : (0, handler_1.phNumberFormat)(yield dec(u === null || u === void 0 ? void 0 : u.phoneNumber, u === null || u === void 0 ? void 0 : u.phoneNumberIv));
            yield prisma_1.prisma.hrMessageRecipient.update({
                where: { id: r.id },
                data: { toAddress: to || "" },
            });
        }
    }
    return res.code(200).send(updated);
});
exports.updateBatch = updateBatch;
const deleteBatch = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { id } = req.params;
    const { batch } = yield ownedBatch(req, id);
    // A sent batch is the only proof of who was contacted; deleting it would
    // erase that record.
    if (batch.status !== "draft")
        throw new errors_1.ValidationError("A sent batch cannot be deleted.");
    yield prisma_1.prisma.hrMessageRecipient.deleteMany({ where: { batchId: id } });
    yield prisma_1.prisma.hrMessageBatch.delete({ where: { id } });
    return res.code(200).send({ message: "OK" });
});
exports.deleteBatch = deleteBatch;
const batchDetail = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    const { id } = req.params;
    const q = req.query;
    const { batch } = yield ownedBatch(req, id);
    const term = (q.search || "").trim();
    const page = Math.max(0, Number((_a = q.page) !== null && _a !== void 0 ? _a : 0) || 0);
    const take = 50;
    const where = Object.assign(Object.assign({ batchId: id }, (q.status === "sent" || q.status === "failed" || q.status === "pending"
        ? { status: q.status }
        : {})), (term ? { name: { contains: term, mode: "insensitive" } } : {}));
    const [recipients, matching] = yield Promise.all([
        prisma_1.prisma.hrMessageRecipient.findMany({
            where,
            orderBy: [{ status: "asc" }, { name: "asc" }],
            skip: page * take,
            take,
        }),
        prisma_1.prisma.hrMessageRecipient.count({ where }),
    ]);
    // Counts describe the WHOLE batch, not the filtered view, so searching
    // never makes it look like recipients disappeared.
    const [pending, sent, failed] = yield Promise.all([
        prisma_1.prisma.hrMessageRecipient.count({
            where: { batchId: id, status: "pending" },
        }),
        prisma_1.prisma.hrMessageRecipient.count({ where: { batchId: id, status: "sent" } }),
        prisma_1.prisma.hrMessageRecipient.count({
            where: { batchId: id, status: "failed" },
        }),
    ]);
    return res.code(200).send({
        batch,
        recipients,
        counts: { pending, sent, failed, total: pending + sent + failed },
        matching,
        page,
        pages: Math.ceil(matching / take),
        maxPerSend: exports.MAX_PER_SEND,
        maxPerBatch: exports.MAX_BATCH_RECIPIENTS,
    });
});
exports.batchDetail = batchDetail;
// -- Recipients on a draft -------------------------------------------------
const addRecipients = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { id } = req.params;
    const b = req.body;
    const { batch, lineId } = yield ownedBatch(req, id);
    // People can be added at any point in a batch's life, including after
    // everyone currently on it has been contacted.
    const ids = [...new Set(Array.isArray(b.userIds) ? b.userIds : [])];
    if (!ids.length)
        throw new errors_1.ValidationError("Pick at least one employee");
    const existing = yield prisma_1.prisma.hrMessageRecipient.count({
        where: { batchId: id },
    });
    if (existing + ids.length > exports.MAX_BATCH_RECIPIENTS)
        throw new errors_1.ValidationError(`A batch can hold at most ${exports.MAX_BATCH_RECIPIENTS} recipients. This one already has ${existing}.`);
    let added = 0;
    for (const uid of ids) {
        // Scoped to the caller's line — a batch can never cross a line boundary.
        const u = yield prisma_1.prisma.user.findFirst({
            where: { id: uid, lineId },
            select: {
                id: true,
                firstName: true,
                firstNameIv: true,
                lastName: true,
                lastNameIv: true,
                email: true,
                emailIv: true,
                phoneNumber: true,
                phoneNumberIv: true,
            },
        });
        if (!u)
            continue;
        const name = `${yield dec(u.lastName, u.lastNameIv)}, ${yield dec(u.firstName, u.firstNameIv)}`
            .replace(/^,\s*|,\s*$/g, "")
            .trim() || "Unnamed";
        const to = batch.channel === "email"
            ? yield dec(u.email, u.emailIv)
            : (0, handler_1.phNumberFormat)(yield dec(u.phoneNumber, u.phoneNumberIv));
        yield prisma_1.prisma.hrMessageRecipient.upsert({
            where: { batchId_userId: { batchId: id, userId: uid } },
            update: { toAddress: to || "" },
            create: {
                batchId: id,
                userId: uid,
                name,
                toAddress: to || "",
                renderedBody: "",
                status: "pending",
            },
        });
        added++;
    }
    const total = yield prisma_1.prisma.hrMessageRecipient.count({
        where: { batchId: id },
    });
    yield prisma_1.prisma.hrMessageBatch.update({ where: { id }, data: { total } });
    return res.code(200).send({ added, total });
});
exports.addRecipients = addRecipients;
const removeRecipient = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { id, recipientId } = req.params;
    const { batch } = yield ownedBatch(req, id);
    const row = yield prisma_1.prisma.hrMessageRecipient.findFirst({
        where: { id: recipientId, batchId: id },
    });
    if (!row)
        throw new errors_1.NotFoundError("Recipient not found");
    // A sent or failed row is evidence; only a not-yet-contacted one can be
    // dropped, and that stays true while later waves are still going out.
    if (row.status !== "pending")
        throw new errors_1.ValidationError("This recipient has already been contacted.");
    yield prisma_1.prisma.hrMessageRecipient.delete({ where: { id: recipientId } });
    const total = yield prisma_1.prisma.hrMessageRecipient.count({
        where: { batchId: id },
    });
    yield prisma_1.prisma.hrMessageBatch.update({ where: { id }, data: { total } });
    return res.code(200).send({ message: "OK", total });
});
exports.removeRecipient = removeRecipient;
// -- Sending ---------------------------------------------------------------
/** Delivers one already-rendered message. Never throws — returns the outcome. */
const deliver = (channel, to, subject, text) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        if (channel === "email") {
            if (!isGmail(to))
                return { ok: false, error: "Not a Gmail address" };
            yield (0, handler_1.sendEmail)(subject || "Message from HR", to, text, "HR Team");
            return { ok: true };
        }
        const num = (0, handler_1.phNumberFormat)(to);
        if (!num)
            return { ok: false, error: "Invalid mobile number" };
        const r = (yield Semaphore_1.semaphoreService.sendSingleSMS(num, text));
        return (r === null || r === void 0 ? void 0 : r.success) === false
            ? { ok: false, error: (_a = r === null || r === void 0 ? void 0 : r.message) !== null && _a !== void 0 ? _a : "SMS gateway rejected the message" }
            : { ok: true };
    }
    catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : "Send failed" };
    }
});
/** Recomputes the batch counters from the rows themselves. */
const syncCounts = (batchId) => __awaiter(void 0, void 0, void 0, function* () {
    const [pending, sent, failed] = yield Promise.all([
        prisma_1.prisma.hrMessageRecipient.count({ where: { batchId, status: "pending" } }),
        prisma_1.prisma.hrMessageRecipient.count({ where: { batchId, status: "sent" } }),
        prisma_1.prisma.hrMessageRecipient.count({ where: { batchId, status: "failed" } }),
    ]);
    yield prisma_1.prisma.hrMessageBatch.update({
        where: { id: batchId },
        data: {
            sentCount: sent,
            failedCount: failed,
            total: pending + sent + failed,
        },
    });
    return { pending, sent, failed };
});
/**
 * POST /hr/message/batch/:id/send   { recipientIds?: string[] }
 *
 * Dispatches ONE WAVE of at most MAX_PER_SEND. Pass recipientIds to send to a
 * specific selection, or omit it to take the next pending people in list
 * order. Call it again for the next wave; the batch closes itself once
 * nothing is left pending.
 */
const sendBatch = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    const { id } = req.params;
    const b = ((_a = req.body) !== null && _a !== void 0 ? _a : {});
    const { batch } = yield ownedBatch(req, id);
    if (!batch.body.trim())
        throw new errors_1.ValidationError("The message is empty");
    if (batch.channel === "email" && !(batch.subject || "").trim())
        throw new errors_1.ValidationError("Email needs a subject");
    const picked = Array.isArray(b.recipientIds) ? [...new Set(b.recipientIds)] : null;
    if (picked && picked.length > exports.MAX_PER_SEND)
        throw new errors_1.ValidationError(`You can send to at most ${exports.MAX_PER_SEND} people at a time. Send this wave, then select the next ${exports.MAX_PER_SEND}.`);
    /**
     * Without a selection this takes ONLY people still waiting, so the plain
     * "send next" button can never re-message someone by accident. With an
     * explicit selection any row is fair game: ticking a name that already
     * received this is how HR sends a reminder or retries a corrected number.
     */
    const wave = yield prisma_1.prisma.hrMessageRecipient.findMany({
        where: Object.assign({ batchId: id }, (picked ? { id: { in: picked } } : { status: "pending" })),
        orderBy: [{ name: "asc" }],
        take: exports.MAX_PER_SEND,
    });
    if (!wave.length)
        throw new errors_1.ValidationError(picked
            ? "Those recipients are no longer on this batch."
            : "Everyone here has been contacted. Tick the people you want to message again, or add more recipients.");
    const resent = wave.filter((r) => r.status !== "pending").length;
    for (const r of wave) {
        const rendered = yield (0, exports.renderFor)(batch.body, r.userId);
        const out = r.toAddress
            ? yield deliver(batch.channel, r.toAddress, batch.subject, rendered)
            : {
                ok: false,
                error: batch.channel === "email"
                    ? "No email on file"
                    : "No mobile number on file",
            };
        // renderedBody is frozen here: a later profile edit cannot rewrite what
        // was sent, and a retry reuses the exact same words and address.
        yield prisma_1.prisma.hrMessageRecipient.update({
            where: { id: r.id },
            data: {
                renderedBody: rendered,
                status: out.ok ? "sent" : "failed",
                error: out.ok ? null : ((_b = out.error) !== null && _b !== void 0 ? _b : "Send failed"),
                attempts: { increment: 1 },
                sentAt: out.ok ? new Date() : null,
            },
        });
    }
    const counts = yield syncCounts(id);
    // "sent" just means nobody is waiting right now — the batch stays open to
    // more recipients and to a deliberate re-send.
    yield prisma_1.prisma.hrMessageBatch.update({
        where: { id },
        data: {
            status: counts.pending === 0 ? "sent" : "sending",
            sentAt: new Date(),
        },
    });
    return res.code(200).send(Object.assign(Object.assign({ batchId: id, dispatched: wave.length, resent }, counts), { done: counts.pending === 0 }));
});
exports.sendBatch = sendBatch;
/** Retries ONLY the failed rows of a batch, reusing the frozen address/body. */
const retryBatch = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    const { id } = req.params;
    const b = ((_a = req.body) !== null && _a !== void 0 ? _a : {});
    const { batch } = yield ownedBatch(req, id);
    const rows = yield prisma_1.prisma.hrMessageRecipient.findMany({
        where: Object.assign({ batchId: id, 
            // Never re-send to someone who already received it.
            status: "failed" }, (Array.isArray(b.recipientIds) && b.recipientIds.length
            ? { id: { in: b.recipientIds } }
            : {})),
    });
    if (!rows.length)
        throw new errors_1.ValidationError("Nothing to retry");
    let fixed = 0;
    for (const r of rows) {
        const rendered = r.renderedBody || (yield (0, exports.renderFor)(batch.body, r.userId));
        const out = r.toAddress
            ? yield deliver(batch.channel, r.toAddress, batch.subject, rendered)
            : { ok: false, error: "No contact detail on file" };
        yield prisma_1.prisma.hrMessageRecipient.update({
            where: { id: r.id },
            data: {
                renderedBody: rendered,
                status: out.ok ? "sent" : "failed",
                error: out.ok ? null : ((_b = out.error) !== null && _b !== void 0 ? _b : "Send failed"),
                attempts: { increment: 1 },
                sentAt: out.ok ? new Date() : null,
            },
        });
        if (out.ok)
            fixed++;
    }
    const counts = yield syncCounts(id);
    return res.code(200).send(Object.assign({ retried: rows.length, nowSent: fixed }, counts));
});
exports.retryBatch = retryBatch;
