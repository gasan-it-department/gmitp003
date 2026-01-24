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
} from "../controller/employee";

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
    viewUserProfile
  );
  fastify.get(
    "/user/module-access",
    { preHandler: authenticated },
    userModuleAccess
  );
  fastify.patch("/user/suspend", { preHandler: authenticated }, supsendAccount);
};
