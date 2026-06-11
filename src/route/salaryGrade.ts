import { FastifyInstance } from "../barrel/fastify";
import { authenticated } from "../middleware/handler";

import {
  salaryGradeList,
  saveNewSalaryGrade,
  updateSalaryGrade,
  salaryGradeInfo,
  salaryGradeHistory,
  salaryGradeUsers,
} from "../controller/salaryGradeController";
export const salaryGrade = (fastify: FastifyInstance) => {
  fastify.get(
    "/salary-grade/list",
    { preHandler: authenticated },
    salaryGradeList,
  );
  fastify.get("/salary-grade/new", saveNewSalaryGrade);
  fastify.patch(
    "/salary-grade/update",
    { preHandler: authenticated },
    updateSalaryGrade,
  );
  fastify.get(
    "/salary-grade/info",
    { preHandler: authenticated },
    salaryGradeInfo,
  );
  fastify.get(
    "/salary-grade/history",
    { preHandler: authenticated },
    salaryGradeHistory,
  );
  fastify.get(
    "/salary-grade/users",
    { preHandler: authenticated },
    salaryGradeUsers,
  );
};
