/**
 * Step increments by length of service.
 *
 * The rule: one step for every three years of continuous SATISFACTORY
 * service in the present position, up to Step 8.
 *
 * ── What this module will and will not decide ────────────────────────────
 *
 * It works out the arithmetic — who has reached three years, counted from
 * when, with how much leave without pay in the window — and stops there.
 * It does not grant anything.
 *
 * Two reasons, and both matter:
 *
 *   1. "Satisfactory" is a judgement about performance, and this system
 *      has no performance-rating module. Nothing here can tell a
 *      satisfactory three years from an unsatisfactory one, so it must
 *      not imply that it has checked. HR certifies that at approval and
 *      the certification is recorded.
 *
 *   2. A step increment is a legal act — it issues a Notice of Step
 *      Increment and changes somebody's pay. Software proposes; a person
 *      with the authority decides.
 *
 * So the output is a list of CANDIDATES with the reasons for and against
 * each, which is what an HR officer needs in order to decide, rather than
 * an answer that pretends the decision is already made.
 */
import { prisma } from "../barrel/prisma";
import { MAX_STEP } from "./salaryStep";

/** Three years of service earns one step. */
export const LOS_YEARS = 3;

/**
 * Authorised leave without pay tolerated inside the three-year window.
 *
 * Guidance published by agency HR offices puts this at 15 days, beyond
 * which the reckoning date moves. The figure is NOT from an issuance I
 * was able to read first-hand, so it is a flag for HR rather than an
 * automatic refusal, and it is exported so it can be corrected in one
 * place once the circular is checked.
 */
export const MAX_LWOP_DAYS = 15;

export type Blocker =
  | "at-ceiling"
  | "no-service-date"
  | "not-yet-due"
  | "lwop-exceeded"
  | "already-proposed";

export interface Candidate {
  userId: string;
  name: string;
  currentStep: number;
  grade: number | null;
  /* What is on file, so the HR screen can show and correct it. */
  originalAppointmentDate: Date | null;
  presentPositionDate: Date | null;
  stepEffectiveDate: Date | null;
  /** The date three years are counted from. */
  reckonedFrom: Date | null;
  /** When three years will have passed. */
  dueOn: Date | null;
  lwopDays: number;
  /** Empty when the person is due and nothing stands in the way. */
  blockers: Blocker[];
  /** Plain words for the HR screen, in the same order as `blockers`. */
  notes: string[];
}

export const addYears = (d: Date, years: number): Date => {
  const out = new Date(d);
  out.setFullYear(out.getFullYear() + years);
  return out;
};

/**
 * The date the three years run from.
 *
 * Whichever happened LAST: assuming the present position, the current
 * step taking effect, or the most recent approved increment. Counting
 * from the original appointment would hand somebody a step for years
 * served in a post they have since left, and counting from the present
 * position alone would grant the second increment immediately after the
 * first.
 */
export const reckonFrom = (u: {
  presentPositionDate: Date | null;
  stepEffectiveDate: Date | null;
  lastApprovedEffective?: Date | null;
}): Date | null => {
  const dates = [
    u.presentPositionDate,
    u.stepEffectiveDate,
    u.lastApprovedEffective ?? null,
  ].filter((d): d is Date => !!d);
  if (!dates.length) return null;
  return dates.reduce((a, b) => (a.getTime() > b.getTime() ? a : b));
};

/** Approved days of leave WITHOUT pay that fall inside a window. */
export const lwopDaysBetween = async (
  userId: string,
  from: Date,
  to: Date,
): Promise<number> => {
  const leaves = await prisma.leave.findMany({
    where: {
      userId,
      status: "approved",
      withPay: false,
      startDate: { lte: to },
      endDate: { gte: from },
    },
    select: { days: true },
  });
  return leaves.reduce((a, l) => a + (l.days || 0), 0);
};

/**
 * Who in this municipality is at or near a step increment.
 *
 * Everybody is returned, including those who are not due, because an HR
 * officer asking "who is due?" also needs to see who is nearly due and
 * who is stuck — a list that silently omits the person missing a service
 * date hides the very thing that needs fixing.
 */
