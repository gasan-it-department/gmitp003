import { FastifyRequest, FastifyReply } from "../barrel/fastify";
import { prisma, Prisma } from "../barrel/prisma";
import {
  NotFoundError,
  ValidationError,
  UnauthorizedError,
  dbError,
} from "../errors/errors";
import ExcelJS from "exceljs";
import {
  ATTENDANCE_FIELDS,
  DEFAULT_ATTENDANCE_FIELDS,
  attendanceFieldLabel,
  resolveAttendanceUser,
  sanitizeAttendanceFields,
} from "../service/attendanceFields";
import { isSuperAdmin } from "./storageAccessController";
import { EncryptionService } from "../service/encryption";

/** Decrypts a PII column, tolerating rows written before encryption. */
const dec = async (d?: string | null, iv?: string | null) => {
  if (!d) return "";
  if (!iv) return d;
  try {
    return (await EncryptionService.decrypt(d, iv)) ?? "";
  } catch {
    return d;
  }
};

/**
 * QR attendance.
 *
 * HR creates an AttendanceEvent and picks which user properties it captures.
 * In the field, an authorised user scans the employee's ID-card QR — the same
 * code already printed on every issued ID (`User.verifyCode`, encoded as
 * `<portal>/verify-id?code=<code>`) — previews who it resolved to, and then
 * confirms. Confirming freezes the chosen field values into the record, so a
 * later profile edit can never rewrite a sheet that was already signed off.
 */

// ── caller context ─────────────────────────────────────────────────────────
interface Caller {
  userId: string | null;
  lineId: string | null;
}

const callerOf = async (req: FastifyRequest): Promise<Caller> => {
  const accountId = (req.user as { id?: string } | undefined)?.id;
  if (!accountId) return { userId: null, lineId: null };
  const account = await prisma.account.findUnique({
    where: { id: accountId },
    select: { lineId: true, User: { select: { id: true, lineId: true } } },
  });
  return {
    userId: account?.User?.id ?? null,
    lineId: account?.lineId ?? account?.User?.lineId ?? null,
  };
};

/** Resolves the event and refuses to serve it across a line boundary. */
const eventForCaller = async (eventId: string, req: FastifyRequest) => {
  const event = await prisma.attendanceEvent.findUnique({
    where: { id: eventId },
  });
  if (!event) throw new NotFoundError("Attendance sheet not found");
  const { lineId, userId } = await callerOf(req);
  if (event.lineId !== lineId) {
    // A super-admin managing another line still gets through.
    const sup = userId ? await isSuperAdmin(userId) : false;
    if (!sup) throw new UnauthorizedError("Not your attendance sheet");
  }
  return event;
};

/**
 * Pulls the verify code out of whatever the camera read. Accepts the full
 * ID-card URL (`https://portal.gasan.ph/verify-id?code=abc`), a bare
 * `verify-id?code=abc`, or the raw code on its own.
 */
export const extractVerifyCode = (raw: string): string | null => {
  const s = (raw || "").trim();
  if (!s) return null;
  const m = s.match(/[?&]code=([^&\s]+)/i);
  if (m) return decodeURIComponent(m[1]);
  // A bare code: hex uuid-without-dashes as minted by idCardController.
  if (/^[A-Za-z0-9_-]{8,64}$/.test(s)) return s;
  return null;
};

// ── field catalogue ────────────────────────────────────────────────────────
/** The label a sheet falls back to when HR did not define any entries. */
export const DEFAULT_ENTRY = "Attendance";
/** More than a working day's worth of segments is a data-entry mistake. */
const MAX_ENTRIES = 8;

/**
 * Cleans HR's scan-entry list: trimmed, de-duplicated case-insensitively,
 * order preserved, capped. An empty list becomes the single default entry, so
 * a sheet always has at least one thing to scan into.
 */
export const sanitizeEntries = (raw: unknown): string[] => {
  const arr = Array.isArray(raw) ? raw : [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of arr) {
    const label = String(v ?? "").trim().slice(0, 40);
    if (!label) continue;
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(label);
    if (out.length >= MAX_ENTRIES) break;
  }
  return out.length ? out : [DEFAULT_ENTRY];
};

/**
 * Resolves which entry a scan belongs to.
 *
 * Matching is case-insensitive so a scanner sending "am in" lands on "AM In".
 * With one entry defined the argument is optional — a single-scan sheet should
 * not force every caller to name it. With several, an unknown or missing entry
 * is an error rather than a silent write into the first one: putting someone's
 * PM Out under AM In would be worse than refusing.
 */
