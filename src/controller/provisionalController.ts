import { FastifyRequest, FastifyReply } from "../barrel/fastify";
import { Prisma, prisma } from "../barrel/prisma";
import { PagingProps } from "../models/route";
import { AppError, NotFoundError, ValidationError } from "../errors/errors";
import { EncryptionService } from "../service/encryption";
import { sendEmail } from "../middleware/handler";
import { createUserNotification } from "../service/notificationEvents";
import ExcelJs from "exceljs";

const frontEnd = process.env.VITE_LOCAL_FRONTEND_URL;
const INVITE_TTL_DAYS = 7;

// A User's email is encrypted when `emailIv` is set; otherwise it's plaintext.
// Returns the readable address (or null if it can't be decrypted).
const decryptUserEmail = async (
  email: string,
  iv: string | null,
): Promise<string | null> => {
  if (!email) return null;
  if (!iv) return email;
  try {
    return await EncryptionService.decrypt(email, iv);
  } catch (e) {
    console.warn("[provisional] failed to decrypt user email", e);
    return null;
  }
};

// Employment categories used for provisional (non-plantilla) staff. A User with
// one of these in `status` is shown only in Provisional > Personnel, not the
// plantilla Employees list. The create form offers exactly these.
export const PROVISIONAL_STATUSES = [
  "Job Order",
  "Contract of Service",
  "Casual",
  "Contractual",
  "Temporary",
];

// POST /provisional/position  { title, empType, termMonths, slots, description, lineId, userId }
// Create a provisional position (carries the employment type + term in months).
export const createProvisionalPosition = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const body = req.body as {
    title?: string;
    empType?: string;
    termMonths?: number | string;
    slots?: number | string;
    description?: string | null;
    lineId?: string;
    userId?: string;
  };

  if (!body.title?.trim() || !body.empType?.trim() || !body.lineId) {
    throw new ValidationError("title, empType and lineId are required");
  }
  const termMonths = Math.max(1, parseInt(String(body.termMonths ?? 3), 10) || 3);
  const slots = Math.max(1, parseInt(String(body.slots ?? 1), 10) || 1);

  try {
    const created = await prisma.provisionalPosition.create({
      data: {
        title: body.title.trim(),
        empType: body.empType.trim(),
        termMonths,
        slots,
        description: body.description?.trim() || null,
        lineId: body.lineId,
      },
    });
    return res.code(200).send({ message: "OK", id: created.id });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
    }
    throw error;
  }
};

// GET /provisional/positions?id=<lineId>&query&lastCursor&limit
// Lists provisional positions with how many slots are filled (= accepted
// invites) vs open.
export const provisionalPositions = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const params = req.query as PagingProps;
  if (!params.id) throw new ValidationError("BAD_REQUEST");

  try {
    const cursor = params.lastCursor ? { id: params.lastCursor } : undefined;
    const limit = params.limit ? parseInt(params.limit, 10) : 20;
    const q = (params.query ?? "").trim();

    const rows = await prisma.provisionalPosition.findMany({
      where: {
        lineId: params.id,
        ...(q
          ? {
              OR: [
                { title: { contains: q, mode: "insensitive" } },
                { empType: { contains: q, mode: "insensitive" } },
              ],
            }
          : {}),
      },
      cursor,
      take: limit,
      skip: cursor ? 1 : 0,
      orderBy: { createdAt: "desc" },
      include: {
        invitations: {
          select: { id: true, concluded: true, concludedReason: true },
        },
      },
    });

    const list = rows.map((p) => {
      const filled = p.invitations.filter(
        (i) => i.concludedReason === "accepted",
      ).length;
      const pending = p.invitations.filter(
        (i) => !i.concluded && i.concludedReason !== "accepted",
      ).length;
      const { invitations, ...rest } = p;
      void invitations;
      return { ...rest, filled, pending, open: Math.max(0, p.slots - filled) };
    });

    const lastCursor = list.length > 0 ? list[list.length - 1].id : null;
    const hasMore = rows.length === limit;
    return res.code(200).send({ list, lastCursor, hasMore });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
    }
    throw error;
  }
};

