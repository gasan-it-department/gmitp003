import { FastifyReply, FastifyRequest } from "../barrel/fastify";
import { prisma, Prisma } from "../barrel/prisma";
import { NewAnnouncement, PagingProps } from "../models/route";
import { AppError, NotFoundError, ValidationError } from "../errors/errors";
import { EncryptionService } from "../service/encryption";
import { announcementStatus } from "../utils/helper";
import { sendEmail } from "../middleware/handler";
//

export const announcements = async (req: FastifyRequest, res: FastifyReply) => {
  const params = req.query as PagingProps;

  if (!params.id) throw new ValidationError("INVALID REQUIRED ID");

  try {
    const filter: any = {
      lineId: params.id,
    };
    const cursor = params.lastCursor ? { id: params.lastCursor } : undefined;
    const take = params.limit ? parseInt(params.limit, 10) : 20;

    if (params.query) {
      filter.title = {
        contains: params.query,
        mode: "insensitive",
      };
    }

    const announcements = await prisma.announcement.findMany({
      where: filter,
      cursor,
      take: take,
      skip: cursor ? 1 : 0,
      select: {
        id: true,
        title: true,
        titleIv: true,
        createdAt: true,
        status: true,
        content: true,
        contentIv: true,
      },
      orderBy: {
        createdAt: "desc", // Added ordering
      },
    });

    // Decrypt all titles in parallel
    const decryptedAnnouncements = await Promise.all(
      announcements.map(async (item) => {
        try {
          const { title, titleIv, id, createdAt, content, contentIv } = item;

          // Decrypt the title if IV exists
          let decryptedTitle = title;
          let decryptedContent = content;
          if (title && titleIv) {
            try {
              decryptedTitle = await EncryptionService.decrypt(title, titleIv);
            } catch (decryptError) {
              console.error(
                `Failed to decrypt title for announcement ${id}:`,
                decryptError,
              );
              decryptedTitle = "[Encrypted - Decryption Failed]";
            }
          }

          if (content && contentIv) {
            try {
              decryptedContent = await EncryptionService.decrypt(
                content,
                contentIv,
              );
            } catch (decryptError) {
              console.error(
                `Failed to decrypt title for announcement ${id}:`,
                decryptError,
              );
              decryptedContent = "[Encrypted - Decryption Failed]";
            }
          }

          return {
            id,
            title: decryptedTitle,
            createdAt,
            status: item.status,
            content: decryptedContent,
          };
        } catch (error) {
          console.error(`Error processing announcement ${item.id}:`, error);
          return {
            id: item.id,
            title: "[Error Processing]",
            createdAt: item.createdAt,
            status: item.status,
          };
        }
      }),
    );

    // Get cursor for pagination
    const newLastCursorId =
      decryptedAnnouncements.length > 0
        ? decryptedAnnouncements[decryptedAnnouncements.length - 1].id
        : null;

    // Check if there are more items (using original announcements count)
    const hasMore = announcements.length === take;

    return res.code(200).send({
      list: decryptedAnnouncements,
      lastCursor: newLastCursorId,
      hasMore,
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
    }

    if (error instanceof ValidationError) {
      throw error;
    }

    throw new AppError(
      "ANNOUNCEMENTS_FETCH_FAILED",
      500,
      "Failed to fetch announcements",
    );
  }
};
export const createNewAnnouncement = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const body = req.body as NewAnnouncement;

  if (!body.lineId || !body.authorId || !body.title)
    throw new ValidationError("INVALID REQUIRED FIELDS");
  try {
    const encryptedTitle = await EncryptionService.encrypt(body.title);
    const newAnnouncement = await prisma.announcement.create({
      data: {
        title: encryptedTitle.encryptedData,
        titleIv: encryptedTitle.iv,
        content: "Content here...",
        authorId: body.authorId,
        important: body.important,
        lineId: body.lineId,
        status: 0,
      },
    });

    return res.code(200).send({ message: "OK", id: newAnnouncement.id });
  } catch (error) {
    console.log(error);

    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
    }
    throw error;
  }
};

export const announcementData = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const params = req.query as { id: string; userId: string };

  if (!params.id || !params.userId)
    throw new ValidationError("INVALID REQUIRED ID");
  try {
    const data = await prisma.announcement.findUnique({
      where: {
        id: params.id,
      },
      include: {
        announcementAttachFiles: true,
        _count: {
          select: {
            announcementViews: true,
            announcementAttachFiles: true,
            announcementMentions: true,
            announcementReactions: true,
          },
        },
        author: {
          select: {
            firstName: true,
            lastName: true,
            id: true,
            username: true,
          },
        },
      },
    });

    const reacted = await prisma.announcementReaction.findFirst({
      where: {
        userId: params.userId,
        announcementId: params.id,
      },
    });

    if (!data) throw new NotFoundError("DATA NOT FOUND!");
    const {
      title,
      titleIv,
      content,
      contentIv,
      announcementAttachFiles,
      _count,
      createdAt,
      author,
    } = data;
    console.log({ data });

    const decryptedData = await Promise.all([
      titleIv ? EncryptionService.decrypt(title, titleIv) : titleIv,
      contentIv ? EncryptionService.decrypt(content, contentIv) : contentIv,
    ]);

    const [decryptedTitle, decryptedContent] = decryptedData;

    return res.code(200).send({
      title: decryptedTitle,
      content: decryptedContent,
      files: announcementAttachFiles,
      status: data.status,
      _count: {
        views: _count.announcementViews,
        reactions: _count.announcementReactions,
        mentions: _count.announcementMentions,
        files: _count.announcementAttachFiles,
      },
      createdAt,
      author,
      reacted: reacted ? true : false,
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
    }
    throw error;
  }
};

