"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.push = void 0;
const handler_1 = require("../middleware/handler");
const pushController_1 = require("../controller/pushController");
const push = (fastify) => {
    fastify.post("/push/register", { preHandler: handler_1.authenticated }, pushController_1.registerPushToken);
    fastify.post("/push/unregister", { preHandler: handler_1.authenticated }, pushController_1.unregisterPushToken);
};
exports.push = push;
