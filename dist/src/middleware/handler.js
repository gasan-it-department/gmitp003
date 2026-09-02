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
exports.lineStatus = exports.phNumberFormat = exports.getAreaData = exports.generateOTPCode = exports.sendEmail = exports.generateDispenseRef = exports.generatePrescriptionRef = exports.generateMedRef = exports.generateStorageRef = exports.generatedInvitationCode = exports.generateItemRef = exports.generateOrderRef = exports.generatedItemCode = exports.viewContainerAuth = exports.generatedBoxCode = exports.medicineAccessAuth = exports.attendanceMobileAuth = exports.documentMobileAuth = exports.pharmacyMobileAuth = exports.authenticated = exports.callerUserId = exports.adminAuthenticated = exports.tempAuthenticated = void 0;
const prisma_1 = require("../barrel/prisma");
const prisma_2 = require("../barrel/prisma");
const errors_1 = require("../errors/errors");
const nodemailer_1 = __importDefault(require("nodemailer"));
const resend_1 = require("resend");
// HR mailbox — used as the sender + reply-to for all outgoing mail.
const HR_EMAIL = process.env.EMAIL_USER || "officeofthemayor.gasan@gmail.com";
// Resend requires the sending domain to be VERIFIED. A gmail.com "from" won't
// verify, so set RESEND_FROM to an address on your verified domain (e.g.
// hr@lgu-portal.xyz); replies still route to the HR mailbox. Defaults to the
// HR email so it's the sender out of the box once the domain is verified.
const RESEND_FROM = process.env.RESEND_FROM || HR_EMAIL;
const resend = process.env.RESEND_API_KEY
    ? new resend_1.Resend(process.env.RESEND_API_KEY)
    : null;
const tempAuthenticated = (request, reply) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const authHeader = request.headers.authorization;
        if (!(authHeader === null || authHeader === void 0 ? void 0 : authHeader.startsWith("Bearer "))) {
            throw new Error("Invalid authorization format. Expected: Bearer <token>");
        }
        const token = authHeader.split(" ")[1];
        if (!token) {
            throw new Error("No token provided");
        }
        const decoded = yield request.jwtVerify();
        const temp = yield prisma_2.prisma.submittedApplication.findUnique({
            where: {
                id: decoded.username,
            },
        });
        if (!temp) {
            throw new Error("Temp belonging to this token no longer exists");
        }
        request.user = temp;
        return; // Success - continue to route handler
    }
    catch (error) {
        console.log(error);
        reply.code(401).send({
            error: "Unauthorized",
            message: error instanceof Error ? error.message : "Authentication failed",
        });
    }
});
exports.tempAuthenticated = tempAuthenticated;
const adminAuthenticated = (request, reply) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const authHeader = request.headers.authorization;
        if (!(authHeader === null || authHeader === void 0 ? void 0 : authHeader.startsWith("Bearer "))) {
            throw new Error("Invalid authorization format. Expected: Bearer <token>");
        }
        const token = authHeader.split(" ")[1];
        if (!token) {
            throw new Error("No token provided");
        }
        console.log({ token });
        const decoded = yield request.jwtVerify();
        console.log({ decoded });
        const user = yield prisma_2.prisma.admin.findUnique({
            where: {
                id: decoded.id,
            },
        });
        if (!user) {
            throw new Error("User belonging to this token no longer exists");
        }
        request.user = user;
        return; // Success - continue to route handler
    }
    catch (error) {
        console.log(error);
        reply.code(401).send({
            error: "Unauthorized",
            message: error instanceof Error ? error.message : "Authentication failed",
        });
    }
});
exports.adminAuthenticated = adminAuthenticated;
/**
 * The User id behind the bearer token — the ONLY trustworthy identity.
 *
 * A client-supplied `userId` in a query string or body is an assertion, not a
 * fact. Endpoints that act on "my" data must resolve the actor from the token
 * instead, or any authenticated user can name someone else's id and operate as
 * them. (This is exactly how the e-signature endpoints were broken: they took
 * `userId` from the request, so one user could read, activate, delete, and
 * sign with another user's signature.)
 *
 * Impersonation still works as designed: the admin "Manage HR" flow mints a
 * real session for the target line, so the token itself carries the effective
 * identity.
 */
