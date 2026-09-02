"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.user = void 0;
const handler_1 = require("../middleware/handler");
//
const userController_1 = require("../controller/userController");
const user = (fastify) => {
    fastify.get("/users", { preHandler: [handler_1.authenticated] }, userController_1.users);
    fastify.get("/users/search", userController_1.searchUsers);
    fastify.get("/user/data", { preHandler: handler_1.authenticated }, userController_1.getUserInfo);
};
exports.user = user;
