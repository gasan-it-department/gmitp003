import { FastifyInstance } from "../barrel/fastify";
import { authenticated } from "../middleware/handler";
import { controllerListSchema } from "../models/request";
import {
  accountList,
  sendResetPasswordLink,
  resetUserPassword,
} from "../controller/accountController";
export const accounts = (fastify: FastifyInstance) => {
  fastify.get(
    "/accounts",
    {
      preHandler: authenticated,
      schema: controllerListSchema,
    },
    accountList
  );
  fastify.post(
    "/account/send-reset-link",
    { preHandler: authenticated },
    sendResetPasswordLink
  );
  fastify.patch("/account/user/reset-password", resetUserPassword);
};
