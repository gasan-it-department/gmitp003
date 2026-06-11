import { FastifyReply, FastifyRequest } from "../barrel/fastify";
import { prisma, Prisma } from "../barrel/prisma";
import { AppError, NotFoundError, ValidationError } from "../errors/errors";
import { PagingProps } from "../models/route";

/**
 * PESO (Public Employment Service Office) job postings.
 *
 * PESO posts external / private-sector vacancies that are OUTSIDE the LGU HR
 * jurisdiction. They live in the SAME `JobPost` table as HR posts (discriminated
 * by `postType`), so the public job board surfaces both in one list on the same
 * line. External posts carry free-text fields instead of an internal Position.
 *
 * `applyMode`:
 *   - "INTERNAL" → applicants apply in-app (reuses the existing application
 *     pipeline + JobPostRequirements, added via the /application/* endpoints).
 *   - "EXTERNAL" → referral listing only; applicants use `applyUrl` / `contactInfo`.
 */

type PesoJobBody = {
  id?: string;
  userId: string;
  lineId: string;
  jobTitle?: string;
  employerName?: string;
  location?: string;
  employmentType?: string;
  salaryText?: string;
  desc?: string;
  deadline?: string | null;
  slot?: number;
  showApplicationCount?: boolean;
  hideSG?: boolean;
  applyMode?: string;
  applyUrl?: string;
  contactInfo?: string;
  status?: number;
};

const normalizeApplyMode = (v?: string) =>
  v === "EXTERNAL" ? "EXTERNAL" : "INTERNAL";

/** Create a PESO external job post (starts as a draft, status = 0). */
export const createPesoJob = async (req: FastifyRequest, res: FastifyReply) => {
  const body = req.body as PesoJobBody;

  if (!body.lineId || !body.userId)
    throw new ValidationError("INVALID REQUIRED ID");
  if (!body.jobTitle || !body.jobTitle.trim())
    throw new ValidationError("Job title is required");

  const applyMode = normalizeApplyMode(body.applyMode);
  if (applyMode === "EXTERNAL" && !body.applyUrl && !body.contactInfo) {
    throw new ValidationError(
      "External jobs need an application link or contact info.",
    );
  }

  try {
    const id = await prisma.$transaction(async (tx) => {
      const post = await tx.jobPost.create({
        data: {
          postType: "PESO",
          applyMode,
          positionId: null,
          salaryGradeId: null,
          unitPositionId: null,
          lineId: body.lineId,
          status: 0,
          slot: body.slot && body.slot > 0 ? body.slot : 1,
          showApplicationCount: body.showApplicationCount ?? false,
          hideSG: body.hideSG ?? false,
          location: body.location?.trim() || "N/A",
          desc: body.desc?.trim() || "N/A",
          jobTitle: body.jobTitle!.trim(),
          employerName: body.employerName?.trim() || null,
          employmentType: body.employmentType?.trim() || null,
          salaryText: body.salaryText?.trim() || null,
          applyUrl: applyMode === "EXTERNAL" ? body.applyUrl?.trim() || null : null,
          contactInfo:
            applyMode === "EXTERNAL" ? body.contactInfo?.trim() || null : null,
          deadline: body.deadline ? new Date(body.deadline) : null,
        },
        select: { id: true },
      });

      await tx.humanResourcesLogs.create({
        data: {
          action: "ADDED",
          userId: body.userId,
          lineId: body.lineId,
          desc:
            `PESO job created: ${body.jobTitle?.trim()} | ` +
            `Employer: ${body.employerName?.trim() || "N/A"} | ` +
            `Apply: ${applyMode}`,
        },
      });

      return post.id;
    });

    if (!id) throw new AppError("Something went wrong", 500, "DB_ERROR");
    return res.code(200).send({ message: "OK", id });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DATABASE_CONNECTION_FAILED", 500, "DB_ERROR");
    }
    throw error;
  }
};

/**
 * Update a PESO job post. Caller sends only what changed (undefined = leave
 * alone; send `deadline: null` to clear it). Status transitions follow the same
 * whitelist as HR posts: 0 draft → 1 published → 3 paused.
 */