const callerUserId = (request) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c;
    const accountId = (_a = request.user) === null || _a === void 0 ? void 0 : _a.id;
    if (!accountId)
        return null;
    const account = yield prisma_2.prisma.account.findUnique({
        where: { id: accountId },
        select: { User: { select: { id: true } } },
    });
    return (_c = (_b = account === null || account === void 0 ? void 0 : account.User) === null || _b === void 0 ? void 0 : _b.id) !== null && _c !== void 0 ? _c : null;
});
exports.callerUserId = callerUserId;
const authenticated = (request, reply) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const authHeader = request.headers.authorization;
        if (!(authHeader === null || authHeader === void 0 ? void 0 : authHeader.startsWith("Bearer "))) {
            throw new Error("Invalid authorization format. Expected: Bearer <token>");
        }
        const token = authHeader.split(" ")[1];
        if (!token) {
            throw new Error("No token provided");
        }
        const decoded = yield request.jwtVerify();
        const user = yield prisma_2.prisma.account.findUnique({
            where: {
                id: decoded.id,
            },
            select: {
                id: true,
                line: {
                    select: {
                        status: true,
                    },
                },
                // The User behind this account. Needed to attribute impersonated
                // requests correctly — audit columns are User foreign keys.
                User: { select: { id: true } },
            },
        });
        if (!user) {
            throw new Error("User belonging to this token no longer exists");
        }
        if (user.line && user.line.status !== 1) {
            throw new Error("Unauthorized line accessed");
        }
        request.user = user;
        // ── Super-admin HR impersonation (imp:true tokens) ────────────────────
        // Every write stamps the request's `userId` into a User foreign-key column
        // (audit logs, created rows). The impersonating browser session sends a
        // stale/account-level userId, so those writes hit a foreign-key violation
        // and the whole request 500s — this is why EVERY HR action failed under
        // "Manage HR". Fix it once, here: overwrite `userId` with the impersonation
        // account's real User id, resolved server-side. This covers every endpoint
        // and never depends on what the client sent. Writes only — a GET may use
        // `userId` as a filter, so reads are left untouched.
        if (decoded.imp === true &&
            ((_a = user.User) === null || _a === void 0 ? void 0 : _a.id) &&
            request.method !== "GET" &&
            request.method !== "HEAD") {
            const actorUserId = user.User.id;
            if (request.body && typeof request.body === "object") {
                request.body.userId = actorUserId;
            }
            if (request.query && typeof request.query === "object") {
                request.query.userId = actorUserId;
            }
        }
        return; // Success - continue to route handler
    }
    catch (error) {
        console.log(error);
        reply.code(401).send({
            error: "Unauthorized",
            message: error instanceof Error ? error.message : "Authentication failed",
        });
    }
});
exports.authenticated = authenticated;
/**
 * Gate the MOBILE-only pharmacy endpoints (scan-log, add-stock/bulk, sync).
 * Runs AFTER `authenticated` (which set request.user = { id: <accountId> }).
 * The caller must have a PharmacyMobileAccess row for their (line, user), else
 * 403 — this is what stops an ungranted mobile user from modifying medicine
 * data. Web endpoints are NOT gated with this (they share some routes).
 */
