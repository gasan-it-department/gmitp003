import { FastifyInstance } from "../barrel/fastify";
import { adminAuth, creteAdmin } from "../controller/adminAuth";
import { adminLogs, adminLogTypes } from "../controller/adminLogsController";
import {
  adminBackupExport,
  adminBackupImport,
} from "../controller/adminBackupController";
import { adminAuthenticated } from "../middleware/handler";
import { adminLoginScehma } from "../models/request";
export const admin = (fastify: FastifyInstance) => {
  fastify.post("/admin-login", { schema: adminLoginScehma }, adminAuth);
  fastify.post("/create-admin", { schema: adminLoginScehma }, creteAdmin);
  fastify.get("/admin-inbox", async (req, res) => {});
  // Audit logs for the admin panel. Open, like the other admin-panel list
  // endpoints (/accounts, /line/list).
  fastify.get("/admin/log-types", adminLogTypes);
  fastify.get("/admin/logs", adminLogs);
  // Full-database backup / restore — gated by the admin token, and the import
  // accepts a large JSON body.
  fastify.get(
    "/admin/backup/export",
    { preHandler: adminAuthenticated },
    adminBackupExport,
  );
  fastify.post(
    "/admin/backup/import",
    { preHandler: adminAuthenticated, bodyLimit: 100 * 1024 * 1024 },
    adminBackupImport,
  );
};
