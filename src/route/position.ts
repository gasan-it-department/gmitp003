import { FastifyInstance } from "../barrel/fastify";
import { authenticated } from "../middleware/handler";
import { positionList, addPosition } from "../controller/positionController";
import { positionListSchema, addPostionSchema } from "../models/request";
export const position = (fastify: FastifyInstance) => {
  fastify.get(
    "/position",
    { preHandler: authenticated, schema: positionListSchema },
    positionList
  );
  fastify.post(
    "/add-position",
    { preHandler: authenticated, schema: addPostionSchema },
    addPosition
  );
};
