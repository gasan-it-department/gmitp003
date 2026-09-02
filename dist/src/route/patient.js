"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.patient = void 0;
const handler_1 = require("../middleware/handler");
const patientController_1 = require("../controller/patientController");
const patient = (fastify) => {
    fastify.get("/patient/list", { preHandler: handler_1.authenticated }, patientController_1.patientList);
    fastify.get("/patient/data", { preHandler: handler_1.authenticated }, patientController_1.patientData);
    fastify.post("/patient/new", { preHandler: handler_1.authenticated }, patientController_1.addPatient);
    fastify.patch("/patient/update", { preHandler: handler_1.authenticated }, patientController_1.updatePatient);
    fastify.delete("/patient/delete", { preHandler: handler_1.authenticated }, patientController_1.deletePatient);
    fastify.get("/patient/record/list", { preHandler: handler_1.authenticated }, patientController_1.patientRecordList);
    fastify.get("/patient/record/data", { preHandler: handler_1.authenticated }, patientController_1.patientRecordData);
    fastify.post("/patient/record/new", { preHandler: handler_1.authenticated }, patientController_1.addPatientRecord);
};
exports.patient = patient;
