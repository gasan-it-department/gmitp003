import { FastifyInstance } from "../barrel/fastify";
import { authenticated } from "../middleware/handler";
import { controllerListSchema } from "../models/request";
import { accountList } from "../controller/accountController";
export const accounts = (fastify: FastifyInstance) => {
  fastify.get(
    "/accounts",
    {
      preHandler: authenticated,
      schema: controllerListSchema,
    },
    accountList
  );
};
