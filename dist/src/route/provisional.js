"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.provisional = void 0;
const handler_1 = require("../middleware/handler");
const provisionalController_1 = require("../controller/provisionalController");
// Provisional (temporary/contract) staff. A ProvisionalPosition carries the
// employment type (Job Order / Contract of Service / ...) + term in months.
// Hiring picks an applicant + a unit at hire time and emails the existing
// /position/register link; registration creates a User with status = empType
// and term = now + termMonths.
const provisional = (fastify) => {
    fastify.post("/provisional/position", { preHandler: handler_1.authenticated }, provisionalController_1.createProvisionalPosition);
    fastify.get("/provisional/positions", { preHandler: handler_1.authenticated }, provisionalController_1.provisionalPositions);
    fastify.post("/provisional/invite", { preHandler: handler_1.authenticated }, provisionalController_1.provisionalInvite);
    fastify.get("/provisional/personnel", { preHandler: handler_1.authenticated }, provisionalController_1.provisionalPersonnel);
    fastify.get("/provisional/position/personnel", { preHandler: handler_1.authenticated }, provisionalController_1.provisionalPositionPersonnel);
    fastify.get("/provisional/personnel/excel", { preHandler: handler_1.authenticated }, provisionalController_1.provisionalPersonnelExcel);
    fastify.post("/provisional/transfer", { preHandler: handler_1.authenticated }, provisionalController_1.provisionalTransfer);
    fastify.post("/provisional/remove", { preHandler: handler_1.authenticated }, provisionalController_1.provisionalRemove);
    fastify.post("/provisional/renew", { preHandler: handler_1.authenticated }, provisionalController_1.provisionalRenew);
    fastify.patch("/provisional/position", { preHandler: handler_1.authenticated }, provisionalController_1.updateProvisionalPosition);
    fastify.patch("/provisional/personnel", { preHandler: handler_1.authenticated }, provisionalController_1.updateProvisionalPersonnel);
};
exports.provisional = provisional;