// POST /provisional/invite  { applicationId, provisionalPositionId, unitId, userId, lineId, message? }
// Pick an applicant for a provisional position + a unit, and email them the
// registration link. Reuses the FillPositionInvitation row (+ the existing
// /position/register pages); the provisional fields drive a temp/contract hire.
export const provisionalInvite = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const body = req.body as {
    applicationId?: string;
    applicationIds?: string[];
    provisionalPositionId?: string;
    unitId?: string;
    userId?: string;
    lineId?: string;
    message?: string | null;
  };

  if (
    !body.provisionalPositionId ||
    !body.unitId ||
    !body.lineId ||
    !body.userId
  ) {
    throw new ValidationError("INVALID REQUIRED FIELDS");
  }
  if (!frontEnd) {
    throw new ValidationError("Server misconfigured: FRONTEND_URL is not set.");
  }

  // Accept one `applicationId` or a bulk `applicationIds[]`, de-duped.
  const appIds = [
    ...new Set(
      [
        ...(Array.isArray(body.applicationIds) ? body.applicationIds : []),
        ...(body.applicationId ? [body.applicationId] : []),
      ].filter((x): x is string => typeof x === "string" && !!x),
    ),
  ];
  if (!appIds.length) throw new ValidationError("No applicants selected");

  const provisionalPositionId = body.provisionalPositionId;
  const unitId = body.unitId;
  const lineId = body.lineId;
  const actorId = body.userId;
  const message = body.message?.trim() || null;

  try {
    const result = await prisma.$transaction(async (tx) => {
      const position = await tx.provisionalPosition.findUnique({
        where: { id: provisionalPositionId },
        include: {
          invitations: { select: { concluded: true, concludedReason: true } },
        },
      });
      if (!position) throw new NotFoundError("Provisional position not found");

      const taken = position.invitations.filter(
        (i) => i.concludedReason === "accepted" || !i.concluded,
      ).length;
      const available = position.slots - taken;
      if (available <= 0) {
        throw new ValidationError("No open slots left for this position.");
      }

      const unit = await tx.department.findUnique({
        where: { id: unitId },
        select: { id: true, name: true, lineId: true },
      });
      if (!unit) throw new NotFoundError("Unit not found");

      const applications = await tx.submittedApplication.findMany({
        where: { id: { in: appIds }, lineId },
        select: {
          id: true,
          firstname: true,
          lastname: true,
          email: true,
          emailIv: true,
          userId: true,
          fillPositionInvitations: {
            select: {
              id: true,
              concluded: true,
              concludedReason: true,
              expiresAt: true,
            },
          },
        },
      });

      // Eligible = not yet registered AND no live (non-concluded, unexpired)
      // invite. Ineligible / not-found ones are skipped, not failed.
      const now = new Date();
      const eligible = applications.filter((a) => {
        if (a.userId) return false;
        const prev = a.fillPositionInvitations;
        const live =
          !!prev && !prev.concluded && (!prev.expiresAt || prev.expiresAt > now);
        return !live;
      });
      const skipped = appIds.length - eligible.length;

      if (eligible.length === 0) {
        throw new ValidationError(
          "None of the selected applicants are eligible (already registered or have a live invite).",
        );
      }
      if (eligible.length > available) {
        throw new ValidationError(
          `Only ${available} slot(s) open for "${position.title}", but ${eligible.length} eligible applicant(s) were selected.`,
        );
      }

      const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 86_400_000);
      const created: {
        linkId: string;
        applicationId: string;
        email: string;
        firstname: string;
      }[] = [];

      for (const application of eligible) {
        // submittedApplicationId is @unique, so detach any stale prior invite.
        const prev = application.fillPositionInvitations;
        if (prev) {
          await tx.fillPositionInvitation.update({
            where: { id: prev.id },
            data: { submittedApplicationId: null },
          });
        }

        const plainEmail = application.emailIv
          ? await EncryptionService.decrypt(
              application.email,
              application.emailIv,
            )
          : application.email;

        const link = await tx.fillPositionInvitation.create({
          data: {
            email: plainEmail,
            message,
            lineId,
            provisionalPositionId: position.id,
            departmentId: unit.id,
            empType: position.empType,
            submittedApplicationId: application.id,
            expiresAt,
          },
        });

        // Move the application out of "Pending" — it's been acted on (selected
        // + invited to a position). applicationStatus: 0 Pending / 1 Viewed /
        // 2 Concluded.
        await tx.submittedApplication.update({
          where: { id: application.id },
          data: { status: 2 },
        });

        await tx.humanResourcesLogs.create({
          data: {
            action: "ADD",
            desc: `PROVISIONAL (${position.empType}) invite -> ${application.firstname} ${application.lastname} (${plainEmail}) for "${position.title}" in ${unit.name ?? "unit"}`,
            lineId,
            userId: actorId,
          },
        });

        created.push({
          linkId: link.id,
          applicationId: application.id,
          email: plainEmail,
          firstname: application.firstname,
        });
      }

      return { created, skipped, position, unit, expiresAt };
    });

    // Each link goes straight to the account step (applicants already submitted
    // a PDS when they applied), pre-loaded with their existing application id.
    for (const c of result.created) {
      sendEmail(
        `Provisional appointment — ${result.position.title}`,
        c.email,
        `Good day ${c.firstname},

You have been selected for a ${result.position.empType} appointment as
"${result.position.title}" (${result.position.termMonths} months) at ${result.unit.name ?? "the LGU"}.

Please complete your registration here:
${frontEnd}/position/register/${c.linkId}/${c.applicationId}

This link expires on ${result.expiresAt.toLocaleString()}.
${message ? `\n${message}\n` : ""}
Best regards,
HR Team`,
        "Gasan LGU HR",
      ).catch((e) => console.warn("[provisionalInvite] email failed", e));
    }

    return res.code(200).send({
      message: "OK",
      invited: result.created.length,
      skipped: result.skipped,
      position: result.position.title,
    });
  } catch (error) {
    if (error instanceof NotFoundError || error instanceof ValidationError) {
      throw error;
    }
    throw new AppError("PROVISIONAL_INVITE_FAILED", 500, "DB_ERROR");
  }
};

