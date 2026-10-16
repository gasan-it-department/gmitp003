/**
 * Loading and inspecting the salary grid.
 *
 * The official schedule arrives as a scanned PDF, so the figures are keyed
 * in by a person. That makes two things matter more than usual: a bad row
 * is refused and named rather than stored, and the result says exactly
 * what landed, so whoever typed it can check their work against the paper.
 *
 * Admin-gated. These numbers are everybody's salary.
 */
import { FastifyReply, FastifyRequest } from "../barrel/fastify";
import { ValidationError } from "../errors/errors";
import {
  MAX_GRADE,
  MAX_STEP,
  RateInput,
  loadRates,
  resolveMonthlyRate,
  scheduleCoverage,
} from "../service/salaryStep";

/**
 * POST /admin/salary-steps
 *
 * Body: { lineId?: string|null, rates: [{grade, step, amount, effectiveFrom, note?}] }
 *
 * Omit lineId (or send null) to load the NATIONAL schedule, which every
 * municipality falls back to. Send one to override it for that line only.
 */
export const putSalarySteps = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const body = req.body as { lineId?: string | null; rates?: RateInput[] };
  const rates = Array.isArray(body?.rates) ? body.rates : null;
  if (!rates || rates.length === 0) {
    throw new ValidationError(
      "Send a `rates` array of {grade, step, amount, effectiveFrom}.",
    );
  }
  // A full tranche is 33 grades x 8 steps; anything far beyond that is a
  // mistake, not a schedule.
  if (rates.length > MAX_GRADE * MAX_STEP * 4) {
    throw new ValidationError("That is more rows than four full schedules.");
  }

  const report = await loadRates(rates, body.lineId ?? null);
  return res.code(200).send({
    message: "OK",
    scope: body.lineId ? `line ${body.lineId}` : "national",
    ...report,
    /*
      Reported rather than thrown on: a batch keyed from a scan may have
      one bad line, and refusing the other 263 good rows would mean typing
      them all again.
    */
    hint: report.rejected.length
      ? "Rows listed under `rejected` were NOT written. Fix and re-send just those."
      : undefined,
  });
};

/**
 * GET /admin/salary-steps?lineId=&grade=&step=&on=
 *
 * With no grade/step it reports what the table covers, per tranche, which
 * is how you see a half-keyed schedule before a payroll run uses it.
 * With a grade and step it answers what that person would be paid.
 */
export const getSalarySteps = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const q = req.query as {
    lineId?: string;
    grade?: string;
    step?: string;
    on?: string;
  };
  const lineId = q.lineId || null;

  if (q.grade || q.step) {
    const grade = parseInt(String(q.grade), 10);
    const step = parseInt(String(q.step ?? "1"), 10);
    const on = q.on ? new Date(q.on) : new Date();
    if (Number.isNaN(on.getTime())) {
      throw new ValidationError("`on` is not a date.");
    }
    const rate = await resolveMonthlyRate({ lineId, grade, step, on });
    return res.code(200).send({
      grade,
      step,
      on,
      rate,
      /*
        Null is a real answer: the grid does not cover this yet, and
        payroll would fall back to the grade's own amount.
      */
      note: rate
        ? undefined
        : "No rate on file — payroll would use SalaryGrade.amount instead.",
    });
  }

  const coverage = await scheduleCoverage(lineId);
  return res.code(200).send({
    scope: lineId ? `line ${lineId}` : "national",
    tranches: coverage.map((c) => ({
      ...c,
      // 33 x 8; anything short means a grade or a step is missing.
      complete: c.rows === MAX_GRADE * MAX_STEP,
      expectedRows: MAX_GRADE * MAX_STEP,
    })),
  });
};
