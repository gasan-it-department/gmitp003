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
 * A BATCH is the unit of work. HR creates one, writes the message on it, and
 * adds recipients (each becomes a row at status "pending"). Sending goes out
 * in waves of at most 20: each dispatched row flips to "sent" or "failed", so
 * the same list that was the recipient picker becomes the delivery report and
 * HR can see exactly who is still waiting.
 *
 * Lifecycle:
 *   draft    nothing dispatched yet - message and recipients fully editable
 *   sending  at least one wave out, some still pending - message is LOCKED
 *            (two people under one batch must not receive different text),
 *            but more recipients may still be added and sent
 *   sent     nothing pending - a finished record; retry is all that remains
 */

/**
 * 20 is how many go out in ONE send, not how many a batch may hold. A batch
 * can carry the whole office; HR dispatches it in waves of 20 and watches the
 * indicator fill in. Both ceilings are enforced HERE, not only in the UI.
 */
export const MAX_PER_SEND = 20;
/** Sanity bound on one batch, so a mis-click cannot queue the entire database. */
export const MAX_BATCH_RECIPIENTS = 1000;

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

/** Resolves a batch the caller is actually allowed to touch. */
const ownedBatch = async (req: FastifyRequest, id: string) => {
  const lineId = await callerLine(req);
  if (!lineId) throw new UnauthorizedError("No line for this account");
  const batch = await prisma.hrMessageBatch.findFirst({
    where: { id, lineId },
  });
  if (!batch) throw new NotFoundError("Batch not found");
  return { batch, lineId };
};

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
export const previewMessage = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
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
  const unresolved = [
    ...new Set([...rendered.matchAll(TOKEN)].map((m) => m[1])),
  ];
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
        .send(
          await prisma.hrMessageTemplate.update({ where: { id: b.id }, data }),
        );
    }
    return res.code(201).send(
      await prisma.hrMessageTemplate.create({
        data: { ...data, createdById: userId },
      }),
    );
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError) throw dbError(e);
    throw e;
  }
};

export const deleteTemplate = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
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

// -- Employee search (for adding recipients) -------------------------------
/**
 * GET /hr/message/employees?audience=&query=&channel=&batchId=
 *
 * `status` is encrypted at rest, so Plantilla / Non-Plantilla CANNOT be a SQL
 * filter — rows are decrypted and partitioned in memory.
 */
export const searchEmployees = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const q = req.query as {
    audience?: string;
    query?: string;
    channel?: string;
    batchId?: string;
  };
  const lineId = await callerLine(req);
  if (!lineId) throw new UnauthorizedError("No line for this account");
  const channel = q.channel === "email" ? "email" : "sms";
  const term = (q.query || "").trim().toLowerCase();

  // Anyone already on the batch is marked so the picker shows them as added
  // rather than offering them a second time.
  const already = q.batchId
    ? new Set(
        (
          await prisma.hrMessageRecipient.findMany({
            where: { batchId: q.batchId },
            select: { userId: true },
          })
        ).map((r) => r.userId),
      )
    : new Set<string>();

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
      added: already.has(u.id),
    });
    if (out.length >= 300) break;
  }

  out.sort((a, b) => String(a.name).localeCompare(String(b.name)));
  return res.code(200).send({
    employees: out,
    maxPerSend: MAX_PER_SEND,
    maxPerBatch: MAX_BATCH_RECIPIENTS,
  });
};

