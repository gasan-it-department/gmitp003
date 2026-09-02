"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.modules = void 0;
const handler_1 = require("../middleware/handler");
const moduleController_1 = require("../controller/moduleController");
const modules = (fastify) => {
    fastify.get("/module/list", { preHandler: handler_1.authenticated }, moduleController_1.modules);
    fastify.get("/module/users", { preHandler: handler_1.authenticated }, moduleController_1.moduleUsers);
    fastify.post("/module/add/acces", { preHandler: handler_1.authenticated }, moduleController_1.addModuleAccess);
    fastify.get("/module/user", { preHandler: handler_1.authenticated }, moduleController_1.userAccessModule);
    fastify.patch("/module/remove-access", { preHandler: handler_1.authenticated }, moduleController_1.removeAccess);
    fastify.patch("/module/update-access", { preHandler: handler_1.authenticated }, moduleController_1.updateModuleAccess);
};
exports.modules = modules;
