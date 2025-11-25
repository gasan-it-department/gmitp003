import { FastifyInstance } from "../barrel/fastify";
import { getRegions } from "../controller/region";
//handler
import { authenticated } from "../middleware/handler";
//controller
import { regionController } from "../controller/region";

import { regionListSchema } from "../models/request";
import { provinces } from "../controller/provinceController";
import { municipalities } from "../controller/municipalController";
import { barangays } from "../controller/barangayController";
export const area = (fastify: FastifyInstance) => {
  fastify.get(
    "/region",
    { preHandler: authenticated, schema: regionListSchema },
    regionController
  );
  fastify.get("/all-regions", getRegions);
  fastify.get("/provinces", { preHandler: authenticated }, provinces);
  fastify.get("/municipalities", { preHandler: authenticated }, municipalities);
  fastify.get("/barangays", { preHandler: authenticated }, barangays);
};
