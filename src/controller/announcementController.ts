import { FastifyReply, FastifyRequest } from "../barrel/fastify";
import { prisma } from "../barrel/prisma";

//
import { AnnouncementsProps } from "../models/route";

export const announcements = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const body = req.params as AnnouncementsProps;
    const { departmentId, important, line, lastCursor, limit } = body;
    const filter: any = {
      lineId: line,
    };
    const cursor = lastCursor ? { id: lastCursor } : undefined;
    if (departmentId) {
      filter.departmentId = departmentId;
    }
    if (important) {
      filter.important = important;
    }

    const response = await prisma.announcement.findMany({
      where: filter,
      cursor,
      take: limit ?? 5,
      skip: cursor ? 1 : 0,
    });

    const newLastCursorId =
      response.length > 0 ? response[response.length - 1].id : null;
    const hasMore = response.length === 5;

    return res
      .code(200)
      .send({ list: response, lastCursor: newLastCursorId, hasMore });
  } catch (error) {
    console.log(error);
  }
};
