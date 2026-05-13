import { FastifyInstance } from "../barrel/fastify";
import { authenticated } from "../middleware/handler";
import {
  patientList,
  patientData,
  addPatient,
  updatePatient,
  deletePatient,
  patientRecordList,
  patientRecordData,
  addPatientRecord,
} from "../controller/patientController";

export const patient = (fastify: FastifyInstance) => {
  fastify.get("/patient/list", { preHandler: authenticated }, patientList);
  fastify.get("/patient/data", { preHandler: authenticated }, patientData);
  fastify.post("/patient/new", { preHandler: authenticated }, addPatient);
  fastify.patch("/patient/update", { preHandler: authenticated }, updatePatient);
  fastify.delete("/patient/delete", { preHandler: authenticated }, deletePatient);
  fastify.get("/patient/record/list", { preHandler: authenticated }, patientRecordList);
  fastify.get("/patient/record/data", { preHandler: authenticated }, patientRecordData);
  fastify.post("/patient/record/new", { preHandler: authenticated }, addPatientRecord);
};