export const resolveEntry = (entries: string[], wanted?: string | null): string => {
  const list = entries.length ? entries : [DEFAULT_ENTRY];
  const want = (wanted ?? "").trim();
  if (!want) {
    if (list.length === 1) return list[0];
    throw new ValidationError(
      `This sheet records ${list.length} entries (${list.join(", ")}). Say which one this scan is for.`,
    );
  }
  const hit = list.find((e) => e.toLowerCase() === want.toLowerCase());
  if (!hit)
    throw new ValidationError(
      `"${want}" is not an entry on this sheet. Expected one of: ${list.join(", ")}.`,
    );
  return hit;
};

// GET /attendance/fields — drives the web column picker.
export const attendanceFields = async (
  _req: FastifyRequest,
  res: FastifyReply,
) =>
  res.code(200).send({
    fields: ATTENDANCE_FIELDS,
    defaults: DEFAULT_ATTENDANCE_FIELDS,
  });

// ── events (HR/web) ────────────────────────────────────────────────────────
// POST /attendance/event
export const createAttendanceEvent = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const body = req.body as {
    lineId?: string;
    title?: string;
    description?: string;
    location?: string;
    startAt?: string;
    endAt?: string;
    fields?: string[];
  };
  const title = (body.title || "").trim();
  if (!title) throw new ValidationError("Title is required");

  const { userId, lineId: callerLine } = await callerOf(req);
  const lineId = body.lineId || callerLine;
  if (!lineId) throw new ValidationError("lineId is required");

  const fields = sanitizeAttendanceFields(body.fields);
  if (!fields.length)
    throw new ValidationError("Pick at least one column to capture");
  // HR decides the scan entries per sheet: one for a simple headcount, or
  // AM In / AM Out / PM In / PM Out for a full day.
  const entries = sanitizeEntries((body as { entries?: unknown }).entries);

  try {
    const event = await prisma.attendanceEvent.create({
      data: {
        lineId,
        title,
        entries,
        description: body.description?.trim() || null,
        location: body.location?.trim() || null,
        startAt: body.startAt ? new Date(body.startAt) : new Date(),
        endAt: body.endAt ? new Date(body.endAt) : null,
        fields,
        createdById: userId,
      },
    });
    return res.code(201).send(event);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError)
      throw dbError(error);
    throw error;
  }
};

// GET /attendance/events?lineId&page&search&status
export const listAttendanceEvents = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const q = req.query as {
    lineId?: string;
    page?: string;
    search?: string;
    status?: string;
  };
  const { lineId: callerLine } = await callerOf(req);
  const lineId = q.lineId || callerLine;
  if (!lineId) throw new ValidationError("lineId is required");

  const page = Math.max(0, Number(q.page ?? 0) || 0);
  const take = 20;
  const search = (q.search || "").trim();

  const where: Prisma.AttendanceEventWhereInput = {
    lineId,
    ...(q.status && q.status !== "all" ? { status: q.status } : {}),
    ...(search
      ? {
          OR: [
            { title: { contains: search, mode: "insensitive" as const } },
            { location: { contains: search, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };

  try {
    const [rows, total] = await Promise.all([
      prisma.attendanceEvent.findMany({
        where,
        orderBy: { startAt: "desc" },
        skip: page * take,
        take,
        include: {
          _count: { select: { records: true } },
          createdBy: { select: { firstName: true, lastName: true } },
        },
      }),
      prisma.attendanceEvent.count({ where }),
    ]);
    return res.code(200).send({
      events: rows.map((e) => ({
        ...e,
        attendees: e._count.records,
      })),
      total,
      page,
      pages: Math.ceil(total / take),
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError)
      throw dbError(error);
    throw error;
  }
};

// GET /attendance/event/:eventId
export const attendanceEventDetail = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const { eventId } = req.params as { eventId: string };
  const event = await eventForCaller(eventId, req);
  const attendees = await prisma.attendanceRecord.count({ where: { eventId } });
  return res.code(200).send({
    ...event,
    attendees,
    columns: event.fields.map((k) => ({ key: k, label: attendanceFieldLabel(k) })),
  });
};

// PATCH /attendance/event/:eventId
export const updateAttendanceEvent = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const { eventId } = req.params as { eventId: string };
  await eventForCaller(eventId, req);
  const body = req.body as {
    title?: string;
    description?: string;
    location?: string;
    startAt?: string;
    endAt?: string | null;
    status?: string;
    fields?: string[];
  };

  const data: Prisma.AttendanceEventUpdateInput = {};
  if (body.title !== undefined) {
    const t = body.title.trim();
    if (!t) throw new ValidationError("Title is required");
    data.title = t;
  }
  if (body.description !== undefined)
    data.description = body.description?.trim() || null;
  if (body.location !== undefined) data.location = body.location?.trim() || null;
  if (body.startAt !== undefined) data.startAt = new Date(body.startAt);
  if (body.endAt !== undefined)
    data.endAt = body.endAt ? new Date(body.endAt) : null;
  if (body.status !== undefined) {
    if (!["open", "closed"].includes(body.status))
      throw new ValidationError("status must be 'open' or 'closed'");
    data.status = body.status;
  }
  if (body.fields !== undefined) {
    const f = sanitizeAttendanceFields(body.fields);
    if (!f.length) throw new ValidationError("Pick at least one column");
    data.fields = f;
  }

  try {
    const event = await prisma.attendanceEvent.update({
      where: { id: eventId },
      data,
    });
    return res.code(200).send(event);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError)
      throw dbError(error);
    throw error;
  }
};

// DELETE /attendance/event/:eventId
export const deleteAttendanceEvent = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const { eventId } = req.params as { eventId: string };
  await eventForCaller(eventId, req);
  try {
    await prisma.attendanceEvent.delete({ where: { id: eventId } });
    return res.code(200).send({ message: "OK" });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError)
      throw dbError(error);
    throw error;
  }
};

