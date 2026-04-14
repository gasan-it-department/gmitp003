"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.lineRoutes = void 0;
const lineController_1 = require("../controller/lineController");
const handler_1 = require("../middleware/handler");
const lineController_2 = require("../controller/lineController");
const lineRoutes = (fastify) => __awaiter(void 0, void 0, void 0, function* () {
    fastify.post("/create-line", { preHandler: handler_1.adminAuthenticated }, lineController_1.createLine);
    fastify.get("/lines", lineController_2.getLines);
    fastify.get("/line/list", lineController_2.getAllLine);
    fastify.patch("/line/update/status", { preHandler: handler_1.adminAuthenticated }, lineController_2.lineUpdateStatus);
    fastify.delete("/line/delete", { preHandler: handler_1.adminAuthenticated }, lineController_2.deleteLine);
    fastify.post("/line/register", lineController_2.registerLine);
    fastify.post("/line/inventory/back-up", { preHandler: handler_1.authenticated }, lineController_1.backUpInventoryLineData);
    fastify.get("/line/invitation", lineController_2.checkLineInvitation);
    fastify.post("/line/user/register", lineController_2.userDataRegister);
});
exports.lineRoutes = lineRoutes;
