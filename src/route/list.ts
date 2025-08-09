import { FastifyInstance } from "../barrel/fastify";

import { createList, list as listOflist } from "../controller/listController";
import { authenticated } from "../middleware/handler";

import { listSchema } from "../models/request";
export const list = (fastify: FastifyInstance) => {
  fastify.post(
    "/create-list",
    { preHandler: authenticated, schema: listSchema },
    createList
  );
  fastify.get("/list", listOflist);
};