// ── records ────────────────────────────────────────────────────────────────
const snapshotOf = (r: { snapshot: Prisma.JsonValue }): Record<string, string> =>
  r.snapshot && typeof r.snapshot === "object" && !Array.isArray(r.snapshot)
    ? (r.snapshot as Record<string, string>)
    : {};

/**
 * Fills gaps for columns HR added AFTER a scan happened: the old snapshot has
 * no value for the new key, so we resolve those users live (once each) rather
 * than printing blanks. Values already frozen are never overwritten.
 */
const withBackfill = async <
  T extends { userId: string; snapshot: Prisma.JsonValue },
>(
  records: T[],
  fields: string[],
): Promise<Array<T & { values: Record<string, string> }>> => {
  const missing = new Map<string, string[]>();
  for (const r of records) {
    const snap = snapshotOf(r);
    const gaps = fields.filter((f) => snap[f] === undefined);
    if (gaps.length) missing.set(r.userId, gaps);
  }
  const resolved = new Map<string, Record<string, string>>();
  for (const [userId, gaps] of missing) {
    const u = await resolveAttendanceUser(userId, gaps);
    if (u) resolved.set(userId, u.values);
  }
  return records.map((r) => {
    const snap = snapshotOf(r);
    const extra = resolved.get(r.userId) ?? {};
    const values: Record<string, string> = {};
    for (const f of fields) values[f] = snap[f] ?? extra[f] ?? "";
    return { ...r, values };
  });
};

export interface RecordFilters {
  dateFrom?: string;
  dateTo?: string;
  departmentId?: string;
  search?: string;
  /** One of the sheet's scan entries, e.g. "AM Out". */
  entry?: string;
}

/**
 * Turns the query string into a Prisma filter.
 *
 * Date and office are real SQL filters. Office keys off the employee's CURRENT
 * department rather than the frozen snapshot, because `office` is only in the
 * snapshot if HR happened to pick that column — filtering must work either way.
 */
const recordWhere = (
  eventId: string,
  f: RecordFilters,
): Prisma.AttendanceRecordWhereInput => {
  const where: Prisma.AttendanceRecordWhereInput = { eventId };
  if (f.dateFrom || f.dateTo) {
    const gte = f.dateFrom ? new Date(f.dateFrom) : undefined;
    // A bare YYYY-MM-DD means the WHOLE day, so push the end to 23:59:59.999.
    let lte: Date | undefined;
    if (f.dateTo) {
      lte = new Date(f.dateTo);
      if (/^\d{4}-\d{2}-\d{2}$/.test(f.dateTo)) lte.setHours(23, 59, 59, 999);
    }
    where.timestamp = {
      ...(gte && !Number.isNaN(gte.getTime()) ? { gte } : {}),
      ...(lte && !Number.isNaN(lte.getTime()) ? { lte } : {}),
    };
  }
  if (f.departmentId) where.user = { departmentId: f.departmentId };
  // Narrow to one scan entry, e.g. show only who has tapped "AM Out".
  if (f.entry) where.entry = f.entry;
  return where;
};

