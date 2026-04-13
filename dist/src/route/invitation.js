"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.invitation = void 0;
const invitationController_1 = require("../controller/invitationController.");
const handler_1 = require("../middleware/handler");
const invitation = (fastify) => {
    fastify.get("/invitation", invitationController_1.invitationAuth);
    fastify.post("/create-invitation", invitationController_1.createInvitationLink);
    fastify.get("/invite-link", { preHandler: handler_1.authenticated }, invitationController_1.invitations);
    fastify.delete("/delete-link", { preHandler: handler_1.authenticated }, invitationController_1.deleteInvitationLink);
};
exports.invitation = invitation;
