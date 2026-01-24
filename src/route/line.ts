import { FastifyInstance } from "../barrel/fastify";
import { createLine } from "../controller/lineController";
import { adminAuthenticated } from "../middleware/handler";
import { getLines, getAllLine } from "../controller/lineController";
export const lineRoutes = async (fastify: FastifyInstance) => {
  fastify.post("/create-line", { preHandler: adminAuthenticated }, createLine);
  fastify.get("/lines", getLines);
  fastify.get("/line/list", { preHandler: adminAuthenticated }, getAllLine);
};
