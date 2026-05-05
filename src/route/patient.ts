import { FastifyInstance } from "../barrel/fastify";
import { authenticated } from "../decoration/jwt";
//controller
import { patientList } from "../controller/patientController";

export const patient = (fastify: FastifyInstance) => {
  fastify.get("/patients", { preHandler: authenticated }, patientList);
};
