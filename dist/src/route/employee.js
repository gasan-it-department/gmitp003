"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.employee = void 0;
//handlers
const handler_1 = require("../middleware/handler");
//controllers
const employee_1 = require("../controller/employee");
const idCardController_1 = require("../controller/idCardController");
//models, interface
const request_1 = require("../models/request");
const employee = (fastify) => {
    fastify.post("/employees", { schema: request_1.employeeSchema }, employee_1.getAllEmpoyees);
    fastify.get("/search-user", { preHandler: handler_1.authenticated }, employee_1.searchUser);
    fastify.get("/employee-list", { preHandler: handler_1.authenticated }, employee_1.employees);
    fastify.get("/user/profile", { preHandler: handler_1.authenticated }, employee_1.decryptUserData);
    fastify.get("/user/view-profile", { preHandler: handler_1.authenticated }, employee_1.viewUserProfile);
    fastify.get("/user/module-access", { preHandler: handler_1.authenticated }, employee_1.userModuleAccess);
    // The logged-in employee's ID-card verify QR (mobile profile screen).
    fastify.get("/user/my-verify-qr", { preHandler: handler_1.authenticated }, idCardController_1.myVerifyQr);
    fastify.patch("/user/suspend", { preHandler: handler_1.authenticated }, employee_1.supsendAccount);
    fastify.delete("/user/delete", { preHandler: handler_1.authenticated }, employee_1.deleteUser);
    fastify.get("/user/record", { preHandler: handler_1.authenticated }, employee_1.userRecord);
    fastify.get("/archived-personnel", { preHandler: handler_1.authenticated }, employee_1.archivedPersonnel);
    fastify.post("/archived-personnel/restore", { preHandler: handler_1.authenticated }, employee_1.restorePersonnel);
    fastify.get("/user/verify-info", { preHandler: handler_1.authenticated }, employee_1.userVerifyInfo);
    fastify.post("/user/profile-picture", { preHandler: handler_1.authenticated }, employee_1.updateProfilePicture);
    // PUBLIC — image is loaded via <img src>, so no auth header is sent.
    fastify.get("/user/photo/:userId", employee_1.servePhoto);
    // PUBLIC — scanned from an ID's QR; no auth so anyone can verify.
    fastify.get("/id/verify", employee_1.verifyId);
    // Bulk ID card issuing — list + imposed PDF export (front/rear files).
    fastify.get("/id/issue-list", { preHandler: handler_1.authenticated }, idCardController_1.idIssueList);
    fastify.post("/id/export-batch", 
    // template carries two base64 images — allow a larger body than the default
    { preHandler: handler_1.authenticated, bodyLimit: 25 * 1024 * 1024 }, idCardController_1.idExportBatch);
};
exports.employee = employee;