// GET /attendance/event/:eventId/records?page&search&dateFrom&dateTo&departmentId
export const attendanceRecords = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const { eventId } = req.params as { eventId: string };
  const q = (req.query ?? {}) as RecordFilters & { page?: string };
  const event = await eventForCaller(eventId, req);

  const page = Math.max(0, Number(q.page ?? 0) || 0);
  const take = 25;

  try {
    // Text search has to run AFTER the snapshot is materialised (the values
    // live in JSON, and the underlying User columns are encrypted at rest, so
    // there's nothing meaningful to LIKE against in SQL). An attendance sheet
    // is a bounded list, so we filter the sheet in memory and paginate the
    // result — that way search spans the whole sheet, not just one page.
    const rows = await prisma.attendanceRecord.findMany({
      where: recordWhere(eventId, q),
      orderBy: { timestamp: "desc" },
      include: {
        user: {
          select: {
            id: true,
            profilePicture: true,
            department: { select: { id: true, name: true } },
          },
        },
        scannedBy: {
          select: {
            id: true,
            firstName: true,
            firstNameIv: true,
            lastName: true,
            lastNameIv: true,
          },
        },
      },
    });

    const filled = await withBackfill(rows, event.fields);
    const search = (q.search || "").trim().toLowerCase();
    const visible = search
      ? filled.filter((r) =>
          Object.values(r.values).some((v) =>
            (v || "").toLowerCase().includes(search),
          ),
        )
      : filled;

    const total = visible.length;
    const pageRows = visible.slice(page * take, page * take + take);

    // Offices actually present on this sheet, so the dropdown can't offer a
    // choice that yields nothing. Built from the UNFILTERED sheet so the
    // options don't vanish as soon as you pick one.
    const allForFacet = q.departmentId
      ? await prisma.attendanceRecord.findMany({
          where: recordWhere(eventId, { ...q, departmentId: undefined }),
          select: {
            user: { select: { department: { select: { id: true, name: true } } } },
          },
        })
      : rows;
    const facet = new Map<string, { id: string; name: string; count: number }>();
    for (const r of allForFacet) {
      const d = r.user?.department;
      if (!d?.id) continue;
      const hit = facet.get(d.id);
      if (hit) hit.count += 1;
      else facet.set(d.id, { id: d.id, name: d.name ?? "Unnamed", count: 1 });
    }

    /**
     * The ATTENDEE's name, always — independent of which columns HR chose to
     * capture. A sheet that captures only, say, office and position has no
     * name anywhere on the row, which left "scanned by <operator>" as the only
     * human name in sight and made every row look like it belonged to the
     * operator. The row must state who it is FOR.
     */
    const attendeeNames = new Map<string, string>();
    {
      const cache = new Map<string, string>();
      for (const r of pageRows) {
        let name = cache.get(r.userId);
        if (name === undefined) {
          const snap = snapshotOf(r);
          // Prefer the frozen snapshot: it is what was true at scan time.
          name =
            (snap.fullName || "").trim() ||
            (await resolveAttendanceUser(r.userId, ["fullName"]))?.fullName ||
            "";
          cache.set(r.userId, name);
        }
        if (name) attendeeNames.set(r.id, name);
      }
    }

    // One decrypt per distinct operator on this page, not per row.
    const scannedByNames = new Map<string, string>();
    {
      const cache = new Map<string, string>();
      for (const r of pageRows) {
        const sb = r.scannedBy;
        if (!sb) continue;
        let name = cache.get(sb.id);
        if (name === undefined) {
          const f = await dec(sb.firstName, sb.firstNameIv);
          const l = await dec(sb.lastName, sb.lastNameIv);
          name = `${f} ${l}`.trim();
          cache.set(sb.id, name);
        }
        if (name) scannedByNames.set(r.id, name);
      }
    }

    return res.code(200).send({
      entries: event.entries,
      columns: event.fields.map((k) => ({
        key: k,
        label: attendanceFieldLabel(k),
      })),
      departments: [...facet.values()].sort((a, b) =>
        a.name.localeCompare(b.name),
      ),
      records: pageRows.map((r) => ({
        id: r.id,
        userId: r.userId,
        /** Who this row is FOR. Always present, whatever columns HR picked. */
        attendee: attendeeNames.get(r.id) ?? "Unnamed employee",
        entry: r.entry,
        timestamp: r.timestamp,
        remarks: r.remarks,
        profilePicture: r.user?.profilePicture ?? null,
        office: r.user?.department?.name ?? null,
        // Decrypted. Concatenating the raw columns emitted ciphertext for
        // anyone whose name is encrypted at rest, and — worse — a readable
        // OTHER PERSON's name for anyone whose is not, right next to the
        // attendee's own row.
        scannedBy: scannedByNames.get(r.id) ?? null,
        scannedById: r.scannedBy?.id ?? null,
        values: r.values,
      })),
      total,
      page,
      pages: Math.ceil(total / take),
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError)
      throw dbError(error);
    throw error;
  }
};

