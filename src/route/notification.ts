// route/notification.ts
import { FastifyInstance } from "../barrel/fastify";
import { authenticated } from "../middleware/handler";
import {
  markAsRead,
  notifications,
  viewNotifcation,
} from "../controller/notificationController";

export const notification = (fastify: FastifyInstance) => {
  fastify.get(
    "/notification/list",
    { preHandler: authenticated },
    notifications,
  );
  fastify.patch(
    "/notification/view",
    { preHandler: authenticated },
    viewNotifcation,
  );
  fastify.patch(
    "/notification/mark-as-read",
    { preHandler: authenticated },
    markAsRead,
  );
  // Disabled along with @fastify/websocket — Socket.IO covers real-time
  // notification delivery. Re-enable only if you bring fastify-websocket
  // back (see comment in src/index.ts).
  // fastify.get("/notification/realtime", { websocket: true }, realTimeNoif);
};
