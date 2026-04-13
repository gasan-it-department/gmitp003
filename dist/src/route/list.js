"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.list = void 0;
const listController_1 = require("../controller/listController");
const handler_1 = require("../middleware/handler");
const request_1 = require("../models/request");
const list = (fastify) => {
    fastify.post("/create-list", { preHandler: handler_1.authenticated, schema: request_1.listSchema }, listController_1.createList);
    fastify.get("/list", listController_1.list);
    fastify.get("/list-data", { preHandler: handler_1.authenticated, schema: request_1.listDataSchema }, listController_1.listData);
    fastify.post("/add-list-access", { preHandler: handler_1.authenticated, schema: request_1.addAccessToListSchema }, listController_1.addListAccess);
    fastify.get("/access-list", { preHandler: handler_1.authenticated, schema: request_1.listSchema }, listController_1.listAccessUsers);
    fastify.delete("/delete-list", { schema: request_1.deleteListSchema, preHandler: handler_1.authenticated }, listController_1.deleteList);
    fastify.delete("/list/remove", { preHandler: handler_1.authenticated }, listController_1.removeList);
};
exports.list = list;
