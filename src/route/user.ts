import { FastifyInstance } from "../barrel/fastify";
import { authenticated } from "../middleware/handler";

//
import { users } from "../controller/userController";

export const user = (fastify: FastifyInstance) => {
  fastify.get("/users", { preHandler: [authenticated] }, users);
};
