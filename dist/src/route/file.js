"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.file = void 0;
const fileControllert_1 = require("../controller/fileControllert");
const handler_1 = require("../middleware/handler");
const file = (fastify) => {
    fastify.post("/add-supply-excel", fileControllert_1.itemExcelFile);
    fastify.post("/data-set-supplies-excel", 
    // { preHandler: authenticated },
    fileControllert_1.dataSetSupplies);
    fastify.get("/supply/excel", { preHandler: handler_1.authenticated }, fileControllert_1.exportSupplyExcel);
    fastify.post("/supply/excel-ris", { preHandler: handler_1.authenticated }, fileControllert_1.importUserSupplyRsiExcel);
    fastify.post("/supply/excel-ris/unit", { preHandler: handler_1.authenticated }, fileControllert_1.importUnitSupplyRsiExcel);
};
exports.file = file;