export const updatePesoJob = async (req: FastifyRequest, res: FastifyReply) => {
  const body = req.body as PesoJobBody;

  if (!body.id) throw new ValidationError("INVALID REQUIRED ID");

  try {
    const result = await prisma.$transaction(async (tx) => {
      const post = await tx.jobPost.findUnique({
        where: { id: body.id },
        select: { id: true, status: true, postType: true, jobTitle: true },
      });
      if (!post) throw new NotFoundError("JOB POST NOT FOUND");
      if (post.postType !== "PESO")
        throw new ValidationError("Not a PESO job post.");

      if (body.status !== undefined && body.status !== post.status) {
        const allowed: Record<number, number[]> = {
          0: [1],
          1: [3],
          3: [1, 0],
        };
        const ok = allowed[post.status]?.includes(body.status) ?? false;
        if (!ok) {
          throw new ValidationError(
            `Cannot move status from ${post.status} to ${body.status}.`,
          );
        }
      }

      const data: Prisma.JobPostUpdateInput = {};
      if (body.jobTitle !== undefined) data.jobTitle = body.jobTitle.trim();
      if (body.employerName !== undefined)
        data.employerName = body.employerName?.trim() || null;
      if (body.location !== undefined)
        data.location = body.location?.trim() || "N/A";
      if (body.employmentType !== undefined)
        data.employmentType = body.employmentType?.trim() || null;
      if (body.salaryText !== undefined)
        data.salaryText = body.salaryText?.trim() || null;
      if (body.desc !== undefined) data.desc = body.desc?.trim() || "N/A";
      if (body.slot !== undefined && body.slot > 0) data.slot = body.slot;
      if (body.showApplicationCount !== undefined)
        data.showApplicationCount = body.showApplicationCount;
      if (body.applyMode !== undefined) {
        const mode = normalizeApplyMode(body.applyMode);
        data.applyMode = mode;
        if (mode === "INTERNAL") {
          data.applyUrl = null;
          data.contactInfo = null;
        }
      }
      if (body.applyUrl !== undefined)
        data.applyUrl = body.applyUrl?.trim() || null;
      if (body.contactInfo !== undefined)
        data.contactInfo = body.contactInfo?.trim() || null;
      if (body.status !== undefined) data.status = body.status;
      if (body.deadline !== undefined)
        data.deadline = body.deadline ? new Date(body.deadline) : null;

      if (Object.keys(data).length > 0) {
        await tx.jobPost.update({ where: { id: post.id }, data });
      }

      const wasStatusChange =
        body.status !== undefined && body.status !== post.status;

      await tx.humanResourcesLogs.create({
        data: {
          action: wasStatusChange ? "STATUS" : "UPDATED",
          userId: body.userId,
          lineId: body.lineId,
          desc:
            `PESO job "${post.jobTitle ?? "N/A"}" ` +
            (wasStatusChange
              ? `status ${post.status} → ${body.status}`
              : "details updated"),
        },
      });

      return true;
    });

    if (!result) throw new ValidationError("TRANSACTION FAILED");
    return res.code(200).send({ message: "OK" });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DATABASE_CONNECTION_FAILED", 500, "DB_ERROR");
    }
    throw error;
  }
};

/** Paginated management list of a line's PESO posts (all statuses). */
export const pesoJobList = async (req: FastifyRequest, res: FastifyReply) => {
  const params = req.query as PagingProps;
  if (!params.id) throw new ValidationError("INVALID ID");

  try {
    const cursor = params.lastCursor ? { id: params.lastCursor } : undefined;
    const limit = params.limit ? parseInt(params.limit, 10) : 20;

    const andClauses: Prisma.JobPostWhereInput[] = [
      { postType: "PESO" },
      { lineId: params.id },
    ];

    if (params.query && params.query.trim()) {
      const q = params.query.trim();
      andClauses.push({
        OR: [
          { jobTitle: { contains: q, mode: "insensitive" } },
          { employerName: { contains: q, mode: "insensitive" } },
          { desc: { contains: q, mode: "insensitive" } },
        ],
      });
    }

    const list = await prisma.jobPost.findMany({
      where: { AND: andClauses },
      include: {
        _count: { select: { submittedApplications: true } },
        requirements: { select: { id: true } },
      },
      skip: cursor ? 1 : 0,
      take: limit,
      orderBy: { timestamp: "desc" },
      cursor,
    });

    const shaped = list.map((j) => ({
      ...j,
      _count: { application: j._count?.submittedApplications ?? 0 },
    }));

    const lastCursor = shaped.length > 0 ? shaped[shaped.length - 1].id : null;
    const hasMore = shaped.length === limit;

    return res.code(200).send({ list: shaped, hasMore, lastCursor });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DATABASE_CONNECTION_FAILED", 500, "DB_ERROR");
    }
    throw error;
  }
};

/** Single PESO post (for the edit form). */
export const pesoJobData = async (req: FastifyRequest, res: FastifyReply) => {
  const params = req.query as { id?: string };
  if (!params.id) throw new ValidationError("INVALID ID");

  try {
    const post = await prisma.jobPost.findUnique({
      where: { id: params.id },
      include: {
        requirements: {
          select: {
            id: true,
            title: true,
            asset: {
              select: {
                id: true,
                fileName: true,
                fileSize: true,
                fileUrl: true,
              },
            },
          },
        },
        _count: { select: { submittedApplications: true } },
      },
    });

    if (!post) throw new NotFoundError("JOB POST NOT FOUND");
    if (post.postType !== "PESO")
      throw new ValidationError("Not a PESO job post.");

    return res.code(200).send({
      ...post,
      _count: { application: post._count?.submittedApplications ?? 0 },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DATABASE_CONNECTION_FAILED", 500, "DB_ERROR");
    }
    throw error;
  }
};
