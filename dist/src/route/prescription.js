"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.prescription = void 0;
const handler_1 = require("../middleware/handler");
const prescriptionController_1 = require("../controller/prescriptionController");
const prescription = (fastify) => {
    fastify.post("/prescription/new", { preHandler: handler_1.authenticated }, prescriptionController_1.createPrescriptions);
    fastify.get("/medicine/prescriptions", { preHandler: handler_1.authenticated }, prescriptionController_1.prescriptionList);
    fastify.get("/prescription/data", { preHandler: handler_1.authenticated }, prescriptionController_1.prescriptionData);
    fastify.get("/prescription/prescribe/med", { preHandler: handler_1.authenticated }, prescriptionController_1.prescriptionPrescribeMed);
    fastify.get("/prescription/progress", { preHandler: handler_1.authenticated }, prescriptionController_1.prescriptionProgress);
    fastify.patch("/prescription/dispense", prescriptionController_1.prescriptionDispense);
    fastify.patch("/prescription/progress/update", prescriptionController_1.prescriptionProgressUpdate);
    fastify.get("/prescription/transaction", { preHandler: handler_1.authenticated }, prescriptionController_1.prescribeTransaction);
};
exports.prescription = prescription;
