import { FastifyInstance } from "../barrel/fastify";
import { itemExcelFile, dataSetSupplies } from "../controller/fileControllert";
import { authenticated } from "../middleware/handler";
export const file = (fastify: FastifyInstance) => {
  fastify.post("/add-supply-excel", itemExcelFile);
  fastify.post(
    "/data-set-supplies-excel",
    // { preHandler: authenticated },
    dataSetSupplies
  );
};
