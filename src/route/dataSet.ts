import { FastifyInstance } from "../barrel/fastify";
import { authenticated } from "../middleware/handler";
import {
  createDateSet,
  dataSetList,
  dataSetSupplies,
  dateSetData,
  deleteDataSet,
} from "../controller/dataSetController";
import { newDataSetSchema } from "../models/request";
export const dataSet = (fastify: FastifyInstance) => {
  fastify.post(
    "/create-data-set",
    { preHandler: authenticated, schema: newDataSetSchema },
    createDateSet
  );
  fastify.get("/data-set-list", dataSetList);
  fastify.get("/data-set-info", { preHandler: authenticated }, dateSetData);
  fastify.get(
    "/data-set-supplies",
    { preHandler: authenticated },
    dataSetSupplies
  );
  fastify.delete(
    "/delete-data-set",
    { preHandler: authenticated },
    deleteDataSet
  );
};
