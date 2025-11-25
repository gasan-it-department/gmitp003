import { FastifyInstance } from "../barrel/fastify";
import { authenticated } from "../middleware/handler";

import {
  salaryGradeList,
  saveNewSalaryGrade,
} from "../controller/salaryGradeController";
export const salaryGrade = (fastify: FastifyInstance) => {
  fastify.get(
    "/salary-grade/list",
    { preHandler: authenticated },
    salaryGradeList
  );
  fastify.get("/salary-grade/new", saveNewSalaryGrade);
};
