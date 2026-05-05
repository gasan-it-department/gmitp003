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
  removeRoom,
  updateRoomStatus,
  archiveDetail,
  downloadArchiveFile,
  searchArchiveDocsAI,
  createDocumentRoute,
  routerInfo,
  searchArchiveDocs,
  generateAbstract,
  removeArchiveFile,
  userSignatures,
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
  fastify.patch(
    "/document/room/update-status",
    { preHandler: authenticated },
    updateRoomStatus,
  );
  fastify.delete(
    "/document/room/remove",
    { preHandler: authenticated },
    removeRoom,
  );
  fastify.get(
    "/document/archive/datail",
    { preHandler: authenticated },
    archiveDetail,
  );
  fastify.get(
    "/document/download/file",
    { preHandler: authenticated },
    downloadArchiveFile,
  );
  fastify.get(
    "/document/archive/search/ai",
    { preHandler: authenticated },
    searchArchiveDocsAI,
  );
  fastify.post(
    "/document/route",
    { preHandler: authenticated },
    createDocumentRoute,
  );
  fastify.get(
    "/document/route/info",
    { preHandler: authenticated },
    routerInfo,
  );
  fastify.get(
    "/document/archive/search",
    { preHandler: authenticated },
    searchArchiveDocs,
  );
  fastify.post(
    "/document/archive/generate-archive",
    { preHandler: authenticated },
    generateAbstract,
  );
  fastify.delete(
    "/document/archive/remove",
    { preHandler: authenticated },
    removeArchiveFile,
  );
  fastify.get(
    "/document/user/signatures",
    { preHandler: authenticated },
    userSignatures,
  );
};
