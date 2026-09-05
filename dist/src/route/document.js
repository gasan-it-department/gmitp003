"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.document = void 0;
const handler_1 = require("../middleware/handler");
const documentVerifyController_1 = require("../controller/documentVerifyController");
const documentReceiveController_1 = require("../controller/documentReceiveController");
const documentController_1 = require("../controller/documentController");
const signatureController_1 = require("../controller/signatureController");
const disseminationController_1 = require("../controller/disseminationController");
const selfSignController_1 = require("../controller/selfSignController");
const roomConfigController_1 = require("../controller/roomConfigController");
const document = (fastify) => {
    fastify.post("/document/create", { preHandler: handler_1.authenticated }, documentController_1.addDocument);
    fastify.get("/document/signatories", { preHandler: handler_1.authenticated }, documentController_1.authorizedUsers);
    fastify.post("/document/room/register", documentController_1.roomRegister);
    fastify.get("/document/signatory-registry", { preHandler: handler_1.authenticated }, documentController_1.signatoryRegistry);
    fastify.get("/document/room-request", { preHandler: handler_1.authenticated }, documentController_1.roomRequest);
    fastify.patch("/document/update/status", { preHandler: handler_1.authenticated }, documentController_1.updateStatus);
    fastify.delete("/document/request/delete", { preHandler: handler_1.authenticated }, documentController_1.deleteRoomRequest);
    fastify.get("/document/details", { preHandler: handler_1.authenticated }, documentController_1.roomRequestDetails);
    fastify.get("/document/archives", { preHandler: handler_1.authenticated }, documentController_1.archives);
    fastify.post("/document/archive/file", documentController_1.archiveFile);
    // ── Room configuration (rename, address, signatories/receivers) ────────
    fastify.get("/document/room/config", { preHandler: handler_1.authenticated }, roomConfigController_1.roomConfig);
    fastify.get("/document/room/config/candidates", { preHandler: handler_1.authenticated }, roomConfigController_1.roomCandidates);
    fastify.patch("/document/room/config", { preHandler: handler_1.authenticated }, roomConfigController_1.updateRoomConfig);
    fastify.post("/document/room/config/members", { preHandler: handler_1.authenticated }, roomConfigController_1.addRoomMembers);
    fastify.patch("/document/room/config/member", { preHandler: handler_1.authenticated }, roomConfigController_1.updateRoomMember);
    fastify.delete("/document/room/config/member", { preHandler: handler_1.authenticated }, roomConfigController_1.removeRoomMember);
    fastify.get("/document/rooms", { preHandler: handler_1.authenticated }, documentController_1.rooms);
    fastify.get("/document/room", { preHandler: handler_1.authenticated }, documentController_1.room);
    fastify.patch("/document/room/update-status", { preHandler: handler_1.authenticated }, documentController_1.updateRoomStatus);
    fastify.delete("/document/room/remove", { preHandler: handler_1.authenticated }, documentController_1.removeRoom);
    fastify.get("/document/archive/datail", { preHandler: handler_1.authenticated }, documentController_1.archiveDetail);
    fastify.get("/document/download/file", { preHandler: handler_1.authenticated }, documentController_1.downloadArchiveFile);
    fastify.get("/document/archive/search/ai", { preHandler: handler_1.authenticated }, documentController_1.searchArchiveDocsAI);
    fastify.post("/document/route", { preHandler: handler_1.authenticated }, documentController_1.createDocumentRoute);
    fastify.get("/document/route/info", { preHandler: handler_1.authenticated }, documentController_1.routerInfo);
    fastify.get("/document/archive/search", { preHandler: handler_1.authenticated }, documentController_1.searchArchiveDocs);
    fastify.post("/document/archive/generate-archive", { preHandler: handler_1.authenticated }, documentController_1.generateAbstract);
    fastify.delete("/document/archive/remove", { preHandler: handler_1.authenticated }, documentController_1.removeArchive);
    // ── Signature management (e-sign) ──────────────────────────────
    fastify.get("/document/user/signatures", { preHandler: handler_1.authenticated }, signatureController_1.listUserSignatures);
    fastify.post("/document/user/signatures/upload", { preHandler: handler_1.authenticated }, signatureController_1.uploadUserSignature);
    fastify.patch("/document/user/signatures/activate", { preHandler: handler_1.authenticated }, signatureController_1.activateUserSignature);
    fastify.delete("/document/user/signatures/remove", { preHandler: handler_1.authenticated }, signatureController_1.deleteUserSignature);
    fastify.patch("/document/user/signatures/qr", { preHandler: handler_1.authenticated }, signatureController_1.setSignatureQr);
    fastify.patch("/document/user/signatures/placement", { preHandler: handler_1.authenticated }, signatureController_1.setSignaturePlacement);
    // ── Dissemination (signature queue rooms) ──────────────────────
    fastify.get("/document/dissemination/outbox", { preHandler: handler_1.authenticated }, disseminationController_1.disseminationOutbox);
    fastify.get("/document/dissemination/inbox", { preHandler: handler_1.authenticated }, disseminationController_1.disseminationInbox);
    fastify.get("/document/dissemination/detail", { preHandler: handler_1.authenticated }, disseminationController_1.disseminationDetail);
    fastify.post("/document/dissemination/targets/set", { preHandler: handler_1.authenticated }, disseminationController_1.setTargetRooms);
    fastify.post("/document/dissemination/signatories/set", { preHandler: handler_1.authenticated }, disseminationController_1.setSignatoryArrangement);
    fastify.patch("/document/dissemination/receipt", { preHandler: handler_1.authenticated }, disseminationController_1.acknowledgeReceipt);
    fastify.patch("/document/dissemination/finalize", { preHandler: handler_1.authenticated }, disseminationController_1.finalizeDissemination);
    fastify.delete("/document/dissemination/remove", { preHandler: handler_1.authenticated }, disseminationController_1.removeDissemination);
    fastify.get("/document/dissemination/target-rooms", { preHandler: handler_1.authenticated }, disseminationController_1.targetRoomCandidates);
    fastify.get("/document/dissemination/signatories", { preHandler: handler_1.authenticated }, disseminationController_1.signatoryCandidates);
    fastify.get("/document/dissemination/documents", { preHandler: handler_1.authenticated }, disseminationController_1.disseminationDocuments);
    fastify.get("/document/dissemination/file", { preHandler: handler_1.authenticated }, disseminationController_1.streamDocumentFile);
    fastify.post("/document/dissemination/placements/save", { preHandler: handler_1.authenticated }, disseminationController_1.saveSignaturePlacements);
    fastify.post("/document/dissemination/documents/upload", { preHandler: handler_1.authenticated }, disseminationController_1.uploadDisseminationDocument);
    fastify.delete("/document/dissemination/documents/remove", { preHandler: handler_1.authenticated }, disseminationController_1.removeDisseminationDocument);
    fastify.post("/document/room/repair-membership", { preHandler: handler_1.authenticated }, disseminationController_1.repairRoomMembership);
    fastify.post("/document/room/reset-membership", { preHandler: handler_1.authenticated }, disseminationController_1.resetRoomMembership);
    fastify.get("/document/overview", { preHandler: handler_1.authenticated }, disseminationController_1.documentOverview);
    fastify.get("/document/dissemination/view", { preHandler: handler_1.authenticated }, disseminationController_1.viewDissemination);
    fastify.post("/document/dissemination/sign-mine", { preHandler: handler_1.authenticated }, disseminationController_1.signMine);
    fastify.post("/document/dissemination/claim-slot", { preHandler: handler_1.authenticated }, disseminationController_1.claimSignatorySlot);
    fastify.post("/document/dissemination/archive", { preHandler: handler_1.authenticated }, disseminationController_1.archiveDissemination);
    fastify.get("/document/dissemination/signed-document", { preHandler: handler_1.authenticated }, disseminationController_1.downloadSignedDocument);
    fastify.patch("/document/dissemination/cancel", { preHandler: handler_1.authenticated }, disseminationController_1.cancelDispatchedDissemination);
    // Public verification — no auth. The HTML route stays as a fallback
    // for direct API hits; the QR points to the frontend, which calls the
    // JSON route below.
    fastify.get("/document/verify/:id", disseminationController_1.verifySignaturePage);
    fastify.get("/document/verify-data/:id", disseminationController_1.verifySignatureData);
    // ── Public document verification ──────────────────────────────────────
    // No auth: an outside recipient must be able to check a document they were
    // handed. None of these reveal document contents.
    fastify.post("/document/verify-file", documentVerifyController_1.verifyFile);
    fastify.get("/document/verify-seal/:serial", documentVerifyController_1.verifySeal);
    fastify.get("/document/verify-key", documentVerifyController_1.verifyPublicKey);
    // Self-sign — single-user e-sign tool (no dissemination involved).
    fastify.post("/document/self-sign/upload", { preHandler: handler_1.authenticated }, selfSignController_1.selfSignUpload);
    fastify.post("/document/self-sign/save-placements", { preHandler: handler_1.authenticated }, selfSignController_1.selfSignSavePlacements);
    fastify.post("/document/self-sign/sign", { preHandler: handler_1.authenticated }, selfSignController_1.selfSignAll);
    fastify.post("/document/self-sign/unsign", { preHandler: handler_1.authenticated }, selfSignController_1.selfSignUnsign);
    fastify.get("/document/self-sign/list", { preHandler: handler_1.authenticated }, selfSignController_1.selfSignList);
    fastify.get("/document/self-sign/detail", { preHandler: handler_1.authenticated }, selfSignController_1.selfSignDetail);
    fastify.post("/document/self-sign/archive", { preHandler: handler_1.authenticated }, selfSignController_1.selfSignArchive);
    fastify.delete("/document/self-sign/remove", { preHandler: handler_1.authenticated }, selfSignController_1.selfSignRemove);
    // ── Document Receiving (barcode-stickered physical documents) ──────────
    // sync/find/create are gated by the Mobile Access grant (documentMobileAuth),
    // exactly like the pharmacy scanner: ungranted users get 403 on every read
    // and write, so the registry can't be touched without a grant.
    fastify.get("/document/receive/sync", { preHandler: [handler_1.authenticated, handler_1.documentMobileAuth] }, documentReceiveController_1.documentReceiveSync);
    fastify.get("/document/receive/find", { preHandler: [handler_1.authenticated, handler_1.documentMobileAuth] }, documentReceiveController_1.documentReceiveFind);
    fastify.post("/document/receive", { preHandler: [handler_1.authenticated, handler_1.documentMobileAuth] }, documentReceiveController_1.documentReceiveCreate);
    fastify.get("/document/receive/list", { preHandler: handler_1.authenticated }, documentReceiveController_1.documentReceiveList);
    fastify.post("/document/receive/disseminate", { preHandler: handler_1.authenticated }, documentReceiveController_1.documentReceiveDisseminate);
    fastify.post("/document/receive/page", { preHandler: [handler_1.authenticated, handler_1.documentMobileAuth] }, documentReceiveController_1.documentReceivePageUpload);
    // PUBLIC — page images load directly by URL (uuid-obscured, like chat media).
    fastify.get("/document/receive/page/:id", documentReceiveController_1.documentReceivePageServe);
    // ── Documents Mobile Access (grant/revoke who may use the scanner) ─────
    fastify.get("/document/mobile-access", { preHandler: handler_1.authenticated }, documentReceiveController_1.listDocMobileAccess);
    fastify.get("/document/mobile-access/candidates", { preHandler: handler_1.authenticated }, documentReceiveController_1.docMobileAccessCandidates);
    fastify.post("/document/mobile-access", { preHandler: handler_1.authenticated }, documentReceiveController_1.grantDocMobileAccess);
    fastify.delete("/document/mobile-access", { preHandler: handler_1.authenticated }, documentReceiveController_1.revokeDocMobileAccess);
    fastify.get("/document/mobile-access/me", { preHandler: handler_1.authenticated }, documentReceiveController_1.myDocMobileAccess);
};
exports.document = document;