// DELETE /attendance/record/:recordId — undo a mistaken scan
export const deleteAttendanceRecord = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const { recordId } = req.params as { recordId: string };
  const record = await prisma.attendanceRecord.findUnique({
    where: { id: recordId },
    select: { eventId: true },
  });
  if (!record) throw new NotFoundError("Attendance record not found");
  await eventForCaller(record.eventId, req);
  try {
    await prisma.attendanceRecord.delete({ where: { id: recordId } });
    return res.code(200).send({ message: "OK" });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError)
      throw dbError(error);
    throw error;
  }
};

// ── mobile: resolve → confirm ──────────────────────────────────────────────
// GET /attendance/mobile/events — open sheets the scanner may post to
export const mobileAttendanceEvents = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const { lineId } = await callerOf(req);
  if (!lineId) throw new UnauthorizedError("No line for this account");
  const rows = await prisma.attendanceEvent.findMany({
    where: { lineId, status: "open" },
    orderBy: { startAt: "desc" },
    take: 50,
    include: { _count: { select: { records: true } } },
  });
  return res.code(200).send({
    events: rows.map((e) => ({
      id: e.id,
      title: e.title,
      location: e.location,
      startAt: e.startAt,
      endAt: e.endAt,
      attendees: e._count.records,
      fields: e.fields,
      // The phone needs these to offer a segment picker; without them a
      // multi-entry sheet would refuse every scan it sends.
      entries: e.entries,
    })),
  });
};

/**
 * POST /attendance/resolve  { eventId, code }
 * Read-only. Turns a scanned QR into the employee preview the scanner shows
 * before confirming. Writes nothing — confirming is a separate, explicit call.
 */
export const resolveAttendanceScan = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const body = req.body as { eventId?: string; code?: string };
  if (!body.eventId) throw new ValidationError("eventId is required");
  const code = extractVerifyCode(body.code || "");
  if (!code)
    throw new ValidationError("That QR isn't a Gasan LGU employee ID.");

  const event = await eventForCaller(body.eventId, req);
  if (event.status !== "open")
    throw new ValidationError("This attendance sheet is closed.");

  const target = await prisma.user.findUnique({
    where: { verifyCode: code },
    select: { id: true, lineId: true, active: true, archivedAt: true },
  });
  if (!target) throw new NotFoundError("No employee matches that QR code.");
  // Never let a scan cross a line boundary.
  if (target.lineId !== event.lineId)
    throw new ValidationError(
      "That employee belongs to a different office and can't be added to this sheet.",
    );

  const resolved = await resolveAttendanceUser(target.id, event.fields);
  if (!resolved) throw new NotFoundError("Employee record unavailable.");

  const entry = resolveEntry(event.entries, (body as { entry?: string }).entry);
  const existing = await prisma.attendanceRecord.findUnique({
    where: {
      eventId_userId_entry: { eventId: event.id, userId: target.id, entry },
    },
    select: { id: true, timestamp: true },
  });

  return res.code(200).send({
    event: { id: event.id, title: event.title },
    user: {
      id: resolved.id,
      fullName: resolved.fullName,
      profilePicture: resolved.profilePicture,
      inactive: target.active === 0 || !!target.archivedAt,
    },
    columns: event.fields.map((k) => ({
      key: k,
      label: attendanceFieldLabel(k),
      value: resolved.values[k] ?? "",
    })),
    entry,
    entries: event.entries,
    alreadyRecorded: !!existing,
    recordedAt: existing?.timestamp ?? null,
  });
};

/**
 * The shared write path for both the online confirm and the offline upload.
 * Identifies the employee by `userId` OR by a scanned `code`, and honours a
 * client-supplied `scannedAt` so a queued scan lands on the sheet at the time
 * it happened at the door, not the time the phone got signal back.
 */
