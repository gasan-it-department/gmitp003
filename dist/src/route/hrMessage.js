"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.hrMessage = void 0;
const handler_1 = require("../middleware/handler");
const hrMessageController_1 = require("../controller/hrMessageController");
const hrMessage = (fastify) => {
    const auth = { preHandler: handler_1.authenticated };
    // Composing aids
    fastify.get("/hr/message/placeholders", auth, hrMessageController_1.placeholderCatalogue);
    fastify.post("/hr/message/preview", auth, hrMessageController_1.previewMessage);
    // Templates
    fastify.get("/hr/message/templates", auth, hrMessageController_1.listTemplates);
    fastify.post("/hr/message/template", auth, hrMessageController_1.saveTemplate);
    fastify.delete("/hr/message/template/:id", auth, hrMessageController_1.deleteTemplate);
    // Employee directory, for adding recipients to a draft
    fastify.get("/hr/message/employees", auth, hrMessageController_1.searchEmployees);
    // Batches
    fastify.get("/hr/message/batches", auth, hrMessageController_1.listBatches);
    fastify.post("/hr/message/batch", auth, hrMessageController_1.createBatch);
    fastify.get("/hr/message/batch/:id", auth, hrMessageController_1.batchDetail);
    fastify.patch("/hr/message/batch/:id", auth, hrMessageController_1.updateBatch);
    fastify.delete("/hr/message/batch/:id", auth, hrMessageController_1.deleteBatch);
    // Recipients on a draft
    fastify.post("/hr/message/batch/:id/recipients", auth, hrMessageController_1.addRecipients);
    fastify.delete("/hr/message/batch/:id/recipient/:recipientId", auth, hrMessageController_1.removeRecipient);
    // Dispatch
    fastify.post("/hr/message/batch/:id/send", auth, hrMessageController_1.sendBatch);
    fastify.post("/hr/message/batch/:id/retry", auth, hrMessageController_1.retryBatch);
};
exports.hrMessage = hrMessage;
