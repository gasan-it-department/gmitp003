"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.attendance = void 0;
const handler_1 = require("../middleware/handler");
const attendanceController_1 = require("../controller/attendanceController");
const attendance = (fastify) => {
    // ── HR / web ────────────────────────────────────────────────────────────
    fastify.get("/attendance/fields", { preHandler: handler_1.authenticated }, attendanceController_1.attendanceFields);
    fastify.post("/attendance/event", { preHandler: handler_1.authenticated }, attendanceController_1.createAttendanceEvent);
    fastify.get("/attendance/events", { preHandler: handler_1.authenticated }, attendanceController_1.listAttendanceEvents);
    fastify.get("/attendance/event/:eventId", { preHandler: handler_1.authenticated }, attendanceController_1.attendanceEventDetail);
    fastify.patch("/attendance/event/:eventId", { preHandler: handler_1.authenticated }, attendanceController_1.updateAttendanceEvent);
    fastify.delete("/attendance/event/:eventId", { preHandler: handler_1.authenticated }, attendanceController_1.deleteAttendanceEvent);
    fastify.get("/attendance/event/:eventId/records", { preHandler: handler_1.authenticated }, attendanceController_1.attendanceRecords);
    fastify.get("/attendance/event/:eventId/export", { preHandler: handler_1.authenticated }, attendanceController_1.exportAttendance);
    fastify.delete("/attendance/record/:recordId", { preHandler: handler_1.authenticated }, attendanceController_1.deleteAttendanceRecord);
    // ── Scanner access grants ───────────────────────────────────────────────
    fastify.get("/attendance/mobile-access", { preHandler: handler_1.authenticated }, attendanceController_1.listAttendanceAccess);
    fastify.post("/attendance/mobile-access", { preHandler: handler_1.authenticated }, attendanceController_1.grantAttendanceAccess);
    fastify.delete("/attendance/mobile-access/:accessId", { preHandler: handler_1.authenticated }, attendanceController_1.revokeAttendanceAccess);
    // ── Mobile scanner (gated: super-admin, HRMO, or explicit grant) ────────
    fastify.get("/attendance/mobile/events", { preHandler: [handler_1.authenticated, handler_1.attendanceMobileAuth] }, attendanceController_1.mobileAttendanceEvents);
    fastify.post("/attendance/resolve", { preHandler: [handler_1.authenticated, handler_1.attendanceMobileAuth] }, attendanceController_1.resolveAttendanceScan);
    fastify.post("/attendance/confirm", { preHandler: [handler_1.authenticated, handler_1.attendanceMobileAuth] }, attendanceController_1.confirmAttendance);
    // Flush path for scans captured with no signal.
    fastify.post("/attendance/confirm/bulk", { preHandler: [handler_1.authenticated, handler_1.attendanceMobileAuth] }, attendanceController_1.confirmAttendanceBulk);
};
exports.attendance = attendance;
