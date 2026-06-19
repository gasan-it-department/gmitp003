import { FastifyInstance } from "../barrel/fastify";
import { authenticated } from "../middleware/handler";
import { controllerListSchema } from "../models/request";
import {
  accountList,
  sendResetPasswordLink,
  resetUserPassword,
  adminSetAccountStatus,
  adminDeleteAccount,
} from "../controller/accountController";
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
  // Admin-panel account management (open, like /accounts).
  fastify.patch("/account/status", adminSetAccountStatus);
  fastify.delete("/account/delete", adminDeleteAccount);
};
