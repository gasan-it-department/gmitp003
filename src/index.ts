import fastify, { FastifyRequest, FastifyReply } from "fastify";
import multipart from "@fastify/multipart";
import { jwt } from "./barrel/fastify";
import { prisma } from "./barrel/prisma";
import cors from "@fastify/cors";
import { Server } from "socket.io";
import { NotificationSocket } from "./class/NotificationSocket";
// `@fastify/websocket` would attach its own HTTP `upgrade` listener to
// the same http.Server we hand Socket.IO. The two listeners fight over
// /socket.io/* upgrades and the fastify-ws side returns 400, which the
// browser surfaces as "websocket error". Nothing currently uses
// fastify-ws (the only route was /notification/realtime, unreferenced on
// the frontend) so we drop the registration to let Socket.IO own
// upgrades. Re-enable carefully if you bring fastify-ws back.
// import fastifyWebsocket from "@fastify/websocket";
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
import { push } from "./route/push";
import { otp } from "./route/otp";
import { modules } from "./route/module";
import { document } from "./route/document";
//
import { file } from "./route/file";
import { supply } from "./route/supply";

//
import { user } from "./route/user";
import { patient } from "./route/patient";
import { leave } from "./route/leave";
import { services } from "./route/services";
import { peso } from "./route/peso";

import errorHandlerPlugin from "./plugin/errorHandlers";
//

//
import { EncryptionService } from "./service/encryption";
import { testGemini } from "./utils/gemini";
// Allow large archive uploads. PostgreSQL bytea tops out at ~1GB. The body
// limit covers multipart framing; the connection/keepalive timeouts are
// bumped so a slow client uploading hundreds of MB doesn't get cut off.
const app = fastify({
  bodyLimit: 1024 * 1024 * 1024, // 1GB
  connectionTimeout: 30 * 60 * 1000, // 30 min
  keepAliveTimeout: 5 * 60 * 1000, // 5 min
});
// Attach Socket.IO directly to Fastify's HTTP server (`app.server`). The
// previous `createServer(app.server)` wrapped Fastify's server in a second
// http.Server that was never `.listen()`'d — Socket.IO was effectively
// offline. Binding to `app.server` makes the socket reachable on the same
// port Fastify is listening on.
const io = new Server(app.server, {
  cors: {
    origin: [
      "http://localhost:5173",
      "https://gasanmarinduque.xyz",
      "https://g671jwjj-5173.asse.devtunnels.ms",
      "https://lgu-portal.xyz",
    ],
    methods: ["GET", "POST"],
    credentials: true,
  },
});
export const notificationSocket = new NotificationSocket(io);
//plugin
// app.register(fastifyWebsocket); // disabled — see import comment above
app.register(errorHandlerPlugin);
app.register(multipart, {
  attachFieldsToBody: false,
  limits: {
    fileSize: 1024 * 1024 * 1024, // 1GB (PostgreSQL bytea max)
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
  ],
  credentials: true,
  preflightContinue: false,
  exposedHeaders: ["Authorization"],
});
app.decorate("io", io);
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
app.register(push);
app.register(otp);
app.register(modules);
app.register(document);
app.register(patient);
app.register(leave);
app.register(services);
app.register(peso);
io.on("connection", (socket) => {
  console.log("User connected: ", socket.id);

  socket.on("send_message", (data) => {
    console.log("Received message:", data);

    socket.emit("message_received", {
      status: "success",
      message: "Message received by server",
      originalData: data,
    });
  });

  // New area handler
  socket.on("new_area", (areaData) => {
    console.log("New area created:", areaData);

    // Broadcast to all other clients except sender
    socket.broadcast.emit("new_area_broadcast", areaData);

    // Or broadcast to everyone including sender
    // io.emit("new_area_broadcast", areaData);
  });

  socket.on("disconnect", (reason) => {
    console.log("User disconnected: ", socket.id, "Reason:", reason);
  });
});

//middleware
app.get("/admin-test", async (request, reply) => {
  const jobPost = await prisma.jobPost.findMany({
    include: {
      line: {
        select: {
          municipalId: true,
        },
      },
      position: {
        select: {
          name: true,
        },
      },
    },
    orderBy: {
      timestamp: "desc",
    },
  });
  console.log("Admin Reached");

  return reply.code(200).send({ message: jobPost });
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
app.get("/test/ai", async (request: FastifyRequest, reply: FastifyReply) => {
  await testGemini();
  return { status: "ok" };
});

app.listen({ port: 3000, host: "0.0.0.0" }, (err, address) => {
  if (err) {
    console.error(err);
    process.exit(1);
  }
  console.log(`Server is running at ${address}`);
});
export { io };