export const publishAnnouncement = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const body = req.body as {
    id: string;
    title: string;
    content: string;
    authorId: string;
    lineId: string;
    status: number;
  };
  console.log({ body });

  if (!body.lineId || !body.authorId || !body.id) {
    throw new ValidationError("INVALID REQUIRED ID");
  }

  try {
    const encryptedData = await Promise.all([
      EncryptionService.encrypt(body.title),
      EncryptionService.encrypt(body.content),
    ]);

    const [title, content] = encryptedData;

    if (!title || !content) {
      throw new ValidationError("FAILED ENCRYPTION");
    }
    const sent: string[] = [];
    const fail: string[] = [];

    const response = await prisma.$transaction(async (tx) => {
      // const users = await tx.user.findMany({
      //   where: {
      //     status: "",
      //   },
      // });
      const announcement = await tx.announcement.update({
        data: {
          title: title.encryptedData,
          titleIv: title.iv,
          content: content.encryptedData,
          contentIv: content.iv,
          status: body.status,
        },
        where: {
          id: body.id,
        },
      });

      await tx.humanResourcesLogs.create({
        data: {
          userId: body.authorId,
          tab: 2,
          desc: `POSTED: New announcement: ${announcement.title}`,
          lineId: body.lineId,
          action: "ADDED",
        },
      });

      return "OK";
    });

    if (!response) {
      throw new ValidationError("SOMETHING WENT WRONG");
    }
    return res.code(200).send({ data: body });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
    }
    throw error;
  }
};

export const announcementUpdateStatus = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const body = req.body as {
    id: string;
    userId: string;
    status: number;
    lineId: string;
  };

  if (!body.id || !body.userId || !body.status)
    throw new ValidationError("INVALID REQUIRED FIELD");
  try {
    const statusText = announcementStatus[body.status];
    const response = await prisma.$transaction(async (tx) => {
      const announcement = await tx.announcement.update({
        where: {
          id: body.id,
        },
        data: {
          status: body.status,
        },
      });
      await tx.humanResourcesLogs.create({
        data: {
          userId: body.userId,
          tab: 2,
          desc: `UPDATED: Change announcement status: ${announcement.title} - [${statusText}]`,
          lineId: body.lineId,
          action: "UPDATED",
        },
      });
      return "OK";
    });

    if (!response) throw new ValidationError("FAILED TO UPDATE");

    return res.code(200).send({ message: "OK" });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
    }
    throw error;
  }
};

export const viewAnnouncement = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const body = req.body as { id: string; userId: string };

  try {
    const resposne = await prisma.$transaction(async (tx) => {
      const checked = await tx.announcementViews.findFirst({
        where: {
          announcementId: body.id,
          userId: body.userId,
        },
      });

      if (checked) return true;
      await tx.announcementViews.create({
        data: {
          userId: body.userId,
          announcementId: body.id,
        },
      });
      return true;
    });

    if (!resposne) throw new ValidationError("TRANSACTION FAILED");

    return res.code(200).send({ message: "OK" });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
    }
    throw error;
  }
};

export const markOkayAnnouncement = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const params = req.body as { id: string; userId: string };
  console.log("React: ", { params });

  if (!params.id || !params.userId)
    throw new ValidationError("INVALID REQUIRED ID");

  try {
    const response = await prisma.$transaction(async (tx) => {
      // Check if user exists
      const user = await tx.user.findUnique({
        where: {
          id: params.userId,
        },
      });
      if (!user) throw new NotFoundError("USER NOT FOUND");

      // Check if announcement exists
      const announcement = await tx.announcement.findUnique({
        where: {
          id: params.id,
        },
      });
      if (!announcement) throw new NotFoundError("ANNOUNCEMENT NOT FOUND");

      // Check if user already reacted to this announcement
      const existingReaction = await tx.announcementReaction.findFirst({
        where: {
          announcementId: params.id, // Fixed: should be announcementId, not id
          userId: params.userId,
        },
      });
      // await tx.announcementReaction.deleteMany();
      // Toggle logic: if reaction exists, delete it; if not, create it
      if (existingReaction) {
        // Delete existing reaction
        await tx.announcementReaction.delete({
          where: {
            id: existingReaction.id,
          },
        });
        return { action: "removed", reacted: false };
      } else {
        // Create new reaction (assuming reaction type 1 for "okay")
        await tx.announcementReaction.create({
          data: {
            userId: params.userId,
            announcementId: params.id,
            reaction: 1, // Assuming 1 represents "okay" reaction
            timestamp: new Date(),
          },
        });
        return { action: "added", reacted: true };
      }
    });

    return res.code(200).send({
      message: "OK",
      data: response,
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
    }
    throw error;
  }
};

export const removeAnnouncement = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const params = req.query as { id: string; lineId: string; userId: string };
  console.log({ params });

  if (!params.id || !params.lineId || !params.userId) {
    throw new ValidationError("INVALID REQUIRED FIELD");
  }
  try {
    const response = await prisma.$transaction(async (tx) => {
      const announcement = await tx.announcement.delete({
        where: {
          id: params.id,
        },
      });

      const decryptedAnnouncement = announcement.titleIv
        ? await EncryptionService.decrypt(
            announcement.title,
            announcement.titleIv,
          )
        : undefined;

      await tx.humanResourcesLogs.create({
        data: {
          lineId: params.lineId,
          userId: params.userId,
          action: "REMOVE",
          desc: `REMOVE ANNOUNCEMENT: ${decryptedAnnouncement || "Unknown"}`,
        },
      });
      return true;
    });

    if (!response) {
      throw new ValidationError("TRANSACTION FAILED");
    }

    return res.code(200).send({ message: "OK" });
  } catch (error) {
    console.log(error);

    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
    }
    throw error;
  }
};
