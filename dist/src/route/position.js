"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.position = void 0;
const handler_1 = require("../middleware/handler");
const positionController_1 = require("../controller/positionController");
const request_1 = require("../models/request");
const position = (fastify) => {
    fastify.get("/position/list", { preHandler: handler_1.authenticated }, positionController_1.positionList);
    fastify.patch("/position/unit/update", { preHandler: handler_1.authenticated }, positionController_1.updateUnitPosition);
    fastify.post("/add-position", { preHandler: handler_1.authenticated, schema: request_1.addPostionSchema }, positionController_1.addPosition);
    fastify.get("/position/selection-list", { preHandler: handler_1.authenticated }, positionController_1.positionSelectionList);
    fastify.get("/position/data", { preHandler: handler_1.authenticated }, positionController_1.positionData);
    fastify.post("/position/unit/position", { preHandler: handler_1.authenticated }, positionController_1.createNewUnitPosition);
    fastify.get("/position/line", { preHandler: handler_1.authenticated }, positionController_1.linePositions);
    fastify.get("/job-post-data", positionController_1.publicJobPost);
    fastify.post("/position/fill-invite", { preHandler: handler_1.authenticated }, positionController_1.fillPositionInvite);
    // List invitations for a UnitPosition (or specific slot). Default
    // returns only "active" (non-concluded, non-expired) rows; pass
    // ?status=all for the full history.
    fastify.get("/position/invitations", { preHandler: handler_1.authenticated }, positionController_1.listPositionInvitations);
    // Soft-conclude (cancel) a pending invitation.
    fastify.post("/position/invitation/cancel", { preHandler: handler_1.authenticated }, positionController_1.cancelPositionInvitation);
    // Invite an existing SubmittedApplication into a vacant slot — same
    // email mechanic as /position/fill-invite but the recipient is picked
    // from the line's existing applicant pool instead of typed in by HR.
    fastify.post("/position/invitation/from-application", { preHandler: handler_1.authenticated }, positionController_1.inviteFromApplication);
    fastify.get("/position/check-invitation", positionController_1.positionCheckInvitation);
    fastify.post("/position/register", positionController_1.submitApplication);
    fastify.post("/position/account-register", positionController_1.positionRegister);
    // PUBLIC quick registration (essentials-only invite; multipart with photo).
    fastify.post("/position/quick-register", positionController_1.positionQuickRegister);
    fastify.get("/position/records", { preHandler: handler_1.authenticated }, positionController_1.positionRecords);
    fastify.get("/position/applications", { preHandler: handler_1.authenticated }, positionController_1.positionApplications);
    fastify.get("/position/history", { preHandler: handler_1.authenticated }, positionController_1.unitPositionRecord);
    fastify.delete("/position/remove", { preHandler: handler_1.authenticated }, positionController_1.removeUnitPosition);
    // Vacate an occupied slot (optionally suspending the occupant's account).
    fastify.post("/position/vacant", { preHandler: handler_1.authenticated }, positionController_1.vacantPosition);
};
exports.position = position;
