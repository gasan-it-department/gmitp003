import { FastifyInstance } from "../barrel/fastify";

import { authenticated, tempAuthenticated } from "../middleware/handler";

import {
  applications,
  postJob,
  createPobJobRequirements,
  postJobRequirements,
  removePostJobRequirements,
  postJobRequirementsRemoveAsset,
  updatePostJobRequiments,
  updatePostJob,
  jobPost,
  submitApplication,
  applicationList,
  applicationData,
  contactApplicant,
  applicationConvertion,
  contactManyApplicants,
  adminApplicationSendConversation,
  updateApplicationStatus,
  concludeApplication,
  applicationRegisterUser,
  updatePostApplication,
  sendPublicApplicationMessage,
  deleteApplication,
  applicationDeleteMany,
  withdrawApplication,
  reuploadApplicationFile,
  editApplicationContact,
} from "../controller/applicationController";

import { exportPdsExcel } from "../controller/pdsExportController";

export const application = (fastify: FastifyInstance) => {
  fastify.post("/submit-application", () => {});
  // Download a filled CS Form 212 (.xlsx). `?id=<applicationId>` for an
  // application, or `?userId=<userId>` for an onboarded employee.
  fastify.get("/application/pds/export", exportPdsExcel);
  fastify.post("/application/post", { preHandler: authenticated }, postJob);
  fastify.patch(
    "/application/post/update/status",
    { preHandler: authenticated },
    updatePostApplication,
  );
  fastify.post(
    "/application/post-requirement",
    { preHandler: authenticated },
    createPobJobRequirements,
  );
  fastify.get(
    "/application/post-job/requirement",
    { preHandler: authenticated },
    postJobRequirements,
  );
  fastify.delete(
    "/application/post-job/delete",
    { preHandler: authenticated },
    removePostJobRequirements,
  );
  fastify.delete(
    "/application/post-job/requirements/delete",
    { preHandler: authenticated },
    postJobRequirementsRemoveAsset,
  );

  fastify.patch(
    "/application/update-job/requirement",
    { preHandler: authenticated },
    updatePostJobRequiments,
  );
  fastify.patch(
    "/application/post/update",
    { preHandler: authenticated },
    updatePostJob,
  );

  fastify.get("/application/job-post", jobPost);
  fastify.post("/application/submission", submitApplication);
  fastify.get(
    "/application/list",
    { preHandler: authenticated },
    applicationList,
  );
  fastify.get(
    "/application/data",
    { preHandler: authenticated },
    applicationData,
  );
  fastify.post(
    "/application/contact-applicant",
    { preHandler: authenticated },
    contactApplicant,
  );
  fastify.post(
    "/application/contact-applicant/bulk",
    { preHandler: authenticated },
    contactManyApplicants,
  );
  fastify.get(
    "/application/conversation",
    { preHandler: authenticated },
    applicationConvertion,
  );
  fastify.get(
    "/application/public/conversation",
    { preHandler: tempAuthenticated },
    applicationConvertion,
  );
  fastify.post(
    "/application/send/applicant-conversation",
    sendPublicApplicationMessage,
  );
  fastify.post(
    "/application/send/admin-conversation",
    { preHandler: authenticated },
    adminApplicationSendConversation,
  );
  fastify.patch(
    "/application/update/status",
    { preHandler: authenticated },
    updateApplicationStatus,
  );
  fastify.get("/application/public/data", applicationData);
  // PUBLIC applicant action — the applicationId UUID is the credential.
  fastify.post("/application/public/withdraw", withdrawApplication);
  fastify.post("/application/public/reupload", reuploadApplicationFile);
  fastify.patch("/application/public/edit-contact", editApplicationContact);
  fastify.post("/application/user/registration", applicationRegisterUser);

  fastify.patch(
    "/application/conclude",
    { preHandler: authenticated },
    concludeApplication,
  );
  fastify.delete(
    "/application/delete",
    { preHandler: authenticated },
    deleteApplication,
  );
  fastify.post(
    "/application/delete-selected",
    { preHandler: authenticated },
    applicationDeleteMany,
  );
};
