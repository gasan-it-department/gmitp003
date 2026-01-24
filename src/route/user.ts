import { FastifyInstance } from "../barrel/fastify";
import { authenticated } from "../middleware/handler";

//
import { searchUsers, users, getUserInfo } from "../controller/userController";

export const user = (fastify: FastifyInstance) => {
  fastify.get("/users", { preHandler: [authenticated] }, users);
  fastify.get("/users/search", searchUsers);
  fastify.get("/user/data", { preHandler: authenticated }, getUserInfo);
};
