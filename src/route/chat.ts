import { FastifyInstance } from "../barrel/fastify";
import { authenticated } from "../middleware/handler";
import {
  chatRooms,
  chatMessages,
  chatSend,
  chatMarkRead,
  chatMute,
  chatReads,
  chatReact,
  chatEdit,
  chatDelete,
  chatReport,
  chatPresence,
  chatUploadImage,
  chatServeImage,
  chatUploadFile,
  chatServeFile,
} from "../controller/chatController";

export const chat = (fastify: FastifyInstance) => {
  fastify.get("/chat/rooms", { preHandler: authenticated }, chatRooms);
  fastify.get("/chat/messages", { preHandler: authenticated }, chatMessages);
  fastify.post("/chat/message", { preHandler: authenticated }, chatSend);
  fastify.patch("/chat/message", { preHandler: authenticated }, chatEdit);
  fastify.delete("/chat/message", { preHandler: authenticated }, chatDelete);
  fastify.post("/chat/read", { preHandler: authenticated }, chatMarkRead);
  fastify.post("/chat/mute", { preHandler: authenticated }, chatMute);
  fastify.get("/chat/reads", { preHandler: authenticated }, chatReads);
  fastify.post("/chat/react", { preHandler: authenticated }, chatReact);
  fastify.post("/chat/report", { preHandler: authenticated }, chatReport);
  fastify.get("/chat/presence", { preHandler: authenticated }, chatPresence);
  fastify.post("/chat/image", { preHandler: authenticated }, chatUploadImage);
  fastify.post("/chat/file", { preHandler: authenticated }, chatUploadFile);
  // PUBLIC — image/file loaded directly by URL, so no auth header is sent.
  fastify.get("/chat/image/:id", chatServeImage);
  fastify.get("/chat/file/:id", chatServeFile);
};
