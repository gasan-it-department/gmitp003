import { FastifyInstance } from "../barrel/fastify";
import { authenticated } from "../middleware/handler";
import { unitOfMeasures } from "../controller/qualityControl";
export const quality = (fastify: FastifyInstance) => {
  fastify.get("/supply-quality", { preHandler: authenticated }, unitOfMeasures);
};
