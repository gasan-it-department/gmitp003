/* Does the salary grid pay people by grade AND step?
 *
 *   npx ts-node --transpile-only e2e_salary_step.ts
 *
 * The property that matters most is the boring one: with the grid EMPTY
 * — which is how it ships, because the official schedule is a scanned PDF
 * somebody has to key in — payroll must produce exactly what it produced
 * before the grid existed. A change that quietly alters a municipality's
 * payroll the moment it deploys is a far worse outcome than a feature
 * that does nothing until configured.
 *
 * So this runs the REAL payroll computation twice, once with no rates and
 * once with them, and compares the pesos.
 *
 * Everything it writes, it removes: the rate rows are deleted and the
 * period is recomputed at the end so the payslips are back as they were.
 */
import path from "path";
const entry = path.join(process.cwd(), "src", "index.ts");
require.cache[entry] = {
  id: entry,
  filename: entry,
  loaded: true,
  exports: {
    notificationSocket: { emitUserNotification: () => undefined },
  },
} as never;

import { prisma } from "./src/barrel/prisma";
import {
  MAX_STEP,
  loadRates,
  resolveMonthlyRate,
  scheduleCoverage,
} from "./src/service/salaryStep";
import { computePayrollPeriod } from "./src/controller/payrollController";

let pass = 0;
const fails: string[] = [];
const ok = (name: string, cond: boolean, detail = "") => {
  if (cond) {
    pass++;
    console.log(`  ok    ${name}`);
  } else {
    fails.push(`${name}${detail ? ` — ${detail}` : ""}`);
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
};

const TEST_NOTE = "__e2e_salary_step__";
const T1 = new Date("2024-01-01T00:00:00.000Z");
const T3 = new Date("2026-01-01T00:00:00.000Z");

const runPayroll = async (periodId: string, lineId: string) => {
  const res: any = {
    body: null as any,
    code() {
      return res;
    },
    send(b: any) {
      res.body = b;
      return res;
    },
    header() {
      return res;
    },
  };
  await computePayrollPeriod(
    { body: { periodId }, query: {}, params: {}, headers: {}, user: {} } as any,
    res,
  );
  return prisma.payslip.findMany({
    where: { periodId },
    select: { userId: true, basicMonthly: true, step: true, rateSource: true },
  });
};

(async () => {
  try {
    // ── the resolver, in isolation ─────────────────────────────────────
    console.log("\n── an empty grid answers 'no rate', not 'zero' ──");
    const none = await resolveMonthlyRate({
      lineId: null,
      grade: 31,
      step: 4,
      on: new Date(),
    });
    ok("an uncovered grade/step resolves to null", none === null);

    console.log("\n── loading a schedule ──");
    const load = await loadRates(
      [
        { grade: 31, step: 1, amount: 100000, effectiveFrom: T1, note: TEST_NOTE },
        { grade: 31, step: 4, amount: 110000, effectiveFrom: T1, note: TEST_NOTE },
        { grade: 31, step: 1, amount: 120000, effectiveFrom: T3, note: TEST_NOTE },
        { grade: 31, step: 4, amount: 130000, effectiveFrom: T3, note: TEST_NOTE },
      ],
      null,
    );
    ok("four rows written", load.written === 4, JSON.stringify(load));
    ok("nothing rejected", load.rejected.length === 0);

    const s1 = await resolveMonthlyRate({ lineId: null, grade: 31, step: 1, on: T3 });
    const s4 = await resolveMonthlyRate({ lineId: null, grade: 31, step: 4, on: T3 });
    ok("step changes the pay", s1?.amount === 120000 && s4?.amount === 130000,
      `${s1?.amount} vs ${s4?.amount}`);

    console.log("\n── the schedule in force on the date, not the newest ──");
    const old = await resolveMonthlyRate({
      lineId: null, grade: 31, step: 4, on: new Date("2025-06-30"),
    });
    ok("a 2025 payroll uses the 2024 tranche", old?.amount === 110000, String(old?.amount));
    const now = await resolveMonthlyRate({
      lineId: null, grade: 31, step: 4, on: new Date("2026-06-30"),
    });
    ok("a 2026 payroll uses the 2026 tranche", now?.amount === 130000, String(now?.amount));
    const before = await resolveMonthlyRate({
      lineId: null, grade: 31, step: 4, on: new Date("2023-01-01"),
    });
    ok("before any tranche there is no rate", before === null);

    console.log("\n── a line can override the national figure ──");
    const line = await prisma.line.findFirst({ select: { id: true } });
    if (line) {
      await loadRates(
        [{ grade: 31, step: 4, amount: 999000, effectiveFrom: T3, note: TEST_NOTE }],
        line.id,
      );
      const overridden = await resolveMonthlyRate({
        lineId: line.id, grade: 31, step: 4, on: T3,
      });
      const national = await resolveMonthlyRate({
        lineId: null, grade: 31, step: 4, on: T3,
      });
      ok("the line's own figure wins", overridden?.amount === 999000, String(overridden?.amount));
      ok("and it is reported as the line's", overridden?.source === "line");
      ok("the national figure is untouched", national?.amount === 130000, String(national?.amount));
    }

    console.log("\n── bad rows are refused and named ──");
    const bad = await loadRates(
      [
        { grade: 0, step: 1, amount: 1, effectiveFrom: T1 },
        { grade: 34, step: 1, amount: 1, effectiveFrom: T1 },
        { grade: 10, step: MAX_STEP + 1, amount: 1, effectiveFrom: T1 },
        { grade: 10, step: 1, amount: -5, effectiveFrom: T1 },
        { grade: 10, step: 1, amount: 1, effectiveFrom: "not a date" },
      ],
      null,
    );
    ok("all five bad rows refused", bad.written === 0 && bad.rejected.length === 5,
      JSON.stringify(bad.rejected.map((r) => r.why)));
    ok("step 9 is refused — 8 is the ceiling",
      bad.rejected.some((r) => /step must be/.test(r.why)));

    console.log("\n── re-loading a tranche corrects it, never duplicates ──");
    await loadRates(
      [{ grade: 31, step: 1, amount: 121000, effectiveFrom: T3, note: TEST_NOTE }],
      null,
    );
    const fixed = await resolveMonthlyRate({ lineId: null, grade: 31, step: 1, on: T3 });
    const count = await prisma.salaryStepRate.count({
      where: { lineId: "", grade: 31, step: 1, effectiveFrom: T3 },
    });
    ok("the figure is corrected", fixed?.amount === 121000, String(fixed?.amount));
    ok("and there is still only one row", count === 1, `rows=${count}`);

    console.log("\n── coverage reporting ──");
    const cov = await scheduleCoverage(null);
    ok("both tranches are reported", cov.length >= 2, JSON.stringify(cov.map((c) => c.rows)));

    // ── the real payroll, before and after ─────────────────────────────
    console.log("\n── the REAL payroll computation ──");
    const emp = await prisma.user.findFirst({
      where: { salaryGradeId: { not: null } },
      select: { id: true, step: true, lineId: true, SalaryGrade: { select: { grade: true, amount: true } } },
    });
    /*
      A period of our own, not a real one. Recomputing a live period wipes
      and recreates its payslips, and one of the periods in this database
      is already released — which the app rightly refuses to recompute.
      A throwaway period means the test never touches anybody's real pay.
    */
    const period = emp?.lineId
      ? await prisma.payrollPeriod.create({
          data: {
            lineId: emp.lineId,
            label: TEST_NOTE,
            periodStart: new Date("2026-02-01T00:00:00.000Z"),
            periodEnd: new Date("2026-02-15T00:00:00.000Z"),
            status: "draft",
          },
        })
      : null;

    if (!emp?.SalaryGrade || !period) {
      console.log("  (no employee with a grade + a period in this database — skipped)");
    } else {
      const grade = emp.SalaryGrade.grade;
      const step = emp.step ?? 1;
      console.log(`  employee on SG ${grade} step ${step}, grade amount ${emp.SalaryGrade.amount}`);

      // 1. grid does not cover this grade -> must behave exactly as before
      const beforeSlips = await runPayroll(period.id, period.lineId);
      const mine = beforeSlips.find((s) => s.userId === emp.id);
      ok(
        "with no rate on file, basic is still the grade's own amount",
        mine?.basicMonthly === emp.SalaryGrade.amount,
        `${mine?.basicMonthly} vs ${emp.SalaryGrade.amount}`,
      );
      ok("and the slip says so", mine?.rateSource === "grade-default", String(mine?.rateSource));
      ok("the step is recorded on the slip", mine?.step === step, String(mine?.step));

      // 2. load a rate for exactly this grade+step -> basic must follow it
      const GRID = 54321;
      await loadRates(
        [{
          grade, step, amount: GRID,
          effectiveFrom: new Date(period.periodStart.getTime() - 86400000),
          note: TEST_NOTE,
        }],
        null,
      );
      const afterSlips = await runPayroll(period.id, period.lineId);
      const mine2 = afterSlips.find((s) => s.userId === emp.id);
      ok("with a rate on file, basic comes from the grid", mine2?.basicMonthly === GRID,
        `${mine2?.basicMonthly} vs ${GRID}`);
      ok("and the slip records where it came from", mine2?.rateSource === "national",
        String(mine2?.rateSource));
    }
  } finally {
    // ── put everything back ────────────────────────────────────────────
    const removed = await prisma.salaryStepRate.deleteMany({
      where: { note: TEST_NOTE },
    });
    console.log(`\n(removed ${removed.count} test rate row(s))`);
    // The throwaway period goes, and its payslips with it (cascade).
    const gone = await prisma.payrollPeriod.deleteMany({
      where: { label: TEST_NOTE },
    });
    console.log(`(removed ${gone.count} test payroll period(s); no real payslip was touched)`);
    await prisma.$disconnect();
  }

  console.log(`\n${pass} passed, ${fails.length} failed`);
  if (fails.length) for (const f of fails) console.log(`  FAIL  ${f}`);
  process.exit(fails.length ? 1 : 0);
})();