// Status applied when a provisional engagement is ended (the account is also
// disabled). Kept out of both the active provisional roster AND the plantilla
// Employees list.
export const PROVISIONAL_ENDED = "Ended";

// Shared select for the personnel list + Excel export so both stay in sync.
const personnelSelect = {
  id: true,
  firstName: true,
  lastName: true,
  middleName: true,
  username: true,
  status: true,
  term: true,
  createdAt: true,
  accountId: true,
  department: { select: { id: true, name: true } },
  // Skills come from the applicant's PDS (ApplicationSkillTags) via the
  // application this provisional user was hired from.
  submittedApplications: {
    select: {
      ApplicationSkillTags: { select: { id: true, tags: true } },
    },
  },
} satisfies Prisma.UserSelect;

// Normalises a target-user payload: accepts `userIds: string[]` (bulk) and/or a
// single `userId`, de-duped. Lets the same endpoint serve one-off + bulk actions.
const collectIds = (body: {
  userId?: string;
  userIds?: string[];
}): string[] => {
  const arr = Array.isArray(body.userIds) ? body.userIds : [];
  const all = [...arr, ...(body.userId ? [body.userId] : [])];
  return [...new Set(all.filter((x) => typeof x === "string" && x))];
};

// Reads the skill `tags` from the query string, tolerating both `tags[]=a`
// (axios array serialization) and a bare `tags=a`, string or array.
const readTags = (query: unknown): string[] => {
  const q = query as Record<string, unknown>;
  const raw = q?.["tags[]"] ?? q?.["tags"];
  if (Array.isArray(raw)) return raw.filter((t): t is string => typeof t === "string");
  if (typeof raw === "string" && raw) return [raw];
  return [];
};

// Builds the Prisma `where` for provisional personnel, applying the optional
// employment-type + contract-term + name + skill filters. Used by both the list
// endpoint and the Excel export so the download honours the same filters.
const buildPersonnelWhere = (params: {
  id: string;
  query?: string;
  status?: string;
  term?: string;
  tags?: string[];
}): Prisma.UserWhereInput => {
  const q = (params.query ?? "").trim();
  const tags = (params.tags ?? []).filter((t) => typeof t === "string" && t);

  // Employment-type filter: only accept known provisional categories, else
  // fall back to "all provisional".
  const status = (params.status ?? "").trim();
  const statusFilter =
    status && PROVISIONAL_STATUSES.includes(status)
      ? status
      : { in: PROVISIONAL_STATUSES };

  // Contract end-date (User.term) filter.
  //   active   → no end date OR ends in the future
  //   expiring → ends within the next 30 days
  //   expired  → end date already passed
  //   none     → open-ended (no end date)
  const termSel = (params.term ?? "").trim();
  const now = new Date();
  const soon = new Date(now.getTime() + 30 * 86_400_000);
  let termCond: Prisma.UserWhereInput | null = null;
  if (termSel === "expiring") termCond = { term: { gte: now, lte: soon } };
  else if (termSel === "expired") termCond = { term: { lt: now } };
  else if (termSel === "active")
    termCond = { OR: [{ term: null }, { term: { gte: now } }] };
  else if (termSel === "none") termCond = { term: null };

  const and: Prisma.UserWhereInput[] = [];
  if (q) {
    and.push({
      OR: [
        { firstName: { contains: q, mode: "insensitive" } },
        { lastName: { contains: q, mode: "insensitive" } },
        { middleName: { contains: q, mode: "insensitive" } },
        { username: { contains: q, mode: "insensitive" } },
      ],
    });
  }
  if (termCond) and.push(termCond);
  // Skill-tag filter: provisional users whose application carries any of the
  // selected skill tags. Mirrors the applicant list's `tags` filter.
  if (tags.length) {
    and.push({
      submittedApplications: {
        is: {
          ApplicationSkillTags: {
            some: { tags: { in: tags } },
          },
        },
      },
    });
  }

  return {
    lineId: params.id,
    status: statusFilter,
    ...(and.length ? { AND: and } : {}),
  };
};