// -- Batches ---------------------------------------------------------------
export const listBatches = async (req: FastifyRequest, res: FastifyReply) => {
  const q = req.query as { page?: string; search?: string; status?: string };
  const lineId = await callerLine(req);
  if (!lineId) throw new UnauthorizedError("No line for this account");
  const page = Math.max(0, Number(q.page ?? 0) || 0);
  const take = 20;
  const search = (q.search || "").trim();

  const where: Prisma.HrMessageBatchWhereInput = {
    lineId,
    ...(q.status === "draft" || q.status === "sent" ? { status: q.status } : {}),
    ...(search
      ? {
          OR: [
            { name: { contains: search, mode: "insensitive" } },
            { subject: { contains: search, mode: "insensitive" } },
            { body: { contains: search, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.hrMessageBatch.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: page * take,
      take,
      include: { createdBy: { select: { firstName: true, lastName: true } } },
    }),
    prisma.hrMessageBatch.count({ where }),
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

export const createBatch = async (req: FastifyRequest, res: FastifyReply) => {
  const b = req.body as {
    name?: string;
    channel?: string;
    templateId?: string;
  };
  const lineId = await callerLine(req);
  const actorId = await callerUserId(req);
  if (!lineId) throw new UnauthorizedError("No line for this account");

  const channel = b.channel === "email" ? "email" : "sms";
  let subject: string | null = null;
  let body = "";

  // Starting from a template pre-fills the draft — the whole point of having
  // templates in the first place.
  if (b.templateId) {
    const t = await prisma.hrMessageTemplate.findFirst({
      where: { id: b.templateId, lineId },
    });
    if (t) {
      subject = t.subject;
      body = t.body;
    }
  }

  try {
    const batch = await prisma.hrMessageBatch.create({
      data: {
        lineId,
        name: (b.name || "").trim() || null,
        templateId: b.templateId || null,
        channel,
        subject,
        body,
        status: "draft",
        createdById: actorId,
      },
    });
    return res.code(201).send(batch);
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError) throw dbError(e);
    throw e;
  }
};

export const updateBatch = async (req: FastifyRequest, res: FastifyReply) => {
  const { id } = req.params as { id: string };
  const b = req.body as {
    name?: string;
    channel?: string;
    subject?: string;
    body?: string;
    audience?: string;
  };
  const { batch } = await ownedBatch(req, id);
  // Once one wave is out the text is frozen: two people under the same batch
  // must never receive different messages.
  if (batch.status !== "draft")
    throw new ValidationError(
      "Part of this batch has already gone out, so the message can no longer be changed.",
    );

  const channel =
    b.channel === undefined
      ? batch.channel
      : b.channel === "email"
        ? "email"
        : "sms";

  const data: Prisma.HrMessageBatchUpdateInput = {};
  if (b.name !== undefined) data.name = b.name.trim() || null;
  if (b.channel !== undefined) data.channel = channel;
  if (b.body !== undefined) data.body = b.body;
  if (b.subject !== undefined)
    data.subject = channel === "email" ? b.subject : null;
  if (b.audience !== undefined)
    data.audience =
      b.audience === "plantilla" || b.audience === "non-plantilla"
        ? b.audience
        : "custom";
  // Switching to SMS drops a subject that no longer applies.
  if (b.channel === "sms") data.subject = null;

  const updated = await prisma.hrMessageBatch.update({ where: { id }, data });

  // Changing channel changes which contact detail is used, so every pending
  // recipient's address is re-resolved. Rows already sent keep their frozen
  // address — that is the record of where the message actually went.
  if (b.channel !== undefined && b.channel !== batch.channel) {
    const pending = await prisma.hrMessageRecipient.findMany({
      where: { batchId: id, status: "pending" },
      select: { id: true, userId: true },
    });
    for (const r of pending) {
      const u = await prisma.user.findUnique({
        where: { id: r.userId },
        select: {
          email: true,
          emailIv: true,
          phoneNumber: true,
          phoneNumberIv: true,
        },
      });
      const to =
        channel === "email"
          ? await dec(u?.email, u?.emailIv)
          : phNumberFormat(await dec(u?.phoneNumber, u?.phoneNumberIv));
      await prisma.hrMessageRecipient.update({
        where: { id: r.id },
        data: { toAddress: to || "" },
      });
    }
  }

  return res.code(200).send(updated);
};

export const deleteBatch = async (req: FastifyRequest, res: FastifyReply) => {
  const { id } = req.params as { id: string };
  const { batch } = await ownedBatch(req, id);
  // A sent batch is the only proof of who was contacted; deleting it would
  // erase that record.
  if (batch.status !== "draft")
    throw new ValidationError("A sent batch cannot be deleted.");
  await prisma.hrMessageRecipient.deleteMany({ where: { batchId: id } });
  await prisma.hrMessageBatch.delete({ where: { id } });
  return res.code(200).send({ message: "OK" });
};

export const batchDetail = async (req: FastifyRequest, res: FastifyReply) => {
  const { id } = req.params as { id: string };
  const q = req.query as {
    search?: string;
    status?: string;
    page?: string;
  };
  const { batch } = await ownedBatch(req, id);
  const term = (q.search || "").trim();
  const page = Math.max(0, Number(q.page ?? 0) || 0);
  const take = 50;

  const where: Prisma.HrMessageRecipientWhereInput = {
    batchId: id,
    ...(q.status === "sent" || q.status === "failed" || q.status === "pending"
      ? { status: q.status }
      : {}),
    ...(term ? { name: { contains: term, mode: "insensitive" } } : {}),
  };

  const [recipients, matching] = await Promise.all([
    prisma.hrMessageRecipient.findMany({
      where,
      orderBy: [{ status: "asc" }, { name: "asc" }],
      skip: page * take,
      take,
    }),
    prisma.hrMessageRecipient.count({ where }),
  ]);

  // Counts describe the WHOLE batch, not the filtered view, so searching
  // never makes it look like recipients disappeared.
  const [pending, sent, failed] = await Promise.all([
    prisma.hrMessageRecipient.count({
      where: { batchId: id, status: "pending" },
    }),
    prisma.hrMessageRecipient.count({ where: { batchId: id, status: "sent" } }),
    prisma.hrMessageRecipient.count({
      where: { batchId: id, status: "failed" },
    }),
  ]);

  return res.code(200).send({
    batch,
    recipients,
    counts: { pending, sent, failed, total: pending + sent + failed },
    matching,
    page,
    pages: Math.ceil(matching / take),
    maxPerSend: MAX_PER_SEND,
    maxPerBatch: MAX_BATCH_RECIPIENTS,
  });
};

// -- Recipients on a draft -------------------------------------------------
export const addRecipients = async (req: FastifyRequest, res: FastifyReply) => {
  const { id } = req.params as { id: string };
  const b = req.body as { userIds?: string[] };
  const { batch, lineId } = await ownedBatch(req, id);
  // More people may still be added while waves are going out; only a fully
  // finished batch is closed.
  if (batch.status === "sent")
    throw new ValidationError(
      "Every recipient on this batch has been contacted. Create a new batch to message more people.",
    );

  const ids = [...new Set(Array.isArray(b.userIds) ? b.userIds : [])];
  if (!ids.length) throw new ValidationError("Pick at least one employee");

  const existing = await prisma.hrMessageRecipient.count({
    where: { batchId: id },
  });
  if (existing + ids.length > MAX_BATCH_RECIPIENTS)
    throw new ValidationError(
      `A batch can hold at most ${MAX_BATCH_RECIPIENTS} recipients. This one already has ${existing}.`,
    );

  let added = 0;
  for (const uid of ids) {
    // Scoped to the caller's line — a batch can never cross a line boundary.
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
    if (!u) continue;

    const name =
      `${await dec(u.lastName, u.lastNameIv)}, ${await dec(u.firstName, u.firstNameIv)}`
        .replace(/^,\s*|,\s*$/g, "")
        .trim() || "Unnamed";
    const to =
      batch.channel === "email"
        ? await dec(u.email, u.emailIv)
        : phNumberFormat(await dec(u.phoneNumber, u.phoneNumberIv));

    await prisma.hrMessageRecipient.upsert({
      where: { batchId_userId: { batchId: id, userId: uid } },
      update: { toAddress: to || "" },
      create: {
        batchId: id,
        userId: uid,
        name,
        toAddress: to || "",
        renderedBody: "",
        status: "pending",
      },
    });
    added++;
  }

  const total = await prisma.hrMessageRecipient.count({
    where: { batchId: id },
  });
  await prisma.hrMessageBatch.update({ where: { id }, data: { total } });
  return res.code(200).send({ added, total });
};

export const removeRecipient = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const { id, recipientId } = req.params as {
    id: string;
    recipientId: string;
  };
  const { batch } = await ownedBatch(req, id);
  const row = await prisma.hrMessageRecipient.findFirst({
    where: { id: recipientId, batchId: id },
  });
  if (!row) throw new NotFoundError("Recipient not found");
  // A sent or failed row is evidence; only a not-yet-contacted one can be
  // dropped, and that stays true while later waves are still going out.
  if (row.status !== "pending")
    throw new ValidationError("This recipient has already been contacted.");
  await prisma.hrMessageRecipient.delete({ where: { id: recipientId } });
  const total = await prisma.hrMessageRecipient.count({
    where: { batchId: id },
  });
  await prisma.hrMessageBatch.update({ where: { id }, data: { total } });
  return res.code(200).send({ message: "OK", total });
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

/** Recomputes the batch counters from the rows themselves. */
const syncCounts = async (batchId: string) => {
  const [pending, sent, failed] = await Promise.all([
    prisma.hrMessageRecipient.count({ where: { batchId, status: "pending" } }),
    prisma.hrMessageRecipient.count({ where: { batchId, status: "sent" } }),
    prisma.hrMessageRecipient.count({ where: { batchId, status: "failed" } }),
  ]);
  await prisma.hrMessageBatch.update({
    where: { id: batchId },
    data: {
      sentCount: sent,
      failedCount: failed,
      total: pending + sent + failed,
    },
  });
  return { pending, sent, failed };
};

/**
 * POST /hr/message/batch/:id/send   { recipientIds?: string[] }
 *
 * Dispatches ONE WAVE of at most MAX_PER_SEND. Pass recipientIds to send to a
 * specific selection, or omit it to take the next pending people in list
 * order. Call it again for the next wave; the batch closes itself once
 * nothing is left pending.
 */
export const sendBatch = async (req: FastifyRequest, res: FastifyReply) => {
  const { id } = req.params as { id: string };
  const b = (req.body ?? {}) as { recipientIds?: string[] };
  const { batch } = await ownedBatch(req, id);
  if (batch.status === "sent")
    throw new ValidationError("Everyone on this batch has already been contacted.");
  if (!batch.body.trim()) throw new ValidationError("The message is empty");
  if (batch.channel === "email" && !(batch.subject || "").trim())
    throw new ValidationError("Email needs a subject");

  const picked = Array.isArray(b.recipientIds) ? [...new Set(b.recipientIds)] : null;
  if (picked && picked.length > MAX_PER_SEND)
    throw new ValidationError(
      `You can send to at most ${MAX_PER_SEND} people at a time. Send this wave, then select the next ${MAX_PER_SEND}.`,
    );

  // Only ever pending rows: an explicit selection cannot resurrect someone
  // who already received the message.
  const wave = await prisma.hrMessageRecipient.findMany({
    where: {
      batchId: id,
      status: "pending",
      ...(picked ? { id: { in: picked } } : {}),
    },
    orderBy: [{ name: "asc" }],
    take: MAX_PER_SEND,
  });
  if (!wave.length)
    throw new ValidationError(
      picked
        ? "Those recipients have already been contacted."
        : "Add at least one recipient",
    );

  for (const r of wave) {
    const rendered = await renderFor(batch.body, r.userId);
    const out = r.toAddress
      ? await deliver(batch.channel, r.toAddress, batch.subject, rendered)
      : {
          ok: false,
          error:
            batch.channel === "email"
              ? "No email on file"
              : "No mobile number on file",
        };

    // renderedBody is frozen here: a later profile edit cannot rewrite what
    // was sent, and a retry reuses the exact same words and address.
    await prisma.hrMessageRecipient.update({
      where: { id: r.id },
      data: {
        renderedBody: rendered,
        status: out.ok ? "sent" : "failed",
        error: out.ok ? null : (out.error ?? "Send failed"),
        attempts: { increment: 1 },
        sentAt: out.ok ? new Date() : null,
      },
    });
  }

  const counts = await syncCounts(id);
  // "sent" means nothing is waiting. While people remain the batch is
  // "sending": the message is locked but more waves can still go out.
  await prisma.hrMessageBatch.update({
    where: { id },
    data: {
      status: counts.pending === 0 ? "sent" : "sending",
      sentAt: new Date(),
    },
  });

  return res.code(200).send({
    batchId: id,
    dispatched: wave.length,
    ...counts,
    done: counts.pending === 0,
  });
};

/** Retries ONLY the failed rows of a batch, reusing the frozen address/body. */
export const retryBatch = async (req: FastifyRequest, res: FastifyReply) => {
  const { id } = req.params as { id: string };
  const b = (req.body ?? {}) as { recipientIds?: string[] };
  const { batch } = await ownedBatch(req, id);

  const rows = await prisma.hrMessageRecipient.findMany({
    where: {
      batchId: id,
      // Never re-send to someone who already received it.
      status: "failed",
      ...(Array.isArray(b.recipientIds) && b.recipientIds.length
        ? { id: { in: b.recipientIds } }
        : {}),
    },
  });
  if (!rows.length) throw new ValidationError("Nothing to retry");

  let fixed = 0;
  for (const r of rows) {
    const rendered = r.renderedBody || (await renderFor(batch.body, r.userId));
    const out = r.toAddress
      ? await deliver(batch.channel, r.toAddress, batch.subject, rendered)
      : { ok: false, error: "No contact detail on file" };
    await prisma.hrMessageRecipient.update({
      where: { id: r.id },
      data: {
        renderedBody: rendered,
        status: out.ok ? "sent" : "failed",
        error: out.ok ? null : (out.error ?? "Send failed"),
        attempts: { increment: 1 },
        sentAt: out.ok ? new Date() : null,
      },
    });
    if (out.ok) fixed++;
  }

  const counts = await syncCounts(id);
  return res.code(200).send({ retried: rows.length, nowSent: fixed, ...counts });
};
