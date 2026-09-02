"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.leave = void 0;
const handler_1 = require("../middleware/handler");
const leaveController_1 = require("../controller/leaveController");
const payrollController_1 = require("../controller/payrollController");
const leave = (fastify) => {
    // Leave
    fastify.get("/leave/catalogue", { preHandler: handler_1.authenticated }, leaveController_1.leaveCatalogue);
    fastify.post("/leave/apply", { preHandler: handler_1.authenticated }, leaveController_1.applyLeave);
    fastify.get("/leave/list", { preHandler: handler_1.authenticated }, leaveController_1.listLeaves);
    fastify.patch("/leave/decide", { preHandler: handler_1.authenticated }, leaveController_1.decideLeave);
    fastify.patch("/leave/cancel", { preHandler: handler_1.authenticated }, leaveController_1.cancelLeave);
    fastify.get("/leave/credits", { preHandler: handler_1.authenticated }, leaveController_1.listLeaveCredits);
    fastify.patch("/leave/credits/adjust", { preHandler: handler_1.authenticated }, leaveController_1.adjustLeaveCredit);
    fastify.get("/leave/credits/ledger", { preHandler: handler_1.authenticated }, leaveController_1.listLeaveLedger);
    fastify.get("/leave/line-users", { preHandler: handler_1.authenticated }, leaveController_1.listLineUsers);
    // Payroll periods
    fastify.get("/payroll/periods", { preHandler: handler_1.authenticated }, payrollController_1.listPayrollPeriods);
    fastify.post("/payroll/periods/create", { preHandler: handler_1.authenticated }, payrollController_1.createPayrollPeriod);
    fastify.delete("/payroll/periods/remove", { preHandler: handler_1.authenticated }, payrollController_1.removePayrollPeriod);
    fastify.post("/payroll/periods/compute", { preHandler: handler_1.authenticated }, payrollController_1.computePayrollPeriod);
    fastify.patch("/payroll/periods/release", { preHandler: handler_1.authenticated }, payrollController_1.releasePayrollPeriod);
    // Payslips
    fastify.get("/payroll/payslips", { preHandler: handler_1.authenticated }, payrollController_1.listPayslips);
    fastify.get("/payroll/payslip", { preHandler: handler_1.authenticated }, payrollController_1.getPayslip);
    // Custom deductions
    fastify.get("/payroll/deductions", { preHandler: handler_1.authenticated }, payrollController_1.listDeductions);
    fastify.post("/payroll/deductions/upsert", { preHandler: handler_1.authenticated }, payrollController_1.upsertDeduction);
    fastify.delete("/payroll/deductions/remove", { preHandler: handler_1.authenticated }, payrollController_1.removeDeduction);
};
exports.leave = leave;
