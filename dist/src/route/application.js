"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.application = void 0;
const handler_1 = require("../middleware/handler");
const applicationController_1 = require("../controller/applicationController");
const pdsExportController_1 = require("../controller/pdsExportController");
const application = (fastify) => {
    fastify.post("/submit-application", () => { });
    // Download a filled CS Form 212 (.xlsx). `?id=<applicationId>` for an
    // application, or `?userId=<userId>` for an onboarded employee.
    fastify.get("/application/pds/export", pdsExportController_1.exportPdsExcel);
    fastify.post("/application/post", { preHandler: handler_1.authenticated }, applicationController_1.postJob);
    fastify.patch("/application/post/update/status", { preHandler: handler_1.authenticated }, applicationController_1.updatePostApplication);
    fastify.post("/application/post-requirement", { preHandler: handler_1.authenticated }, applicationController_1.createPobJobRequirements);
    fastify.get("/application/post-job/requirement", { preHandler: handler_1.authenticated }, applicationController_1.postJobRequirements);
    fastify.delete("/application/post-job/delete", { preHandler: handler_1.authenticated }, applicationController_1.removePostJobRequirements);
    fastify.delete("/application/post-job/requirements/delete", { preHandler: handler_1.authenticated }, applicationController_1.postJobRequirementsRemoveAsset);
    fastify.patch("/application/update-job/requirement", { preHandler: handler_1.authenticated }, applicationController_1.updatePostJobRequiments);
    fastify.patch("/application/post/update", { preHandler: handler_1.authenticated }, applicationController_1.updatePostJob);
    fastify.get("/application/job-post", applicationController_1.jobPost);
    fastify.post("/application/submission", applicationController_1.submitApplication);
    fastify.get("/application/list", { preHandler: handler_1.authenticated }, applicationController_1.applicationList);
    fastify.get("/application/data", { preHandler: handler_1.authenticated }, applicationController_1.applicationData);
    fastify.post("/application/contact-applicant", { preHandler: handler_1.authenticated }, applicationController_1.contactApplicant);
    fastify.post("/application/contact-applicant/bulk", { preHandler: handler_1.authenticated }, applicationController_1.contactManyApplicants);
    fastify.get("/application/conversation", { preHandler: handler_1.authenticated }, applicationController_1.applicationConvertion);
    fastify.get("/application/public/conversation", { preHandler: handler_1.tempAuthenticated }, applicationController_1.applicationConvertion);
    fastify.post("/application/send/applicant-conversation", applicationController_1.sendPublicApplicationMessage);
    fastify.post("/application/send/admin-conversation", { preHandler: handler_1.authenticated }, applicationController_1.adminApplicationSendConversation);
    fastify.patch("/application/update/status", { preHandler: handler_1.authenticated }, applicationController_1.updateApplicationStatus);
    fastify.get("/application/public/data", applicationController_1.applicationData);
    // PUBLIC applicant action — the applicationId UUID is the credential.
    fastify.post("/application/public/withdraw", applicationController_1.withdrawApplication);
    fastify.post("/application/public/reupload", applicationController_1.reuploadApplicationFile);
    fastify.patch("/application/public/edit-contact", applicationController_1.editApplicationContact);
    // PUBLIC applicant action — safe PARTIAL update (any section, only sent fields)
    fastify.patch("/application/public/update", applicationController_1.updatePublicApplication);
    fastify.post("/application/user/registration", applicationController_1.applicationRegisterUser);
    fastify.patch("/application/conclude", { preHandler: handler_1.authenticated }, applicationController_1.concludeApplication);
    fastify.delete("/application/delete", { preHandler: handler_1.authenticated }, applicationController_1.deleteApplication);
    fastify.post("/application/delete-selected", { preHandler: handler_1.authenticated }, applicationController_1.applicationDeleteMany);
};
exports.application = application;
