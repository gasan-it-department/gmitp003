/* Length-of-service step increments.
 *
 *   npx ts-node --transpile-only e2e_step_increment.ts
 *
 * The arithmetic decides whether somebody's pay goes up, so it is worth
 * testing against the cases that actually arise rather than one happy
 * path: a person short of three years, one exactly due, one at the Step 8
 * ceiling, one with no service date at all, one with too much leave
 * without pay, and the second increment — which must be counted from the
 * first, not from the original appointment, or everybody jumps to Step 8
 * at once.
 *
 * It also checks the two refusals that protect the decision itself:
 * approving your own increment, and approving without certifying that the
 * service was satisfactory — which the system cannot determine, having no
 * performance ratings.
 *
 * Everything it creates is removed in a finally block.
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
  LOS_YEARS,
  MAX_LWOP_DAYS,
  addYears,
  decide,
  listCandidates,
  proposeDue,
  reckonFrom,
  setServiceRecord,
} from "./src/service/stepIncrement";

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

const TAG = "__e2e_step__";
const ASOF = new Date("2026-06-30T00:00:00.000Z");
const made: string[] = [];

const mkUser = async (
  lineId: string,
  label: string,
  o: {
    step?: number;
    presentPositionDate?: Date | null;
    stepEffectiveDate?: Date | null;
  },
) => {
  const u = await prisma.user.create({
    data: {
      lineId,
      firstName: TAG,
      lastName: label,
      username: `${TAG}${label}${Date.now()}`,
      email: `${TAG}${label}@example.invalid`,
      step: o.step ?? 1,
      presentPositionDate: o.presentPositionDate ?? null,
      stepEffectiveDate: o.stepEffectiveDate ?? null,
    },
    select: { id: true },
  });
  made.push(u.id);
  return u.id;
};

(async () => {
  let lineId = "";
  try {
    const line = await prisma.line.findFirst({ select: { id: true } });
    if (!line) {
      console.log("no line in this database — cannot test");
      process.exit(1);
    }
    lineId = line.id;

    // ── the reckoning date ─────────────────────────────────────────────
    console.log("\n── which date the three years run from ──");
    const a = new Date("2020-01-01");
    const b = new Date("2023-05-05");
    ok(
      "the latest of the dates wins",
      reckonFrom({ presentPositionDate: a, stepEffectiveDate: b })?.getTime() ===
        b.getTime(),
    );
    ok(
      "a previous increment supersedes both",
      reckonFrom({
        presentPositionDate: a,
        stepEffectiveDate: b,
        lastApprovedEffective: new Date("2024-02-02"),
      })?.getTime() === new Date("2024-02-02").getTime(),
    );
    ok(
      "with no dates at all there is nothing to count from",
      reckonFrom({ presentPositionDate: null, stepEffectiveDate: null }) === null,
    );

    // ── the cases an HR officer actually meets ─────────────────────────
    console.log("\n── the candidate list ──");
    const dueId = await mkUser(lineId, "due", {
      step: 1,
      presentPositionDate: addYears(ASOF, -LOS_YEARS), // exactly three years
    });
    const earlyId = await mkUser(lineId, "early", {
      step: 1,
      presentPositionDate: addYears(ASOF, -1),
    });
    const ceilingId = await mkUser(lineId, "ceiling", {
      step: 8,
      presentPositionDate: addYears(ASOF, -10),
    });
    const noDateId = await mkUser(lineId, "nodate", { step: 1 });

    const list = await listCandidates(lineId, ASOF);
    const find = (id: string) => list.find((c) => c.userId === id);

    ok("three years exactly = due", find(dueId)?.blockers.length === 0,
      JSON.stringify(find(dueId)?.blockers));
    ok("one year = not yet", find(earlyId)?.blockers.includes("not-yet-due"));
    ok("Step 8 = at the ceiling", find(ceilingId)?.blockers.includes("at-ceiling"));
    ok("no service date is reported, not skipped",
      find(noDateId)?.blockers.includes("no-service-date"));
    ok("and the list explains each in words",
      (find(noDateId)?.notes[0] ?? "").length > 10, find(noDateId)?.notes[0]);
    ok("the due person sorts first", list[0]?.userId === dueId);

    // ── leave without pay ──────────────────────────────────────────────
    console.log("\n── leave without pay in the window ──");
    const lwopId = await mkUser(lineId, "lwop", {
      step: 1,
      presentPositionDate: addYears(ASOF, -LOS_YEARS),
    });
    await prisma.leave.create({
      data: {
        userId: lwopId,
        lineId,
        type: TAG,
        withPay: false,
        status: "approved",
        days: MAX_LWOP_DAYS + 5,
        startDate: addYears(ASOF, -1),
        endDate: addYears(ASOF, -1),
      },
    });
    const withLwop = (await listCandidates(lineId, ASOF)).find(
      (c) => c.userId === lwopId,
    );
    ok("the days are counted", withLwop?.lwopDays === MAX_LWOP_DAYS + 5,
      String(withLwop?.lwopDays));
    ok("and flagged for HR to check",
      !!withLwop?.blockers.includes("lwop-exceeded"));

    // ── proposing ──────────────────────────────────────────────────────
    console.log("\n── proposing ──");
    const prop = await proposeDue(lineId, ASOF, [dueId, earlyId, ceilingId]);
    ok("only the due person is proposed", prop.proposed === 1,
      JSON.stringify(prop));
    ok("the others are skipped WITH a reason", prop.skipped.length === 2 &&
      prop.skipped.every((s) => s.why && s.why.length > 5),
      JSON.stringify(prop.skipped));

    const proposal = await prisma.stepIncrement.findFirst({
      where: { userId: dueId, status: "proposed" },
      select: { id: true, fromStep: true, toStep: true, effectiveDate: true },
    });
    ok("it proposes exactly one step", proposal?.fromStep === 1 && proposal?.toStep === 2);
    ok("effective the day the three years complete, not today",
      proposal?.effectiveDate.toISOString().slice(0, 10) ===
        ASOF.toISOString().slice(0, 10),
      proposal?.effectiveDate.toISOString());

    const again = await proposeDue(lineId, ASOF, [dueId]);
    ok("a second run does not duplicate it", again.proposed === 0 &&
      again.skipped.some((s) => /already/i.test(s.why)),
      JSON.stringify(again));

    // ── deciding ───────────────────────────────────────────────────────
    console.log("\n── deciding ──");
    const decider = await mkUser(lineId, "hr", {});

    const selfApprove = await decide({
      id: proposal!.id, lineId, action: "approve",
      decidedByUserId: dueId, certifiedSatisfactory: true,
    });
    ok("you cannot approve your own increment",
      !selfApprove.ok && /your own/i.test((selfApprove as any).why),
      JSON.stringify(selfApprove));

    const uncertified = await decide({
      id: proposal!.id, lineId, action: "approve",
      decidedByUserId: decider,
    });
    ok("approval without certifying satisfactory service is refused",
      !uncertified.ok && /satisfactory/i.test((uncertified as any).why),
      JSON.stringify(uncertified));

    const otherLine = await decide({
      id: proposal!.id, lineId: "some-other-line", action: "approve",
      decidedByUserId: decider, certifiedSatisfactory: true,
    });
    ok("another municipality cannot decide it",
      !otherLine.ok && /another municipality/i.test((otherLine as any).why));

    const good = await decide({
      id: proposal!.id, lineId, action: "approve",
      decidedByUserId: decider, certifiedSatisfactory: true,
      nosiNumber: "NOSI-2026-001",
    });
    ok("a certified approval goes through", good.ok === true, JSON.stringify(good));

    const after = await prisma.user.findUnique({
      where: { id: dueId },
      select: { step: true, stepEffectiveDate: true },
    });
    ok("the step moves", after?.step === 2, String(after?.step));
    ok("and the clock restarts from the effective date",
      after?.stepEffectiveDate?.toISOString() === proposal!.effectiveDate.toISOString(),
      String(after?.stepEffectiveDate));

    const twice = await decide({
      id: proposal!.id, lineId, action: "approve",
      decidedByUserId: decider, certifiedSatisfactory: true,
    });
    ok("it cannot be approved twice", !twice.ok && /already/i.test((twice as any).why));

    // ── the second increment is counted from the first ─────────────────
    console.log("\n── the next three years start over ──");
    const soon = (await listCandidates(lineId, ASOF)).find((c) => c.userId === dueId);
    ok("not due again the moment it is granted",
      !!soon?.blockers.includes("not-yet-due"), JSON.stringify(soon?.blockers));
    const later = (await listCandidates(lineId, addYears(ASOF, LOS_YEARS))).find(
      (c) => c.userId === dueId,
    );
    ok("due again three years later, at step 2->3",
      later?.blockers.length === 0 && later?.currentStep === 2,
      JSON.stringify(later?.blockers));
    // -- recording the service record --------------------------------
    console.log("");
    console.log("-- recording what is already true --");
    const blankId = await mkUser(lineId, "blank", {});

    const noDates = await setServiceRecord({
      userId: blankId, lineId, byUserId: decider,
    });
    ok("an empty change is refused rather than logged",
      !noDates.ok && /nothing to change/i.test((noDates as any).why));

    const stepNoDate = await setServiceRecord({
      userId: blankId, lineId, byUserId: decider, step: 4,
    });
    ok("a step above 1 without the date it took effect is refused",
      !stepNoDate.ok && /took effect/i.test((stepNoDate as any).why),
      JSON.stringify(stepNoDate));

    const badStep = await setServiceRecord({
      userId: blankId, lineId, byUserId: decider,
      step: 9, stepEffectiveDate: ASOF,
    });
    ok("step 9 is refused - 8 is the ceiling",
      !badStep.ok && /1 to 8/.test((badStep as any).why));

    const together = await setServiceRecord({
      userId: blankId, lineId, byUserId: decider,
      step: 4, stepEffectiveDate: addYears(ASOF, -4),
      presentPositionDate: addYears(ASOF, -9),
      originalAppointmentDate: addYears(ASOF, -15),
    });
    ok("step and its date together are accepted", together.ok === true,
      JSON.stringify(together));

    const recorded = await prisma.user.findUnique({
      where: { id: blankId },
      select: { step: true, presentPositionDate: true, originalAppointmentDate: true },
    });
    ok("the dates are stored", recorded?.step === 4 &&
      !!recorded?.presentPositionDate && !!recorded?.originalAppointmentDate);

    const logged = await prisma.activityLogs.count({
      where: { userId: decider, desc: { contains: "Service record for" } },
    });
    ok("and the change is in the activity log", logged >= 1, `rows=${logged}`);

    const nowDue = (await listCandidates(lineId, ASOF)).find(
      (c) => c.userId === blankId,
    );
    ok("the person is now reckoned from the step date, not the appointment",
      nowDue?.reckonedFrom?.getTime() === addYears(ASOF, -4).getTime(),
      String(nowDue?.reckonedFrom));
    ok("and so is due, at step 4 going on 5",
      nowDue?.blockers.length === 0 && nowDue?.currentStep === 4,
      JSON.stringify(nowDue?.blockers));

    // The gate checks the caller's municipality; this checks the target's.
    const otherLineRow = await prisma.line.findFirst({
      where: { id: { not: lineId } }, select: { id: true },
    });
    if (otherLineRow) {
      const crossLine = await setServiceRecord({
        userId: blankId, lineId: otherLineRow.id, byUserId: decider,
        presentPositionDate: ASOF,
      });
      ok("HR of one municipality cannot edit another's employee",
        !crossLine.ok && /another municipality/i.test((crossLine as any).why),
        JSON.stringify(crossLine));
    } else {
      console.log("  (only one line in this database - cross-line check skipped)");
    }

    const ghost = await setServiceRecord({
      userId: "no-such-user", lineId, byUserId: decider, presentPositionDate: ASOF,
    });
    ok("an unknown employee is refused", !ghost.ok);
  } finally {
    if (made.length) {
      await prisma.activityLogs.deleteMany({ where: { userId: { in: made } } });
      await prisma.stepIncrement.deleteMany({ where: { userId: { in: made } } });
      await prisma.leave.deleteMany({ where: { userId: { in: made } } });
      await prisma.user.deleteMany({ where: { id: { in: made } } });
      console.log(`\n(removed ${made.length} test user(s) and their records)`);
    }
    await prisma.$disconnect();
  }

  console.log(`\n${pass} passed, ${fails.length} failed`);
  if (fails.length) for (const f of fails) console.log(`  FAIL  ${f}`);
  process.exit(fails.length ? 1 : 0);
})();