const recordAttendance = async (
  event: {
    id: string;
    lineId: string;
    status: string;
    fields: string[];
    entries: string[];
  },
  opts: {
    userId?: string;
    code?: string;
    entry?: string | null;
    scannedById: string | null;
    scannedAt?: string | number | null;
    remarks?: string | null;
  },
) => {
  if (event.status !== "open")
    throw new ValidationError("This attendance sheet is closed.");

  let targetId = opts.userId;
  if (!targetId) {
    const code = extractVerifyCode(opts.code || "");
    if (!code) throw new ValidationError("That QR isn't a Gasan LGU employee ID.");
    const byCode = await prisma.user.findUnique({
      where: { verifyCode: code },
      select: { id: true },
    });
    if (!byCode) throw new NotFoundError("No employee matches that QR code.");
    targetId = byCode.id;
  }

  const target = await prisma.user.findUnique({
    where: { id: targetId },
    select: { id: true, lineId: true },
  });
  if (!target) throw new NotFoundError("Employee not found");
  if (target.lineId !== event.lineId)
    throw new ValidationError(
      "That employee belongs to a different office and can't be added to this sheet.",
    );

  const resolved = await resolveAttendanceUser(target.id, event.fields);
  if (!resolved) throw new NotFoundError("Employee record unavailable.");

  // Trust the device clock only when it's sane: never in the future, never
  // before the sheet's own start. Otherwise fall back to server time.
  let stamp: Date | undefined;
  if (opts.scannedAt) {
    const d = new Date(opts.scannedAt);
    if (!Number.isNaN(d.getTime()) && d.getTime() <= Date.now() + 60_000)
      stamp = d;
  }

  // Which segment of the day this scan belongs to. A person may appear once
  // per entry, so AM Out after AM In is a new row, not a duplicate.
  const entry = resolveEntry(event.entries, opts.entry);

  const existing = await prisma.attendanceRecord.findUnique({
    where: {
      eventId_userId_entry: { eventId: event.id, userId: target.id, entry },
    },
    select: { id: true, userId: true, timestamp: true },
  });
  if (existing)
    return {
      record: existing,
      fullName: resolved.fullName,
      entry,
      duplicate: true,
    };

  const record = await prisma.attendanceRecord.create({
    data: {
      eventId: event.id,
      userId: target.id,
      entry,
      scannedById: opts.scannedById,
      remarks: opts.remarks?.trim() || null,
      snapshot: resolved.values as Prisma.InputJsonObject,
      ...(stamp ? { timestamp: stamp } : {}),
    },
    select: { id: true, userId: true, timestamp: true },
  });
  return { record, fullName: resolved.fullName, entry, duplicate: false };
};

/**
 * POST /attendance/confirm  { eventId, userId|code, scannedAt?, remarks? }
 * Idempotent: a second confirm for the same person returns the existing
 * record instead of erroring, so a double-tap or a retry after a flaky
 * connection can't create duplicates or scare the operator.
 */
export const confirmAttendance = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const body = req.body as {
    eventId?: string;
    userId?: string;
    code?: string;
    entry?: string;
    scannedAt?: string;
    remarks?: string;
  };
  if (!body.eventId) throw new ValidationError("eventId is required");
  if (!body.userId && !body.code)
    throw new ValidationError("userId or code is required");

  const event = await eventForCaller(body.eventId, req);
  const { userId: scannedById } = await callerOf(req);

  try {
    const out = await recordAttendance(event, {
      userId: body.userId,
      code: body.code,
      entry: body.entry,
      scannedById,
      scannedAt: body.scannedAt,
      remarks: body.remarks,
    });
    // Counted for the entry that was just scanned, not the whole sheet — on a
    // four-entry sheet a single total would tell HR nothing about whether
    // everyone has tapped out.
    const [attendees, entryCount] = await Promise.all([
      prisma.attendanceRecord.count({ where: { eventId: event.id } }),
      prisma.attendanceRecord.count({
        where: { eventId: event.id, entry: out.entry },
      }),
    ]);
    return res.code(200).send({
      record: out.record,
      fullName: out.fullName,
      entry: out.entry,
      duplicate: out.duplicate,
      attendees,
      entryCount,
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError)
      throw dbError(error);
    throw error;
  }
};

/**
 * POST /attendance/confirm/bulk  { rows: [{ clientOpId, eventId, code|userId,
 *                                           scannedAt, remarks? }] }
 * Flush path for scans taken with no signal. Each row is independent: one bad
 * row (wrong line, closed sheet, unknown QR) is reported against its own
 * clientOpId and never sinks the rest of the batch. Replays are safe — a row
 * already on the sheet comes back as `duplicate`, not an error, so the phone
 * can clear it from the queue.
 */
