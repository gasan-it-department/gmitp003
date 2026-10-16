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
exports.getSalarySteps = exports.putSalarySteps = void 0;
const errors_1 = require("../errors/errors");
const salaryStep_1 = require("../service/salaryStep");
/**
 * POST /admin/salary-steps
 *
 * Body: { lineId?: string|null, rates: [{grade, step, amount, effectiveFrom, note?}] }
 *
 * Omit lineId (or send null) to load the NATIONAL schedule, which every
 * municipality falls back to. Send one to override it for that line only.
 */
const putSalarySteps = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    const body = req.body;
    const rates = Array.isArray(body === null || body === void 0 ? void 0 : body.rates) ? body.rates : null;
    if (!rates || rates.length === 0) {
        throw new errors_1.ValidationError("Send a `rates` array of {grade, step, amount, effectiveFrom}.");
    }
    // A full tranche is 33 grades x 8 steps; anything far beyond that is a
    // mistake, not a schedule.
    if (rates.length > salaryStep_1.MAX_GRADE * salaryStep_1.MAX_STEP * 4) {
        throw new errors_1.ValidationError("That is more rows than four full schedules.");
    }
    const report = yield (0, salaryStep_1.loadRates)(rates, (_a = body.lineId) !== null && _a !== void 0 ? _a : null);
    return res.code(200).send(Object.assign(Object.assign({ message: "OK", scope: body.lineId ? `line ${body.lineId}` : "national" }, report), { 
        /*
          Reported rather than thrown on: a batch keyed from a scan may have
          one bad line, and refusing the other 263 good rows would mean typing
          them all again.
        */
        hint: report.rejected.length
            ? "Rows listed under `rejected` were NOT written. Fix and re-send just those."
            : undefined }));
});
exports.putSalarySteps = putSalarySteps;
/**
 * GET /admin/salary-steps?lineId=&grade=&step=&on=
 *
 * With no grade/step it reports what the table covers, per tranche, which
 * is how you see a half-keyed schedule before a payroll run uses it.
 * With a grade and step it answers what that person would be paid.
 */
const getSalarySteps = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    const q = req.query;
    const lineId = q.lineId || null;
    if (q.grade || q.step) {
        const grade = parseInt(String(q.grade), 10);
        const step = parseInt(String((_a = q.step) !== null && _a !== void 0 ? _a : "1"), 10);
        const on = q.on ? new Date(q.on) : new Date();
        if (Number.isNaN(on.getTime())) {
            throw new errors_1.ValidationError("`on` is not a date.");
        }
        const rate = yield (0, salaryStep_1.resolveMonthlyRate)({ lineId, grade, step, on });
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
    const coverage = yield (0, salaryStep_1.scheduleCoverage)(lineId);
    return res.code(200).send({
        scope: lineId ? `line ${lineId}` : "national",
        tranches: coverage.map((c) => (Object.assign(Object.assign({}, c), { 
            // 33 x 8; anything short means a grade or a step is missing.
            complete: c.rows === salaryStep_1.MAX_GRADE * salaryStep_1.MAX_STEP, expectedRows: salaryStep_1.MAX_GRADE * salaryStep_1.MAX_STEP }))),
    });
});
exports.getSalarySteps = getSalarySteps;
