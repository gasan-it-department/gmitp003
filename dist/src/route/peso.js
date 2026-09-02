"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.peso = void 0;
const handler_1 = require("../middleware/handler");
const pesoController_1 = require("../controller/pesoController");
const peso = (fastify) => {
    fastify.post("/peso/job/create", { preHandler: handler_1.authenticated }, pesoController_1.createPesoJob);
    fastify.patch("/peso/job/update", { preHandler: handler_1.authenticated }, pesoController_1.updatePesoJob);
    fastify.get("/peso/job/list", { preHandler: handler_1.authenticated }, pesoController_1.pesoJobList);
    fastify.get("/peso/job/data", { preHandler: handler_1.authenticated }, pesoController_1.pesoJobData);
};
exports.peso = peso;
