"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.chat = void 0;
const handler_1 = require("../middleware/handler");
const chatController_1 = require("../controller/chatController");
const chat = (fastify) => {
    fastify.get("/chat/rooms", { preHandler: handler_1.authenticated }, chatController_1.chatRooms);
    fastify.get("/chat/messages", { preHandler: handler_1.authenticated }, chatController_1.chatMessages);
    fastify.post("/chat/message", { preHandler: handler_1.authenticated }, chatController_1.chatSend);
    fastify.patch("/chat/message", { preHandler: handler_1.authenticated }, chatController_1.chatEdit);
    fastify.delete("/chat/message", { preHandler: handler_1.authenticated }, chatController_1.chatDelete);
    fastify.post("/chat/read", { preHandler: handler_1.authenticated }, chatController_1.chatMarkRead);
    fastify.post("/chat/mute", { preHandler: handler_1.authenticated }, chatController_1.chatMute);
    fastify.get("/chat/reads", { preHandler: handler_1.authenticated }, chatController_1.chatReads);
    fastify.post("/chat/react", { preHandler: handler_1.authenticated }, chatController_1.chatReact);
    fastify.post("/chat/report", { preHandler: handler_1.authenticated }, chatController_1.chatReport);
    fastify.get("/chat/presence", { preHandler: handler_1.authenticated }, chatController_1.chatPresence);
    fastify.post("/chat/image", { preHandler: handler_1.authenticated }, chatController_1.chatUploadImage);
    fastify.post("/chat/file", { preHandler: handler_1.authenticated }, chatController_1.chatUploadFile);
    // PUBLIC — image/file loaded directly by URL, so no auth header is sent.
    fastify.get("/chat/image/:id", chatController_1.chatServeImage);
    fastify.get("/chat/file/:id", chatController_1.chatServeFile);
};
exports.chat = chat;
