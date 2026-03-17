import { FastifyInstance } from "../barrel/fastify";
import { authenticated } from "../middleware/handler";

import {
  addDocument,
  authorizedUsers,
  roomRegister,
  signatoryRegistry,
  roomRequest,
  updateStatus,
  deleteRoomRequest,
  roomRequestDetails,
  archives,
  archiveFile,
  rooms,
  room,
} from "../controller/documentController";

export const document = (fastify: FastifyInstance) => {
  fastify.post("/document/create", { preHandler: authenticated }, addDocument);
  fastify.get(
    "/document/signatories",
    { preHandler: authenticated },
    authorizedUsers,
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
  fastify.get("/document/archives", { preHandler: authenticated }, archives);
  fastify.post("/document/archive/file", archiveFile);
  fastify.get("/document/rooms", { preHandler: authenticated }, rooms);
  fastify.get("/document/room", { preHandler: authenticated }, room);
};
