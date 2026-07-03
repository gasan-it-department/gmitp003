import { FastifyInstance } from "../barrel/fastify";
import { authSchema, registerSchema } from "../models/request";
//handlers
import { authenticated } from "../middleware/handler";

//controllers
import {
  getAllEmpoyees,
  searchUser,
  employees,
  viewUserProfile,
  decryptUserData,
  userModuleAccess,
  supsendAccount,
  deleteUser,
  userRecord,
  archivedPersonnel,
  restorePersonnel,
  userVerifyInfo,
  verifyId,
  updateProfilePicture,
  servePhoto,
} from "../controller/employee";
import {
  idIssueList,
  idExportBatch,
  myVerifyQr,
} from "../controller/idCardController";

//models, interface
import { employeeSchema } from "../models/request";

export const employee = (fastify: FastifyInstance) => {
  fastify.post("/employees", { schema: employeeSchema }, getAllEmpoyees);
  fastify.get("/search-user", { preHandler: authenticated }, searchUser);
  fastify.get("/employee-list", { preHandler: authenticated }, employees);
  fastify.get("/user/profile", { preHandler: authenticated }, decryptUserData);
  fastify.get(
    "/user/view-profile",
    { preHandler: authenticated },
    viewUserProfile,
  );
  fastify.get(
    "/user/module-access",
    { preHandler: authenticated },
    userModuleAccess,
  );
  // The logged-in employee's ID-card verify QR (mobile profile screen).
  fastify.get("/user/my-verify-qr", { preHandler: authenticated }, myVerifyQr);
  fastify.patch("/user/suspend", { preHandler: authenticated }, supsendAccount);
  fastify.delete("/user/delete", { preHandler: authenticated }, deleteUser);
  fastify.get("/user/record", { preHandler: authenticated }, userRecord);
  fastify.get(
    "/archived-personnel",
    { preHandler: authenticated },
    archivedPersonnel,
  );
  fastify.post(
    "/archived-personnel/restore",
    { preHandler: authenticated },
    restorePersonnel,
  );
  fastify.get(
    "/user/verify-info",
    { preHandler: authenticated },
    userVerifyInfo,
  );
  fastify.post(
    "/user/profile-picture",
    { preHandler: authenticated },
    updateProfilePicture,
  );
  // PUBLIC — image is loaded via <img src>, so no auth header is sent.
  fastify.get("/user/photo/:userId", servePhoto);
  // PUBLIC — scanned from an ID's QR; no auth so anyone can verify.
  fastify.get("/id/verify", verifyId);
  // Bulk ID card issuing — list + imposed PDF export (front/rear files).
  fastify.get("/id/issue-list", { preHandler: authenticated }, idIssueList);
  fastify.post(
    "/id/export-batch",
    // template carries two base64 images — allow a larger body than the default
    { preHandler: authenticated, bodyLimit: 25 * 1024 * 1024 },
    idExportBatch,
  );
};
