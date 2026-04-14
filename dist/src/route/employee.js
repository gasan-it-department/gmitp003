"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.employee = void 0;
//handlers
const handler_1 = require("../middleware/handler");
//controllers
const employee_1 = require("../controller/employee");
//models, interface
const request_1 = require("../models/request");
const employee = (fastify) => {
    fastify.post("/employees", { schema: request_1.employeeSchema }, employee_1.getAllEmpoyees);
    fastify.get("/search-user", { preHandler: handler_1.authenticated }, employee_1.searchUser);
    fastify.get("/employee-list", { preHandler: handler_1.authenticated }, employee_1.employees);
    fastify.get("/user/profile", { preHandler: handler_1.authenticated }, employee_1.decryptUserData);
    fastify.get("/user/view-profile", { preHandler: handler_1.authenticated }, employee_1.viewUserProfile);
    fastify.get("/user/module-access", { preHandler: handler_1.authenticated }, employee_1.userModuleAccess);
    fastify.patch("/user/suspend", { preHandler: handler_1.authenticated }, employee_1.supsendAccount);
    fastify.delete("/user/delete", { preHandler: handler_1.authenticated }, employee_1.deleteUser);
};
exports.employee = employee;
