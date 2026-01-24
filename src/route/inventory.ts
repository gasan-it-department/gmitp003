import { FastifyInstance } from "../barrel/fastify";
import {
  inventories,
  createInventory,
  inventoryLogsAccessList,
  inventoryLogs,
  removeContainer,
} from "../controller/inventory";
import { authenticated } from "../middleware/handler";
import { viewContainerAuth } from "../controller/inventory";
export const inventory = (fastify: FastifyInstance) => {
  fastify.post(
    "/create-inventory",
    { preHandler: authenticated },
    createInventory
  );
  fastify.get("/inventories", { preHandler: authenticated }, inventories);
  fastify.get(
    "/view-container",
    { preHandler: authenticated },
    viewContainerAuth
  );
  fastify.get(
    "/container-access",
    { preHandler: authenticated },
    inventoryLogsAccessList
  );
  fastify.get("/inventory/logs", { preHandler: authenticated }, inventoryLogs);
  fastify.delete(
    "/inventory/delete",
    { preHandler: authenticated },
    removeContainer
  );
};
