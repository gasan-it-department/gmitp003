import { FastifyReply, FastifyRequest } from "../barrel/fastify";
import { prisma, Prisma } from "../barrel/prisma";
import { AppError, ValidationError } from "../errors/errors";
export const provinces = async (req: FastifyRequest, res: FastifyReply) => {
  const params = req.query as { id: string };

  if (!params) throw new ValidationError("BAD_REQUEST");
  try {
    const response = await prisma.province.findMany({
      where: {
        regionId: params.id,
      },
    });

    return res.code(200).send(response);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
    }
    throw error;
  }
};
