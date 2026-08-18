import { FastifyRequest, FastifyReply } from "../barrel/fastify";
import { prisma, Prisma } from "../barrel/prisma";
import {
  NotFoundError,
  ValidationError,
  UnauthorizedError,
  dbError,
} from "../errors/errors";
import { callerUserId, sendEmail, phNumberFormat } from "../middleware/handler";
import { semaphoreService } from "../class/Semaphore";
import { EncryptionService } from "../service/encryption";
import { PROVISIONAL_STATUSES } from "./provisionalController";
import {
  ATTENDANCE_FIELDS,
  resolveAttendanceUser,
} from "../service/attendanceFields";

/**
 * HR Message Queue.
 *
 * HR writes a template with {{placeholders}}, picks up to 20 people, and sends
 * by SMS (Semaphore) or Gmail. Every recipient gets its own row recording what
 * was actually sent, so one failure can be retried without re-sending to the
 * whole list.
 */

/** Hard ceiling, enforced HERE and not only in the UI. */
export const MAX_RECIPIENTS = 20;

const dec = async (d?: string | null, iv?: string | null) => {
  if (!d) return "";
  if (!iv) return d;
  try {
    return (await EncryptionService.decrypt(d, iv)) ?? "";
  } catch {
    return d;
  }
};

const callerLine = async (req: FastifyRequest) => {
  const accountId = (req.user as { id?: string } | undefined)?.id;
  if (!accountId) return null;
  const a = await prisma.account.findUnique({
    where: { id: accountId },
    select: { lineId: true, User: { select: { lineId: true } } },
  });
  return a?.lineId ?? a?.User?.lineId ?? null;
};

const isNonPlantilla = (status: string) =>
  PROVISIONAL_STATUSES.some(
    (s) => s.toLowerCase() === (status || "").trim().toLowerCase(),
  );

/** Gmail-only, as specified. */
const isGmail = (e: string) => /^[^@\s]+@gmail\.com$/i.test((e || "").trim());

// -- Placeholders ----------------------------------------------------------
// Reuses the attendance field catalogue so there is ONE definition of what a
// user property is called and where its value comes from.
export const placeholderCatalogue = async (
  _req: FastifyRequest,
  res: FastifyReply,
) =>
  res.code(200).send({
    placeholders: ATTENDANCE_FIELDS.map((f) => ({
      key: f.key,
      label: f.label,
      group: f.group,
      token: "{{" + f.key + "}}",
    })),
  });

const TOKEN = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;

export const extractTokens = (body: string): string[] => [
  ...new Set([...(body || "").matchAll(TOKEN)].map((m) => m[1])),
];

/**
 * Substitutes {{tokens}} for one user.
 *
 * An unknown or empty token is left VISIBLE as {{token}} rather than blanked —
 * a silent gap in an official message is worse than an obvious one, and the
 * compose screen warns about it before sending.
 */
export const renderFor = async (body: string, userId: string) => {
  const keys = extractTokens(body);
  if (!keys.length) return body;
  const resolved = await resolveAttendanceUser(userId, keys);
  const vals = resolved?.values ?? {};
  return (body || "").replace(TOKEN, (whole: string, k: string) =>
    vals[k] !== undefined && vals[k] !== "" ? vals[k] : whole,
  );
};

/**
 * POST /hr/message/preview  { body, userId }
 *
 * Renders the message for ONE real employee so the compose screen shows the
 * exact text that will be sent, not an approximation built in the browser.
 */
export const previewMessage = async (req: FastifyRequest, res: FastifyReply) => {
  const b = req.body as { body?: string; userId?: string };
  const lineId = await callerLine(req);
  if (!lineId) throw new UnauthorizedError("No line for this account");
  if (!b.userId) throw new ValidationError("Pick someone to preview against");
  const u = await prisma.user.findFirst({
    where: { id: b.userId, lineId },
    select: { id: true },
  });
  if (!u) throw new NotFoundError("Employee not found");
  const rendered = await renderFor(b.body || "", b.userId);
  const unresolved = [...new Set([...rendered.matchAll(TOKEN)].map((m) => m[1]))];
  return res.code(200).send({ rendered, unresolved });
};