// GET /provisional/personnel?id=<lineId>&query&lastCursor&limit&status&term
// Provisional employees = Users whose status is a provisional category. Shows
// employment type (status) + contract end date (User.term).
export const provisionalPersonnel = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const params = req.query as PagingProps & {
    status?: string;
    term?: string;
  };
  if (!params.id) throw new ValidationError("BAD_REQUEST");

  try {
    const cursor = params.lastCursor ? { id: params.lastCursor } : undefined;
    const limit = params.limit ? parseInt(params.limit, 10) : 20;
    const tags = readTags(req.query);

    const response = await prisma.user.findMany({
      where: buildPersonnelWhere({ ...params, id: params.id, tags }),
      cursor,
      take: limit,
      skip: cursor ? 1 : 0,
      orderBy: { createdAt: "desc" },
      select: personnelSelect,
    });

    const lastCursor =
      response.length > 0 ? response[response.length - 1].id : null;
    const hasMore = response.length === limit;
    return res.code(200).send({ list: response, lastCursor, hasMore });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
    }
    throw error;
  }
};

// GET /provisional/personnel/excel?id=<lineId>&query&status&term
// Downloads the (filtered) provisional personnel list as an .xlsx file. Honours
// the same employment-type / term / search filters as the list endpoint.
export const provisionalPersonnelExcel = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const params = req.query as {
    id?: string;
    query?: string;
    status?: string;
    term?: string;
  };
  if (!params.id) throw new ValidationError("BAD_REQUEST");

  try {
    const tags = readTags(req.query);
    const rows = await prisma.user.findMany({
      where: buildPersonnelWhere({ ...params, id: params.id, tags }),
      orderBy: { createdAt: "desc" },
      select: personnelSelect,
    });

    const now = new Date();
    const workbook = new ExcelJs.Workbook();
    workbook.created = now;
    const worksheet = workbook.addWorksheet("Provisional Personnel", {
      pageSetup: { orientation: "landscape", fitToPage: true },
    });

    worksheet.columns = [
      { header: "No", key: "no", width: 5 },
      { header: "Name", key: "name", width: 30 },
      { header: "Username", key: "username", width: 18 },
      { header: "Employment Type", key: "empType", width: 20 },
      { header: "Unit", key: "unit", width: 26 },
      { header: "Date Hired", key: "hired", width: 16 },
      { header: "Contract End", key: "end", width: 16 },
      { header: "Status", key: "state", width: 14 },
      { header: "Skills", key: "skills", width: 40 },
    ];
    worksheet.getRow(1).eachCell((cell) => {
      cell.font = { bold: true };
      cell.alignment = { horizontal: "center", vertical: "middle" };
      cell.border = {
        top: { style: "thin" },
        left: { style: "thin" },
        bottom: { style: "thin" },
        right: { style: "thin" },
      };
    });

    worksheet.addRows(
      rows.map((u, i) => {
        const name = [u.firstName, u.middleName, u.lastName]
          .filter(Boolean)
          .join(" ");
        const end = u.term ? new Date(u.term) : null;
        const state = !end ? "Open-ended" : end < now ? "Expired" : "Active";
        const skills = (u.submittedApplications?.ApplicationSkillTags ?? [])
          .map((s) => s.tags)
          .filter(Boolean)
          .join(", ");
        return {
          no: i + 1,
          name: name || "N/A",
          username: u.username ?? "—",
          empType: u.status,
          unit: u.department?.name ?? "Unassigned",
          hired: u.createdAt ? new Date(u.createdAt).toLocaleDateString() : "—",
          end: end ? end.toLocaleDateString() : "—",
          state,
          skills: skills || "—",
        };
      }),
    );

    const stamp = now.toISOString().slice(0, 10);
    res.header(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.header(
      "Content-Disposition",
      `attachment; filename=provisional-personnel-${stamp}.xlsx`,
    );
    res.header("Access-Control-Expose-Headers", "Content-Disposition");

    const buffer = await workbook.xlsx.writeBuffer();
    return res.send(buffer);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
    }
    throw error;
  }
};

