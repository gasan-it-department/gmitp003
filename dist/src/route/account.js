"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.accounts = void 0;
const handler_1 = require("../middleware/handler");
const accountController_1 = require("../controller/accountController");
const accountSelfDeleteController_1 = require("../controller/accountSelfDeleteController");
const accounts = (fastify) => {
    fastify.get("/accounts", accountController_1.accountList);
    fastify.post("/account/send-reset-link", { preHandler: handler_1.authenticated }, accountController_1.sendResetPasswordLink);
    fastify.patch("/account/user/reset-password", accountController_1.resetUserPassword);
    // PUBLIC — logged-out "forgot password" from the login page. Keyed by
    // username; emails a one-time reset link to the account's on-file email.
    fastify.post("/account/forgot-password", accountController_1.forgotPassword);
    // Admin-panel account management (open, like /accounts).
    fastify.patch("/account/status", accountController_1.adminSetAccountStatus);
    fastify.delete("/account/delete", accountController_1.adminDeleteAccount);
    // Self-service deletion, required by App Store Review 5.1.1(v). Distinct
    // from the admin route above: it acts on the CALLER's own account and
    // re-checks their password first.
    fastify.post("/account/self-delete", { preHandler: handler_1.authenticated }, accountSelfDeleteController_1.selfDeleteAccount);
};
exports.accounts = accounts;