// -- Templates -------------------------------------------------------------
export const listTemplates = async (req: FastifyRequest, res: FastifyReply) => {
  const lineId = await callerLine(req);
  if (!lineId) throw new UnauthorizedError("No line for this account");
  const rows = await prisma.hrMessageTemplate.findMany({
    where: { lineId },
    orderBy: { updatedAt: "desc" },
    take: 100,
  });
  return res.code(200).send({ templates: rows });
};

export const saveTemplate = async (req: FastifyRequest, res: FastifyReply) => {
  const b = req.body as {
    id?: string;
    name?: string;
    channel?: string;
    subject?: string;
    body?: string;
  };
  const lineId = await callerLine(req);
  const userId = await callerUserId(req);
  if (!lineId) throw new UnauthorizedError("No line for this account");

  const name = (b.name || "").trim();
  const body = (b.body || "").trim();
  if (!name) throw new ValidationError("Give the template a name");
  if (!body) throw new ValidationError("The message body is empty");
  const channel = b.channel === "email" ? "email" : "sms";
  if (channel === "email" && !(b.subject || "").trim())
    throw new ValidationError("Email templates need a subject");

  const data = {
    lineId,
    name,
    channel,
    subject: channel === "email" ? (b.subject || "").trim() : null,
    body,
    placeholders: extractTokens(body),
  };

  try {
    if (b.id) {
      const owned = await prisma.hrMessageTemplate.findFirst({
        where: { id: b.id, lineId },
        select: { id: true },
      });
      if (!owned) throw new NotFoundError("Template not found");
      return res
        .code(200)
        .send(await prisma.hrMessageTemplate.update({ where: { id: b.id }, data }));
    }
    return res
      .code(201)
      .send(
        await prisma.hrMessageTemplate.create({
          data: { ...data, createdById: userId },
        }),
      );
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError) throw dbError(e);
    throw e;
  }
};

export const deleteTemplate = async (req: FastifyRequest, res: FastifyReply) => {
  const { id } = req.params as { id: string };
  const lineId = await callerLine(req);
  const owned = await prisma.hrMessageTemplate.findFirst({
    where: { id, lineId: lineId ?? "" },
    select: { id: true },
  });
  if (!owned) throw new NotFoundError("Template not found");
  await prisma.hrMessageTemplate.delete({ where: { id } });
  return res.code(200).send({ message: "OK" });
};

// -- Recipient search ------------------------------------------------------
/**
 * GET /hr/message/recipients?audience=&query=&channel=
 *
 * `status` is encrypted at rest, so Plantilla / Non-Plantilla CANNOT be a SQL
 * filter — rows are decrypted and partitioned in memory.
 */
export const searchRecipients = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const q = req.query as { audience?: string; query?: string; channel?: string };
  const lineId = await callerLine(req);
  if (!lineId) throw new UnauthorizedError("No line for this account");
  const channel = q.channel === "email" ? "email" : "sms";
  const term = (q.query || "").trim().toLowerCase();

  const users = await prisma.user.findMany({
    where: { lineId, active: 1, archivedAt: null },
    select: {
      id: true,
      firstName: true,
      firstNameIv: true,
      lastName: true,
      lastNameIv: true,
      status: true,
      statusIV: true,
      email: true,
      emailIv: true,
      phoneNumber: true,
      phoneNumberIv: true,
      Position: { select: { name: true } },
      department: { select: { name: true } },
    },
    take: 800,
  });

  const out: Array<Record<string, unknown>> = [];
  for (const u of users) {
    const status = await dec(u.status, u.statusIV);
    const nonPlantilla = isNonPlantilla(status);
    if (q.audience === "plantilla" && nonPlantilla) continue;
    if (q.audience === "non-plantilla" && !nonPlantilla) continue;

    const first = await dec(u.firstName, u.firstNameIv);
    const last = await dec(u.lastName, u.lastNameIv);
    const name =
      `${last}, ${first}`.replace(/^,\s*|,\s*$/g, "").trim() || "Unnamed";

    if (
      term &&
      !`${name} ${u.Position?.name ?? ""} ${u.department?.name ?? ""}`
        .toLowerCase()
        .includes(term)
    )
      continue;

    const to =
      channel === "email"
        ? await dec(u.email, u.emailIv)
        : phNumberFormat(await dec(u.phoneNumber, u.phoneNumberIv));

    // Surface WHY someone cannot be messaged instead of hiding them — HR needs
    // to know a contact detail is missing so they can go and fix it.
    const reason = !to
      ? channel === "email"
        ? "No email on file"
        : "No mobile number on file"
      : channel === "email" && !isGmail(to)
        ? "Not a Gmail address"
        : null;

    out.push({
      id: u.id,
      name,
      status: status || "-",
      plantilla: !nonPlantilla,
      position: u.Position?.name ?? null,
      office: u.department?.name ?? null,
      to,
      sendable: !reason,
      reason,
    });
    if (out.length >= 300) break;
  }

  out.sort((a, b) => String(a.name).localeCompare(String(b.name)));
  return res.code(200).send({ recipients: out, max: MAX_RECIPIENTS });
};

