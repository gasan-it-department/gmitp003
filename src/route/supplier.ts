import { authenticated } from "../middleware/handler";
import { FastifyInstance } from "../barrel/fastify";
import { getSuppliers } from "../controller/supplierController";
export const supplier = (fastify: FastifyInstance) => {
  fastify.get("/suppliers", { preHandler: authenticated }, getSuppliers);
};
