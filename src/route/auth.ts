import { FastifyInstance } from "../barrel/fastify";
import { authSchema, registerSchema } from "../models/request";
//handlers
import { authenticated } from "../middleware/handler";

//constroller
import {
  authController,
  registerController,
  sessionLine,
} from "../controller/authController";
export async function auth(fastify: FastifyInstance) {
  fastify.post("/auth", { schema: authSchema }, authController);
  fastify.post("/register", registerController);
  // Which line does this session belong to? (root-page redirect)
  fastify.get("/auth/session-line", { preHandler: authenticated }, sessionLine);
}