// POST /provisional/transfer { userId | userIds[], unitId, actorId, lineId }
// Reassigns one or more provisional employees to a unit and notifies each.
export const provisionalTransfer = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const body = req.body as {
    userId?: string;
    userIds?: string[];
    unitId?: string;
    actorId?: string;
    lineId?: string;
  };
  if (!body.unitId || !body.actorId || !body.lineId) {
    throw new ValidationError("INVALID REQUIRED FIELDS");
  }
  const ids = collectIds(body);
  if (!ids.length) throw new ValidationError("No personnel selected");
  const { unitId, actorId, lineId } = body;

  try {
    const result = await prisma.$transaction(async (tx) => {
      const unit = await tx.department.findFirst({
        where: { id: unitId, lineId },
        select: { id: true, name: true },
      });
      if (!unit) throw new NotFoundError("Unit not found");

      const users = await tx.user.findMany({
        where: { id: { in: ids }, lineId, status: { in: PROVISIONAL_STATUSES } },
        select: { id: true, firstName: true, lastName: true, departmentId: true },
      });

      let moved = 0;
      for (const user of users) {
        if (user.departmentId === unit.id) continue; // already there
        await tx.user.update({
          where: { id: user.id },
          data: { departmentId: unit.id },
        });
        await createUserNotification(tx, {
          recipientId: user.id,
          title: "Unit transfer",
          content: `You have been transferred to ${unit.name ?? "a new unit"}.`,
          senderId: null,
        });
        await tx.humanResourcesLogs.create({
          data: {
            action: "UPDATE",
            desc: `PROVISIONAL transfer -> ${user.firstName} ${user.lastName} → ${unit.name ?? "unit"}`,
            lineId,
            userId: actorId,
          },
        });
        moved++;
      }
      return { unit, moved };
    });

    return res.code(200).send({
      message: "OK",
      unit: result.unit.name ?? null,
      count: result.moved,
    });
  } catch (error) {
    if (error instanceof NotFoundError || error instanceof ValidationError) {
      throw error;
    }
    throw new AppError("PROVISIONAL_TRANSFER_FAILED", 500, "DB_ERROR");
  }
};

// POST /provisional/remove { userId | userIds[], actorId, lineId, message? }
// Ends one or more provisional engagements: marks "Ended", clears the unit, sets
// the contract end to now, disables the account, notifies + emails each.
export const provisionalRemove = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const body = req.body as {
    userId?: string;
    userIds?: string[];
    actorId?: string;
    lineId?: string;
    message?: string | null;
  };
  if (!body.actorId || !body.lineId) {
    throw new ValidationError("INVALID REQUIRED FIELDS");
  }
  const ids = collectIds(body);
  if (!ids.length) throw new ValidationError("No personnel selected");
  const { actorId, lineId } = body;
  const note = body.message?.trim() || null;

  try {
    const ended = await prisma.$transaction(async (tx) => {
      const users = await tx.user.findMany({
        where: { id: { in: ids }, lineId, status: { in: PROVISIONAL_STATUSES } },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          accountId: true,
          status: true,
          email: true,
          emailIv: true,
        },
      });

      for (const user of users) {
        await tx.user.update({
          where: { id: user.id },
          data: {
            status: PROVISIONAL_ENDED,
            term: new Date(),
            departmentId: null,
          },
        });
        if (user.accountId) {
          await tx.account.update({
            where: { id: user.accountId },
            data: { active: false, status: 2 },
          });
        }
        await createUserNotification(tx, {
          recipientId: user.id,
          title: "Engagement ended",
          content:
            "Your provisional engagement has ended and your account access has been disabled. Please coordinate with HR for any clarifications.",
          senderId: null,
        });
        await tx.humanResourcesLogs.create({
          data: {
            action: "DELETE",
            desc: `PROVISIONAL ended -> ${user.firstName} ${user.lastName}`,
            lineId,
            userId: actorId,
          },
        });
      }

      return users;
    });

    // Email each (now ex-) employee about the termination.
    let emailed = 0;
    for (const u of ended) {
      const to = await decryptUserEmail(u.email, u.emailIv);
      if (!to) continue;
      emailed++;
      sendEmail(
        "End of Provisional Engagement",
        to,
        `Good day ${u.firstName} ${u.lastName},

This is to formally inform you that your ${u.status} engagement with the Local Government Unit of Gasan has ended effective ${new Date().toLocaleDateString()}.

Your portal access has been deactivated. ${note ? `\n${note}\n` : ""}
For any clarifications regarding your engagement, clearance, or final pay, please coordinate with the HR Office.

Thank you for your service.

Best regards,
Human Resources Office
LGU Gasan`,
        "Gasan LGU HR",
      ).catch((e) => console.warn("[provisionalRemove] email failed", e));
    }

    return res
      .code(200)
      .send({ message: "OK", count: ended.length, emailed });
  } catch (error) {
    if (error instanceof NotFoundError || error instanceof ValidationError) {
      throw error;
    }
    throw new AppError("PROVISIONAL_REMOVE_FAILED", 500, "DB_ERROR");
  }
};

