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
const stepIncrementController_1 = require("../controller/stepIncrementController");
const employee = (fastify) => {
    fastify.post("/employees", { schema: request_1.employeeSchema }, employee_1.getAllEmpoyees);
    fastify.get("/search-user", { preHandler: handler_1.authenticated }, employee_1.searchUser);
    fastify.get("/employee-list", { preHandler: handler_1.authenticated }, employee_1.employees);
    fastify.get("/user/profile", { preHandler: handler_1.authenticated }, employee_1.decryptUserData);
    /*
      Step increments by length of service. HR only — `requireHr` inside
      each handler, on top of `authenticated` here, because approving an
      increment raises somebody's pay and the person it benefits must not
      be the one who approves it.
    */
    fastify.get("/hr/step-increments/due", { preHandler: handler_1.authenticated }, stepIncrementController_1.stepIncrementsDue);
    fastify.get("/hr/step-increments", { preHandler: handler_1.authenticated }, stepIncrementController_1.stepIncrementsList);
    fastify.post("/hr/step-increments/propose", { preHandler: handler_1.authenticated }, stepIncrementController_1.stepIncrementsPropose);
    fastify.post("/hr/step-increments/decide", { preHandler: handler_1.authenticated }, stepIncrementController_1.stepIncrementsDecide);
    fastify.post("/hr/step-increments/service-record", { preHandler: handler_1.authenticated }, stepIncrementController_1.stepIncrementsSetServiceRecord);
    fastify.get("/user/view-profile", { preHandler: handler_1.authenticated }, employee_1.viewUserProfile);
    fastify.get("/user/module-access", { preHandler: handler_1.authenticated }, employee_1.userModuleAccess);
    // The logged-in employee's ID-card verify QR (mobile profile screen).
    fastify.get("/user/my-verify-qr", { preHandler: handler_1.authenticated }, idCardController_1.myVerifyQr);
    fastify.patch("/user/suspend", { preHandler: handler_1.authenticated }, employee_1.supsendAccount);
    // HR renames an employee's login. The handler checks the caller runs HR
    // for that employee's municipality; `authenticated` only gets it a token.
    fastify.patch("/user/username", { preHandler: handler_1.authenticated }, employee_1.changeEmployeeUsername);
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