export const confirmAttendanceBulk = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const body = req.body as {
    rows?: Array<{
      clientOpId?: string;
      eventId?: string;
      userId?: string;
      code?: string;
      scannedAt?: string | number;
      remarks?: string;
    }>;
  };
  const rows = Array.isArray(body.rows) ? body.rows : [];
  if (!rows.length) throw new ValidationError("rows is required");
  if (rows.length > 500)
    throw new ValidationError("Too many rows in one upload (max 500)");

  const { userId: scannedById } = await callerOf(req);

  // Resolve each distinct sheet once, not once per scan.
  const eventCache = new Map<string, any>();
  const eventErr = new Map<string, string>();

  const results: Array<{
    clientOpId: string;
    status: "ok" | "duplicate" | "error";
    message?: string;
    fullName?: string;
  }> = [];

  for (const row of rows) {
    const clientOpId = row.clientOpId || "";
    if (!clientOpId) continue;
    try {
      if (!row.eventId) throw new ValidationError("eventId is required");

      if (!eventCache.has(row.eventId) && !eventErr.has(row.eventId)) {
        try {
          eventCache.set(row.eventId, await eventForCaller(row.eventId, req));
        } catch (e: any) {
          eventErr.set(row.eventId, e?.message ?? "Sheet unavailable");
        }
      }
      if (eventErr.has(row.eventId))
        throw new ValidationError(eventErr.get(row.eventId) as string);

      const out = await recordAttendance(eventCache.get(row.eventId), {
        entry: (row as { entry?: string }).entry,
        userId: row.userId,
        code: row.code,
        scannedById,
        scannedAt: row.scannedAt,
        remarks: row.remarks,
      });
      results.push({
        clientOpId,
        status: out.duplicate ? "duplicate" : "ok",
        fullName: out.fullName,
      });
    } catch (e: any) {
      results.push({
        clientOpId,
        status: "error",
        message: e?.message ?? "Could not record this scan",
      });
    }
  }

  return res.code(200).send({ results });
};

// ── export ─────────────────────────────────────────────────────────────────
// GET /attendance/event/:eventId/export — Excel with exactly HR's columns
export const exportAttendance = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const { eventId } = req.params as { eventId: string };
  const q = (req.query ?? {}) as RecordFilters;
  const event = await eventForCaller(eventId, req);

  try {
    // Same filters as the on-screen table — you export what you're looking at.
    const rows = await prisma.attendanceRecord.findMany({
      where: recordWhere(eventId, q),
      orderBy: { timestamp: "asc" },
    });
    const all = await withBackfill(rows, event.fields);
    const term = (q.search || "").trim().toLowerCase();
    const filled = term
      ? all.filter((r) =>
          Object.values(r.values).some((v) =>
            (v || "").toLowerCase().includes(term),
          ),
        )
      : all;

    const workbook = new ExcelJS.Workbook();
    workbook.creator = "Municipality of Gasan";
    const ws = workbook.addWorksheet("Attendance");

    // A sheet with several scan entries needs the entry named per row, or the
    // export is just an unexplained list of repeated names.
    const multiEntry = (event.entries?.length ?? 0) > 1;
    const columns = [
      { key: "no", label: "No." },
      ...event.fields.map((k) => ({ key: k, label: attendanceFieldLabel(k) })),
      ...(multiEntry ? [{ key: "__entry", label: "Entry" }] : []),
      { key: "__time", label: "Time recorded" },
    ];
    const lastCol = columns.length;

    // Title band
    ws.mergeCells(1, 1, 1, lastCol);
    const t = ws.getCell(1, 1);
    t.value = event.title;
    t.font = { bold: true, size: 14 };
    t.alignment = { horizontal: "center" };

    ws.mergeCells(2, 1, 2, lastCol);
    const sub = ws.getCell(2, 1);
    const when = new Date(event.startAt).toLocaleString("en-PH");
    sub.value = [event.location, when].filter(Boolean).join(" — ");
    sub.alignment = { horizontal: "center" };
    sub.font = { size: 10, color: { argb: "FF666666" } };

    ws.addRow([]);

    const header = ws.addRow(columns.map((c) => c.label));
    header.font = { bold: true };
    header.alignment = { vertical: "middle", horizontal: "center" };
    header.eachCell((cell) => {
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFEEF3F7" },
      };
      cell.border = {
        top: { style: "thin" },
        left: { style: "thin" },
        bottom: { style: "thin" },
        right: { style: "thin" },
      };
    });

    filled.forEach((r, i) => {
      const row = ws.addRow([
        i + 1,
        ...event.fields.map((f) => r.values[f] || ""),
        ...(multiEntry ? [r.entry] : []),
        new Date(r.timestamp).toLocaleString("en-PH"),
      ]);
      row.getCell(1).alignment = { horizontal: "center" };
      row.eachCell((cell) => {
        cell.border = {
          top: { style: "thin" },
          left: { style: "thin" },
          bottom: { style: "thin" },
          right: { style: "thin" },
        };
      });
    });

    const totalRow = ws.addRow([
      "",
      `TOTAL ATTENDEES: ${filled.length}`,
      ...Array(Math.max(0, lastCol - 2)).fill(""),
    ]);
    totalRow.font = { bold: true };

    // Width from the widest cell in each column, clamped to something sane.
    columns.forEach((c, idx) => {
      const col = ws.getColumn(idx + 1);
      let max = c.label.length;
      col.eachCell?.({ includeEmpty: false }, (cell) => {
        const len = String(cell.value ?? "").length;
        if (len > max) max = len;
      });
      col.width = Math.min(42, Math.max(8, max + 2));
    });

    const safe =
      event.title.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, "") ||
      "Attendance";
    res.header(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.header(
      "Content-Disposition",
      `attachment; filename="Attendance_${safe}.xlsx"`,
    );
    res.header("Access-Control-Expose-Headers", "Content-Disposition");

    const buffer = await workbook.xlsx.writeBuffer();
    return res.send(buffer);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError)
      throw dbError(error);
    throw error;
  }
};