export const listCandidates = async (
  lineId: string,
  asOf: Date = new Date(),
): Promise<Candidate[]> => {
  const users = await prisma.user.findMany({
    where: { lineId, archivedAt: null },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      step: true,
      originalAppointmentDate: true,
      presentPositionDate: true,
      stepEffectiveDate: true,
      SalaryGrade: { select: { grade: true } },
    },
  });

  /*
    Two queries for the whole municipality, not two per employee. The
    per-person version meant a thousand round-trips on a payroll of five
    hundred, on a page HR opens every day.
  */
  const ids = users.map((u) => u.id);
  const history = await prisma.stepIncrement.findMany({
    where: { userId: { in: ids }, status: { in: ["approved", "proposed"] } },
    orderBy: { effectiveDate: "desc" },
    select: { id: true, userId: true, status: true, effectiveDate: true },
  });
  const lastApproved = new Map<string, Date>();
  const pendingBy = new Map<string, string>();
  for (const h of history) {
    if (h.status === "approved") {
      // Ordered newest first, so the first one seen is the latest.
      if (!lastApproved.has(h.userId)) lastApproved.set(h.userId, h.effectiveDate);
    } else if (!pendingBy.has(h.userId)) {
      pendingBy.set(h.userId, h.id);
    }
  }

  const lwopAll = await prisma.leave.findMany({
    where: { userId: { in: ids }, status: "approved", withPay: false },
    select: { userId: true, days: true, startDate: true, endDate: true },
  });

  const out: Candidate[] = [];
  for (const u of users) {
    const last = lastApproved.get(u.id);
    const pending = pendingBy.get(u.id);

    const from = reckonFrom({
      presentPositionDate: u.presentPositionDate,
      stepEffectiveDate: u.stepEffectiveDate,
      lastApprovedEffective: last ?? null,
    });
    const dueOn = from ? addYears(from, LOS_YEARS) : null;
    const lwop = from
      ? lwopAll
          .filter(
            (l) =>
              l.userId === u.id &&
              l.startDate.getTime() <= asOf.getTime() &&
              l.endDate.getTime() >= from.getTime(),
          )
          .reduce((a, l) => a + (l.days || 0), 0)
      : 0;

    const blockers: Blocker[] = [];
    const notes: string[] = [];
    if (u.step >= MAX_STEP) {
      blockers.push("at-ceiling");
      notes.push(`Already at Step ${MAX_STEP}, the ceiling.`);
    }
    if (!from) {
      blockers.push("no-service-date");
      notes.push(
        "No date for the present position or the current step — nothing " +
          "to count three years from.",
      );
    } else if (dueOn && dueOn.getTime() > asOf.getTime()) {
      blockers.push("not-yet-due");
      notes.push(`Three years fall due on ${dueOn.toISOString().slice(0, 10)}.`);
    }
    if (lwop > MAX_LWOP_DAYS) {
      blockers.push("lwop-exceeded");
      notes.push(
        `${lwop} days of approved leave without pay in the window, over ` +
          `the ${MAX_LWOP_DAYS}-day guidance — HR should check whether the ` +
          `reckoning date moves.`,
      );
    }
    if (pending) {
      blockers.push("already-proposed");
      notes.push("A proposal is already waiting for a decision.");
    }

    out.push({
      userId: u.id,
      name: `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim(),
      currentStep: u.step,
      grade: u.SalaryGrade?.grade ?? null,
      originalAppointmentDate: u.originalAppointmentDate,
      presentPositionDate: u.presentPositionDate,
      stepEffectiveDate: u.stepEffectiveDate,
      reckonedFrom: from,
      dueOn,
      lwopDays: lwop,
      blockers,
      notes,
    });
  }

  // Due first, then by how soon.
  return out.sort((a, b) => {
    const ad = a.blockers.length === 0 ? 0 : 1;
    const bd = b.blockers.length === 0 ? 0 : 1;
    if (ad !== bd) return ad - bd;
    return (a.dueOn?.getTime() ?? Infinity) - (b.dueOn?.getTime() ?? Infinity);
  });
};

/** Raise proposals for the people who are due and clear of blockers. */
export const proposeDue = async (
  lineId: string,
  asOf: Date = new Date(),
  onlyUserIds?: string[],
): Promise<{ proposed: number; skipped: Array<{ userId: string; why: string }> }> => {
  const candidates = await listCandidates(lineId, asOf);
  const wanted = onlyUserIds?.length
    ? candidates.filter((c) => onlyUserIds.includes(c.userId))
    : candidates;

  let proposed = 0;
  const skipped: Array<{ userId: string; why: string }> = [];
  for (const c of wanted) {
    if (c.blockers.length) {
      skipped.push({ userId: c.userId, why: c.notes[0] ?? c.blockers[0] });
      continue;
    }
    if (!c.reckonedFrom || !c.dueOn) continue;
    await prisma.stepIncrement.create({
      data: {
        userId: c.userId,
        lineId,
        fromStep: c.currentStep,
        toStep: c.currentStep + 1,
        basis: "length-of-service",
        // Effective the day the three years complete, not the day HR
        // happens to run the list.
        effectiveDate: c.dueOn,
        serviceFrom: c.reckonedFrom,
        serviceTo: c.dueOn,
        lwopDays: c.lwopDays,
        status: "proposed",
      },
    });
    proposed++;
  }
  return { proposed, skipped };
};

/**
 * HR's decision.
 *
 * Approval REQUIRES the explicit certification that service was
 * satisfactory, because nothing in this system can establish that. An
 * approval without it is refused rather than recorded with a default.
 */
export const decide = async (opts: {
  id: string;
  lineId: string;
  action: "approve" | "reject";
  decidedByUserId: string;
  certifiedSatisfactory?: boolean;
  nosiNumber?: string | null;
  note?: string | null;
}): Promise<{ ok: true; status: string } | { ok: false; why: string }> => {
  const inc = await prisma.stepIncrement.findUnique({
    where: { id: opts.id },
    select: {
      id: true, userId: true, lineId: true, status: true,
      fromStep: true, toStep: true, effectiveDate: true,
    },
  });
  if (!inc) return { ok: false, why: "No such step increment." };
  if (inc.lineId !== opts.lineId) {
    return { ok: false, why: "That increment belongs to another municipality." };
  }
  if (inc.status !== "proposed") {
    return { ok: false, why: `Already ${inc.status}.` };
  }
  if (inc.userId === opts.decidedByUserId) {
    return { ok: false, why: "You cannot decide your own step increment." };
  }
  if (opts.action === "approve" && !opts.certifiedSatisfactory) {
    return {
      ok: false,
      why:
        "Approval requires certifying that the three years of service were " +
        "satisfactory. This system has no performance ratings and cannot " +
        "determine it.",
    };
  }
  if (opts.action === "approve" && inc.toStep > MAX_STEP) {
    return { ok: false, why: `Step ${MAX_STEP} is the ceiling.` };
  }

  await prisma.$transaction(async (tx) => {
    await tx.stepIncrement.update({
      where: { id: inc.id },
      data: {
        status: opts.action === "approve" ? "approved" : "rejected",
        certifiedSatisfactory: !!opts.certifiedSatisfactory,
        nosiNumber: opts.nosiNumber ?? null,
        note: opts.note ?? null,
        decidedAt: new Date(),
        decidedByUserId: opts.decidedByUserId,
      },
    });
    if (opts.action === "approve") {
      /*
        The step moves AND the clock restarts. Writing the step without
        stepEffectiveDate would leave the next increment reckoned from
        the old date and fall due immediately.
      */
      await tx.user.update({
        where: { id: inc.userId },
        data: { step: inc.toStep, stepEffectiveDate: inc.effectiveDate },
      });
    }
  });
  /*
    A decision that moves somebody's pay should be findable later without
    reading the database by hand, so it lands in the activity log with the
    NOSI number the Notice of Step Increment will carry.
  */
  const subject = await prisma.user.findUnique({
    where: { id: inc.userId },
    select: { firstName: true, lastName: true },
  });
  const name = `${subject?.firstName ?? ""} ${subject?.lastName ?? ""}`.trim();
  await prisma.activityLogs.create({
    data: {
      userId: opts.decidedByUserId,
      lineId: opts.lineId,
      action: 2,
      desc:
        `Step increment ${opts.action === "approve" ? "approved" : "rejected"}` +
        ` for ${name}: step ${inc.fromStep} to ${inc.toStep}, effective ` +
        `${inc.effectiveDate.toISOString().slice(0, 10)}` +
        (opts.nosiNumber ? `, NOSI ${opts.nosiNumber}` : ""),
    },
  });
  return { ok: true, status: opts.action === "approve" ? "approved" : "rejected" };
};

/**
 * Record where a person stands today: the dates, and the step they are
 * already on.
 *
 * This is data entry, not a grant. Most employees were hired long before
 * this system existed, so somebody has to tell it when they took up the
 * present position and which step they reached — until then every one of
 * them reads "no service date" and nothing can be proposed at all.
 *
 * `undefined` leaves a field alone; `null` clears it.
 */
export const setServiceRecord = async (opts: {
  userId: string;
  lineId: string;
  byUserId: string;
  originalAppointmentDate?: Date | null;
  presentPositionDate?: Date | null;
  stepEffectiveDate?: Date | null;
  step?: number | null;
}): Promise<{ ok: true } | { ok: false; why: string }> => {
  const target = await prisma.user.findUnique({
    where: { id: opts.userId },
    select: {
      id: true, lineId: true, step: true, stepEffectiveDate: true,
      firstName: true, lastName: true,
    },
  });
  if (!target) return { ok: false, why: "No such employee." };
  /*
    The HR gate checks the CALLER's municipality. It cannot check the
    TARGET's, so this does — otherwise HR of one line could edit another
    line's employee by passing their id.
  */
  if (target.lineId !== opts.lineId) {
    return { ok: false, why: "That employee belongs to another municipality." };
  }

  if (opts.step !== undefined && opts.step !== null) {
    if (!Number.isInteger(opts.step) || opts.step < 1 || opts.step > MAX_STEP) {
      return { ok: false, why: `Step must be a whole number from 1 to ${MAX_STEP}.` };
    }
    /*
      A step above 1 with no date for it would leave the three years
      reckoned from the wrong event — usually making the person look due
      immediately. If the date is not known, the honest state is to leave
      the step alone and let the record read "no service date".
    */
    const effective =
      opts.stepEffectiveDate !== undefined
        ? opts.stepEffectiveDate
        : target.stepEffectiveDate;
    if (opts.step > 1 && !effective) {
      return {
        ok: false,
        why:
          `Step ${opts.step} needs the date it took effect, or the next ` +
          `increment cannot be reckoned. Enter "Current step since" as well.`,
      };
    }
  }

  const data: Record<string, unknown> = {};
  const put = (k: string, v: Date | number | null | undefined) => {
    if (v !== undefined) data[k] = v;
  };
  put("originalAppointmentDate", opts.originalAppointmentDate);
  put("presentPositionDate", opts.presentPositionDate);
  put("stepEffectiveDate", opts.stepEffectiveDate);
  put("step", opts.step);
  if (!Object.keys(data).length) return { ok: false, why: "Nothing to change." };

  await prisma.user.update({ where: { id: target.id }, data });

  const name = `${target.firstName ?? ""} ${target.lastName ?? ""}`.trim();
  const changed = Object.entries(data)
    .map(([k, v]) => `${k}=${v instanceof Date ? v.toISOString().slice(0, 10) : v}`)
    .join(", ");
  await prisma.activityLogs.create({
    data: {
      userId: opts.byUserId,
      lineId: opts.lineId,
      action: 2,
      desc: `Service record for ${name}: ${changed}`,
    },
  });
  return { ok: true };
};
