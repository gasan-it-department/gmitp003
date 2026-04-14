"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.area = void 0;
const region_1 = require("../controller/region");
//handler
const handler_1 = require("../middleware/handler");
//controller
const region_2 = require("../controller/region");
const request_1 = require("../models/request");
const provinceController_1 = require("../controller/provinceController");
const municipalController_1 = require("../controller/municipalController");
const barangayController_1 = require("../controller/barangayController");
const area = (fastify) => {
    fastify.get("/region", { preHandler: handler_1.authenticated, schema: request_1.regionListSchema }, region_2.regionController);
    fastify.get("/all-regions", region_1.getRegions);
    fastify.get("/provinces", { preHandler: handler_1.authenticated }, provinceController_1.provinces);
    fastify.get("/municipalities", { preHandler: handler_1.authenticated }, municipalController_1.municipalities);
    fastify.get("/barangays", { preHandler: handler_1.authenticated }, barangayController_1.barangays);
};
exports.area = area;
