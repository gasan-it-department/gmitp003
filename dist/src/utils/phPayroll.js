"use strict";
// Philippine statutory contribution + withholding tax calculators.
//
// These tables are aligned with the 2024–2025 rates as published by SSS,
// PhilHealth, Pag-IBIG and the BIR (TRAIN Law revised tax table effective
// January 2023 onward). Rates change periodically; the structure here is
// kept simple so the constants at the top can be bumped without touching
// the math.
Object.defineProperty(exports, "__esModule", { value: true });
exports.computePayslip = exports.withholdingTaxMonthly = exports.pagibigEmployeeShare = exports.philhealthEmployeeShare = exports.sssEmployeeShare = void 0;
// ── SSS (Social Security System) ──────────────────────────────────────
// Employee share is 4.5% of the monthly salary credit (MSC), bracketed
// in ₱500 steps from ₱4,000 to ₱30,000. Rates here use the 2024 schedule.
const SSS_EMPLOYEE_RATE = 0.045;
const SSS_MSC_MIN = 4000;
const SSS_MSC_MAX = 30000;
const SSS_STEP = 500;
const sssEmployeeShare = (monthly) => {
    if (!Number.isFinite(monthly) || monthly <= 0)
        return 0;
    const msc = Math.min(SSS_MSC_MAX, Math.max(SSS_MSC_MIN, Math.round(monthly / SSS_STEP) * SSS_STEP));
    return round2(msc * SSS_EMPLOYEE_RATE);
};
exports.sssEmployeeShare = sssEmployeeShare;
// ── PhilHealth ────────────────────────────────────────────────────────
// 2024: 5% premium rate, split equally between employer and employee
// (i.e. 2.5% employee share). Floor salary ₱10,000, ceiling ₱100,000.
const PH_RATE_EMPLOYEE = 0.025;
const PH_FLOOR = 10000;
const PH_CEILING = 100000;
const philhealthEmployeeShare = (monthly) => {
    if (!Number.isFinite(monthly) || monthly <= 0)
        return 0;
    const base = Math.min(PH_CEILING, Math.max(PH_FLOOR, monthly));
    return round2(base * PH_RATE_EMPLOYEE);
};
exports.philhealthEmployeeShare = philhealthEmployeeShare;
// ── Pag-IBIG (HDMF) ───────────────────────────────────────────────────
// Employee contribution: 1% if salary ≤ ₱1,500, otherwise 2%. Capped at
// ₱200/month per the latest schedule (still subject to change).
const PAGIBIG_CAP = 200;
const pagibigEmployeeShare = (monthly) => {
    if (!Number.isFinite(monthly) || monthly <= 0)
        return 0;
    const rate = monthly <= 1500 ? 0.01 : 0.02;
    return round2(Math.min(PAGIBIG_CAP, monthly * rate));
};
exports.pagibigEmployeeShare = pagibigEmployeeShare;
const MONTHLY_TAX_TABLE = [
    { upTo: 20833, base: 0, rate: 0, floor: 0 },
    { upTo: 33333, base: 0, rate: 0.15, floor: 20833 },
    { upTo: 66667, base: 1875, rate: 0.2, floor: 33333 },
    { upTo: 166667, base: 8541.8, rate: 0.25, floor: 66667 },
    { upTo: 666667, base: 33541.8, rate: 0.3, floor: 166667 },
    { upTo: Infinity, base: 183541.8, rate: 0.35, floor: 666667 },
];
const withholdingTaxMonthly = (taxableMonthly) => {
    if (!Number.isFinite(taxableMonthly) || taxableMonthly <= 0)
        return 0;
    for (const b of MONTHLY_TAX_TABLE) {
        if (taxableMonthly <= b.upTo) {
            return round2(b.base + (taxableMonthly - b.floor) * b.rate);
        }
    }
    return 0;
};
exports.withholdingTaxMonthly = withholdingTaxMonthly;
const computePayslip = (i) => {
    const basic = Math.max(0, i.basicMonthly);
    const workingDays = Math.max(1, i.workingDays);
    const dailyRate = basic / workingDays;
    // Days actually compensated: working days − absent − unpaid leave.
    // (Paid leave is already worth a day's pay, so it's already inside
    //  the working-day count we start from.)
    const unpaidDays = Math.max(0, i.daysAbsent) + Math.max(0, i.unpaidLeaveDays);
    const effectiveDaysPaid = Math.max(0, workingDays - unpaidDays);
    const grossPay = round2(dailyRate * effectiveDaysPaid);
    // Contributions are computed off the full monthly rate, not gross,
    // because PH statutory bases are tied to the basic salary.
    const sssEE = (0, exports.sssEmployeeShare)(basic);
    const philhealthEE = (0, exports.philhealthEmployeeShare)(basic);
    const pagibigEE = (0, exports.pagibigEmployeeShare)(basic);
    const taxable = Math.max(0, grossPay - sssEE - philhealthEE - pagibigEE);
    const withholdingTax = (0, exports.withholdingTaxMonthly)(taxable);
    const otherDeductions = Math.max(0, i.otherDeductions);
    const netPay = round2(grossPay -
        sssEE -
        philhealthEE -
        pagibigEE -
        withholdingTax -
        otherDeductions);
    return {
        grossPay,
        sssEE,
        philhealthEE,
        pagibigEE,
        withholdingTax,
        otherDeductions,
        netPay,
        dailyRate: round2(dailyRate),
        effectiveDaysPaid: round2(effectiveDaysPaid),
        breakdown: {
            basicMonthly: round2(basic),
            workingDays: round2(workingDays),
            daysAbsent: round2(i.daysAbsent),
            paidLeaveDays: round2(i.paidLeaveDays),
            unpaidLeaveDays: round2(i.unpaidLeaveDays),
            unpaidDaysTotal: round2(unpaidDays),
            taxableIncome: round2(taxable),
        },
    };
};
exports.computePayslip = computePayslip;
const round2 = (n) => Math.round(n * 100) / 100;
