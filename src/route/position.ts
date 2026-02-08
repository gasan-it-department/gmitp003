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
  submitApplication,
} from "../controller/positionController";
import { positionListSchema, addPostionSchema } from "../models/request";
export const position = (fastify: FastifyInstance) => {
  fastify.get("/position/list", { preHandler: authenticated }, positionList);
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
  fastify.get("/position/check-invitation", positionCheckInvitation);
  fastify.post("/position/register", submitApplication);
  fastify.post("/position/account-register", positionRegister);
};
