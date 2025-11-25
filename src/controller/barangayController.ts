import { FastifyReply, FastifyRequest } from "../barrel/fastify";
import { Prisma, prisma } from "../barrel/prisma";
import { AppError, ValidationError } from "../errors/errors";

export const barangays = async (req: FastifyRequest, res: FastifyReply) => {
  const params = req.query as { id: string };

  if (!params.id) throw new ValidationError("BAD_REQUEST");
  try {
    const response = await prisma.barangay.findMany({
      where: {
        municipalId: params.id,
      },
      orderBy: {
        name: "desc",
      },
    });

    return res.code(200).send(response);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DB_CONNECTION_ERROR", 500, "DB_FAILED");
    }
    throw error;
  }
};
