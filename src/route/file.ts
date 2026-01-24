import { FastifyInstance } from "../barrel/fastify";
import {
  itemExcelFile,
  dataSetSupplies,
  exportSupplyExcel,
  importUserSupplyRsiExcel,
  importUnitSupplyRsiExcel,
} from "../controller/fileControllert";
import { authenticated } from "../middleware/handler";
export const file = (fastify: FastifyInstance) => {
  fastify.post("/add-supply-excel", itemExcelFile);
  fastify.post(
    "/data-set-supplies-excel",
    // { preHandler: authenticated },
    dataSetSupplies
  );
  fastify.get(
    "/supply/excel",
    { preHandler: authenticated },
    exportSupplyExcel
  );
  fastify.post(
    "/supply/excel-ris",
    { preHandler: authenticated },
    importUserSupplyRsiExcel
  );
  fastify.post(
    "/supply/excel-ris/unit",
    { preHandler: authenticated },
    importUnitSupplyRsiExcel
  );
};
