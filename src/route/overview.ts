import { FastifyInstance } from "../barrel/fastify";
import { authenticated } from "../middleware/handler";

import { supplyOverview } from "../controller/supplyOverviewController";

export const overview = (fastify: FastifyInstance) => {
  fastify.get(
    "/supply-overview",
    { preHandler: authenticated },
    supplyOverview
  );
};
