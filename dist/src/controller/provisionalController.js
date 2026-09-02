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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateProvisionalPersonnel = exports.updateProvisionalPosition = exports.provisionalRenew = exports.provisionalRemove = exports.provisionalTransfer = exports.provisionalPersonnelExcel = exports.provisionalPositionPersonnel = exports.provisionalPersonnel = exports.positionOccupantWhere = exports.PROVISIONAL_ENDED = exports.provisionalInvite = exports.provisionalPositions = exports.createProvisionalPosition = exports.provisionalStatusFilter = exports.PROVISIONAL_STATUSES = exports.PROVISIONAL_EMP_TYPES = void 0;
const prisma_1 = require("../barrel/prisma");
const errors_1 = require("../errors/errors");
const encryption_1 = require("../service/encryption");
const handler_1 = require("../middleware/handler");
const notificationEvents_1 = require("../service/notificationEvents");
const exceljs_1 = __importDefault(require("exceljs"));
const frontEnd = process.env.VITE_LOCAL_FRONTEND_URL;
const INVITE_TTL_DAYS = 7;
// A User's email is encrypted when `emailIv` is set; otherwise it's plaintext.
// Returns the readable address (or null if it can't be decrypted).
const decryptUserEmail = (email, iv) => __awaiter(void 0, void 0, void 0, function* () {
    if (!email)
        return null;
    if (!iv)
        return email;
    try {
        return yield encryption_1.EncryptionService.decrypt(email, iv);
    }
    catch (e) {
        console.warn("[provisional] failed to decrypt user email", e);
        return null;
    }
});
// The specific CSC employment categories HR can assign to a person. These are
// what the personnel edit form offers.
exports.PROVISIONAL_EMP_TYPES = [
    "Job Order",
    "Contract of Service",
    "Casual",
    "Contractual",
    "Temporary",
];
/**
 * Every `User.status` value that means "non-plantilla".
 *
 * This is deliberately WIDER than the assignable list above, because the hire
 * paths write placeholders that nobody ever picked from a form:
 *
 *   "Non-Plantilla"  the provisional position UI stores this as empType (it
 *                    stopped asking for a type per position), and registration
 *                    copies empType straight onto the user's status
 *   "Provisional"    quick-register on a non-plantilla slot, and the full-PDS
 *                    fallback when an invite carries no employment type
 *
 * Both were missing here, so anyone hired through the ordinary flow vanished
 * from Non-Plantilla > Personnel AND showed up in the plantilla Employees list
 * (which excludes exactly this set). Widening the list heals the existing rows
 * without a migration; HR can still narrow a person to a real category later.
 */
exports.PROVISIONAL_STATUSES = [
    ...exports.PROVISIONAL_EMP_TYPES,
    "Non-Plantilla",
    "Provisional",
];
/**
 * Matches any non-plantilla status regardless of case or stray whitespace.
 * `empType` is free text on the position, so "job order" and "Job Order " both
 * reach the user row; an exact `in` filter silently drops them.
 */
