import { FastifyInstance } from "../barrel/fastify";
import { authSchema, registerSchema } from "../models/request";
//handlers
import { authenticated } from "../middleware/handler";

//controllers
import { getAllEmpoyees, searchUser } from "../controller/employee";

//models, interface
import { employeeSchema } from "../models/request";

export const employee = (fastify: FastifyInstance) => {
  fastify.post("/employees", { schema: employeeSchema }, getAllEmpoyees);
  fastify.get("/search-user", { preHandler: authenticated }, searchUser);
};
