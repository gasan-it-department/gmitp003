"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.supplier = void 0;
const handler_1 = require("../middleware/handler");
const supplierController_1 = require("../controller/supplierController");
const supplier = (fastify) => {
    fastify.get("/suppliers", { preHandler: handler_1.authenticated }, supplierController_1.getSuppliers);
};
exports.supplier = supplier;
