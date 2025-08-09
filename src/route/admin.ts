import { FastifyInstance } from "../barrel/fastify";
import { adminAuth, creteAdmin } from "../controller/adminAuth";
import { adminLoginScehma } from "../models/request";
export const admin = (fastify: FastifyInstance) => {
  fastify.post("/admin-login", { schema: adminLoginScehma }, adminAuth);
  fastify.post("/create-admin", { schema: adminLoginScehma }, creteAdmin);
};
