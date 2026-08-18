import { FastifyInstance } from "../barrel/fastify";
import { authenticated } from "../middleware/handler";
import {
  placeholderCatalogue,
  previewMessage,
  listTemplates,
  saveTemplate,
  deleteTemplate,
  searchEmployees,
  listBatches,
  createBatch,
  updateBatch,
  deleteBatch,
  batchDetail,
  addRecipients,
  removeRecipient,
  sendBatch,
  retryBatch,
} from "../controller/hrMessageController";

export const hrMessage = (fastify: FastifyInstance) => {
  const auth = { preHandler: authenticated };

  // Composing aids
  fastify.get("/hr/message/placeholders", auth, placeholderCatalogue);
  fastify.post("/hr/message/preview", auth, previewMessage);

  // Templates
  fastify.get("/hr/message/templates", auth, listTemplates);
  fastify.post("/hr/message/template", auth, saveTemplate);
  fastify.delete("/hr/message/template/:id", auth, deleteTemplate);

  // Employee directory, for adding recipients to a draft
  fastify.get("/hr/message/employees", auth, searchEmployees);

  // Batches
  fastify.get("/hr/message/batches", auth, listBatches);
  fastify.post("/hr/message/batch", auth, createBatch);
  fastify.get("/hr/message/batch/:id", auth, batchDetail);
  fastify.patch("/hr/message/batch/:id", auth, updateBatch);
  fastify.delete("/hr/message/batch/:id", auth, deleteBatch);

  // Recipients on a draft
  fastify.post("/hr/message/batch/:id/recipients", auth, addRecipients);
  fastify.delete(
    "/hr/message/batch/:id/recipient/:recipientId",
    auth,
    removeRecipient,
  );

  // Dispatch
  fastify.post("/hr/message/batch/:id/send", auth, sendBatch);
  fastify.post("/hr/message/batch/:id/retry", auth, retryBatch);
};
