import { FastifyInstance } from "../barrel/fastify";

//handler
import { authenticated } from "../middleware/handler";
//controller
import { regionController } from "../controller/region";

import { regionListSchema } from "../models/request";
export const area = (fastify: FastifyInstance) => {
  fastify.get(
    "/region",
    { preHandler: authenticated, schema: regionListSchema },
    regionController
  );
};
