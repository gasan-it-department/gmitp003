import { FastifyInstance } from "../barrel/fastify";
import { authenticated } from "../middleware/handler";
import { personnelList } from "../controller/personnelController";
import { personnelListSchema } from "../models/request";
export const personnel = (fastify: FastifyInstance) => {
  fastify.get(
    "/personnel",
    { preHandler: authenticated, schema: personnelListSchema },
    personnelList
  );
};
