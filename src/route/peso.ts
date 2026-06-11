import { FastifyInstance } from "../barrel/fastify";

import { authenticated } from "../middleware/handler";

import {
  createPesoJob,
  updatePesoJob,
  pesoJobList,
  pesoJobData,
} from "../controller/pesoController";

export const peso = (fastify: FastifyInstance) => {
  fastify.post("/peso/job/create", { preHandler: authenticated }, createPesoJob);
  fastify.patch("/peso/job/update", { preHandler: authenticated }, updatePesoJob);
  fastify.get("/peso/job/list", { preHandler: authenticated }, pesoJobList);
  fastify.get("/peso/job/data", { preHandler: authenticated }, pesoJobData);
};
