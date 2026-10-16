/**
 * The HR side of step increments: see who is due, propose, decide.
 *
 * HR only — `requireHr`, not `requireHrOrSelf`. Reading your own payslip
 * is one thing; approving the increment that raises your own pay is
 * another, and `decide` refuses it a second time at the service layer so
 * the rule does not depend on the gate alone.
 */
import { FastifyReply, FastifyRequest } from "../barrel/fastify";
import { ValidationError } from "../errors/errors";
import { requireHr } from "../service/callerScope";
import {
  LOS_YEARS,
  MAX_LWOP_DAYS,
  decide,
  listCandidates,
  proposeDue,
  setServiceRecord,
} from "../service/stepIncrement";

const asOfFrom = (raw?: string): Date => {
  if (!raw) return new Date();
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) throw new ValidationError("`asOf` is not a date.");
  return d;
};

/**
 * GET /hr/step-increments/due?lineId=&asOf=
 *
 * Everyone, not just those who qualify: an officer asking who is due also
 * needs to see who is nearly due and who is stuck behind a missing date.
 */
export const stepIncrementsDue = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const q = req.query as { lineId?: string; asOf?: string };
  if (!q.lineId) throw new ValidationError("lineId is required.");
  await requireHr(req, q.lineId, "listing step increments");

  const asOf = asOfFrom(q.asOf);
  const candidates = await listCandidates(q.lineId, asOf);
  return res.code(200).send({
    asOf,
    rules: {
      yearsPerStep: LOS_YEARS,
      maxLwopDays: MAX_LWOP_DAYS,
      note:
        "Length of service only. Merit-based increments need a performance " +
        "rating module, which does not exist yet.",
    },
    due: candidates.filter((c) => c.blockers.length === 0),
    others: candidates.filter((c) => c.blockers.length > 0),
  });
};

/**
 * POST /hr/step-increments/propose  { lineId, asOf?, userIds? }
 *
 * Raises proposals. Nothing is granted here — a proposal still has to be
 * decided, and the people skipped are named with the reason.
 */
export const stepIncrementsPropose = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const body = req.body as { lineId?: string; asOf?: string; userIds?: string[] };
  if (!body?.lineId) throw new ValidationError("lineId is required.");
  await requireHr(req, body.lineId, "proposing step increments");

  const result = await proposeDue(
    body.lineId,
    asOfFrom(body.asOf),
    Array.isArray(body.userIds) ? body.userIds : undefined,
  );
  return res.code(200).send({ message: "OK", ...result });
};

/**
 * POST /hr/step-increments/decide
 *   { lineId, id, action: "approve"|"reject", certifiedSatisfactory?,
 *     nosiNumber?, note? }
 *
 * Approving requires certifying the service was satisfactory. That is not
 * a checkbox for its own sake: the system has no performance ratings, so
 * the certification is the only record that anybody checked.
 */
export const stepIncrementsDecide = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const body = req.body as {
    lineId?: string;
    id?: string;
    action?: string;
    certifiedSatisfactory?: boolean;
    nosiNumber?: string;
    note?: string;
  };
  if (!body?.lineId || !body?.id) {
    throw new ValidationError("lineId and id are required.");
  }
  if (body.action !== "approve" && body.action !== "reject") {
    throw new ValidationError('action must be "approve" or "reject".');
  }
  const caller = await requireHr(req, body.lineId, "deciding a step increment");

  const out = await decide({
    id: body.id,
    lineId: body.lineId,
    action: body.action,
    decidedByUserId: caller.actorId,
    certifiedSatisfactory: body.certifiedSatisfactory === true,
    nosiNumber: body.nosiNumber ?? null,
    note: body.note ?? null,
  });
  if (!out.ok) throw new ValidationError(out.why);
  return res.code(200).send({ message: "OK", status: out.status });
};

/** GET /hr/step-increments?lineId=&userId= — the record, for a NOSI. */
export const stepIncrementsList = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const q = req.query as { lineId?: string; userId?: string; status?: string };
  if (!q.lineId) throw new ValidationError("lineId is required.");
  await requireHr(req, q.lineId, "listing step increments");

  const rows = await prismaList(q);
  return res.code(200).send({ list: rows });
};

// Kept out of the handler so the query reads in one piece.
const prismaList = async (q: {
  lineId?: string;
  userId?: string;
  status?: string;
}) => {
  const { prisma } = await import("../barrel/prisma");
  return prisma.stepIncrement.findMany({
    where: {
      lineId: q.lineId,
      ...(q.userId ? { userId: q.userId } : {}),
      ...(q.status ? { status: q.status } : {}),
    },
    orderBy: [{ proposedAt: "desc" }],
    take: 500,
    select: {
      id: true,
      userId: true,
      fromStep: true,
      toStep: true,
      basis: true,
      effectiveDate: true,
      serviceFrom: true,
      serviceTo: true,
      lwopDays: true,
      status: true,
      certifiedSatisfactory: true,
      nosiNumber: true,
      note: true,
      proposedAt: true,
      decidedAt: true,
      user: { select: { firstName: true, lastName: true } },
      decidedBy: { select: { firstName: true, lastName: true } },
    },
  });
};

/**
 * POST /hr/step-increments/service-record
 *   { lineId, userId, originalAppointmentDate?, presentPositionDate?,
 *     stepEffectiveDate?, step? }
 *
 * Recording what is already true, so the arithmetic has something to work
 * from. A field left out is left alone; an empty string clears it.
 */
export const stepIncrementsSetServiceRecord = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const body = req.body as Record<string, unknown>;
  const lineId = typeof body?.lineId === "string" ? body.lineId : "";
  const userId = typeof body?.userId === "string" ? body.userId : "";
  if (!lineId || !userId) {
    throw new ValidationError("lineId and userId are required.");
  }
  const caller = await requireHr(req, lineId, "editing a service record");

  /* "" clears the date, a missing key leaves it untouched. */
  const dateField = (key: string): Date | null | undefined => {
    if (!(key in body)) return undefined;
    const raw = body[key];
    if (raw === null || raw === "") return null;
    const d = new Date(String(raw));
    if (Number.isNaN(d.getTime())) {
      throw new ValidationError(`\`${key}\` is not a date.`);
    }
    return d;
  };

  let step: number | null | undefined = undefined;
  if ("step" in body) {
    const raw = body.step;
    if (raw === null || raw === "") step = null;
    else {
      step = Number(raw);
      if (!Number.isFinite(step)) throw new ValidationError("`step` is not a number.");
    }
  }

  const out = await setServiceRecord({
    userId,
    lineId,
    byUserId: caller.actorId,
    originalAppointmentDate: dateField("originalAppointmentDate"),
    presentPositionDate: dateField("presentPositionDate"),
    stepEffectiveDate: dateField("stepEffectiveDate"),
    step,
  });
  if (!out.ok) throw new ValidationError(out.why);
  return res.code(200).send({ message: "OK" });
};
