import { FastifyInstance } from "../barrel/fastify";
import { authenticated } from "../middleware/handler";
import {
  leaveCatalogue,
  applyLeave,
  listLeaves,
  decideLeave,
  cancelLeave,
  listLeaveCredits,
  adjustLeaveCredit,
  listLeaveLedger,
  listLineUsers,
} from "../controller/leaveController";
import {
  listPayrollPeriods,
  createPayrollPeriod,
  removePayrollPeriod,
  computePayrollPeriod,
  releasePayrollPeriod,
  listPayslips,
  getPayslip,
  listDeductions,
  upsertDeduction,
  removeDeduction,
} from "../controller/payrollController";

export const leave = (fastify: FastifyInstance) => {
  // Leave
  fastify.get("/leave/catalogue", { preHandler: authenticated }, leaveCatalogue);
  fastify.post("/leave/apply", { preHandler: authenticated }, applyLeave);
  fastify.get("/leave/list", { preHandler: authenticated }, listLeaves);
  fastify.patch("/leave/decide", { preHandler: authenticated }, decideLeave);
  fastify.patch("/leave/cancel", { preHandler: authenticated }, cancelLeave);
  fastify.get("/leave/credits", { preHandler: authenticated }, listLeaveCredits);
  fastify.patch(
    "/leave/credits/adjust",
    { preHandler: authenticated },
    adjustLeaveCredit,
  );
  fastify.get(
    "/leave/credits/ledger",
    { preHandler: authenticated },
    listLeaveLedger,
  );
  fastify.get(
    "/leave/line-users",
    { preHandler: authenticated },
    listLineUsers,
  );

  // Payroll periods
  fastify.get(
    "/payroll/periods",
    { preHandler: authenticated },
    listPayrollPeriods,
  );
  fastify.post(
    "/payroll/periods/create",
    { preHandler: authenticated },
    createPayrollPeriod,
  );
  fastify.delete(
    "/payroll/periods/remove",
    { preHandler: authenticated },
    removePayrollPeriod,
  );
  fastify.post(
    "/payroll/periods/compute",
    { preHandler: authenticated },
    computePayrollPeriod,
  );
  fastify.patch(
    "/payroll/periods/release",
    { preHandler: authenticated },
    releasePayrollPeriod,
  );

  // Payslips
  fastify.get("/payroll/payslips", { preHandler: authenticated }, listPayslips);
  fastify.get("/payroll/payslip", { preHandler: authenticated }, getPayslip);

  // Custom deductions
  fastify.get(
    "/payroll/deductions",
    { preHandler: authenticated },
    listDeductions,
  );
  fastify.post(
    "/payroll/deductions/upsert",
    { preHandler: authenticated },
    upsertDeduction,
  );
  fastify.delete(
    "/payroll/deductions/remove",
    { preHandler: authenticated },
    removeDeduction,
  );
};