// -- Sending ---------------------------------------------------------------
/** Delivers one already-rendered message. Never throws — returns the outcome. */
const deliver = async (
  channel: string,
  to: string,
  subject: string | null,
  text: string,
): Promise<{ ok: boolean; error?: string }> => {
  try {
    if (channel === "email") {
      if (!isGmail(to)) return { ok: false, error: "Not a Gmail address" };
      await sendEmail(subject || "Message from HR", to, text, "HR Team");
      return { ok: true };
    }
    const num = phNumberFormat(to);
    if (!num) return { ok: false, error: "Invalid mobile number" };
    const r = (await semaphoreService.sendSingleSMS(num, text)) as {
      success?: boolean;
      message?: string;
    };
    return r?.success === false
      ? { ok: false, error: r?.message ?? "SMS gateway rejected the message" }
      : { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Send failed" };
  }
};

export const sendBatch = async (req: FastifyRequest, res: FastifyReply) => {
  const b = req.body as {
    templateId?: string;
    channel?: string;
    subject?: string;
    body?: string;
    audience?: string;
    userIds?: string[];
  };
  const lineId = await callerLine(req);
  const actorId = await callerUserId(req);
  if (!lineId) throw new UnauthorizedError("No line for this account");

  const ids = [...new Set(Array.isArray(b.userIds) ? b.userIds : [])];
  if (!ids.length) throw new ValidationError("Pick at least one recipient");
  if (ids.length > MAX_RECIPIENTS)
    throw new ValidationError(
      `You can send to at most ${MAX_RECIPIENTS} people at a time.`,
    );

  const channel = b.channel === "email" ? "email" : "sms";
  const body = (b.body || "").trim();
  if (!body) throw new ValidationError("The message body is empty");
  const subject = channel === "email" ? (b.subject || "").trim() : null;
  if (channel === "email" && !subject)
    throw new ValidationError("Email needs a subject");

  try {
    const batch = await prisma.hrMessageBatch.create({
      data: {
        lineId,
        templateId: b.templateId || null,
        channel,
        subject,
        body,
        audience:
          b.audience === "plantilla" || b.audience === "non-plantilla"
            ? b.audience
            : "custom",
        total: ids.length,
        createdById: actorId,
      },
    });

    let sent = 0;
    let failed = 0;

    for (const uid of ids) {
      // Scoped to the caller's line — never message across a line boundary.
      const u = await prisma.user.findFirst({
        where: { id: uid, lineId },
        select: {
          id: true,
          firstName: true,
          firstNameIv: true,
          lastName: true,
          lastNameIv: true,
          email: true,
          emailIv: true,
          phoneNumber: true,
          phoneNumberIv: true,
        },
      });
      if (!u) {
        failed++;
        continue;
      }

      const name =
        `${await dec(u.lastName, u.lastNameIv)}, ${await dec(u.firstName, u.firstNameIv)}`
          .replace(/^,\s*|,\s*$/g, "")
          .trim() || "Unnamed";
      const to =
        channel === "email"
          ? await dec(u.email, u.emailIv)
          : phNumberFormat(await dec(u.phoneNumber, u.phoneNumberIv));
      const rendered = await renderFor(body, uid);

      const r = to
        ? await deliver(channel, to, subject, rendered)
        : {
            ok: false,
            error:
              channel === "email"
                ? "No email on file"
                : "No mobile number on file",
          };

      // Frozen: toAddress + renderedBody are what was ACTUALLY sent, so a
      // later profile edit cannot rewrite history and a retry goes to the
      // same place with the same words.
      await prisma.hrMessageRecipient.upsert({
        where: { batchId_userId: { batchId: batch.id, userId: uid } },
        update: {},
        create: {
          batchId: batch.id,
          userId: uid,
          name,
          toAddress: to || "",
          renderedBody: rendered,
          status: r.ok ? "sent" : "failed",
          error: r.ok ? null : (r.error ?? "Send failed"),
          attempts: 1,
          sentAt: r.ok ? new Date() : null,
        },
      });

      if (r.ok) sent++;
      else failed++;
    }

    await prisma.hrMessageBatch.update({
      where: { id: batch.id },
      data: { sentCount: sent, failedCount: failed },
    });
    return res
      .code(200)
      .send({ batchId: batch.id, total: ids.length, sent, failed });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError) throw dbError(e);
    throw e;
  }
};

