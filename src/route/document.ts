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
  removeArchive,
} from "../controller/documentController";
import {
  listUserSignatures,
  uploadUserSignature,
  activateUserSignature,
  deleteUserSignature,
  setSignatureQr,
} from "../controller/signatureController";
import {
  disseminationOutbox,
  disseminationInbox,
  disseminationDetail,
  setTargetRooms,
  setSignatoryArrangement,
  finalizeDissemination,
  removeDissemination,
  targetRoomCandidates,
  signatoryCandidates,
  disseminationDocuments,
  streamDocumentFile,
  saveSignaturePlacements,
  uploadDisseminationDocument,
  removeDisseminationDocument,
  repairRoomMembership,
  documentOverview,
  resetRoomMembership,
  viewDissemination,
  signMine,
  claimSignatorySlot,
  archiveDissemination,
  downloadSignedDocument,
  cancelDispatchedDissemination,
  verifySignaturePage,
  verifySignatureData,
} from "../controller/disseminationController";
import {
  selfSignUpload,
  selfSignSavePlacements,
  selfSignAll,
  selfSignList,
  selfSignDetail,
  selfSignArchive,
  selfSignRemove,
} from "../controller/selfSignController";

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
    removeArchive,
  );

  // ── Signature management (e-sign) ──────────────────────────────
  fastify.get(
    "/document/user/signatures",
    { preHandler: authenticated },
    listUserSignatures,
  );
  fastify.post(
    "/document/user/signatures/upload",
    { preHandler: authenticated },
    uploadUserSignature,
  );
  fastify.patch(
    "/document/user/signatures/activate",
    { preHandler: authenticated },
    activateUserSignature,
  );
  fastify.delete(
    "/document/user/signatures/remove",
    { preHandler: authenticated },
    deleteUserSignature,
  );
  fastify.patch(
    "/document/user/signatures/qr",
    { preHandler: authenticated },
    setSignatureQr,
  );

  // ── Dissemination (signature queue rooms) ──────────────────────
  fastify.get(
    "/document/dissemination/outbox",
    { preHandler: authenticated },
    disseminationOutbox,
  );
  fastify.get(
    "/document/dissemination/inbox",
    { preHandler: authenticated },
    disseminationInbox,
  );
  fastify.get(
    "/document/dissemination/detail",
    { preHandler: authenticated },
    disseminationDetail,
  );
  fastify.post(
    "/document/dissemination/targets/set",
    { preHandler: authenticated },
    setTargetRooms,
  );
  fastify.post(
    "/document/dissemination/signatories/set",
    { preHandler: authenticated },
    setSignatoryArrangement,
  );
  fastify.patch(
    "/document/dissemination/finalize",
    { preHandler: authenticated },
    finalizeDissemination,
  );
  fastify.delete(
    "/document/dissemination/remove",
    { preHandler: authenticated },
    removeDissemination,
  );
  fastify.get(
    "/document/dissemination/target-rooms",
    { preHandler: authenticated },
    targetRoomCandidates,
  );
  fastify.get(
    "/document/dissemination/signatories",
    { preHandler: authenticated },
    signatoryCandidates,
  );
  fastify.get(
    "/document/dissemination/documents",
    { preHandler: authenticated },
    disseminationDocuments,
  );
  fastify.get(
    "/document/dissemination/file",
    { preHandler: authenticated },
    streamDocumentFile,
  );
  fastify.post(
    "/document/dissemination/placements/save",
    { preHandler: authenticated },
    saveSignaturePlacements,
  );
  fastify.post(
    "/document/dissemination/documents/upload",
    { preHandler: authenticated },
    uploadDisseminationDocument,
  );
  fastify.delete(
    "/document/dissemination/documents/remove",
    { preHandler: authenticated },
    removeDisseminationDocument,
  );
  fastify.post(
    "/document/room/repair-membership",
    { preHandler: authenticated },
    repairRoomMembership,
  );
  fastify.post(
    "/document/room/reset-membership",
    { preHandler: authenticated },
    resetRoomMembership,
  );
  fastify.get(
    "/document/overview",
    { preHandler: authenticated },
    documentOverview,
  );
  fastify.get(
    "/document/dissemination/view",
    { preHandler: authenticated },
    viewDissemination,
  );
  fastify.post(
    "/document/dissemination/sign-mine",
    { preHandler: authenticated },
    signMine,
  );
  fastify.post(
    "/document/dissemination/claim-slot",
    { preHandler: authenticated },
    claimSignatorySlot,
  );
  fastify.post(
    "/document/dissemination/archive",
    { preHandler: authenticated },
    archiveDissemination,
  );
  fastify.get(
    "/document/dissemination/signed-document",
    { preHandler: authenticated },
    downloadSignedDocument,
  );
  fastify.patch(
    "/document/dissemination/cancel",
    { preHandler: authenticated },
    cancelDispatchedDissemination,
  );
  // Public verification — no auth. The HTML route stays as a fallback
  // for direct API hits; the QR points to the frontend, which calls the
  // JSON route below.
  fastify.get("/document/verify/:id", verifySignaturePage);
  fastify.get("/document/verify-data/:id", verifySignatureData);
  // Self-sign — single-user e-sign tool (no dissemination involved).
  fastify.post(
    "/document/self-sign/upload",
    { preHandler: authenticated },
    selfSignUpload,
  );
  fastify.post(
    "/document/self-sign/save-placements",
    { preHandler: authenticated },
    selfSignSavePlacements,
  );
  fastify.post(
    "/document/self-sign/sign",
    { preHandler: authenticated },
    selfSignAll,
  );
  fastify.get(
    "/document/self-sign/list",
    { preHandler: authenticated },
    selfSignList,
  );
  fastify.get(
    "/document/self-sign/detail",
    { preHandler: authenticated },
    selfSignDetail,
  );
  fastify.post(
    "/document/self-sign/archive",
    { preHandler: authenticated },
    selfSignArchive,
  );
  fastify.delete(
    "/document/self-sign/remove",
    { preHandler: authenticated },
    selfSignRemove,
  );
};
