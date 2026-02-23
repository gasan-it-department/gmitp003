import { FastifyInstance } from "../barrel/fastify";
import { authenticated } from "../middleware/handler";

import {
  addDocument,
  signatories,
  roomRegister,
  signatoryRegistry,
  roomRequest,
  updateStatus,
  deleteRoomRequest,
  roomRequestDetails,
} from "../controller/documentController";

export const document = (fastify: FastifyInstance) => {
  fastify.post("/document/create", { preHandler: authenticated }, addDocument);
  fastify.get(
    "/document/signatories",
    { preHandler: authenticated },
    signatories,
  );
  fastify.post("/document/room/register", roomRegister);
  fastify.get(
    "/document/signatory-registry",
    { preHandler: authenticated },
    signatoryRegistry,
  );
  fastify.get(
    "/document/room-request",
    { preHandler: authenticated },
    roomRequest,
  );
  fastify.patch(
    "/document/update/status",
    { preHandler: authenticated },
    updateStatus,
  );
  fastify.delete(
    "/document/request/delete",
    { preHandler: authenticated },
    deleteRoomRequest,
  );
  fastify.get(
    "/document/details",
    { preHandler: authenticated },
    roomRequestDetails,
  );
};
