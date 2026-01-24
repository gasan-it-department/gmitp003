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

export const humanResourcesOverall = async (
  req: FastifyRequest,
  res: FastifyReply
) => {
  const params = req.query as { lineId: string };

  if (!params.lineId) throw new ValidationError("INVALID REQUIRED ID");
  try {
    const response = await prisma.$transaction(async (tx) => {
      const employees = await tx.user.count({
        where: {
          lineId: params.lineId,
        },
      });

      const applications = await tx.submittedApplication.count({
        where: {
          lineId: params.lineId,
        },
      });

      const postedJobs = await tx.jobPost.count({
        where: {
          lineId: params.lineId,
        },
      });

      const vacancies = await tx.positionSlot.count({
        where: {
          unitPosition: {
            lineId: params.lineId,
          },
          userId: undefined,
        },
      });

      const announcementsLive = await tx.announcement.count({
        where: {
          lineId: params.lineId,
        },
      });

      const announcementDraft = await tx.announcement.count({
        where: {
          status: 0,
        },
      });

      return {
        employees,
        applications,
        postedJobs,
        vacancies,
        announcementsLive,
        announcementDraft,
      };
    });

    if (!response) {
      throw new ValidationError("TRANSACTION FAILED");
    }
    return res.code(200).send(response);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DB_CONNECTION_ERROR", 500, "DB_FAILED");
    }
    throw error;
  }
};
