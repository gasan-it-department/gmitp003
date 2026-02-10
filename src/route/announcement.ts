import { FastifyInstance } from "../barrel/fastify";
import { authenticated } from "../middleware/handler";
import {
  announcements,
  createNewAnnouncement,
  announcementData,
  publishAnnouncement,
  announcementUpdateStatus,
  viewAnnouncement,
  markOkayAnnouncement,
  removeAnnouncement,
  publicAnnouncement,
} from "../controller/announcementController";

export const announcement = (fastify: FastifyInstance) => {
  fastify.get(
    "/announcement/list",
    { preHandler: authenticated },
    announcements,
  );
  fastify.post(
    "/announcement/new",
    { preHandler: authenticated },
    createNewAnnouncement,
  );
  fastify.get(
    "/announcement/data",
    { preHandler: authenticated },
    announcementData,
  );
  fastify.patch(
    "/announcement/publish",
    { preHandler: authenticated },
    publishAnnouncement,
  );
  fastify.patch(
    "/announcement/status/update",
    { preHandler: authenticated },
    announcementUpdateStatus,
  );
  fastify.patch(
    "/announcement/view-announcement",
    { preHandler: authenticated },
    viewAnnouncement,
  );
  fastify.patch(
    "/announcement/toogle-react",
    { preHandler: authenticated },
    markOkayAnnouncement,
  );
  fastify.delete(
    "/announcement/delete",
    { preHandler: authenticated },
    removeAnnouncement,
  );
  fastify.get(
    "/announcement/public",
    { preHandler: authenticated },
    publicAnnouncement,
  );
};