const provisionalStatusFilter = () => ({
    OR: exports.PROVISIONAL_STATUSES.map((s) => ({
        // `contains` rather than `equals` so a stored " Job Order " still matches.
        // The categories are distinctive enough that this cannot pull in a
        // plantilla status by accident.
        status: { contains: s, mode: "insensitive" },
    })),
});
exports.provisionalStatusFilter = provisionalStatusFilter;
// POST /provisional/position  { title, empType, termMonths, slots, description, lineId, userId }
// Create a provisional position (carries the employment type + term in months).
const createProvisionalPosition = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d, _e;
    const body = req.body;
    if (!((_a = body.title) === null || _a === void 0 ? void 0 : _a.trim()) || !((_b = body.empType) === null || _b === void 0 ? void 0 : _b.trim()) || !body.lineId) {
        throw new errors_1.ValidationError("title, empType and lineId are required");
    }
    const termMonths = Math.max(1, parseInt(String((_c = body.termMonths) !== null && _c !== void 0 ? _c : 3), 10) || 3);
    const slots = Math.max(1, parseInt(String((_d = body.slots) !== null && _d !== void 0 ? _d : 1), 10) || 1);
    try {
        const created = yield prisma_1.prisma.provisionalPosition.create({
            data: {
                title: body.title.trim(),
                empType: body.empType.trim(),
                termMonths,
                slots,
                description: ((_e = body.description) === null || _e === void 0 ? void 0 : _e.trim()) || null,
                lineId: body.lineId,
                salaryGradeId: body.salaryGradeId || null,
            },
        });
        return res.code(200).send({ message: "OK", id: created.id });
    }
    catch (error) {
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw (0, errors_1.dbError)(error);
        }
        throw error;
    }
});
exports.createProvisionalPosition = createProvisionalPosition;
// GET /provisional/positions?id=<lineId>&query&lastCursor&limit
// Lists provisional positions with how many slots are filled (= accepted
// invites) vs open.
const provisionalPositions = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    const params = req.query;
    if (!params.id)
        throw new errors_1.ValidationError("BAD_REQUEST");
    try {
        const cursor = params.lastCursor ? { id: params.lastCursor } : undefined;
        const limit = params.limit ? parseInt(params.limit, 10) : 20;
        const q = ((_a = params.query) !== null && _a !== void 0 ? _a : "").trim();
        const rows = yield prisma_1.prisma.provisionalPosition.findMany({
            where: Object.assign({ lineId: params.id }, (q
                ? {
                    OR: [
                        { title: { contains: q, mode: "insensitive" } },
                        { empType: { contains: q, mode: "insensitive" } },
                    ],
                }
                : {})),
            cursor,
            take: limit,
            skip: cursor ? 1 : 0,
            orderBy: { createdAt: "desc" },
            include: {
                invitations: {
                    select: { id: true, concluded: true, concludedReason: true },
                },
                salaryGrade: { select: { id: true, grade: true, amount: true } },
            },
        });
        /**
         * `filled` counts PEOPLE actually holding the post, not invitation rows.
         *
         * It used to count invitations tagged "accepted", which drifts from
         * reality: provisionalRemove re-tags to "ended" to free the slot, but a
         * person archived through any other path (general archive, manual status
         * change) left their invitation saying "accepted" forever, so the position
         * showed as full and Select-applicant stayed disabled with nobody in it.
         */
        const list = yield Promise.all(rows.map((p) => __awaiter(void 0, void 0, void 0, function* () {
            const filled = yield prisma_1.prisma.user.count({
                where: (0, exports.positionOccupantWhere)(p.id, params.id),
            });
            const pending = p.invitations.filter((i) => !i.concluded && i.concludedReason !== "accepted").length;
            const { invitations } = p, rest = __rest(p, ["invitations"]);
            void invitations;
            const open = Math.max(0, p.slots - filled);
            return Object.assign(Object.assign({}, rest), { filled,
                pending,
                open, 
                // Outstanding invitations can exceed the seats left. HR needs to see
                // that before sending another one.
                overCommitted: Math.max(0, pending - open) });
        })));
        const lastCursor = list.length > 0 ? list[list.length - 1].id : null;
        const hasMore = rows.length === limit;
        return res.code(200).send({ list, lastCursor, hasMore });
    }
    catch (error) {
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw (0, errors_1.dbError)(error);
        }
        throw error;
    }
});
exports.provisionalPositions = provisionalPositions;
// POST /provisional/invite  { applicationId, provisionalPositionId, unitId, userId, lineId, message? }
// Pick an applicant for a provisional position + a unit, and email them the
// registration link. Reuses the FillPositionInvitation row (+ the existing
// /position/register pages); the provisional fields drive a temp/contract hire.
const provisionalInvite = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    const body = req.body;
    if (!body.provisionalPositionId ||
        !body.unitId ||
        !body.lineId ||
        !body.userId) {
        throw new errors_1.ValidationError("INVALID REQUIRED FIELDS");
    }
    if (!frontEnd) {
        throw new errors_1.ValidationError("Server misconfigured: FRONTEND_URL is not set.");
    }
    // Accept one `applicationId` or a bulk `applicationIds[]`, de-duped.
    const appIds = [
        ...new Set([
            ...(Array.isArray(body.applicationIds) ? body.applicationIds : []),
            ...(body.applicationId ? [body.applicationId] : []),
        ].filter((x) => typeof x === "string" && !!x)),
    ];
    if (!appIds.length)
        throw new errors_1.ValidationError("No applicants selected");
    const provisionalPositionId = body.provisionalPositionId;
    const unitId = body.unitId;
    const lineId = body.lineId;
    const actorId = body.userId;
    const message = ((_a = body.message) === null || _a === void 0 ? void 0 : _a.trim()) || null;
    try {
        const result = yield prisma_1.prisma.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            var _a, _b, _c;
            const position = yield tx.provisionalPosition.findUnique({
                where: { id: provisionalPositionId },
                include: {
                    invitations: { select: { concluded: true, concludedReason: true } },
                },
            });
            if (!position)
                throw new errors_1.NotFoundError("Provisional position not found");
            const taken = position.invitations.filter((i) => i.concludedReason === "accepted" || !i.concluded).length;
            const available = position.slots - taken;
            if (available <= 0) {
                throw new errors_1.ValidationError("No open slots left for this position.");
            }
            const unit = yield tx.department.findUnique({
                where: { id: unitId },
                select: { id: true, name: true, lineId: true },
            });
            if (!unit)
                throw new errors_1.NotFoundError("Unit not found");
            const applications = yield tx.submittedApplication.findMany({
                where: { id: { in: appIds }, lineId },
                select: {
                    id: true,
                    firstname: true,
                    lastname: true,
                    email: true,
                    emailIv: true,
                    userId: true,
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
            const now = new Date();
            // Split the selections:
            //  • NEW applicants (no user yet) → send a registration invite + email.
            //  • ALREADY-REGISTERED users who are ended/archived (e.g. a removed
            //    person who was restored) → RE-ASSIGN them directly into the slot,
            //    no re-registration. Anyone actively placed or with a live invite is
            //    skipped (not failed).
            const registeredIds = applications
                .filter((a) => a.userId)
                .map((a) => a.userId);
            const userById = new Map();
            if (registeredIds.length) {
                const us = yield tx.user.findMany({
                    where: { id: { in: registeredIds } },
                    select: {
                        id: true,
                        status: true,
                        accountId: true,
                        archivedAt: true,
                        firstName: true,
                        lastName: true,
                    },
                });
                us.forEach((u) => userById.set(u.id, u));
            }
            const toInvite = [];
            const toReassign = [];
            for (const a of applications) {
                if (a.userId) {
                    const u = userById.get(a.userId);
                    if (u && (u.status === exports.PROVISIONAL_ENDED || u.archivedAt)) {
                        toReassign.push({ app: a, user: u });
                    }
                    // else: actively placed / regular employee → skip
                }
                else {
                    const prev = a.fillPositionInvitations;
                    const live = !!prev && !prev.concluded && (!prev.expiresAt || prev.expiresAt > now);
                    if (!live)
                        toInvite.push(a);
                    // else: live invite already → skip
                }
            }
            const totalToFill = toInvite.length + toReassign.length;
            const skipped = appIds.length - totalToFill;
            if (totalToFill === 0) {
                throw new errors_1.ValidationError("None of the selected applicants are eligible (already placed, or have a live invite).");
            }
            if (totalToFill > available) {
                throw new errors_1.ValidationError(`Only ${available} slot(s) open for "${position.title}", but ${totalToFill} selection(s) were made.`);
            }
            const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 86400000);
            const created = [];
            // 1) NEW applicants → registration invite + email.
            for (const application of toInvite) {
                // submittedApplicationId is @unique, so detach any stale prior invite.
                const prev = application.fillPositionInvitations;
                if (prev) {
                    yield tx.fillPositionInvitation.update({
                        where: { id: prev.id },
                        data: { submittedApplicationId: null },
                    });
                }
                const plainEmail = application.emailIv
                    ? yield encryption_1.EncryptionService.decrypt(application.email, application.emailIv)
                    : application.email;
                const link = yield tx.fillPositionInvitation.create({
                    data: {
                        email: plainEmail,
                        message,
                        lineId,
                        provisionalPositionId: position.id,
                        departmentId: unit.id,
                        empType: position.empType,
                        submittedApplicationId: application.id,
                        expiresAt,
                    },
                });
                yield tx.submittedApplication.update({
                    where: { id: application.id },
                    data: { status: 2 },
                });
                yield tx.humanResourcesLogs.create({
                    data: {
                        action: "ADD",
                        desc: `PROVISIONAL (${position.empType}) invite -> ${application.firstname} ${application.lastname} (${plainEmail}) for "${position.title}" in ${(_a = unit.name) !== null && _a !== void 0 ? _a : "unit"}`,
                        lineId,
                        userId: actorId,
                    },
                });
                created.push({
                    linkId: link.id,
                    applicationId: application.id,
                    email: plainEmail,
                    firstname: application.firstname,
                });
            }
            // 2) ALREADY-REGISTERED (restored/ended) users → re-assign directly.
            const term = new Date(now);
            term.setMonth(term.getMonth() + (position.termMonths || 0));
            let reassigned = 0;
            for (const { app, user } of toReassign) {
                const prev = app.fillPositionInvitations;
                if (prev) {
                    yield tx.fillPositionInvitation.update({
                        where: { id: prev.id },
                        data: { submittedApplicationId: null },
                    });
                }
                // An ACCEPTED invitation occupies the slot (that's what "filled" counts).
                yield tx.fillPositionInvitation.create({
                    data: {
                        email: "",
                        message,
                        lineId,
                        provisionalPositionId: position.id,
                        departmentId: unit.id,
                        empType: position.empType,
                        submittedApplicationId: app.id,
                        expiresAt,
                        concluded: true,
                        concludedAt: now,
                        concludedReason: "accepted",
                    },
                });
                yield tx.user.update({
                    where: { id: user.id },
                    data: Object.assign(Object.assign({ status: position.empType, departmentId: unit.id, term }, (position.salaryGradeId
                        ? { salaryGradeId: position.salaryGradeId }
                        : {})), { archivedAt: null, archiveReason: null }),
                });
                if (user.accountId) {
                    yield tx.account.update({
                        where: { id: user.accountId },
                        data: { active: true, status: 1 },
                    });
                }
                yield (0, notificationEvents_1.createUserNotification)(tx, {
                    recipientId: user.id,
                    title: "Assigned to a provisional position",
                    content: `You have been assigned as "${position.title}" (${position.empType}) in ${(_b = unit.name) !== null && _b !== void 0 ? _b : "your unit"}.`,
                    senderId: null,
                });
                yield tx.humanResourcesLogs.create({
                    data: {
                        action: "UPDATE",
                        desc: `PROVISIONAL reassign -> ${user.firstName} ${user.lastName} to "${position.title}" in ${(_c = unit.name) !== null && _c !== void 0 ? _c : "unit"}`,
                        lineId,
                        userId: actorId,
                    },
                });
                yield tx.submittedApplication.update({
                    where: { id: app.id },
                    data: { status: 2 },
                });
                reassigned++;
            }
            return { created, skipped, reassigned, position, unit, expiresAt };
        }));
        // Each link goes straight to the account step (applicants already submitted
        // a PDS when they applied), pre-loaded with their existing application id.
        for (const c of result.created) {
            (0, handler_1.sendEmail)(`Provisional appointment — ${result.position.title}`, c.email, `Good day ${c.firstname},

You have been selected for a ${result.position.empType} appointment as
"${result.position.title}" (${result.position.termMonths} months) at ${(_b = result.unit.name) !== null && _b !== void 0 ? _b : "the LGU"}.

Please complete your registration here:
${frontEnd}/position/register/${c.linkId}/${c.applicationId}

This link expires on ${result.expiresAt.toLocaleString()}.
${message ? `\n${message}\n` : ""}
Best regards,
HR Team`, "Gasan LGU HR").catch((e) => console.warn("[provisionalInvite] email failed", e));
        }
        return res.code(200).send({
            message: "OK",
            invited: result.created.length,
            reassigned: result.reassigned,
            skipped: result.skipped,
            position: result.position.title,
        });
    }
    catch (error) {
        if (error instanceof errors_1.NotFoundError || error instanceof errors_1.ValidationError) {
            throw error;
        }
        throw new errors_1.AppError("PROVISIONAL_INVITE_FAILED", 500, "DB_ERROR");
    }
});
exports.provisionalInvite = provisionalInvite;
// Status applied when a provisional engagement is ended (the account is also
// disabled). Kept out of both the active provisional roster AND the plantilla
// Employees list.
exports.PROVISIONAL_ENDED = "Ended";
// Shared select for the personnel list + Excel export so both stay in sync.
const personnelSelect = {
    id: true,
    firstName: true,
    lastName: true,
    middleName: true,
    username: true,
    status: true,
    term: true,
    createdAt: true,
    accountId: true,
    department: { select: { id: true, name: true } },
    SalaryGrade: { select: { id: true, grade: true, amount: true } },
    // Skills come from the applicant's PDS (ApplicationSkillTags) via the
    // application this provisional user was hired from.
    submittedApplications: {
        select: {
            ApplicationSkillTags: { select: { id: true, tags: true } },
        },
    },
};
// Normalises a target-user payload: accepts `userIds: string[]` (bulk) and/or a
// single `userId`, de-duped. Lets the same endpoint serve one-off + bulk actions.
const collectIds = (body) => {
    const arr = Array.isArray(body.userIds) ? body.userIds : [];
    const all = [...arr, ...(body.userId ? [body.userId] : [])];
    return [...new Set(all.filter((x) => typeof x === "string" && x))];
};
// Reads the skill `tags` from the query string, tolerating both `tags[]=a`
// (axios array serialization) and a bare `tags=a`, string or array.
const readTags = (query) => {
    var _a;
    const q = query;
    const raw = (_a = q === null || q === void 0 ? void 0 : q["tags[]"]) !== null && _a !== void 0 ? _a : q === null || q === void 0 ? void 0 : q["tags"];
    if (Array.isArray(raw))
        return raw.filter((t) => typeof t === "string");
    if (typeof raw === "string" && raw)
        return [raw];
    return [];
};
// Builds the Prisma `where` for provisional personnel, applying the optional
// employment-type + contract-term + name + skill filters. Used by both the list
// endpoint and the Excel export so the download honours the same filters.
const buildPersonnelWhere = (params) => {
    var _a, _b, _c, _d;
    const q = ((_a = params.query) !== null && _a !== void 0 ? _a : "").trim();
    const tags = ((_b = params.tags) !== null && _b !== void 0 ? _b : []).filter((t) => typeof t === "string" && t);
    // Employment-type filter: one known category, else every non-plantilla
    // status. Matching is case/whitespace tolerant either way — see
    // provisionalStatusFilter.
    const status = ((_c = params.status) !== null && _c !== void 0 ? _c : "").trim();
    const statusCond = status && exports.PROVISIONAL_STATUSES.some((s) => s.toLowerCase() === status.toLowerCase())
        ? { status: { contains: status, mode: "insensitive" } }
        : (0, exports.provisionalStatusFilter)();
    // Contract end-date (User.term) filter.
    //   active   → no end date OR ends in the future
    //   expiring → ends within the next 30 days
    //   expired  → end date already passed
    //   none     → open-ended (no end date)
    const termSel = ((_d = params.term) !== null && _d !== void 0 ? _d : "").trim();
    const now = new Date();
    const soon = new Date(now.getTime() + 30 * 86400000);
    let termCond = null;
    if (termSel === "expiring")
        termCond = { term: { gte: now, lte: soon } };
    else if (termSel === "expired")
        termCond = { term: { lt: now } };
    else if (termSel === "active")
        termCond = { OR: [{ term: null }, { term: { gte: now } }] };
    else if (termSel === "none")
        termCond = { term: null };
    const and = [statusCond];
    if (q) {
        and.push({
            OR: [
                { firstName: { contains: q, mode: "insensitive" } },
                { lastName: { contains: q, mode: "insensitive" } },
                { middleName: { contains: q, mode: "insensitive" } },
                { username: { contains: q, mode: "insensitive" } },
            ],
        });
    }
    if (termCond)
        and.push(termCond);
    // Skill-tag filter: provisional users whose application carries any of the
    // selected skill tags. Mirrors the applicant list's `tags` filter.
    if (tags.length) {
        and.push({
            submittedApplications: {
                is: {
                    ApplicationSkillTags: {
                        some: { tags: { in: tags } },
                    },
                },
            },
        });
    }
    return {
        lineId: params.id,
        // Ended engagements are archived; they belong on the Archived page, not
        // here. Previously this leaned on "Ended" not being a provisional status,
        // which stops being true the moment the list widens.
        archivedAt: null,
        AND: and,
    };
};
/**
 * A person currently occupying a provisional position.
 *
 * The link is User -> SubmittedApplication -> FillPositionInvitation, and the
 * invitation must still be tagged "accepted" (provisionalRemove re-tags it to
 * "ended" to free the slot). Archived people never count.
 */
