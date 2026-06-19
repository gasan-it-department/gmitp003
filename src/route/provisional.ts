import { FastifyInstance } from "../barrel/fastify";
import { authenticated } from "../middleware/handler";
import {
  createProvisionalPosition,
  provisionalPositions,
  provisionalInvite,
  provisionalPersonnel,
  provisionalPersonnelExcel,
  provisionalTransfer,
  provisionalRemove,
  provisionalRenew,
} from "../controller/provisionalController";

// Provisional (temporary/contract) staff. A ProvisionalPosition carries the
// employment type (Job Order / Contract of Service / ...) + term in months.
// Hiring picks an applicant + a unit at hire time and emails the existing
// /position/register link; registration creates a User with status = empType
// and term = now + termMonths.
export const provisional = (fastify: FastifyInstance) => {
  fastify.post(
    "/provisional/position",
    { preHandler: authenticated },
    createProvisionalPosition,
  );
  fastify.get(
    "/provisional/positions",
    { preHandler: authenticated },
    provisionalPositions,
  );
  fastify.post(
    "/provisional/invite",
    { preHandler: authenticated },
    provisionalInvite,
  );
  fastify.get(
    "/provisional/personnel",
    { preHandler: authenticated },
    provisionalPersonnel,
  );
  fastify.get(
    "/provisional/personnel/excel",
    { preHandler: authenticated },
    provisionalPersonnelExcel,
  );
  fastify.post(
    "/provisional/transfer",
    { preHandler: authenticated },
    provisionalTransfer,
  );
  fastify.post(
    "/provisional/remove",
    { preHandler: authenticated },
    provisionalRemove,
  );
  fastify.post(
    "/provisional/renew",
    { preHandler: authenticated },
    provisionalRenew,
  );
};
