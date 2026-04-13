"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.otp = void 0;
const otpController_1 = require("../controller/otpController");
const otp = (fastify) => {
    fastify.get("/otp/send-via/email", otpController_1.sendOtpViaEmail);
    fastify.get("/otp/send-via/phone-number", otpController_1.sendOtpViaEmail);
    fastify.post("/otp/verify/email", otpController_1.verifyOTPCode);
};
exports.otp = otp;
