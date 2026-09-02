"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sync = void 0;
const handler_1 = require("../middleware/handler");
const syncController_1 = require("../controller/syncController");
/**
 * Offline-first sync API for the Gasan Pharmacy desktop app. All routes are
 * token-authenticated (same Bearer token the web app uses) and scoped to the
 * account's line inside the controller.
 */
const sync = (fastify) => {
    // unauthenticated: just "is the server reachable?"
    fastify.get("/sync/health", syncController_1.syncHealth);
    // unauthenticated: desktop auto-update manifest (version + download url)
    fastify.get("/desktop/update", syncController_1.desktopUpdate);
    // authenticated: token still valid + data sync
    fastify.get("/sync/ping", { preHandler: handler_1.authenticated }, syncController_1.syncPing);
    fastify.post("/sync/push", { preHandler: handler_1.authenticated }, syncController_1.syncPush);
    fastify.get("/sync/pull", { preHandler: handler_1.authenticated }, syncController_1.syncPull);
    // authenticated: realtime notification long-poll (Pharmacy Desktop)
    fastify.get("/sync/notify/poll", { preHandler: handler_1.authenticated }, syncController_1.pollNotifications);
};
exports.sync = sync;
