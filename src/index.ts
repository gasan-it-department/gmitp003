import fastify, { FastifyRequest, FastifyReply } from "fastify";
import multipart from "@fastify/multipart";
import { jwt } from "./barrel/fastify";
import { prisma } from "./barrel/prisma";
import cors from "@fastify/cors";
import { createServer } from "node:http";
import { NotificationSocket } from "./class/NotificationSocket";
import fastifyWebsocket from "@fastify/websocket";
import { mailGun } from "./utils/email";
import { getEnv, getCurrentUrl } from "./utils/env";
//routes
import { auth } from "./route/auth";
import { employee } from "./route/employee";
import { test } from "./route/test";
import { area } from "./route/area";
import { position } from "./route/position";
import { personnel } from "./route/personnel";
import { lineRoutes } from "./route/line";
import { invitation } from "./route/invitation";
import { unit } from "./route/unit";
import { announcement } from "./route/announcement";
import { admin } from "./route/admin";
import { accounts } from "./route/account";
import { dashboard } from "./route/dashboard";
import { inventory } from "./route/inventory";
import { list } from "./route/list";
import { dataSet } from "./route/dataSet";
import { order } from "./route/order";
import { quality } from "./route/quality";
import { overview } from "./route/overview";
import { supplier } from "./route/supplier";
import { medicine } from "./route/medicine";
import { prescription } from "./route/prescription";
import { notification } from "./route/notification";
import { salaryGrade } from "./route/salaryGrade";
import { application } from "./route/application";
import { otp } from "./route/otp";
import { modules } from "./route/module";
import { document } from "./route/document";
//
import { file } from "./route/file";
import { supply } from "./route/supply";

//
import { user } from "./route/user";

import errorHandlerPlugin from "./plugin/errorHandlers";
//

//
import { EncryptionService } from "./service/encryption";
import { testGemini } from "./utils/gemini";
const app = fastify();

//plugin
app.register(fastifyWebsocket);
app.register(errorHandlerPlugin);
app.register(multipart, {
  attachFieldsToBody: false,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB
    files: 10,
  },
});
app.register(jwt, {
  secret: process.env.JWT_SECRET!,
});
app.register(import("@fastify/rate-limit"), {
  max: 100,
  timeWindow: "1 minute",
  global: true,
});

app.register(cors, {
  origin: [
    "http://localhost:5173",
    "https://gasanmarinduque.xyz",
    "https://ckv55gfl-5173.asse.devtunnels.ms",
    "https://lgu-portal.xyz",
  ], // Allow all origins
  methods: ["GET", "POST", "PUT", "DELETE", "PATCH"], // Allowed HTTP methods
  allowedHeaders: [
    "Origin",
    "X-Requested-With",
    "Content-Type",
    "Accept",
    "Authorization",
    "Cache-Control",
    "Upgrade",
    "Connection",
    "Sec-WebSocket-Key",
    "Sec-WebSocket-Version",
    "Sec-WebSocket-Protocol",
    "Sec-WebSocket-Extensions",
  ],
  credentials: true,
  preflightContinue: false,
  exposedHeaders: ["Authorization"],
});

app.register(auth);
app.register(test);
app.register(employee);
app.register(area);
app.register(position);
app.register(lineRoutes);
app.register(invitation);
app.register(unit);
app.register(announcement);
app.register(admin);
app.register(accounts);
app.register(dashboard);
app.register(inventory);
app.register(list);
app.register(dataSet);
app.register(file);
app.register(supply);
app.register(order);
app.register(quality);
app.register(overview);
app.register(supplier);
app.register(user);
app.register(personnel);
app.register(medicine);
app.register(prescription);
app.register(notification);
app.register(salaryGrade);
app.register(application);
app.register(otp);
app.register(modules);
app.register(document);

//middleware
app.get("/admin-test", async (request, reply) => {
  console.log("Admin Reached");

  return reply.code(200).send({ message: "OK na" });
  // const text = "JudePogdasdasd";
  // const encrypted = {
  //   encryptedData: "05f9ee6af31971537b09794e0b35a988",
  //   iv: "5c35cf0ccba9c91a56f5fbc76f178c57",
  // };
  // const encrypt = await EncryptionService.encrypt(text);
  // const decrypt = await EncryptionService.decrypt(
  //   encrypted.encryptedData,
  //   encrypted.iv,
  // );
  // return { encrypt, decrypt };
});
app.get("/test/email", async (request: FastifyRequest, reply: FastifyReply) => {
  const response = await getCurrentUrl();
  return reply.code(200).send({ env: response });
  // const response = await mailGun(
  //   "officeofthemayor.gasan@gmail.com",
  //   "juderibleza36@gmail.com",
  //   "Email Test",
  //   "Test content",
  // );
  // if (!response) {
  //   return { message: "Error" };
  // }
  // return { message: "Email sent" };
});

app.get("/socket/test", { websocket: true }, (connection, req) => {
  console.log("Client connected to /socket/test");

  // Send welcome message
  connection.socket.send(
    JSON.stringify({
      type: "connected",
      message: "Welcome to Fastify WebSocket!",
    }),
  );

  // Handle incoming messages
  connection.socket.on("message", (message: any) => {
    console.log("Received:", message.toString());

    // Echo back
    connection.socket.send(
      JSON.stringify({
        type: "echo",
        data: message.toString(),
      }),
    );
  });

  // Handle disconnection
  connection.socket.on("close", () => {
    console.log("Client disconnected from /socket/test");
  });

  // Handle errors
  connection.socket.on("error", (error: any) => {
    console.error("WebSocket error:", error);
  });
});
app.listen({ port: 3000, host: "0.0.0.0" }, (err, address) => {
  if (err) {
    console.error(err);
    process.exit(1);
  }
  console.log(`Server is running at ${address}`);
});
