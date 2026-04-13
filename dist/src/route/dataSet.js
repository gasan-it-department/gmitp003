"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.dataSet = void 0;
const handler_1 = require("../middleware/handler");
const dataSetController_1 = require("../controller/dataSetController");
const dataSet = (fastify) => {
    fastify.post("/create-data-set", { preHandler: handler_1.authenticated }, dataSetController_1.createDateSet);
    fastify.get("/data-set-list", dataSetController_1.dataSetList);
    fastify.get("/data-set-info", { preHandler: handler_1.authenticated }, dataSetController_1.dateSetData);
    fastify.get("/data-set-supplies", { preHandler: handler_1.authenticated }, dataSetController_1.dataSetSupplies);
    fastify.delete("/delete-data-set", { preHandler: handler_1.authenticated }, dataSetController_1.deleteDataSet);
};
exports.dataSet = dataSet;
