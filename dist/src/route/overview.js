"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.overview = void 0;
const handler_1 = require("../middleware/handler");
const supplyOverviewController_1 = require("../controller/supplyOverviewController");
const overview = (fastify) => {
    fastify.get("/supply-overview", { preHandler: handler_1.authenticated }, supplyOverviewController_1.supplyOverview);
    fastify.get("/supply/overview/status", { preHandler: handler_1.authenticated }, supplyOverviewController_1.supplyOverviewStatus);
};
exports.overview = overview;
