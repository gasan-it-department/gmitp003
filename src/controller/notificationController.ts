import { FastifyReply, FastifyRequest } from "../barrel/fastify";
import { prisma, Prisma } from "../barrel/prisma";
import { PagingProps } from "../models/route";
import { ValidationError, AppError } from "../errors/errors";
export const notifications = async (req: FastifyRequest, res: FastifyReply) => {
  const params = req.query as PagingProps;
  if (!params.id) throw new ValidationError("INVALID REQUIRED ID");
  try {
    const cursor = params.lastCursor ? { id: params.id } : undefined;
    const limit = params.limit ? parseInt(params.limit, 10) : 20;

    const response = await prisma.notification.findMany({
      where: {
        recipientId: params.id,
      },
      include: {
        sender: {
          select: {
            firstName: true,
            lastName: true,
            userProfilePictures: {
              select: {
                file_name: true,
                id: true,
                file_size: true,
                file_url: true,
                file_public_id: true,
              },
            },
          },
        },
      },
      skip: cursor ? 1 : 0,
      take: limit,
      orderBy: {
        createdAt: "desc",
      },
      cursor,
    });

    const newLastCursorId =
      response.length > 0 ? response[response.length - 1].id : null;
    const hasMore = response.length === limit;

    return res
      .code(200)
      .send({ list: response, lastCursor: newLastCursorId, hasMore });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DB_CONNECTION_ERROR", 500, "DB_FAILED");
    }
    throw error;
  }
};

export const viewNotifcation = async (
  req: FastifyRequest,
  res: FastifyReply
) => {
  const body = req.body as { id: string; userId: string };

  if (!body.userId || !body.id)
    throw new ValidationError("INVALID REQURIED ID");

  try {
    const response = await prisma.notification.update({
      where: {
        id: body.id,
      },
      data: {
        isRead: true,
      },
    });

    if (!response) throw new ValidationError("TRANSACTION FAILED");
    return res.code(200).send({ message: "OK" });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DB_CONNECTION_ERROR", 500, "DB_FAILED");
    }
    throw error;
  }
};
