import { FastifyInstance } from "../barrel/fastify";
import { authenticated } from "../middleware/handler";
import { announcements } from "../controller/announcementController";
import { announcementsSchema } from "../models/request";

export const announcement = (fastify: FastifyInstance) => {
  fastify.get(
    "/announcements",
    { preHandler: authenticated, schema: announcementsSchema },
    announcements
  );
};
