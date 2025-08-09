import { FastifyReply, FastifyRequest } from "../barrel/fastify";
import { prisma } from "../barrel/prisma";
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
