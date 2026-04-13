"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.accounts = void 0;
const handler_1 = require("../middleware/handler");
const accountController_1 = require("../controller/accountController");
const accounts = (fastify) => {
    fastify.get("/accounts", accountController_1.accountList);
    fastify.post("/account/send-reset-link", { preHandler: handler_1.authenticated }, accountController_1.sendResetPasswordLink);
    fastify.patch("/account/user/reset-password", accountController_1.resetUserPassword);
};
exports.accounts = accounts;
