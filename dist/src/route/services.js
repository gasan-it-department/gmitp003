"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.services = void 0;
const handler_1 = require("../middleware/handler");
const complaintController_1 = require("../controller/complaintController");
const leaveController_1 = require("../controller/leaveController");
// Employee self-service module routes. Every line user is allowed in
// (no Module table gate); the controllers themselves only require an
// authenticated request and a userId / lineId in the payload.
const services = (fastify) => {
    fastify.post("/service/complaint/create", { preHandler: handler_1.authenticated }, complaintController_1.createComplaint);
    fastify.get("/service/complaint/list", { preHandler: handler_1.authenticated }, complaintController_1.listComplaints);
    fastify.get("/service/complaint/detail", { preHandler: handler_1.authenticated }, complaintController_1.complaintDetail);
    fastify.post("/service/complaint/reply", { preHandler: handler_1.authenticated }, complaintController_1.replyComplaint);
    fastify.patch("/service/complaint/status", { preHandler: handler_1.authenticated }, complaintController_1.updateComplaintStatus);
    fastify.delete("/service/complaint/remove", { preHandler: handler_1.authenticated }, complaintController_1.removeComplaint);
    // Evidence
    fastify.post("/service/complaint/evidence/add", { preHandler: handler_1.authenticated }, complaintController_1.addEvidence);
    fastify.get("/service/complaint/evidence/file", { preHandler: handler_1.authenticated }, complaintController_1.streamEvidence);
    fastify.delete("/service/complaint/evidence/remove", { preHandler: handler_1.authenticated }, complaintController_1.removeEvidence);
    // Line users picker (so the complaint form can target a coworker)
    fastify.get("/service/line-users", { preHandler: handler_1.authenticated }, leaveController_1.listLineUsers);
};
exports.services = services;
