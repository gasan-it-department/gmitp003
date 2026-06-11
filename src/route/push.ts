import { FastifyInstance } from "../barrel/fastify";
import { authenticated } from "../middleware/handler";
import {
  registerPushToken,
  unregisterPushToken,
} from "../controller/pushController";

export const push = (fastify: FastifyInstance) => {
  fastify.post(
    "/push/register",
    { preHandler: authenticated },
    registerPushToken,
  );
  fastify.post(
    "/push/unregister",
    { preHandler: authenticated },
    unregisterPushToken,
  );
};
