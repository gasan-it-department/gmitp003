import { FastifyInstance } from "../barrel/fastify";
import { authenticated } from "../middleware/handler";
import {
  createComplaint,
  listComplaints,
  complaintDetail,
  replyComplaint,
  updateComplaintStatus,
  removeComplaint,
  addEvidence,
  streamEvidence,
  removeEvidence,
} from "../controller/complaintController";
import { listLineUsers } from "../controller/leaveController";

// Employee self-service module routes. Every line user is allowed in
// (no Module table gate); the controllers themselves only require an
// authenticated request and a userId / lineId in the payload.
export const services = (fastify: FastifyInstance) => {
  fastify.post(
    "/service/complaint/create",
    { preHandler: authenticated },
    createComplaint,
  );
  fastify.get(
    "/service/complaint/list",
    { preHandler: authenticated },
    listComplaints,
  );
  fastify.get(
    "/service/complaint/detail",
    { preHandler: authenticated },
    complaintDetail,
  );
  fastify.post(
    "/service/complaint/reply",
    { preHandler: authenticated },
    replyComplaint,
  );
  fastify.patch(
    "/service/complaint/status",
    { preHandler: authenticated },
    updateComplaintStatus,
  );
  fastify.delete(
    "/service/complaint/remove",
    { preHandler: authenticated },
    removeComplaint,
  );
  // Evidence
  fastify.post(
    "/service/complaint/evidence/add",
    { preHandler: authenticated },
    addEvidence,
  );
  fastify.get(
    "/service/complaint/evidence/file",
    { preHandler: authenticated },
    streamEvidence,
  );
  fastify.delete(
    "/service/complaint/evidence/remove",
    { preHandler: authenticated },
    removeEvidence,
  );
  // Line users picker (so the complaint form can target a coworker)
  fastify.get(
    "/service/line-users",
    { preHandler: authenticated },
    listLineUsers,
  );
};