const positionOccupantWhere = (positionId, lineId) => (Object.assign(Object.assign({}, (lineId ? { lineId } : {})), { archivedAt: null, AND: [
        (0, exports.provisionalStatusFilter)(),
        {
            submittedApplications: {
                is: {
                    fillPositionInvitations: {
                        is: {
                            provisionalPositionId: positionId,
                            concludedReason: "accepted",
                        },
                    },
                },
            },
        },
    ] }));
exports.positionOccupantWhere = positionOccupantWhere;
// GET /provisional/personnel?id=<lineId>&query&lastCursor&limit&status&term
// Provisional employees = Users whose status is a provisional category. Shows
// employment type (status) + contract end date (User.term).
const provisionalPersonnel = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const params = req.query;
    if (!params.id)
        throw new errors_1.ValidationError("BAD_REQUEST");
    try {
        const cursor = params.lastCursor ? { id: params.lastCursor } : undefined;
        const limit = params.limit ? parseInt(params.limit, 10) : 20;
        const tags = readTags(req.query);
        const response = yield prisma_1.prisma.user.findMany({
            where: buildPersonnelWhere(Object.assign(Object.assign({}, params), { id: params.id, tags })),
            cursor,
            take: limit,
            skip: cursor ? 1 : 0,
            // `id` breaks ties: ordering by createdAt alone is not deterministic when
            // people share a timestamp, and a cursor over a non-deterministic order
            // silently skips rows between pages.
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            select: personnelSelect,
        });
        const lastCursor = response.length > 0 ? response[response.length - 1].id : null;
        const hasMore = response.length === limit;
        return res.code(200).send({ list: response, lastCursor, hasMore });
    }
    catch (error) {
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw (0, errors_1.dbError)(error);
        }
        throw error;
    }
});
exports.provisionalPersonnel = provisionalPersonnel;
/**
 * GET /provisional/position/personnel?id=<lineId>&positionId&query&lastCursor&limit
 *
 * The people hired into ONE provisional position. Cursor-paginated for the
 * infinite-scroll list, and returns the position alongside so the page can
 * render its header without a second round-trip.
 */
