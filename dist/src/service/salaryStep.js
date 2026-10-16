"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.scheduleCoverage = exports.loadRates = exports.resolveMonthlyRate = exports.isValidStep = exports.isValidGrade = exports.MAX_STEP = exports.MIN_STEP = exports.MAX_GRADE = exports.MIN_GRADE = void 0;
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
const prisma_1 = require("../barrel/prisma");
exports.MIN_GRADE = 1;
exports.MAX_GRADE = 33;
exports.MIN_STEP = 1;
/** Step 8 is the ceiling: once there, no further step increase. */
exports.MAX_STEP = 8;
const isValidGrade = (g) => typeof g === "number" && Number.isInteger(g) && g >= exports.MIN_GRADE && g <= exports.MAX_GRADE;
exports.isValidGrade = isValidGrade;
const isValidStep = (s) => typeof s === "number" && Number.isInteger(s) && s >= exports.MIN_STEP && s <= exports.MAX_STEP;
exports.isValidStep = isValidStep;
/**
 * The monthly rate for a grade and step on a given date, or null when the
 * table does not cover it.
 *
 * Null is a normal answer, not an error: before the schedule is loaded it
 * is the only answer, and the caller falls back. Returning 0 instead would
 * silently zero somebody's pay.
 */
const resolveMonthlyRate = (q) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    if (!(0, exports.isValidGrade)(q.grade) || !(0, exports.isValidStep)(q.step))
        return null;
    /*
      Most recent schedule that had already taken effect on that date — not
      simply the newest row. Recomputing a payslip for March must use the
      tranche that was in force in March, even after a new one is loaded.
    */
    const rows = yield prisma_1.prisma.salaryStepRate.findMany({
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
    if (!rows.length)
        return null;
    // A line's own figure beats the national one for the same effectivity.
    const newest = rows[0].effectiveFrom;
    const sameDate = rows.filter((r) => r.effectiveFrom.getTime() === newest.getTime());
    const chosen = (_a = sameDate.find((r) => r.lineId !== "")) !== null && _a !== void 0 ? _a : sameDate[0];
    return {
        amount: chosen.amount,
        source: chosen.lineId !== "" ? "line" : "national",
        effectiveFrom: chosen.effectiveFrom,
        note: chosen.note,
    };
});
exports.resolveMonthlyRate = resolveMonthlyRate;
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
const loadRates = (rows, lineId) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    const report = { written: 0, rejected: [] };
    const seen = new Set();
    for (const row of rows) {
        const when = new Date(row.effectiveFrom);
        const why = !(0, exports.isValidGrade)(row.grade)
            ? `grade must be ${exports.MIN_GRADE}-${exports.MAX_GRADE}`
            : !(0, exports.isValidStep)(row.step)
                ? `step must be ${exports.MIN_STEP}-${exports.MAX_STEP}`
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
        yield prisma_1.prisma.salaryStepRate.upsert({
            where: {
                lineId_grade_step_effectiveFrom: {
                    lineId: lineId !== null && lineId !== void 0 ? lineId : "",
                    grade: row.grade,
                    step: row.step,
                    effectiveFrom: when,
                },
            },
            create: {
                lineId: lineId !== null && lineId !== void 0 ? lineId : "",
                grade: row.grade,
                step: row.step,
                amount: row.amount,
                effectiveFrom: when,
                note: (_a = row.note) !== null && _a !== void 0 ? _a : null,
            },
            update: { amount: row.amount, note: (_b = row.note) !== null && _b !== void 0 ? _b : null },
        });
        report.written++;
    }
    return report;
});
exports.loadRates = loadRates;
/** What the table holds, so gaps are visible before a payroll run. */
const scheduleCoverage = (lineId) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    const all = yield prisma_1.prisma.salaryStepRate.findMany({
        where: { OR: [{ lineId: lineId !== null && lineId !== void 0 ? lineId : "" }, { lineId: "" }] },
        select: { effectiveFrom: true, grade: true, note: true },
    });
    const by = new Map();
    for (const r of all) {
        const k = r.effectiveFrom.toISOString();
        const e = (_a = by.get(k)) !== null && _a !== void 0 ? _a : { grades: new Set(), rows: 0, note: r.note };
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
});
exports.scheduleCoverage = scheduleCoverage;
