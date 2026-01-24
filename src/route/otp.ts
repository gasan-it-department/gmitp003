import { FastifyInstance } from "../barrel/fastify";
import { sendOtpViaEmail, verifyOTPCode } from "../controller/otpController";
export const otp = (fastify: FastifyInstance) => {
  fastify.get("/otp/send-via/email", sendOtpViaEmail);
  fastify.get("/otp/send-via/phone-number", sendOtpViaEmail);
  fastify.post("/otp/verify/email", verifyOTPCode);
};
