"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.inventory = void 0;
const inventory_1 = require("../controller/inventory");
const handler_1 = require("../middleware/handler");
const inventory_2 = require("../controller/inventory");
const inventory = (fastify) => {
    fastify.post("/create-inventory", { preHandler: handler_1.authenticated }, inventory_1.createInventory);
    fastify.get("/inventories", { preHandler: handler_1.authenticated }, inventory_1.inventories);
    fastify.get("/view-container", { preHandler: handler_1.authenticated }, inventory_2.viewContainerAuth);
    fastify.get("/container-access", { preHandler: handler_1.authenticated }, inventory_1.inventoryLogsAccessList);
    fastify.get("/inventory/logs", { preHandler: handler_1.authenticated }, inventory_1.inventoryLogs);
    fastify.delete("/inventory/delete", { preHandler: handler_1.authenticated }, inventory_1.removeContainer);
};
exports.inventory = inventory;
