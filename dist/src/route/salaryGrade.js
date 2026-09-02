"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.salaryGrade = void 0;
const handler_1 = require("../middleware/handler");
const salaryGradeController_1 = require("../controller/salaryGradeController");
const salaryGrade = (fastify) => {
    fastify.get("/salary-grade/list", { preHandler: handler_1.authenticated }, salaryGradeController_1.salaryGradeList);
    fastify.get("/salary-grade/new", salaryGradeController_1.saveNewSalaryGrade);
    fastify.patch("/salary-grade/update", { preHandler: handler_1.authenticated }, salaryGradeController_1.updateSalaryGrade);
    fastify.get("/salary-grade/info", { preHandler: handler_1.authenticated }, salaryGradeController_1.salaryGradeInfo);
    fastify.get("/salary-grade/history", { preHandler: handler_1.authenticated }, salaryGradeController_1.salaryGradeHistory);
    fastify.get("/salary-grade/users", { preHandler: handler_1.authenticated }, salaryGradeController_1.salaryGradeUsers);
};
exports.salaryGrade = salaryGrade;