const provisionalPositionPersonnel = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    const params = req.query;
    if (!params.id || !params.positionId) {
        throw new errors_1.ValidationError("id and positionId are required");
    }
    try {
        const position = yield prisma_1.prisma.provisionalPosition.findFirst({
            where: { id: params.positionId, lineId: params.id },
            include: { salaryGrade: { select: { id: true, grade: true, amount: true } } },
        });
        if (!position)
            throw new errors_1.NotFoundError("Position not found");
        const cursor = params.lastCursor ? { id: params.lastCursor } : undefined;
        const limit = params.limit ? parseInt(params.limit, 10) : 20;
        const q = ((_a = params.query) !== null && _a !== void 0 ? _a : "").trim();
        const where = Object.assign(Object.assign({}, (0, exports.positionOccupantWhere)(position.id, params.id)), (q
            ? {
                OR: [
                    { firstName: { contains: q, mode: "insensitive" } },
                    { lastName: { contains: q, mode: "insensitive" } },
                    { middleName: { contains: q, mode: "insensitive" } },
                    { username: { contains: q, mode: "insensitive" } },
                ],
            }
            : {}));
        const list = yield prisma_1.prisma.user.findMany({
            where,
            cursor,
            take: limit,
            skip: cursor ? 1 : 0,
            // `id` breaks ties so the cursor can never skip or repeat a person when
            // several were hired in the same instant.
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            select: personnelSelect,
        });
        const filled = yield prisma_1.prisma.user.count({
            where: (0, exports.positionOccupantWhere)(position.id, params.id),
        });
        return res.code(200).send({
            position: Object.assign(Object.assign({}, position), { filled, open: Math.max(0, position.slots - filled) }),
            list,
            lastCursor: list.length ? list[list.length - 1].id : null,
            hasMore: list.length === limit,
        });
    }
    catch (error) {
        if (error instanceof errors_1.NotFoundError || error instanceof errors_1.ValidationError) {
            throw error;
        }
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError)
            throw (0, errors_1.dbError)(error);
        throw error;
    }
});
exports.provisionalPositionPersonnel = provisionalPositionPersonnel;
// GET /provisional/personnel/excel?id=<lineId>&query&status&term
// Downloads the (filtered) provisional personnel list as an .xlsx file. Honours
// the same employment-type / term / search filters as the list endpoint.
const provisionalPersonnelExcel = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const params = req.query;
    if (!params.id)
        throw new errors_1.ValidationError("BAD_REQUEST");
    try {
        const tags = readTags(req.query);
        const rows = yield prisma_1.prisma.user.findMany({
            where: buildPersonnelWhere(Object.assign(Object.assign({}, params), { id: params.id, tags })),
            orderBy: { createdAt: "desc" },
            select: personnelSelect,
        });
        const now = new Date();
        const workbook = new exceljs_1.default.Workbook();
        workbook.created = now;
        const worksheet = workbook.addWorksheet("Provisional Personnel", {
            pageSetup: { orientation: "landscape", fitToPage: true },
        });
        worksheet.columns = [
            { header: "No", key: "no", width: 5 },
            { header: "Name", key: "name", width: 30 },
            { header: "Username", key: "username", width: 18 },
            { header: "Employment Type", key: "empType", width: 20 },
            { header: "Unit", key: "unit", width: 26 },
            { header: "Date Hired", key: "hired", width: 16 },
            { header: "Contract End", key: "end", width: 16 },
            { header: "Status", key: "state", width: 14 },
            { header: "Skills", key: "skills", width: 40 },
        ];
        worksheet.getRow(1).eachCell((cell) => {
            cell.font = { bold: true };
            cell.alignment = { horizontal: "center", vertical: "middle" };
            cell.border = {
                top: { style: "thin" },
                left: { style: "thin" },
                bottom: { style: "thin" },
                right: { style: "thin" },
            };
        });
        worksheet.addRows(rows.map((u, i) => {
            var _a, _b, _c, _d, _e;
            const name = [u.firstName, u.middleName, u.lastName]
                .filter(Boolean)
                .join(" ");
            const end = u.term ? new Date(u.term) : null;
            const state = !end ? "Open-ended" : end < now ? "Expired" : "Active";
            const skills = ((_b = (_a = u.submittedApplications) === null || _a === void 0 ? void 0 : _a.ApplicationSkillTags) !== null && _b !== void 0 ? _b : [])
                .map((s) => s.tags)
                .filter(Boolean)
                .join(", ");
            return {
                no: i + 1,
                name: name || "N/A",
                username: (_c = u.username) !== null && _c !== void 0 ? _c : "—",
                empType: u.status,
                unit: (_e = (_d = u.department) === null || _d === void 0 ? void 0 : _d.name) !== null && _e !== void 0 ? _e : "Unassigned",
                hired: u.createdAt ? new Date(u.createdAt).toLocaleDateString() : "—",
                end: end ? end.toLocaleDateString() : "—",
                state,
                skills: skills || "—",
            };
        }));
        const stamp = now.toISOString().slice(0, 10);
        res.header("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
        res.header("Content-Disposition", `attachment; filename=provisional-personnel-${stamp}.xlsx`);
        res.header("Access-Control-Expose-Headers", "Content-Disposition");
        const buffer = yield workbook.xlsx.writeBuffer();
        return res.send(buffer);
    }
    catch (error) {
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw (0, errors_1.dbError)(error);
        }
        throw error;
    }
});
exports.provisionalPersonnelExcel = provisionalPersonnelExcel;
// POST /provisional/transfer { userId | userIds[], unitId, actorId, lineId }
// Reassigns one or more provisional employees to a unit and notifies each.
const provisionalTransfer = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    const body = req.body;
    if (!body.unitId || !body.actorId || !body.lineId) {
        throw new errors_1.ValidationError("INVALID REQUIRED FIELDS");
    }
    const ids = collectIds(body);
    if (!ids.length)
        throw new errors_1.ValidationError("No personnel selected");
    const { unitId, actorId, lineId } = body;
    try {
        const result = yield prisma_1.prisma.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            var _a, _b;
            const unit = yield tx.department.findFirst({
                where: { id: unitId, lineId },
                select: { id: true, name: true },
            });
            if (!unit)
                throw new errors_1.NotFoundError("Unit not found");
            const users = yield tx.user.findMany({
                where: { id: { in: ids }, lineId, status: { in: exports.PROVISIONAL_STATUSES } },
                select: { id: true, firstName: true, lastName: true, departmentId: true },
            });
            let moved = 0;
            for (const user of users) {
                if (user.departmentId === unit.id)
                    continue; // already there
                yield tx.user.update({
                    where: { id: user.id },
                    data: { departmentId: unit.id },
                });
                yield (0, notificationEvents_1.createUserNotification)(tx, {
                    recipientId: user.id,
                    title: "Unit transfer",
                    content: `You have been transferred to ${(_a = unit.name) !== null && _a !== void 0 ? _a : "a new unit"}.`,
                    senderId: null,
                });
                yield tx.humanResourcesLogs.create({
                    data: {
                        action: "UPDATE",
                        desc: `PROVISIONAL transfer -> ${user.firstName} ${user.lastName} → ${(_b = unit.name) !== null && _b !== void 0 ? _b : "unit"}`,
                        lineId,
                        userId: actorId,
                    },
                });
                moved++;
            }
            return { unit, moved };
        }));
        return res.code(200).send({
            message: "OK",
            unit: (_a = result.unit.name) !== null && _a !== void 0 ? _a : null,
            count: result.moved,
        });
    }
    catch (error) {
        if (error instanceof errors_1.NotFoundError || error instanceof errors_1.ValidationError) {
            throw error;
        }
        throw new errors_1.AppError("PROVISIONAL_TRANSFER_FAILED", 500, "DB_ERROR");
    }
});
exports.provisionalTransfer = provisionalTransfer;
// POST /provisional/remove { userId | userIds[], actorId, lineId, message? }
// Ends one or more provisional engagements: marks "Ended", clears the unit, sets
// the contract end to now, disables the account, notifies + emails each.
const provisionalRemove = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    const body = req.body;
    if (!body.actorId || !body.lineId) {
        throw new errors_1.ValidationError("INVALID REQUIRED FIELDS");
    }
    const ids = collectIds(body);
    if (!ids.length)
        throw new errors_1.ValidationError("No personnel selected");
    const { actorId, lineId } = body;
    const note = ((_a = body.message) === null || _a === void 0 ? void 0 : _a.trim()) || null;
    try {
        const ended = yield prisma_1.prisma.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            const users = yield tx.user.findMany({
                where: { id: { in: ids }, lineId, status: { in: exports.PROVISIONAL_STATUSES } },
                select: {
                    id: true,
                    firstName: true,
                    lastName: true,
                    accountId: true,
                    status: true,
                    email: true,
                    emailIv: true,
                },
            });
            for (const user of users) {
                yield tx.user.update({
                    where: { id: user.id },
                    data: {
                        status: exports.PROVISIONAL_ENDED,
                        term: new Date(),
                        departmentId: null,
                        // Archive: drops out of the active Employees/Non-Plantilla lists
                        // and into the dedicated Archived page.
                        archivedAt: new Date(),
                        archiveReason: note || "Provisional engagement ended",
                    },
                });
                if (user.accountId) {
                    yield tx.account.update({
                        where: { id: user.accountId },
                        data: { active: false, status: 2 },
                    });
                }
                yield (0, notificationEvents_1.createUserNotification)(tx, {
                    recipientId: user.id,
                    title: "Engagement ended",
                    content: "Your provisional engagement has ended and your account access has been disabled. Please coordinate with HR for any clarifications.",
                    senderId: null,
                });
                yield tx.humanResourcesLogs.create({
                    data: {
                        action: "DELETE",
                        desc: `PROVISIONAL ended -> ${user.firstName} ${user.lastName}`,
                        lineId,
                        userId: actorId,
                    },
                });
            }
            // Free the provisional slot(s). A position's "filled" count is derived
            // from FillPositionInvitation rows with concludedReason "accepted" — so
            // ending the user alone doesn't free the slot. Re-tag their accepted
            // invitation as "ended" so the slot opens back up (and can be re-hired).
            const removedIds = users.map((u) => u.id);
            if (removedIds.length) {
                const invites = yield tx.fillPositionInvitation.findMany({
                    where: {
                        concludedReason: "accepted",
                        NOT: { provisionalPositionId: null },
                        applcation: { userId: { in: removedIds } },
                    },
                    select: { id: true },
                });
                if (invites.length) {
                    yield tx.fillPositionInvitation.updateMany({
                        where: { id: { in: invites.map((i) => i.id) } },
                        data: { concludedReason: "ended" },
                    });
                }
            }
            return users;
        }));
        // Email each (now ex-) employee about the termination.
        let emailed = 0;
        for (const u of ended) {
            const to = yield decryptUserEmail(u.email, u.emailIv);
            if (!to)
                continue;
            emailed++;
            (0, handler_1.sendEmail)("End of Provisional Engagement", to, `Good day ${u.firstName} ${u.lastName},

This is to formally inform you that your ${u.status} engagement with the Local Government Unit of Gasan has ended effective ${new Date().toLocaleDateString()}.

Your portal access has been deactivated. ${note ? `\n${note}\n` : ""}
For any clarifications regarding your engagement, clearance, or final pay, please coordinate with the HR Office.

Thank you for your service.

Best regards,
Human Resources Office
LGU Gasan`, "Gasan LGU HR").catch((e) => console.warn("[provisionalRemove] email failed", e));
        }
        return res
            .code(200)
            .send({ message: "OK", count: ended.length, emailed });
    }
    catch (error) {
        if (error instanceof errors_1.NotFoundError || error instanceof errors_1.ValidationError) {
            throw error;
        }
        throw new errors_1.AppError("PROVISIONAL_REMOVE_FAILED", 500, "DB_ERROR");
    }
});
exports.provisionalRemove = provisionalRemove;
// POST /provisional/renew { userId | userIds[], months, actorId, lineId }
// Extends one or more provisional contracts by `months` (from the current end
// date if still in the future, otherwise from today), notifies + emails each.
const provisionalRenew = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c;
    const body = req.body;
    if (!body.actorId || !body.lineId) {
        throw new errors_1.ValidationError("INVALID REQUIRED FIELDS");
    }
    const ids = collectIds(body);
    if (!ids.length)
        throw new errors_1.ValidationError("No personnel selected");
    const months = Math.max(1, parseInt(String((_a = body.months) !== null && _a !== void 0 ? _a : 3), 10) || 3);
    const { actorId, lineId } = body;
    try {
        const result = yield prisma_1.prisma.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            const users = yield tx.user.findMany({
                where: { id: { in: ids }, lineId, status: { in: exports.PROVISIONAL_STATUSES } },
                select: {
                    id: true,
                    firstName: true,
                    lastName: true,
                    status: true,
                    term: true,
                    email: true,
                    emailIv: true,
                },
            });
            const now = new Date();
            const out = [];
            for (const user of users) {
                const base = user.term && new Date(user.term) > now ? new Date(user.term) : now;
                const newTerm = new Date(base);
                newTerm.setMonth(newTerm.getMonth() + months);
                yield tx.user.update({
                    where: { id: user.id },
                    data: { term: newTerm },
                });
                yield (0, notificationEvents_1.createUserNotification)(tx, {
                    recipientId: user.id,
                    title: "Contract renewed",
                    content: `Your ${user.status} engagement has been renewed for ${months} more month(s), now ending ${newTerm.toLocaleDateString()}.`,
                    senderId: null,
                });
                yield tx.humanResourcesLogs.create({
                    data: {
                        action: "UPDATE",
                        desc: `PROVISIONAL renew -> ${user.firstName} ${user.lastName}: +${months} mo (until ${newTerm.toLocaleDateString()})`,
                        lineId,
                        userId: actorId,
                    },
                });
                out.push({ user, newTerm });
            }
            return out;
        }));
        let emailed = 0;
        for (const r of result) {
            const to = yield decryptUserEmail(r.user.email, r.user.emailIv);
            if (!to)
                continue;
            emailed++;
            (0, handler_1.sendEmail)("Provisional Contract Renewed", to, `Good day ${r.user.firstName} ${r.user.lastName},

We are pleased to inform you that your ${r.user.status} engagement with the Local Government Unit of Gasan has been renewed for ${months} more month(s).

Your new contract end date is ${r.newTerm.toLocaleDateString()}.

Best regards,
Human Resources Office
LGU Gasan`, "Gasan LGU HR").catch((e) => console.warn("[provisionalRenew] email failed", e));
        }
        return res.code(200).send({
            message: "OK",
            count: result.length,
            emailed,
            term: (_c = (_b = result[0]) === null || _b === void 0 ? void 0 : _b.newTerm) !== null && _c !== void 0 ? _c : null,
        });
    }
    catch (error) {
        if (error instanceof errors_1.NotFoundError || error instanceof errors_1.ValidationError) {
            throw error;
        }
        throw new errors_1.AppError("PROVISIONAL_RENEW_FAILED", 500, "DB_ERROR");
    }
});
exports.provisionalRenew = provisionalRenew;
// PATCH /provisional/position { positionId, title?, empType?, termMonths?, slots?,
//   description?, salaryGradeId?, lineId, userId? }
// Edit a non-plantilla position. Slots can't drop below the filled count.
const updateProvisionalPosition = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const body = req.body;
    if (!body.positionId || !body.lineId) {
        throw new errors_1.ValidationError("INVALID REQUIRED FIELDS");
    }
    const lineId = body.lineId;
    const actorId = body.userId;
    try {
        yield prisma_1.prisma.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            var _a, _b, _c;
            const pos = yield tx.provisionalPosition.findFirst({
                where: { id: body.positionId, lineId },
                include: {
                    invitations: { select: { concludedReason: true } },
                },
            });
            if (!pos)
                throw new errors_1.NotFoundError("Position not found");
            const filled = pos.invitations.filter((i) => i.concludedReason === "accepted").length;
            const data = {};
            if ((_a = body.title) === null || _a === void 0 ? void 0 : _a.trim())
                data.title = body.title.trim();
            if ((_b = body.empType) === null || _b === void 0 ? void 0 : _b.trim())
                data.empType = body.empType.trim();
            if (body.termMonths != null) {
                data.termMonths = Math.max(1, parseInt(String(body.termMonths), 10) || pos.termMonths);
            }
            if (body.slots != null) {
                const slots = Math.max(1, parseInt(String(body.slots), 10) || pos.slots);
                if (slots < filled) {
                    throw new errors_1.ValidationError(`Slots can't be fewer than the ${filled} already filled.`);
                }
                data.slots = slots;
            }
            if (body.description !== undefined) {
                data.description = ((_c = body.description) === null || _c === void 0 ? void 0 : _c.trim()) || null;
            }
            if (body.salaryGradeId !== undefined) {
                data.salaryGrade = body.salaryGradeId
                    ? { connect: { id: body.salaryGradeId } }
                    : { disconnect: true };
            }
            const updated = yield tx.provisionalPosition.update({
                where: { id: pos.id },
                data,
            });
            if (actorId) {
                yield tx.humanResourcesLogs.create({
                    data: {
                        action: "UPDATE",
                        desc: `PROVISIONAL position updated -> "${updated.title}"`,
                        lineId,
                        userId: actorId,
                    },
                });
            }
        }));
        return res.code(200).send({ message: "OK" });
    }
    catch (error) {
        if (error instanceof errors_1.NotFoundError || error instanceof errors_1.ValidationError) {
            throw error;
        }
        throw new errors_1.AppError("PROVISIONAL_POSITION_UPDATE_FAILED", 500, "DB_ERROR");
    }
});
exports.updateProvisionalPosition = updateProvisionalPosition;
// PATCH /provisional/personnel { userId, status?, salaryGradeId?, actorId, lineId }
// Edit a provisional employee's employment type + salary grade.
const updateProvisionalPersonnel = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const body = req.body;
    if (!body.userId || !body.lineId) {
        throw new errors_1.ValidationError("INVALID REQUIRED FIELDS");
    }
    if (body.status && !exports.PROVISIONAL_STATUSES.includes(body.status)) {
        throw new errors_1.ValidationError("Invalid employment type");
    }
    try {
        const user = yield prisma_1.prisma.user.findFirst({
            where: {
                id: body.userId,
                lineId: body.lineId,
                status: { in: exports.PROVISIONAL_STATUSES },
            },
            select: { id: true, firstName: true, lastName: true },
        });
        if (!user)
            throw new errors_1.NotFoundError("Provisional personnel not found");
        const data = {};
        if (body.status)
            data.status = body.status;
        if (body.salaryGradeId !== undefined) {
            data.salaryGradeId = body.salaryGradeId || null;
        }
        yield prisma_1.prisma.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            yield tx.user.update({ where: { id: user.id }, data });
            if (body.actorId) {
                yield tx.humanResourcesLogs.create({
                    data: {
                        action: "UPDATE",
                        desc: `PROVISIONAL personnel updated -> ${user.firstName} ${user.lastName}`,
                        lineId: body.lineId,
                        userId: body.actorId,
                    },
                });
            }
            yield (0, notificationEvents_1.createUserNotification)(tx, {
                recipientId: user.id,
                title: "Employment details updated",
                content: "Your provisional employment details were updated by the HR office.",
                senderId: null,
            });
        }));
        return res.code(200).send({ message: "OK" });
    }
    catch (error) {
        if (error instanceof errors_1.NotFoundError || error instanceof errors_1.ValidationError) {
            throw error;
        }
        throw new errors_1.AppError("PROVISIONAL_PERSONNEL_UPDATE_FAILED", 500, "DB_ERROR");
    }
});
exports.updateProvisionalPersonnel = updateProvisionalPersonnel;
