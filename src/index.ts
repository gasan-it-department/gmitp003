import fastify, { FastifyRequest, FastifyReply } from "fastify";
import multipart from "@fastify/multipart";
import { jwt } from "./barrel/fastify";
import { prisma } from "./barrel/prisma";
import cors from "@fastify/cors";
//routes
import { auth } from "./route/auth";
import { employee } from "./route/employee";
import { test } from "./route/test";
import { area } from "./route/area";
import { position } from "./route/position";
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
//
import { authenticated } from "./decoration/jwt";
import { file } from "./route/file";
import { supply } from "./route/supply";
const app = fastify();

//
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

app.register(multipart, {
  // These settings guarantee proper multipart handling
  attachFieldsToBody: true,
  sharedSchemaId: "#multipartFiles",
  throwFileSizeLimit: false, // Prevents premature errors
});
app.register(jwt, {
  secret: process.env.JWT_SECRET!,
});
app.register(cors, {
  origin: ["http://localhost:5173"], // Allow all origins
  methods: ["GET", "POST", "PUT", "DELETE"], // Allowed HTTP methods
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
//middleware
app.get("/", async (request, reply) => {
  return { message: "Array ko!" };
});
app.get("/health", async (request: FastifyRequest, reply: FastifyReply) => {
  const data = await prisma.user.findMany();

  return { status: "ok", data };
});

app.listen({ port: 3000 }, (err, address) => {
  if (err) {
    console.error(err);
    process.exit(1);
  }
  console.log(`Server is running at ${address}`);
});
