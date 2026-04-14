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
exports.lineStatus = exports.phNumberFormat = exports.getAreaData = exports.generateOTPCode = exports.sendEmail = exports.generatePrescriptionRef = exports.generateMedRef = exports.generateStorageRef = exports.generatedInvitationCode = exports.generateItemRef = exports.generateOrderRef = exports.generatedItemCode = exports.viewContainerAuth = exports.generatedBoxCode = exports.medicineAccessAuth = exports.authenticated = exports.adminAuthenticated = exports.tempAuthenticated = void 0;
const prisma_1 = require("../barrel/prisma");
const prisma_2 = require("../barrel/prisma");
const errors_1 = require("../errors/errors");
const nodemailer_1 = __importDefault(require("nodemailer"));
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
const authenticated = (request, reply) => __awaiter(void 0, void 0, void 0, function* () {
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
            },
        });
        if (!user) {
            throw new Error("User belonging to this token no longer exists");
        }
        if (user.line && user.line.status !== 1) {
            throw new Error("Unauthorized line accessed");
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
exports.authenticated = authenticated;
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
const generateOrderRef = () => __awaiter(void 0, void 0, void 0, function* () {
    let isUnique = false;
    const generated = generateSecureRef(12);
    while (!isUnique) {
        const check = yield prisma_2.prisma.supplyBatchOrder.findFirst({
            where: {
                refNumber: generated,
            },
        });
        if (!check)
            isUnique = true;
    }
    return generated;
});
exports.generateOrderRef = generateOrderRef;
const generateItemRef = () => __awaiter(void 0, void 0, void 0, function* () {
    let isUnique = false;
    const generated = generateSecureRef(12);
    while (!isUnique) {
        const check = yield prisma_2.prisma.supplyOrder.findFirst({
            where: {
                refNumber: generated,
            },
        });
        if (!check)
            isUnique = true;
    }
    return generated;
});
exports.generateItemRef = generateItemRef;
const generatedInvitationCode = () => __awaiter(void 0, void 0, void 0, function* () {
    let isUnique = false;
    const generated = Math.floor(100000 + Math.random() * 900000);
    while (!isUnique) {
        const check = yield prisma_2.prisma.invitationLink.findFirst({
            where: {
                code: generated.toString(),
            },
        });
        if (!check)
            isUnique = true;
    }
    return generated;
});
exports.generatedInvitationCode = generatedInvitationCode;
const generateStorageRef = () => __awaiter(void 0, void 0, void 0, function* () {
    let isUnique = false;
    const generated = generateSecureRef(12);
    while (!isUnique) {
        const check = yield prisma_2.prisma.medicineStorage.findUnique({
            where: {
                refNumber: generated,
            },
        });
        if (!check)
            isUnique = true;
    }
    return generated;
});
exports.generateStorageRef = generateStorageRef;
const generateMedRef = () => __awaiter(void 0, void 0, void 0, function* () {
    let isUnique = false;
    const generated = generateSecureRef(12);
    while (!isUnique) {
        const check = yield prisma_2.prisma.medicine.findFirst({
            where: {
                serialNumber: generated,
            },
        });
        if (!check)
            isUnique = true;
    }
    return generated;
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
const sendEmail = (sub, to, text, title) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        console.log({ sub, text, to, title });
        const transporter = nodemailer_1.default.createTransport({
            service: "gmail", // ✅ Correct - just "gmail"
            auth: {
                user: "officeofthemayor.gasan@gmail.com",
                pass: "gkms netq czuf llew", // Make sure this is an App Password
            },
        });
        const response = yield transporter.sendMail({
            subject: sub,
            from: `"${title}" <officeofthemayor.gasan@gmail.com>`,
            to: to,
            text: text,
        });
        console.log("Email sent successfully! Message ID:", response.messageId);
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
