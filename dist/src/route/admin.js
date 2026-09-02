"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.admin = void 0;
const adminAuth_1 = require("../controller/adminAuth");
const adminLogsController_1 = require("../controller/adminLogsController");
const adminBackupController_1 = require("../controller/adminBackupController");
const handler_1 = require("../middleware/handler");
const request_1 = require("../models/request");
const adminLineHrController_1 = require("../controller/adminLineHrController");
const admin = (fastify) => {
    fastify.post("/admin-login", { schema: request_1.adminLoginScehma }, adminAuth_1.adminAuth);
    fastify.post("/create-admin", { schema: request_1.adminLoginScehma }, adminAuth_1.creteAdmin);
    fastify.get("/admin-inbox", (req, res) => __awaiter(void 0, void 0, void 0, function* () { }));
    // Audit logs for the admin panel. Open, like the other admin-panel list
    // endpoints (/accounts, /line/list).
    fastify.get("/admin/log-types", adminLogsController_1.adminLogTypes);
    fastify.get("/admin/logs", adminLogsController_1.adminLogs);
    // Full-database backup / restore — gated by the admin token, and the import
    // accepts a large JSON body.
    fastify.get("/admin/backup/export", { preHandler: handler_1.adminAuthenticated }, adminBackupController_1.adminBackupExport);
    fastify.post("/admin/backup/import", { preHandler: handler_1.adminAuthenticated, bodyLimit: 100 * 1024 * 1024 }, adminBackupController_1.adminBackupImport);
    // Mint a real line session so the super-admin can manage that line's HR
    // (the whole existing HR module, scoped to the line).
    fastify.post("/admin/line/:lineId/hr-session", { preHandler: handler_1.adminAuthenticated }, adminLineHrController_1.openLineHrSession);
};
exports.admin = admin;
