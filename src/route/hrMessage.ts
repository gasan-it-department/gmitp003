import { FastifyInstance } from "../barrel/fastify";
import { authenticated } from "../middleware/handler";
import {
  placeholderCatalogue,
  listTemplates,
  saveTemplate,
  deleteTemplate,
  searchRecipients,
  sendBatch,
  retryBatch,
  listBatches,
  batchDetail,
  previewMessage,
} from "../controller/hrMessageController";

export const hrMessage = (fastify: FastifyInstance) => {
  fastify.get(
    "/hr/message/placeholders",
    { preHandler: authenticated },
    placeholderCatalogue,
  );

  fastify.post(
    "/hr/message/preview",
    { preHandler: authenticated },
    previewMessage,
  );

  // Templates
  fastify.get(
    "/hr/message/templates",
    { preHandler: authenticated },
    listTemplates,
  );
  fastify.post(
    "/hr/message/template",
    { preHandler: authenticated },
    saveTemplate,
  );
  fastify.delete(
    "/hr/message/template/:id",
    { preHandler: authenticated },
    deleteTemplate,
  );

  // Recipients
  fastify.get(
    "/hr/message/recipients",
    { preHandler: authenticated },
    searchRecipients,
  );

  // Send / retry
  fastify.post("/hr/message/send", { preHandler: authenticated }, sendBatch);
  fastify.post("/hr/message/retry", { preHandler: authenticated }, retryBatch);

  // History
  fastify.get(
    "/hr/message/batches",
    { preHandler: authenticated },
    listBatches,
  );
  fastify.get(
    "/hr/message/batch/:id",
    { preHandler: authenticated },
    batchDetail,
  );
};
