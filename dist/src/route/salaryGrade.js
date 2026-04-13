"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.salaryGrade = void 0;
const handler_1 = require("../middleware/handler");
const salaryGradeController_1 = require("../controller/salaryGradeController");
const salaryGrade = (fastify) => {
    fastify.get("/salary-grade/list", { preHandler: handler_1.authenticated }, salaryGradeController_1.salaryGradeList);
    fastify.get("/salary-grade/new", salaryGradeController_1.saveNewSalaryGrade);
    fastify.patch("/salary-grade/update", { preHandler: handler_1.authenticated }, salaryGradeController_1.updateSalaryGrade);
};
exports.salaryGrade = salaryGrade;
