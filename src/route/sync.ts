import { FastifyInstance } from "../barrel/fastify";
import { authenticated } from "../middleware/handler";
import {
  syncHealth,
  syncPing,
  syncPush,
  syncPull,
  pollNotifications,
  desktopUpdate,
} from "../controller/syncController";

/**
 * Offline-first sync API for the Gasan Pharmacy desktop app. All routes are
 * token-authenticated (same Bearer token the web app uses) and scoped to the
 * account's line inside the controller.
 */
export const sync = (fastify: FastifyInstance) => {
  // unauthenticated: just "is the server reachable?"
  fastify.get("/sync/health", syncHealth);
  // unauthenticated: desktop auto-update manifest (version + download url)
  fastify.get("/desktop/update", desktopUpdate);
  // authenticated: token still valid + data sync
  fastify.get("/sync/ping", { preHandler: authenticated }, syncPing);
  fastify.post("/sync/push", { preHandler: authenticated }, syncPush);
  fastify.get("/sync/pull", { preHandler: authenticated }, syncPull);
  // authenticated: realtime notification long-poll (Pharmacy Desktop)
  fastify.get(
    "/sync/notify/poll",
    { preHandler: authenticated },
    pollNotifications,
  );
};