/** Retries ONLY the failed rows of a batch, reusing the frozen address/body. */
export const retryBatch = async (req: FastifyRequest, res: FastifyReply) => {
  const b = req.body as { batchId?: string; recipientIds?: string[] };
  const lineId = await callerLine(req);
  if (!b.batchId) throw new ValidationError("batchId is required");

  const batch = await prisma.hrMessageBatch.findFirst({
    where: { id: b.batchId, lineId: lineId ?? "" },
  });
  if (!batch) throw new NotFoundError("Batch not found");

  const rows = await prisma.hrMessageRecipient.findMany({
    where: {
      batchId: batch.id,
      // Never re-send to someone who already received it.
      status: "failed",
      ...(Array.isArray(b.recipientIds) && b.recipientIds.length
        ? { id: { in: b.recipientIds } }
        : {}),
    },
  });

  let fixed = 0;
  for (const r of rows) {
    const out = r.toAddress
      ? await deliver(batch.channel, r.toAddress, batch.subject, r.renderedBody)
      : { ok: false, error: "No contact detail on file" };
    await prisma.hrMessageRecipient.update({
      where: { id: r.id },
      data: {
        status: out.ok ? "sent" : "failed",
        error: out.ok ? null : (out.error ?? "Send failed"),
        attempts: { increment: 1 },
        sentAt: out.ok ? new Date() : null,
      },
    });
    if (out.ok) fixed++;
  }

  const [sent, failed] = await Promise.all([
    prisma.hrMessageRecipient.count({
      where: { batchId: batch.id, status: "sent" },
    }),
    prisma.hrMessageRecipient.count({
      where: { batchId: batch.id, status: "failed" },
    }),
  ]);
  await prisma.hrMessageBatch.update({
    where: { id: batch.id },
    data: { sentCount: sent, failedCount: failed },
  });

  return res
    .code(200)
    .send({ retried: rows.length, nowSent: fixed, sent, failed });
};

// -- History ---------------------------------------------------------------
export const listBatches = async (req: FastifyRequest, res: FastifyReply) => {
  const q = req.query as { page?: string };
  const lineId = await callerLine(req);
  if (!lineId) throw new UnauthorizedError("No line for this account");
  const page = Math.max(0, Number(q.page ?? 0) || 0);
  const take = 20;

  const [rows, total] = await Promise.all([
    prisma.hrMessageBatch.findMany({
      where: { lineId },
      orderBy: { createdAt: "desc" },
      skip: page * take,
      take,
      include: { createdBy: { select: { firstName: true, lastName: true } } },
    }),
    prisma.hrMessageBatch.count({ where: { lineId } }),
  ]);

  return res.code(200).send({
    batches: rows.map((r) => ({
      ...r,
      createdByName: r.createdBy
        ? `${r.createdBy.firstName} ${r.createdBy.lastName}`.trim()
        : null,
    })),
    total,
    page,
    pages: Math.ceil(total / take),
  });
};

export const batchDetail = async (req: FastifyRequest, res: FastifyReply) => {
  const { id } = req.params as { id: string };
  const lineId = await callerLine(req);
  const batch = await prisma.hrMessageBatch.findFirst({
    where: { id, lineId: lineId ?? "" },
  });
  if (!batch) throw new NotFoundError("Batch not found");
  const recipients = await prisma.hrMessageRecipient.findMany({
    where: { batchId: id },
    orderBy: [{ status: "asc" }, { name: "asc" }],
  });
  return res.code(200).send({ batch, recipients });
};