const pharmacyMobileAuth = (request, reply) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d;
    try {
        const accountId = (_a = request.user) === null || _a === void 0 ? void 0 : _a.id;
        if (!accountId) {
            return reply.code(401).send({ error: "Unauthorized" });
        }
        const account = yield prisma_2.prisma.account.findUnique({
            where: { id: accountId },
            select: { lineId: true, User: { select: { id: true } } },
        });
        const lineId = (_b = account === null || account === void 0 ? void 0 : account.lineId) !== null && _b !== void 0 ? _b : null;
        const userId = (_d = (_c = account === null || account === void 0 ? void 0 : account.User) === null || _c === void 0 ? void 0 : _c.id) !== null && _d !== void 0 ? _d : null;
        if (!lineId || !userId) {
            return reply.code(403).send({
                error: "NO_PHARMACY_ACCESS",
                message: "You don't have mobile pharmacy access.",
            });
        }
        const access = yield prisma_2.prisma.pharmacyMobileAccess.findUnique({
            where: { lineId_userId: { lineId, userId } },
            select: { id: true },
        });
        if (!access) {
            return reply.code(403).send({
                error: "NO_PHARMACY_ACCESS",
                message: "You don't have mobile pharmacy access. Ask your pharmacy admin to grant it in Medicine > Config > Mobile Access.",
            });
        }
        return;
    }
    catch (error) {
        return reply.code(403).send({
            error: "NO_PHARMACY_ACCESS",
            message: "Pharmacy access check failed.",
        });
    }
});
exports.pharmacyMobileAuth = pharmacyMobileAuth;
/**
 * Mobile document-scanner gate — mirror of `pharmacyMobileAuth`. The caller
 * must have a DocumentMobileAccess row for their (line, user), else 403. This
 * is what stops an ungranted mobile user from reading or writing the document
 * receiving registry. Granted in the web under Documents → Mobile Access.
 */
const documentMobileAuth = (request, reply) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d, _e, _f;
    try {
        const accountId = (_a = request.user) === null || _a === void 0 ? void 0 : _a.id;
        if (!accountId) {
            return reply.code(401).send({ error: "Unauthorized" });
        }
        const account = yield prisma_2.prisma.account.findUnique({
            where: { id: accountId },
            select: { lineId: true, User: { select: { id: true, lineId: true } } },
        });
        const lineId = (_d = (_b = account === null || account === void 0 ? void 0 : account.lineId) !== null && _b !== void 0 ? _b : (_c = account === null || account === void 0 ? void 0 : account.User) === null || _c === void 0 ? void 0 : _c.lineId) !== null && _d !== void 0 ? _d : null;
        const userId = (_f = (_e = account === null || account === void 0 ? void 0 : account.User) === null || _e === void 0 ? void 0 : _e.id) !== null && _f !== void 0 ? _f : null;
        if (!lineId || !userId) {
            return reply.code(403).send({
                error: "NO_DOCUMENT_ACCESS",
                message: "You don't have mobile document-scanner access.",
            });
        }
        const access = yield prisma_2.prisma.documentMobileAccess.findUnique({
            where: { lineId_userId: { lineId, userId } },
            select: { id: true },
        });
        if (!access) {
            return reply.code(403).send({
                error: "NO_DOCUMENT_ACCESS",
                message: "You don't have mobile document-scanner access. Ask your admin to grant it in Documents > Mobile Access.",
            });
        }
        return;
    }
    catch (error) {
        return reply.code(403).send({
            error: "NO_DOCUMENT_ACCESS",
            message: "Document access check failed.",
        });
    }
});
exports.documentMobileAuth = documentMobileAuth;
/**
 * Mobile attendance-scanner gate. Unlike the pharmacy/document gates this one
 * has three ways through, because "HR or an allowed user may scan":
 *   1. a super-admin,
 *   2. the line's HRMO (the HR officer owns attendance by definition), or
 *   3. an explicit AttendanceMobileAccess grant.
 * Everyone else gets 403 so a rank-and-file employee can't record attendance
 * for other people.
 */
