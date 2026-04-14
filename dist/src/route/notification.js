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
exports.notification = void 0;
const __1 = require("..");
const handler_1 = require("../middleware/handler");
const notificationController_1 = require("../controller/notificationController");
const notification = (fastify) => {
    fastify.post("/notification/send", (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        const params = req.body;
        try {
            console.log("✅ /notification/send route HIT");
            __1.notificationSocket.sendToUser(params.userId, {
                title: params.title,
                message: "",
                type: "",
                userId: params.userId,
            });
            // await sendEmail(
            //   "Test Sub",
            //   "juderibleza36@gmail.com",
            //   "",
            //   "Gasan Portal - Pharmaceuticals"
            // );
            // const { userId, title, message, type = "info" } = req.body;
            // // Validate required fields
            // if (!userId || !title || !message) {
            //   console.log("❌ Missing required fields");
            //   return res.code(400).send({
            //     error: "Missing required fields: userId, title, message",
            //   });
            // }
            // // Send notification to user
            // notificationSocket.sendToUser(userId, {
            //   title,
            //   message,
            //   type,
            //   userId,
            // });
            // console.log("✅ After calling sendToUser");
            // return res.code(200).send({
            //   message: "Notification sent successfully",
            //   data: { userId, title, message, type },
            //   connectedUsers: notificationSocket.getConnectedUsersCount(),
            // });
        }
        catch (error) {
            console.log("❌ Error in /notification/send:", error);
            return res.code(500).send({ error: "Failed to send notification" });
        }
    }));
    fastify.get("/notification/list", { preHandler: handler_1.authenticated }, notificationController_1.notifications);
    fastify.patch("/notification/view", { preHandler: handler_1.authenticated }, notificationController_1.viewNotifcation);
    fastify.patch("/notification/mark-as-read", { preHandler: handler_1.authenticated }, notificationController_1.markAsRead);
    fastify.get("/notification/realtime", { websocket: true }, notificationController_1.realTimeNoif);
};
exports.notification = notification;
