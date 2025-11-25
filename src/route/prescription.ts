import { FastifyInstance } from "../barrel/fastify";
import { authenticated } from "../middleware/handler";
import {
  createPrescriptions,
  prescriptionList,
  prescriptionData,
  prescriptionPrescribeMed,
  prescriptionDispense,
  prescriptionProgress,
  prescriptionProgressUpdate,
} from "../controller/prescriptionController";

export const prescription = (fastify: FastifyInstance) => {
  fastify.post(
    "/prescription/new",
    { preHandler: authenticated },
    createPrescriptions
  );
  fastify.get(
    "/medicine/prescriptions",
    { preHandler: authenticated },
    prescriptionList
  );
  fastify.get(
    "/prescription/data",
    { preHandler: authenticated },
    prescriptionData
  );
  fastify.get(
    "/prescription/prescribe/med",
    { preHandler: authenticated },
    prescriptionPrescribeMed
  );
  fastify.get(
    "/prescription/progress",
    { preHandler: authenticated },
    prescriptionProgress
  );

  fastify.patch("/prescription/dispense", prescriptionDispense);
  fastify.patch("/prescription/progress/update", prescriptionProgressUpdate);
};