const attendanceMobileAuth = (request, reply) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j;
    const deny = () => reply.code(403).send({
        error: "NO_ATTENDANCE_ACCESS",
        message: "You're not allowed to record attendance. Ask HR to grant it in Human Resources > Attendance > Scanner Access.",
    });
    try {
        const accountId = (_a = request.user) === null || _a === void 0 ? void 0 : _a.id;
        if (!accountId)
            return reply.code(401).send({ error: "Unauthorized" });
        const account = yield prisma_2.prisma.account.findUnique({
            where: { id: accountId },
            select: {
                lineId: true,
                User: {
                    select: {
                        id: true,
                        lineId: true,
                        privilege: { select: { super: true } },
                        hrmoLin: { select: { id: true } },
                    },
                },
            },
        });
        const lineId = (_d = (_b = account === null || account === void 0 ? void 0 : account.lineId) !== null && _b !== void 0 ? _b : (_c = account === null || account === void 0 ? void 0 : account.User) === null || _c === void 0 ? void 0 : _c.lineId) !== null && _d !== void 0 ? _d : null;
        const userId = (_f = (_e = account === null || account === void 0 ? void 0 : account.User) === null || _e === void 0 ? void 0 : _e.id) !== null && _f !== void 0 ? _f : null;
        if (!lineId || !userId)
            return deny();
        if ((_h = (_g = account === null || account === void 0 ? void 0 : account.User) === null || _g === void 0 ? void 0 : _g.privilege) === null || _h === void 0 ? void 0 : _h.super)
            return;
        if ((_j = account === null || account === void 0 ? void 0 : account.User) === null || _j === void 0 ? void 0 : _j.hrmoLin)
            return;
        const access = yield prisma_2.prisma.attendanceMobileAccess.findUnique({
            where: { lineId_userId: { lineId, userId } },
            select: { id: true },
        });
        if (!access)
            return deny();
        return;
    }
    catch (error) {
        return deny();
    }
});
exports.attendanceMobileAuth = attendanceMobileAuth;
const medicineAccessAuth = (request, reply) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const params = request.query;
        if (!params.unitId || !params.userId) {
            throw new errors_1.ValidationError("BAD_REQUEST");
        }
        const [user, access] = yield prisma_2.prisma.$transaction([
            prisma_2.prisma.user.findUnique({
                where: {
                    id: params.userId,
                },
            }),
            prisma_2.prisma.medicineStorageAccess.findFirst({
                where: {
                    userId: params.userId,
                    medicineStorageId: params.storateId,
                },
            }),
        ]);
        if (!user) {
            throw new errors_1.ValidationError("USER_NOT_FOUND");
        }
        if (!access) {
            throw new errors_1.ValidationError("USER_UNAUTHORIZED");
        }
        return;
    }
    catch (error) {
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw new errors_1.AppError("DB_CONNECTION_EROR", 500, "DB_FAILED");
        }
        throw error;
    }
});
exports.medicineAccessAuth = medicineAccessAuth;
const generatedBoxCode = () => __awaiter(void 0, void 0, void 0, function* () {
    let isUnique = false;
    const generated = Math.floor(100000 + Math.random() * 900000);
    while (!isUnique) {
        const check = yield prisma_2.prisma.inventoryBox.findUnique({
            where: {
                code: generated,
            },
        });
        if (!check)
            isUnique = true;
    }
    return generated;
});
exports.generatedBoxCode = generatedBoxCode;
const viewContainerAuth = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const params = req.query;
        if (!params.id || !params.userId) {
            return res.code(400).send({ message: "Bad Request" });
        }
        const check = yield prisma_2.prisma.containerAllowedUser.findFirst({
            where: {
                userId: params.userId,
                id: params.id,
            },
        });
        if (!check) {
            throw new Error("Unauthorized");
        }
        return;
    }
    catch (error) {
        console.log(error);
        res.code(401).send({
            error: "Unauthorized",
            message: error instanceof Error ? error.message : "Authentication failed",
        });
    }
});
exports.viewContainerAuth = viewContainerAuth;
const generatedItemCode = () => __awaiter(void 0, void 0, void 0, function* () {
    let isUnique = false;
    const generated = Math.floor(100000 + Math.random() * 900000);
    while (!isUnique) {
        const check = yield prisma_2.prisma.supplies.findFirst({
            where: {
                quantity: generated,
            },
        });
        if (!check)
            isUnique = true;
    }
    return generated;
});
exports.generatedItemCode = generatedItemCode;
function generateSecureRef(len) {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    let result = "";
    for (let i = 0; i < len; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}
// NOTE for all ref generators below: the candidate MUST be regenerated
// INSIDE the retry loop. The old shape computed it once, so a collision
// re-checked the same value forever — hanging the request until timeout.
const generateOrderRef = () => __awaiter(void 0, void 0, void 0, function* () {
    for (;;) {
        const generated = generateSecureRef(12);
        const check = yield prisma_2.prisma.supplyBatchOrder.findFirst({
            where: {
                refNumber: generated,
            },
        });
        if (!check)
            return generated;
    }
});
exports.generateOrderRef = generateOrderRef;
const generateItemRef = () => __awaiter(void 0, void 0, void 0, function* () {
    for (;;) {
        const generated = generateSecureRef(12);
        const check = yield prisma_2.prisma.supplyOrder.findFirst({
            where: {
                refNumber: generated,
            },
        });
        if (!check)
            return generated;
    }
});
exports.generateItemRef = generateItemRef;
const generatedInvitationCode = () => __awaiter(void 0, void 0, void 0, function* () {
    // 6-digit code — collisions are realistic at scale, so regeneration
    // inside the loop matters here most of all.
    for (;;) {
        const generated = Math.floor(100000 + Math.random() * 900000);
        const check = yield prisma_2.prisma.invitationLink.findFirst({
            where: {
                code: generated.toString(),
            },
        });
        if (!check)
            return generated;
    }
});
exports.generatedInvitationCode = generatedInvitationCode;
const generateStorageRef = () => __awaiter(void 0, void 0, void 0, function* () {
    for (;;) {
        const generated = generateSecureRef(12);
        const check = yield prisma_2.prisma.medicineStorage.findFirst({
            where: {
                refNumber: generated,
            },
        });
        if (!check)
            return generated;
    }
});
exports.generateStorageRef = generateStorageRef;
const generateMedRef = () => __awaiter(void 0, void 0, void 0, function* () {
    for (;;) {
        const generated = generateSecureRef(12);
        const check = yield prisma_2.prisma.medicine.findFirst({
            where: {
                serialNumber: generated,
            },
        });
        if (!check)
            return generated;
    }
});
exports.generateMedRef = generateMedRef;
const generatePrescriptionRef = () => __awaiter(void 0, void 0, void 0, function* () {
    let isUnique = false;
    const generated = generateSecureRef(6);
    while (!isUnique) {
        const check = yield prisma_2.prisma.prescription.findFirst({
            where: {
                refNumber: generated,
            },
        });
        if (!check)
            isUnique = true;
    }
    return generated;
});
exports.generatePrescriptionRef = generatePrescriptionRef;
const generateDispenseRef = () => __awaiter(void 0, void 0, void 0, function* () {
    while (true) {
        const generated = `DSP-${generateSecureRef(8)}`;
        const check = yield prisma_2.prisma.supplyDispenseRecord.findFirst({
            where: { refCode: generated },
        });
        if (!check)
            return generated;
    }
});
exports.generateDispenseRef = generateDispenseRef;
const sendEmail = (sub, to, text, title) => __awaiter(void 0, void 0, void 0, function* () {
    // `title` is meant to be a display name only. Some callers historically pass
    // a full "Name <email>" string — strip any embedded address so we never emit
    // a doubly-bracketed, invalid `from` header (which Resend rejects → 500).
    const displayName = (title || "").replace(/<[^>]*>/g, "").replace(/[<>"]/g, "").trim() ||
        "HR Team";
    const from = `${displayName} <${RESEND_FROM}>`;
    // Primary: Resend (when RESEND_API_KEY is configured). Sender is the HR email
    // (RESEND_FROM) with replies routed to the HR mailbox.
    if (resend) {
        try {
            const { data, error } = yield resend.emails.send({
                from,
                to: [to],
                subject: sub,
                text,
                replyTo: HR_EMAIL,
            });
            if (error)
                throw error;
            console.log("Email sent via Resend! id:", data === null || data === void 0 ? void 0 : data.id);
            return "OK";
        }
        catch (error) {
            console.log("Resend email error:", error);
            throw error;
        }
    }
    // Fallback: nodemailer (Gmail) until RESEND_API_KEY is set, so mail keeps
    // working during the switchover.
    try {
        const transporter = nodemailer_1.default.createTransport({
            service: "gmail",
            auth: {
                user: HR_EMAIL,
                pass: process.env.EMAIL_PASSWORD || "gkms netq czuf llew",
            },
        });
        const response = yield transporter.sendMail({
            subject: sub,
            from,
            to,
            text,
        });
        console.log("Email sent (nodemailer)! Message ID:", response.messageId);
        return "OK";
    }
    catch (error) {
        console.log("Email error:", error);
        throw error;
    }
});
exports.sendEmail = sendEmail;
const generateOTPCode = () => __awaiter(void 0, void 0, void 0, function* () {
    let isUnique = false;
    const generated = Math.floor(100000 + Math.random() * 900000);
    while (!isUnique) {
        const check = yield prisma_2.prisma.otpVerification.findFirst({
            where: {
                code: generated,
            },
        });
        if (!check)
            isUnique = true;
    }
    return generated;
});
exports.generateOTPCode = generateOTPCode;
const getAreaData = (code, area) => __awaiter(void 0, void 0, void 0, function* () {
    console.log({ code, area });
    const areas = [
        `https://psgc.gitlab.io/api/provinces/${code}/`,
        `https://psgc.gitlab.io/api/municipalities/${code}/`,
        `https://psgc.gitlab.io/api/barangays/${code}/`,
        `https://psgc.gitlab.io/api/regions/${code}/`,
    ];
    try {
        const response = yield fetch(areas[area]);
        if (!response.ok) {
            console.warn(`Failed to fetch area data for code ${code}, area ${area}: Status ${response.status}`);
            return null;
        }
        const data = yield response.json();
        return data;
    }
    catch (error) {
        console.error(`Error fetching area data for code ${code}, area ${area}:`, error);
        return null;
    }
});
exports.getAreaData = getAreaData;
const phNumberFormat = (number) => {
    // Remove all non-digit characters except plus sign
    let cleaned = number.replace(/[^\d+]/g, "").trim();
    // If empty after cleaning, return empty string
    if (!cleaned)
        return "";
    // Check if starts with +63 (e.g., +639304320169)
    if (cleaned.startsWith("+63")) {
        // Remove +63 and add 0 at the beginning
        return "0" + cleaned.slice(3);
    }
    // Check if starts with 63 (e.g., 639304320169)
    if (cleaned.startsWith("63")) {
        // Remove 63 and add 0 at the beginning
        return "0" + cleaned.slice(2);
    }
    // Check if already starts with 0 (e.g., 09304320169)
    if (cleaned.startsWith("0")) {
        return cleaned;
    }
    // Check if it's a 10-digit number without prefix (e.g., 9304320169)
    if (cleaned.length === 10 && !cleaned.startsWith("0")) {
        return "0" + cleaned;
    }
    // If none of the above, return as is (or handle other cases)
    return cleaned;
};
exports.phNumberFormat = phNumberFormat;
exports.lineStatus = ["Suspended", "Active", "Maintainance"];
