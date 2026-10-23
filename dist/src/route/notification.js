"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.notification = void 0;
const handler_1 = require("../middleware/handler");
const notificationController_1 = require("../controller/notificationController");
const notification = (fastify) => {
    fastify.get("/notification/list", { preHandler: handler_1.authenticated }, notificationController_1.notifications);
    fastify.patch("/notification/view", { preHandler: handler_1.authenticated }, notificationController_1.viewNotifcation);
    fastify.patch("/notification/mark-as-read", { preHandler: handler_1.authenticated }, notificationController_1.markAsRead);
    // Disabled along with @fastify/websocket — Socket.IO covers real-time
    // notification delivery. Re-enable only if you bring fastify-websocket
    // back (see comment in src/index.ts).
    // fastify.get("/notification/realtime", { websocket: true }, realTimeNoif);
};
exports.notification = notification;
