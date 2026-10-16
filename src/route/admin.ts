import { FastifyInstance } from "../barrel/fastify";
import { adminAuth, creteAdmin } from "../controller/adminAuth";
import { adminLogs, adminLogTypes } from "../controller/adminLogsController";
import {
  adminBackupExport,
  adminBackupImport,
} from "../controller/adminBackupController";
import { adminAuthenticated } from "../middleware/handler";
import { adminLoginScehma } from "../models/request";
import { openLineHrSession } from "../controller/adminLineHrController";
import { blobIntegrity } from "../controller/blobIntegrityController";
import {
  getSalarySteps,
  putSalarySteps,
} from "../controller/salaryStepController";
export const admin = (fastify: FastifyInstance) => {
  fastify.post("/admin-login", { schema: adminLoginScehma }, adminAuth);
  fastify.post("/create-admin", { preHandler: adminAuthenticated, schema: adminLoginScehma }, creteAdmin);
  fastify.get("/admin-inbox", { preHandler: adminAuthenticated }, async (req, res) => {});
  // Audit logs for the admin panel. Open, like the other admin-panel list
  // endpoints (/accounts, /line/list).
  fastify.get("/admin/log-types", { preHandler: adminAuthenticated }, adminLogTypes);
  fastify.get("/admin/logs", { preHandler: adminAuthenticated }, adminLogs);
  // Confirm every file the database points at is still in the bucket and
  // still matches its recorded digest. Read-only; ?count=1 for row counts
  // without fetching objects.
  /*
    The salary grid: grade x step x tranche. Admin-gated because these
    figures are everybody's pay, and keyed by hand from a scanned DBM
    circular. GET with no grade reports coverage per tranche, so a
    half-entered schedule is visible before a payroll run uses it.
  */
  fastify.get(
    "/admin/salary-steps",
    { preHandler: adminAuthenticated },
    getSalarySteps,
  );
  fastify.post(
    "/admin/salary-steps",
    { preHandler: adminAuthenticated },
    putSalarySteps,
  );
  fastify.post(
    "/admin/blob-integrity",
    { preHandler: adminAuthenticated },
    blobIntegrity,
  );
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
  // Mint a real line session so the super-admin can manage that line's HR
  // (the whole existing HR module, scoped to the line).
  fastify.post(
    "/admin/line/:lineId/hr-session",
    { preHandler: adminAuthenticated },
    openLineHrSession,
  );
};
