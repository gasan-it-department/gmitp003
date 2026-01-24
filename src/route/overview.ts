import { FastifyInstance } from "../barrel/fastify";
import { authenticated } from "../middleware/handler";

import {
  supplyOverview,
  supplyOverviewStatus,
} from "../controller/supplyOverviewController";

export const overview = (fastify: FastifyInstance) => {
  fastify.get(
    "/supply-overview",
    { preHandler: authenticated },
    supplyOverview
  );
  fastify.get(
    "/supply/overview/status",
    { preHandler: authenticated },
    supplyOverviewStatus
  );
};
