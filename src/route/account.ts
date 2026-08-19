import { FastifyInstance } from "../barrel/fastify";
import { authenticated } from "../middleware/handler";
import { controllerListSchema } from "../models/request";
import {
  accountList,
  sendResetPasswordLink,
  resetUserPassword,
  forgotPassword,
  adminSetAccountStatus,
  adminDeleteAccount,
} from "../controller/accountController";
import { selfDeleteAccount } from "../controller/accountSelfDeleteController";
export const accounts = (fastify: FastifyInstance) => {
  fastify.get(
    "/accounts",

    accountList,
  );
  fastify.post(
    "/account/send-reset-link",
    { preHandler: authenticated },
    sendResetPasswordLink,
  );
  fastify.patch("/account/user/reset-password", resetUserPassword);
  // PUBLIC — logged-out "forgot password" from the login page. Keyed by
  // username; emails a one-time reset link to the account's on-file email.
  fastify.post("/account/forgot-password", forgotPassword);
  // Admin-panel account management (open, like /accounts).
  fastify.patch("/account/status", adminSetAccountStatus);
  fastify.delete("/account/delete", adminDeleteAccount);
  // Self-service deletion, required by App Store Review 5.1.1(v). Distinct
  // from the admin route above: it acts on the CALLER's own account and
  // re-checks their password first.
  fastify.post(
    "/account/self-delete",
    { preHandler: authenticated },
    selfDeleteAccount,
  );
};
