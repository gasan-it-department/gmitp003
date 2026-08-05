import { FastifyInstance } from "../barrel/fastify";
import { authenticated, attendanceMobileAuth } from "../middleware/handler";
import {
  attendanceFields,
  createAttendanceEvent,
  listAttendanceEvents,
  attendanceEventDetail,
  updateAttendanceEvent,
  deleteAttendanceEvent,
  attendanceRecords,
  deleteAttendanceRecord,
  exportAttendance,
  mobileAttendanceEvents,
  resolveAttendanceScan,
  confirmAttendance,
  confirmAttendanceBulk,
  listAttendanceAccess,
  grantAttendanceAccess,
  revokeAttendanceAccess,
} from "../controller/attendanceController";

export const attendance = (fastify: FastifyInstance) => {
  // ── HR / web ────────────────────────────────────────────────────────────
  fastify.get(
    "/attendance/fields",
    { preHandler: authenticated },
    attendanceFields,
  );
  fastify.post(
    "/attendance/event",
    { preHandler: authenticated },
    createAttendanceEvent,
  );
  fastify.get(
    "/attendance/events",
    { preHandler: authenticated },
    listAttendanceEvents,
  );
  fastify.get(
    "/attendance/event/:eventId",
    { preHandler: authenticated },
    attendanceEventDetail,
  );
  fastify.patch(
    "/attendance/event/:eventId",
    { preHandler: authenticated },
    updateAttendanceEvent,
  );
  fastify.delete(
    "/attendance/event/:eventId",
    { preHandler: authenticated },
    deleteAttendanceEvent,
  );
  fastify.get(
    "/attendance/event/:eventId/records",
    { preHandler: authenticated },
    attendanceRecords,
  );
  fastify.get(
    "/attendance/event/:eventId/export",
    { preHandler: authenticated },
    exportAttendance,
  );
  fastify.delete(
    "/attendance/record/:recordId",
    { preHandler: authenticated },
    deleteAttendanceRecord,
  );

  // ── Scanner access grants ───────────────────────────────────────────────
  fastify.get(
    "/attendance/mobile-access",
    { preHandler: authenticated },
    listAttendanceAccess,
  );
  fastify.post(
    "/attendance/mobile-access",
    { preHandler: authenticated },
    grantAttendanceAccess,
  );
  fastify.delete(
    "/attendance/mobile-access/:accessId",
    { preHandler: authenticated },
    revokeAttendanceAccess,
  );

  // ── Mobile scanner (gated: super-admin, HRMO, or explicit grant) ────────
  fastify.get(
    "/attendance/mobile/events",
    { preHandler: [authenticated, attendanceMobileAuth] },
    mobileAttendanceEvents,
  );
  fastify.post(
    "/attendance/resolve",
    { preHandler: [authenticated, attendanceMobileAuth] },
    resolveAttendanceScan,
  );
  fastify.post(
    "/attendance/confirm",
    { preHandler: [authenticated, attendanceMobileAuth] },
    confirmAttendance,
  );
  // Flush path for scans captured with no signal.
  fastify.post(
    "/attendance/confirm/bulk",
    { preHandler: [authenticated, attendanceMobileAuth] },
    confirmAttendanceBulk,
  );
};
