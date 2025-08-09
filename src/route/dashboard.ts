import { FastifyInstance } from "../barrel/fastify";
import { authenticated } from "../middleware/handler";
import { overall } from "../controller/dashboardController";
export const dashboard = async (fastify: FastifyInstance) => {
  fastify.get("/overall", { preHandler: authenticated }, overall);
};
