"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.quality = void 0;
const handler_1 = require("../middleware/handler");
const qualityControl_1 = require("../controller/qualityControl");
const quality = (fastify) => {
    fastify.get("/supply-quality", { preHandler: handler_1.authenticated }, qualityControl_1.unitOfMeasures);
};
exports.quality = quality;
