import { FastifyInstance } from "../barrel/fastify";
import { authenticated } from "../middleware/handler";
import { addNewSupplySchema, deleteSupplySchema } from "../models/request";
import {
  deleteSupply,
  addSupply,
  updateSupply,
  supplyList,
  timebaseSupplyReport,
  dispenseSupply,
  categories,
  supplyDispenseTransaction,
  supplyTimeBaseReport,
  removeStockInList,
  supplyTransactionInfo,
  userSupplyDispenseRecords,
  unitSupplyDispenseRecords,
} from "../controller/supplyController";

export const supply = (fastify: FastifyInstance) => {
  fastify.post("/add-supply", { schema: addNewSupplySchema }, addSupply);
  fastify.delete(
    "/delete-supply",
    { preHandler: authenticated, schema: deleteSupplySchema },
    deleteSupply
  );
  fastify.post("/update-supply", { preHandler: authenticated }, updateSupply);
  fastify.get("/supply-list", { preHandler: authenticated }, supplyList);
  fastify.get(
    "/supply-time-base",
    { preHandler: authenticated },
    timebaseSupplyReport
  );
  fastify.post(
    "/supply/dispense",
    { preHandler: authenticated },
    dispenseSupply
  );
  fastify.get("/supply/category", { preHandler: authenticated }, categories);
  fastify.get(
    "/supply/dispense/transactions",
    { preHandler: authenticated },
    supplyDispenseTransaction
  );
  fastify.get(
    "/supply/timebase",
    { preHandler: authenticated },
    supplyTimeBaseReport
  );
  fastify.delete(
    "/supply/delete-item",
    { preHandler: authenticated },
    removeStockInList
  );
  fastify.get(
    "/supply/dispense/transaction/info",
    { preHandler: authenticated },
    supplyTransactionInfo
  );
  fastify.get(
    "/supply/user/dispense/record",
    { preHandler: authenticated },
    userSupplyDispenseRecords
  );
  fastify.get(
    "/supply/unit/dispense/record",
    { preHandler: authenticated },
    unitSupplyDispenseRecords
  );
};
