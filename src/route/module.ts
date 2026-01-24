import { FastifyInstance } from "../barrel/fastify";
import { authenticated } from "../middleware/handler";
import {
  modules as moduleList,
  moduleUsers,
  addModuleAccess,
  userAccessModule,
  removeAccess,
  updateModuleAccess,
} from "../controller/moduleController";

export const modules = (fastify: FastifyInstance) => {
  fastify.get("/module/list", { preHandler: authenticated }, moduleList);
  fastify.get("/module/users", { preHandler: authenticated }, moduleUsers);
  fastify.post(
    "/module/add/acces",
    { preHandler: authenticated },
    addModuleAccess
  );
  fastify.get("/module/user", { preHandler: authenticated }, userAccessModule);
  fastify.patch(
    "/module/remove-access",
    { preHandler: authenticated },
    removeAccess
  );
  fastify.patch(
    "/module/update-access",
    { preHandler: authenticated },
    updateModuleAccess
  );
};
