import { FastifyInstance } from "../barrel/fastify";
import { createLine } from "../controller/lineController";
import { authenticated } from "../middleware/handler";
import { getLines } from "../controller/lineController";
export const lineRoutes = async (fastify: FastifyInstance) => {
  fastify.post("/create-line", createLine);
  fastify.get("/lines", getLines);
};
