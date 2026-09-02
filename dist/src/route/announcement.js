"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.announcement = void 0;
const handler_1 = require("../middleware/handler");
const announcementController_1 = require("../controller/announcementController");
const announcement = (fastify) => {
    fastify.get("/announcement/list", { preHandler: handler_1.authenticated }, announcementController_1.announcements);
    fastify.post("/announcement/new", { preHandler: handler_1.authenticated }, announcementController_1.createNewAnnouncement);
    fastify.get("/announcement/data", { preHandler: handler_1.authenticated }, announcementController_1.announcementData);
    fastify.patch("/announcement/publish", { preHandler: handler_1.authenticated }, announcementController_1.publishAnnouncement);
    fastify.patch("/announcement/status/update", { preHandler: handler_1.authenticated }, announcementController_1.announcementUpdateStatus);
    fastify.patch("/announcement/view-announcement", { preHandler: handler_1.authenticated }, announcementController_1.viewAnnouncement);
    fastify.patch("/announcement/toogle-react", { preHandler: handler_1.authenticated }, announcementController_1.markOkayAnnouncement);
    fastify.delete("/announcement/delete", { preHandler: handler_1.authenticated }, announcementController_1.removeAnnouncement);
    fastify.get("/announcement/public", { preHandler: handler_1.authenticated }, announcementController_1.publicAnnouncement);
};
exports.announcement = announcement;
