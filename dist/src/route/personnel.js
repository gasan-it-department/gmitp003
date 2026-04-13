"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.personnel = void 0;
const handler_1 = require("../middleware/handler");
const personnelController_1 = require("../controller/personnelController");
const request_1 = require("../models/request");
const personnel = (fastify) => {
    fastify.get("/personnel", { preHandler: handler_1.authenticated, schema: request_1.personnelListSchema }, personnelController_1.personnelList);
};
exports.personnel = personnel;