// ── mobile access grants (mirrors Pharmacy/Document mobile access) ─────────
const grantName = (u: {
  firstName: string;
  lastName: string;
  middleName?: string | null;
}) => `${u.lastName}, ${u.firstName}${u.middleName ? " " + u.middleName : ""}`;

// GET /attendance/mobile-access?lineId
export const listAttendanceAccess = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const q = req.query as { lineId?: string };
  const { lineId: callerLine } = await callerOf(req);
  const lineId = q.lineId || callerLine;
  if (!lineId) throw new ValidationError("lineId is required");
  const rows = await prisma.attendanceMobileAccess.findMany({
    where: { lineId },
    orderBy: { timestamp: "desc" },
    include: {
      user: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          middleName: true,
          username: true,
          department: { select: { name: true } },
        },
      },
      grantedBy: { select: { firstName: true, lastName: true } },
    },
  });
  return res.code(200).send({
    users: rows.map((r) => ({
      id: r.id,
      userId: r.userId,
      name: grantName(r.user),
      office: r.user.department?.name ?? null,
      grantedBy: r.grantedBy
        ? `${r.grantedBy.firstName} ${r.grantedBy.lastName}`.trim()
        : null,
      timestamp: r.timestamp,
    })),
  });
};

// POST /attendance/mobile-access  { lineId, userId }
export const grantAttendanceAccess = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const body = req.body as { lineId?: string; userId?: string };
  const { userId: actorId, lineId: callerLine } = await callerOf(req);
  const lineId = body.lineId || callerLine;
  if (!lineId) throw new ValidationError("lineId is required");
  if (!body.userId) throw new ValidationError("userId is required");

  const target = await prisma.user.findUnique({
    where: { id: body.userId },
    select: { id: true, lineId: true },
  });
  if (!target) throw new NotFoundError("User not found");
  if (target.lineId !== lineId)
    throw new ValidationError("That user belongs to a different office.");

  try {
    const row = await prisma.attendanceMobileAccess.upsert({
      where: { lineId_userId: { lineId, userId: body.userId } },
      update: { grantedById: actorId },
      create: { lineId, userId: body.userId, grantedById: actorId },
    });
    return res.code(201).send(row);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError)
      throw dbError(error);
    throw error;
  }
};

// DELETE /attendance/mobile-access/:accessId
export const revokeAttendanceAccess = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const { accessId } = req.params as { accessId: string };
  const row = await prisma.attendanceMobileAccess.findUnique({
    where: { id: accessId },
    select: { lineId: true },
  });
  if (!row) throw new NotFoundError("Grant not found");
  const { lineId, userId } = await callerOf(req);
  if (row.lineId !== lineId) {
    const sup = userId ? await isSuperAdmin(userId) : false;
    if (!sup) throw new UnauthorizedError("Not your office");
  }
  try {
    await prisma.attendanceMobileAccess.delete({ where: { id: accessId } });
    return res.code(200).send({ message: "OK" });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError)
      throw dbError(error);
    throw error;
  }
};
