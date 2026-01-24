import { FastifyInstance } from "../barrel/fastify";
import { authenticated } from "../middleware/handler";
import {
  overall,
  humanResourcesOverall,
} from "../controller/dashboardController";
export const dashboard = async (fastify: FastifyInstance) => {
  fastify.get("/overall", { preHandler: authenticated }, overall);
  fastify.get(
    "/dashboard/human-resources",
    { preHandler: authenticated },
    humanResourcesOverall
  );
};
