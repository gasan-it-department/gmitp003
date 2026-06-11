import { FastifyReply, FastifyRequest } from "../barrel/fastify";
import { prisma, Prisma } from "../barrel/prisma";
import { AppError, ValidationError } from "../errors/errors";

export const overall = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const [accounts, lines, barangays, municipals, provinces, regions] =
      await prisma.$transaction([
        prisma.account.count(),
        prisma.line.count(),
        prisma.barangay.count(),
        prisma.municipal.count(),
        prisma.province.count(),
        prisma.region.count(),
      ]);

    return res
      .code(200)
      .send({ accounts, lines, barangays, municipals, provinces, regions });
  } catch (error) {
    console.log(error);
    res.code(500).send({ message: "Internal Server Error!" });
  }
};

/**
 * HR Dashboard data — scoped to a single Line.
 *
 * Returns a `stats` block (current counts) and a `trends` block
 * (week-over-week deltas, +/- integer) so the UI can show real direction
 * instead of hardcoded numbers. Also includes a small `recent` block
 * with the latest applications, job posts, and announcements for the
 * activity feed.
 */
export const humanResourcesOverall = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const params = req.query as { lineId: string };
  if (!params.lineId) throw new ValidationError("INVALID REQUIRED ID");

  try {
    const now = new Date();
    const oneWeekAgo = new Date(now);
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
    const twoWeeksAgo = new Date(now);
    twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);

    const lineId = params.lineId;

    const [
      // Current counts
      employees,
      applicationsPending,
      postedJobsActive,
      vacancies,
      announcementsLive,
      announcementDraft,
      // Trend windows
      applicationsThisWeek,
      applicationsLastWeek,
      jobsThisWeek,
      jobsLastWeek,
      announcementsThisWeek,
      announcementsLastWeek,
      employeesThisWeek,
      employeesLastWeek,
      // Recent activity (latest 5 of each)
      recentApplications,
      recentJobs,
      recentAnnouncements,
    ] = await Promise.all([
      prisma.user.count({ where: { lineId } }),

      // Pending applications only — status 0 = pending (1 = viewed, 2 = concluded)
      prisma.submittedApplication.count({
        where: { lineId, status: 0 },
      }),

      // Active job postings — status 1 = published (0 = draft, 3 = paused)
      prisma.jobPost.count({
        where: { lineId, status: 1 },
      }),

      // Vacant position slots — slot row exists but no user assigned.
      // Prisma needs `null` here, not `undefined`.
      prisma.positionSlot.count({
        where: {
          unitPosition: { lineId },
          userId: null,
        },
      }),

      prisma.announcement.count({
        where: { lineId, status: 1 },
      }),

      // Drafts: was previously missing the lineId filter, so it summed
      // every draft in the database.
      prisma.announcement.count({
        where: { lineId, status: 0 },
      }),

      prisma.submittedApplication.count({
        where: { lineId, timestamp: { gte: oneWeekAgo } },
      }),
      prisma.submittedApplication.count({
        where: {
          lineId,
          timestamp: { gte: twoWeeksAgo, lt: oneWeekAgo },
        },
      }),
      prisma.jobPost.count({
        where: { lineId, timestamp: { gte: oneWeekAgo } },
      }),
      prisma.jobPost.count({
        where: {
          lineId,
          timestamp: { gte: twoWeeksAgo, lt: oneWeekAgo },
        },
      }),
      prisma.announcement.count({
        where: { lineId, createdAt: { gte: oneWeekAgo } },
      }),
      prisma.announcement.count({
        where: {
          lineId,
          createdAt: { gte: twoWeeksAgo, lt: oneWeekAgo },
        },
      }),
      prisma.user.count({
        where: { lineId, createdAt: { gte: oneWeekAgo } },
      }),
      prisma.user.count({
        where: {
          lineId,
          createdAt: { gte: twoWeeksAgo, lt: oneWeekAgo },
        },
      }),

      prisma.submittedApplication.findMany({
        where: { lineId },
        orderBy: { timestamp: "desc" },
        take: 5,
        select: {
          id: true,
          firstname: true,
          lastname: true,
          status: true,
          timestamp: true,
          forPosition: { select: { name: true } },
        },
      }),
      prisma.jobPost.findMany({
        where: { lineId },
        orderBy: { timestamp: "desc" },
        take: 5,
        select: {
          id: true,
          timestamp: true,
          status: true,
          position: { select: { name: true } },
        },
      }),
      prisma.announcement.findMany({
        where: { lineId },
        orderBy: { createdAt: "desc" },
        take: 5,
        select: {
          id: true,
          title: true,
          status: true,
          createdAt: true,
        },
      }),
    ]);

    const trend = (now: number, prev: number) => now - prev;

    return res.code(200).send({
      // Existing shape — kept for back-compat with the frontend.
      employees,
      applications: applicationsPending,
      postedJobs: postedJobsActive,
      vacancies,
      announcementsLive,
      announcementDraft,
      // New: week-over-week deltas (integer signed).
      trends: {
        employees: trend(employeesThisWeek, employeesLastWeek),
        applications: trend(applicationsThisWeek, applicationsLastWeek),
        postedJobs: trend(jobsThisWeek, jobsLastWeek),
        announcements: trend(announcementsThisWeek, announcementsLastWeek),
      },
      // New: recent activity (mixed feed).
      recent: {
        applications: recentApplications,
        jobs: recentJobs,
        announcements: recentAnnouncements,
      },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DB_CONNECTION_ERROR", 500, "DB_FAILED");
    }
    throw error;
  }
};
