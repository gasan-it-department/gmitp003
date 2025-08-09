import { FastifyInstance } from "../barrel/fastify";
import { authenticated } from "../middleware/handler";
import { addNewSupplySchema, deleteSupplySchema } from "../models/request";
import {
  deleteSupply,
  addSupply,
  updateSupply,
} from "../controller/supplyController";

export const supply = (fastify: FastifyInstance) => {
  fastify.post("/add-supply", { schema: addNewSupplySchema }, addSupply);
  fastify.delete(
    "/delete-supply",
    { preHandler: authenticated, schema: deleteSupplySchema },
    deleteSupply
  );
  fastify.post("/update-supply", { preHandler: authenticated }, updateSupply);
};