// POST /provisional/renew { userId | userIds[], months, actorId, lineId }
// Extends one or more provisional contracts by `months` (from the current end
// date if still in the future, otherwise from today), notifies + emails each.
export const provisionalRenew = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const body = req.body as {
    userId?: string;
    userIds?: string[];
    months?: number | string;
    actorId?: string;
    lineId?: string;
  };
  if (!body.actorId || !body.lineId) {
    throw new ValidationError("INVALID REQUIRED FIELDS");
  }
  const ids = collectIds(body);
  if (!ids.length) throw new ValidationError("No personnel selected");
  const months = Math.max(1, parseInt(String(body.months ?? 3), 10) || 3);
  const { actorId, lineId } = body;

  try {
    const result = await prisma.$transaction(async (tx) => {
      const users = await tx.user.findMany({
        where: { id: { in: ids }, lineId, status: { in: PROVISIONAL_STATUSES } },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          status: true,
          term: true,
          email: true,
          emailIv: true,
        },
      });

      const now = new Date();
      const out: { user: (typeof users)[number]; newTerm: Date }[] = [];
      for (const user of users) {
        const base =
          user.term && new Date(user.term) > now ? new Date(user.term) : now;
        const newTerm = new Date(base);
        newTerm.setMonth(newTerm.getMonth() + months);

        await tx.user.update({
          where: { id: user.id },
          data: { term: newTerm },
        });
        await createUserNotification(tx, {
          recipientId: user.id,
          title: "Contract renewed",
          content: `Your ${user.status} engagement has been renewed for ${months} more month(s), now ending ${newTerm.toLocaleDateString()}.`,
          senderId: null,
        });
        await tx.humanResourcesLogs.create({
          data: {
            action: "UPDATE",
            desc: `PROVISIONAL renew -> ${user.firstName} ${user.lastName}: +${months} mo (until ${newTerm.toLocaleDateString()})`,
            lineId,
            userId: actorId,
          },
        });
        out.push({ user, newTerm });
      }
      return out;
    });

    let emailed = 0;
    for (const r of result) {
      const to = await decryptUserEmail(r.user.email, r.user.emailIv);
      if (!to) continue;
      emailed++;
      sendEmail(
        "Provisional Contract Renewed",
        to,
        `Good day ${r.user.firstName} ${r.user.lastName},

We are pleased to inform you that your ${r.user.status} engagement with the Local Government Unit of Gasan has been renewed for ${months} more month(s).

Your new contract end date is ${r.newTerm.toLocaleDateString()}.

Best regards,
Human Resources Office
LGU Gasan`,
        "Gasan LGU HR",
      ).catch((e) => console.warn("[provisionalRenew] email failed", e));
    }

    return res.code(200).send({
      message: "OK",
      count: result.length,
      emailed,
      term: result[0]?.newTerm ?? null,
    });
  } catch (error) {
    if (error instanceof NotFoundError || error instanceof ValidationError) {
      throw error;
    }
    throw new AppError("PROVISIONAL_RENEW_FAILED", 500, "DB_ERROR");
  }
};
