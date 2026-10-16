/**
 * What a government employee is actually paid: grade AND step.
 *
 * Philippine civilian pay is a grid, not a list. A position carries a
 * Salary Grade (1-33); a person sits on a Step (1-8) within it, moving up
 * by length of service or meritorious performance until Step 8. So the
 * monthly rate is a function of three things — grade, step, and the date,
 * because the schedule itself changes (EO 64 pays out over four tranches,
 * 1 January 2024 through 2027).
 *
 * `SalaryGrade` stays what it was: the grade attached to a position, a job
 * post or a person. It is NOT turned into the grid, because a position has
 * a grade and no step — only a person has a step. The grid lives in its
 * own table and is looked up.
 *
 * ── The fallback is the point ────────────────────────────────────────────
 *
 * The rate table starts EMPTY, and the official schedule is published as
 * scanned PDFs that somebody has to key in and check. Until that happens
 * this resolver finds nothing and the caller keeps using
 * `SalaryGrade.amount` exactly as before, so installing this changes
 * nobody's pay by a single peso. Pay only starts varying by step once a
 * human has entered the figures for a tranche.
 */
import { prisma } from "../barrel/prisma";

export const MIN_GRADE = 1;
export const MAX_GRADE = 33;
export const MIN_STEP = 1;
/** Step 8 is the ceiling: once there, no further step increase. */
export const MAX_STEP = 8;

export interface RateLookup {
  /** The municipality asking. A line may override the national table. */
  lineId?: string | null;
  grade: number;
  step: number;
  /** Which schedule applies — normally the payroll period's start. */
  on: Date;
}

export interface ResolvedRate {
  amount: number;
  /** Where the figure came from, so a payslip can be explained later. */
  source: "line" | "national";
  effectiveFrom: Date;
  note: string | null;
}

export const isValidGrade = (g: unknown): g is number =>
  typeof g === "number" && Number.isInteger(g) && g >= MIN_GRADE && g <= MAX_GRADE;

export const isValidStep = (s: unknown): s is number =>
  typeof s === "number" && Number.isInteger(s) && s >= MIN_STEP && s <= MAX_STEP;

/**
 * The monthly rate for a grade and step on a given date, or null when the
 * table does not cover it.
 *
 * Null is a normal answer, not an error: before the schedule is loaded it
 * is the only answer, and the caller falls back. Returning 0 instead would
 * silently zero somebody's pay.
 */
export const resolveMonthlyRate = async (
  q: RateLookup,
): Promise<ResolvedRate | null> => {
  if (!isValidGrade(q.grade) || !isValidStep(q.step)) return null;

  /*
    Most recent schedule that had already taken effect on that date — not
    simply the newest row. Recomputing a payslip for March must use the
    tranche that was in force in March, even after a new one is loaded.
  */
  const rows = await prisma.salaryStepRate.findMany({
    where: {
      grade: q.grade,
      step: q.step,
      effectiveFrom: { lte: q.on },
      /*
        "" is the national schedule. A sentinel rather than NULL because
        the uniqueness that stops a tranche being loaded twice is a
        compound key, and in SQL two NULLs are not equal — so a nullable
        lineId would let the same national row be inserted over and over.
      */
      OR: [{ lineId: q.lineId || "" }, { lineId: "" }],
    },
    orderBy: [{ effectiveFrom: "desc" }],
    select: { amount: true, lineId: true, effectiveFrom: true, note: true },
  });
  if (!rows.length) return null;

  // A line's own figure beats the national one for the same effectivity.
  const newest = rows[0].effectiveFrom;
  const sameDate = rows.filter(
    (r) => r.effectiveFrom.getTime() === newest.getTime(),
  );
  const chosen = sameDate.find((r) => r.lineId !== "") ?? sameDate[0];

  return {
    amount: chosen.amount,
    source: chosen.lineId !== "" ? "line" : "national",
    effectiveFrom: chosen.effectiveFrom,
    note: chosen.note,
  };
};

export interface RateInput {
  grade: number;
  step: number;
  amount: number;
  effectiveFrom: string | Date;
  note?: string | null;
}

export interface LoadReport {
  written: number;
  rejected: Array<{ row: RateInput; why: string }>;
}

/**
 * Load a schedule.
 *
 * Upserts on (line, grade, step, effectiveFrom), so re-running a tranche
 * corrects it rather than duplicating it, and a typo is fixed by loading
 * the row again.
 *
 * Every row is validated before anything is written. These figures are
 * somebody's salary, keyed by hand from a scan, so a row that is not a
 * sane grade/step/amount is refused and named rather than quietly stored.
 */
export const loadRates = async (
  rows: RateInput[],
  lineId: string | null,
): Promise<LoadReport> => {
  const report: LoadReport = { written: 0, rejected: [] };
  const seen = new Set<string>();

  for (const row of rows) {
    const when = new Date(row.effectiveFrom);
    const why =
      !isValidGrade(row.grade)
        ? `grade must be ${MIN_GRADE}-${MAX_GRADE}`
        : !isValidStep(row.step)
          ? `step must be ${MIN_STEP}-${MAX_STEP}`
          : typeof row.amount !== "number" || !Number.isFinite(row.amount) || row.amount <= 0
            ? "amount must be a positive number"
            : Number.isNaN(when.getTime())
              ? "effectiveFrom is not a date"
              : null;
    if (why) {
      report.rejected.push({ row, why });
      continue;
    }

    const key = `${row.grade}|${row.step}|${when.toISOString()}`;
    if (seen.has(key)) {
      report.rejected.push({ row, why: "duplicate of an earlier row in this batch" });
      continue;
    }
    seen.add(key);

    await prisma.salaryStepRate.upsert({
      where: {
        lineId_grade_step_effectiveFrom: {
          lineId: lineId ?? "",
          grade: row.grade,
          step: row.step,
          effectiveFrom: when,
        },
      },
      create: {
        lineId: lineId ?? "",
        grade: row.grade,
        step: row.step,
        amount: row.amount,
        effectiveFrom: when,
        note: row.note ?? null,
      },
      update: { amount: row.amount, note: row.note ?? null },
    });
    report.written++;
  }
  return report;
};

/** What the table holds, so gaps are visible before a payroll run. */
export const scheduleCoverage = async (
  lineId: string | null,
): Promise<Array<{ effectiveFrom: Date; rows: number; grades: number; note: string | null }>> => {
  const all = await prisma.salaryStepRate.findMany({
    where: { OR: [{ lineId: lineId ?? "" }, { lineId: "" }] },
    select: { effectiveFrom: true, grade: true, note: true },
  });
  const by = new Map<string, { grades: Set<number>; rows: number; note: string | null }>();
  for (const r of all) {
    const k = r.effectiveFrom.toISOString();
    const e = by.get(k) ?? { grades: new Set<number>(), rows: 0, note: r.note };
    e.grades.add(r.grade);
    e.rows++;
    by.set(k, e);
  }
  return [...by.entries()]
    .map(([k, v]) => ({
      effectiveFrom: new Date(k),
      rows: v.rows,
      grades: v.grades.size,
      note: v.note,
    }))
    .sort((a, b) => b.effectiveFrom.getTime() - a.effectiveFrom.getTime());
};
