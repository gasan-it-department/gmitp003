import { FastifyInstance } from "../barrel/fastify";
import { authenticated } from "../middleware/handler";
import {
  positionList,
  addPosition,
  positionSelectionList,
  positionData,
  createNewUnitPosition,
  linePositions,
  publicJobPost,
  fillPositionInvite,
  positionCheckInvitation,
  positionRegister,
  positionQuickRegister,
  submitApplication,
  positionRecords,
  positionApplications,
  unitPositionRecord,
  removeUnitPosition,
  listPositionInvitations,
  cancelPositionInvitation,
  inviteFromApplication,
  vacantPosition,
  updateUnitPosition,
} from "../controller/positionController";
import { positionListSchema, addPostionSchema } from "../models/request";
export const position = (fastify: FastifyInstance) => {
  fastify.get("/position/list", { preHandler: authenticated }, positionList);
  fastify.patch(
    "/position/unit/update",
    { preHandler: authenticated },
    updateUnitPosition,
  );
  fastify.post(
    "/add-position",
    { preHandler: authenticated, schema: addPostionSchema },
    addPosition,
  );
  fastify.get(
    "/position/selection-list",
    { preHandler: authenticated },
    positionSelectionList,
  );
  fastify.get("/position/data", { preHandler: authenticated }, positionData);
  fastify.post(
    "/position/unit/position",
    { preHandler: authenticated },
    createNewUnitPosition,
  );
  fastify.get("/position/line", { preHandler: authenticated }, linePositions);
  fastify.get("/job-post-data", publicJobPost);
  fastify.post(
    "/position/fill-invite",
    { preHandler: authenticated },
    fillPositionInvite,
  );
  // List invitations for a UnitPosition (or specific slot). Default
  // returns only "active" (non-concluded, non-expired) rows; pass
  // ?status=all for the full history.
  fastify.get(
    "/position/invitations",
    { preHandler: authenticated },
    listPositionInvitations,
  );
  // Soft-conclude (cancel) a pending invitation.
  fastify.post(
    "/position/invitation/cancel",
    { preHandler: authenticated },
    cancelPositionInvitation,
  );
  // Invite an existing SubmittedApplication into a vacant slot — same
  // email mechanic as /position/fill-invite but the recipient is picked
  // from the line's existing applicant pool instead of typed in by HR.
  fastify.post(
    "/position/invitation/from-application",
    { preHandler: authenticated },
    inviteFromApplication,
  );
  fastify.get("/position/check-invitation", positionCheckInvitation);
  fastify.post("/position/register", submitApplication);
  fastify.post("/position/account-register", positionRegister);
  // PUBLIC quick registration (essentials-only invite; multipart with photo).
  fastify.post("/position/quick-register", positionQuickRegister);
  fastify.get(
    "/position/records",
    { preHandler: authenticated },
    positionRecords,
  );
  fastify.get(
    "/position/applications",
    { preHandler: authenticated },
    positionApplications,
  );
  fastify.get(
    "/position/history",
    { preHandler: authenticated },
    unitPositionRecord,
  );
  fastify.delete(
    "/position/remove",
    { preHandler: authenticated },
    removeUnitPosition,
  );
  // Vacate an occupied slot (optionally suspending the occupant's account).
  fastify.post(
    "/position/vacant",
    { preHandler: authenticated },
    vacantPosition,
  );
};
