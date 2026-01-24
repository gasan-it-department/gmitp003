// route/notification.ts
import { FastifyInstance } from "../barrel/fastify";
import { notificationSocket } from "..";
import { authenticated, sendEmail } from "../middleware/handler";
import {
  notifications,
  viewNotifcation,
} from "../controller/notificationController";
interface SendNotificationBody {
  userId: string;
  title: string;
  message: string;
  type?: string;
}

export const notification = (fastify: FastifyInstance) => {
  fastify.post("/notification/send", async (req, res) => {
    const params = req.body as { userId: string; title: string };
    try {
      console.log("✅ /notification/send route HIT");
      notificationSocket.sendToUser(params.userId, {
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
    } catch (error) {
      console.log("❌ Error in /notification/send:", error);
      return res.code(500).send({ error: "Failed to send notification" });
    }
  });
  fastify.get(
    "/notification/list",
    { preHandler: authenticated },
    notifications
  );
  fastify.patch(
    "/notification/view",
    { preHandler: authenticated },
    viewNotifcation
  );
};
