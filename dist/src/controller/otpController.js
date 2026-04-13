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
exports.verifyOTPCode = exports.sendOTPViaPhneNumber = exports.sendOtpViaEmail = void 0;
const prisma_1 = require("../barrel/prisma");
const errors_1 = require("../errors/errors");
const handler_1 = require("../middleware/handler");
const encryption_1 = require("../service/encryption");
const sendOtpViaEmail = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    const body = req.query;
    console.log({ body });
    if (!body.applicationId) {
        throw new errors_1.ValidationError("Application ID is required");
    }
    try {
        // Find the application
        const application = yield prisma_1.prisma.submittedApplication.findUnique({
            where: {
                id: body.applicationId,
            },
            include: {
                forPosition: {
                    select: {
                        name: true,
                    },
                },
            },
        });
        if (!application) {
            throw new errors_1.NotFoundError("Application not found");
        }
        // Decrypt email
        const email = application.emailIv
            ? yield encryption_1.EncryptionService.decrypt(application.email, application.emailIv)
            : undefined;
        if (!email) {
            throw new errors_1.ValidationError("Failed to retrieve applicant email");
        }
        // Generate OTP code
        const code = yield (0, handler_1.generateOTPCode)();
        if (!code) {
            throw new errors_1.ValidationError("Failed to generate OTP code");
        }
        yield prisma_1.prisma.otpVerification.create({
            data: {
                submittedApplicationId: application.id,
                code: code,
                status: 0,
            },
        });
        // Prepare email content
        const applicantName = `${application.firstname} ${application.lastname}`;
        const positionName = ((_a = application.forPosition) === null || _a === void 0 ? void 0 : _a.name) || "the position";
        const emailSubject = `Your Verification Code - Application for ${positionName}`;
        const emailText = `
Application Verification Code

Dear ${applicantName},

Thank you for applying for the ${positionName} position.

To continue with your application process, please use the following One-Time Password (OTP):

${code}

Important: This code will expire in 10 minutes. Do not share this code with anyone.

If you did not request this verification code, please ignore this email.

Best regards,
HR Department

This is an automated message. Please do not reply to this email.
    `;
        // Send email
        yield (0, handler_1.sendEmail)("OTP", email, emailText, emailSubject);
        // Log the OTP send event (optional)
        return res.code(200).send({
            message: "Verification code sent successfully",
            expiresIn: "10 minutes",
        });
    }
    catch (error) {
        // Log the error
        console.error("OTP sending failed:", error);
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw new errors_1.AppError("Database connection failed", 500, "DB_ERROR");
        }
        if (error instanceof errors_1.ValidationError || error instanceof errors_1.NotFoundError) {
            throw error;
        }
        throw new errors_1.AppError("Failed to send verification code", 500, "EMAIL_SEND_FAILED");
    }
});
exports.sendOtpViaEmail = sendOtpViaEmail;
const sendOTPViaPhneNumber = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    const body = req.body;
    if (!body.applicationId) {
        throw new errors_1.ValidationError("Application ID is required");
    }
    try {
        // Find the application
        const application = yield prisma_1.prisma.submittedApplication.findUnique({
            where: {
                id: body.applicationId,
            },
            include: {
                forPosition: {
                    select: {
                        name: true,
                    },
                },
            },
        });
        if (!application) {
            throw new errors_1.NotFoundError("Application not found");
        }
        // Decrypt email
        const email = application.emailIv
            ? yield encryption_1.EncryptionService.decrypt(application.email, application.emailIv)
            : undefined;
        if (!email) {
            throw new errors_1.ValidationError("Failed to retrieve applicant email");
        }
        // Generate OTP code
        const code = yield (0, handler_1.generateOTPCode)();
        if (!code) {
            throw new errors_1.ValidationError("Failed to generate OTP code");
        }
        yield prisma_1.prisma.otpVerification.create({
            data: {
                submittedApplicationId: application.id,
                code: code,
            },
        });
        // Prepare email content
        const applicantName = `${application.firstname} ${application.lastname}`;
        const positionName = ((_a = application.forPosition) === null || _a === void 0 ? void 0 : _a.name) || "the position";
        const emailSubject = `Your Verification Code - Application for ${positionName}`;
        const emailText = `
Application Verification Code

Dear ${applicantName},

Thank you for applying for the ${positionName} position.

To continue with your application process, please use the following One-Time Password (OTP):

${code}

Important: This code will expire in 10 minutes. Do not share this code with anyone.

If you did not request this verification code, please ignore this email.

Best regards,
HR Department

This is an automated message. Please do not reply to this email.
    `;
        // Send email
        yield (0, handler_1.sendEmail)("OTP", email, emailText, emailSubject);
        // Log the OTP send event (optional)
        return res.code(200).send({
            message: "Verification code sent successfully",
            expiresIn: "10 minutes",
        });
    }
    catch (error) {
        // Log the error
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw new errors_1.AppError("Database connection failed", 500, "DB_ERROR");
        }
        if (error instanceof errors_1.ValidationError || error instanceof errors_1.NotFoundError) {
            throw error;
        }
        throw new errors_1.AppError("Failed to send verification code", 500, "EMAIL_SEND_FAILED");
    }
});
exports.sendOTPViaPhneNumber = sendOTPViaPhneNumber;
const verifyOTPCode = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const body = req.body;
    console.log({ body });
    if (!body.code || !body.applicationID)
        throw new errors_1.ValidationError("INVALID_REQUIRED_ID");
    try {
        const response = yield prisma_1.prisma.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            const otp = yield tx.otpVerification.findUnique({
                where: {
                    code: body.code,
                },
            });
            if (!otp)
                throw new errors_1.ValidationError("INVALID OTP CODE");
            console.log(otp);
            const token = yield res.jwtSign({
                id: body.code,
                username: body.applicationID,
            });
            yield tx.otpVerification.update({
                where: {
                    code: otp.code,
                },
                data: {
                    status: 1,
                },
            });
            return token;
        }));
        if (!response)
            throw new errors_1.ValidationError("FAILED_TO_GENERATE");
        return res.code(200).send({ message: "OK", token: response });
    }
    catch (error) {
        console.log("F", error);
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw new errors_1.AppError("Database connection failed", 500, "DB_ERROR");
        }
        if (error instanceof errors_1.ValidationError || error instanceof errors_1.NotFoundError) {
            throw error;
        }
        throw new errors_1.AppError("Failed to send verification code", 500, "EMAIL_SEND_FAILED");
    }
});
exports.verifyOTPCode = verifyOTPCode;
