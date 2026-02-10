import { FastifyInstance } from "../barrel/fastify";
import {
  backUpInventoryLineData,
  createLine,
} from "../controller/lineController";
import { adminAuthenticated, authenticated } from "../middleware/handler";
import {
  getLines,
  getAllLine,
  lineUpdateStatus,
  deleteLine,
  registerLine,
  checkLineInvitation,
  userDataRegister,
} from "../controller/lineController";
export const lineRoutes = async (fastify: FastifyInstance) => {
  fastify.post("/create-line", { preHandler: adminAuthenticated }, createLine);
  fastify.get("/lines", getLines);
  fastify.get("/line/list", { preHandler: adminAuthenticated }, getAllLine);
  fastify.patch(
    "/line/update/status",
    { preHandler: adminAuthenticated },
    lineUpdateStatus,
  );
  fastify.delete(
    "/line/delete",
    { preHandler: adminAuthenticated },
    deleteLine,
  );
  fastify.post("/line/register", registerLine);
  fastify.post(
    "/line/inventory/back-up",
    { preHandler: authenticated },
    backUpInventoryLineData,
  );
  fastify.get("/line/invitation", checkLineInvitation);
  fastify.post("/line/user/register", userDataRegister);
};
