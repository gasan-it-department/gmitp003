"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.humanResourcesOverall = exports.overall = void 0;
const prisma_1 = require("../barrel/prisma");
const errors_1 = require("../errors/errors");
const overall = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const [accounts, lines, barangays, municipals, provinces, regions] = yield prisma_1.prisma.$transaction([
            prisma_1.prisma.account.count(),
            prisma_1.prisma.line.count(),
            prisma_1.prisma.barangay.count(),
            prisma_1.prisma.municipal.count(),
            prisma_1.prisma.province.count(),
            prisma_1.prisma.region.count(),
        ]);
        return res
            .code(200)
            .send({ accounts, lines, barangays, municipals, provinces, regions });
    }
    catch (error) {
        console.log(error);
        res.code(500).send({ message: "Internal Server Error!" });
    }
});
exports.overall = overall;
/**
 * HR Dashboard data — scoped to a single Line.
 *
 * Returns a `stats` block (current counts) and a `trends` block
 * (week-over-week deltas, +/- integer) so the UI can show real direction
 * instead of hardcoded numbers. Also includes a small `recent` block
 * with the latest applications, job posts, and announcements for the
 * activity feed.
 */
const humanResourcesOverall = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const params = req.query;
    if (!params.lineId)
        throw new errors_1.ValidationError("INVALID REQUIRED ID");
    try {
        const now = new Date();
        const oneWeekAgo = new Date(now);
        oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
        const twoWeeksAgo = new Date(now);
        twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);
        const lineId = params.lineId;
        const [
        // Current counts
        employees, applicationsPending, postedJobsActive, vacancies, announcementsLive, announcementDraft, 
        // Trend windows
        applicationsThisWeek, applicationsLastWeek, jobsThisWeek, jobsLastWeek, announcementsThisWeek, announcementsLastWeek, employeesThisWeek, employeesLastWeek, 
        // Recent activity (latest 5 of each)
        recentApplications, recentJobs, recentAnnouncements,] = yield Promise.all([
            prisma_1.prisma.user.count({ where: { lineId } }),
            // Pending applications only — status 0 = pending (1 = viewed, 2 = concluded)
            prisma_1.prisma.submittedApplication.count({
                where: { lineId, status: 0 },
            }),
            // Active job postings — status 1 = published (0 = draft, 3 = paused)
            prisma_1.prisma.jobPost.count({
                where: { lineId, status: 1 },
            }),
            // Vacant position slots — slot row exists but no user assigned.
            // Prisma needs `null` here, not `undefined`.
            prisma_1.prisma.positionSlot.count({
                where: {
                    unitPosition: { lineId },
                    userId: null,
                },
            }),
            prisma_1.prisma.announcement.count({
                where: { lineId, status: 1 },
            }),
            // Drafts: was previously missing the lineId filter, so it summed
            // every draft in the database.
            prisma_1.prisma.announcement.count({
                where: { lineId, status: 0 },
            }),
            prisma_1.prisma.submittedApplication.count({
                where: { lineId, timestamp: { gte: oneWeekAgo } },
            }),
            prisma_1.prisma.submittedApplication.count({
                where: {
                    lineId,
                    timestamp: { gte: twoWeeksAgo, lt: oneWeekAgo },
                },
            }),
            prisma_1.prisma.jobPost.count({
                where: { lineId, timestamp: { gte: oneWeekAgo } },
            }),
            prisma_1.prisma.jobPost.count({
                where: {
                    lineId,
                    timestamp: { gte: twoWeeksAgo, lt: oneWeekAgo },
                },
            }),
            prisma_1.prisma.announcement.count({
                where: { lineId, createdAt: { gte: oneWeekAgo } },
            }),
            prisma_1.prisma.announcement.count({
                where: {
                    lineId,
                    createdAt: { gte: twoWeeksAgo, lt: oneWeekAgo },
                },
            }),
            prisma_1.prisma.user.count({
                where: { lineId, createdAt: { gte: oneWeekAgo } },
            }),
            prisma_1.prisma.user.count({
                where: {
                    lineId,
                    createdAt: { gte: twoWeeksAgo, lt: oneWeekAgo },
                },
            }),
            prisma_1.prisma.submittedApplication.findMany({
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
            prisma_1.prisma.jobPost.findMany({
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
            prisma_1.prisma.announcement.findMany({
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
        const trend = (now, prev) => now - prev;
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
    }
    catch (error) {
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw new errors_1.AppError("DB_CONNECTION_ERROR", 500, "DB_FAILED");
        }
        throw error;
    }
});
exports.humanResourcesOverall = humanResourcesOverall;
