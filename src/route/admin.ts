import { FastifyInstance } from "../barrel/fastify";
import { adminAuth, creteAdmin } from "../controller/adminAuth";
import { adminLogs, adminLogTypes } from "../controller/adminLogsController";
import { adminLoginScehma } from "../models/request";
export const admin = (fastify: FastifyInstance) => {
  fastify.post("/admin-login", { schema: adminLoginScehma }, adminAuth);
  fastify.post("/create-admin", { schema: adminLoginScehma }, creteAdmin);
  fastify.get("/admin-inbox", async (req, res) => {});
  // Audit logs for the admin panel. Open, like the other admin-panel list
  // endpoints (/accounts, /line/list).
  fastify.get("/admin/log-types", adminLogTypes);
  fastify.get("/admin/logs", adminLogs);
};
