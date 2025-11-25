import { FastifyReply, FastifyRequest } from "../barrel/fastify";
import { prisma, InvitationLink, Prisma } from "../barrel/prisma";
import { AppError, NotFoundError, ValidationError } from "../errors/errors";
import { generatedInvitationCode } from "../middleware/handler";
import { PagingProps, SupplyOverviewProps } from "../models/route";

export const createInvitationLink = async (
  req: FastifyRequest,
  res: FastifyReply
) => {
  try {
    const body = req.body as { date: string; time: string; lineId: string };
    if (!body) {
      return res.code(400).send({ message: "Invalid request" });
    }

    // Calculate expiresAt based on date and time
    let expiresAt: Date;

    if (body.date && body.time) {
      // Combine date "2025-10-25" and time "16:00" into ISO string
      const dateTimeString = `${body.date}T${body.time}:00`; // Add seconds
      expiresAt = new Date(dateTimeString);
    } else if (body.date) {
      // If only date is provided, set time to end of day (23:59:59)
      const dateTimeString = `${body.date}T23:59:59`;
      expiresAt = new Date(dateTimeString);
    } else {
      // If no date provided, use default expiration (24 hours from now)
      expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    }

    // Validate that the expiration date is in the future
    if (expiresAt <= new Date()) {
      throw new ValidationError("INVALID_DATA");
    }

    await prisma.$transaction(async (tx) => {
      const generatedInvitationCode = async () => {
        let isUnique = false;
        const generated = Math.floor(100000 + Math.random() * 900000);
        while (!isUnique) {
          const check = await tx.invitationLink.findFirst({
            where: {
              code: generated.toString(),
            },
          });
          if (!check) isUnique = true;
        }
        return generated.toString();
      };
      const code = await generatedInvitationCode();
      const newInviteLink = await tx.invitationLink.create({
        data: {
          code: code,
          expiresAt: expiresAt,
          url: "none",
          used: false,
          lineId: body.lineId,
        },
      });

      if (!newInviteLink)
        throw new AppError("DB_CONNECTION_FAILED", 400, "DB_ERROR");

      await tx.invitationLink.update({
        where: { id: newInviteLink.id },
        data: {
          url: `/invitation/${newInviteLink.id}`,
        },
      });
    });

    return res.code(201).send({
      message: "Invitation link created successfully",
      error: 0,
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
    }
    throw error;
  }
};

export const invitationAuth = async (
  req: FastifyRequest,
  res: FastifyReply
) => {
  try {
    const body = req.query as { id: string };
    console.log({ body });

    if (body.id === undefined || body.id === null) {
      throw new ValidationError("BAD_REQUEST");
    }
    const invitations = await prisma.invitationLink.findUnique({
      where: {
        id: body.id,
      },
      include: {
        line: {
          select: {
            barangay: {
              select: {
                name: true,
              },
            },
            municipal: {
              select: {
                name: true,
              },
            },
            province: {
              select: {
                name: true,
              },
            },
            name: true,
          },
        },
      },
    });
    const currentDate = new Date();
    let response;
    // if (!invitations) {
    //   response = {
    //     message: "Application link not found",
    //     error: 0,
    //     data: invitations,
    //   };
    // } else if (invitations?.expiresAt && invitations.expiresAt < currentDate) {
    //   response = {
    //     message: "Application link has expired",
    //     error: 1,
    //     data: invitations,
    //   };
    // } else if (invitations?.status === 2) {
    //   response = {
    //     message: "Application link maybe suspeded or removed",
    //     error: 2,
    //     data: invitations,
    //   };
    // } else {
    //   response = {
    //     message: "Invitation link is valid",
    //     data: {
    //       ...invitations,
    //     },
    //   };
    // }
    return res.code(200).send({ data: invitations });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DB_CONNECTION_ERROR", 500, "DB_FAILED");
    }
    throw error;
  }
};

export const invitations = async (req: FastifyRequest, res: FastifyReply) => {
  const params = req.query as PagingProps;
  if (!params.id) throw new ValidationError("BAD_REQUEST");

  try {
    const cursor = params.lastCursor ? { id: params.lastCursor } : undefined;
    const limit = params.limit ? parseInt(params.limit, 10) : 30;
    const response = await prisma.invitationLink.findMany({
      where: {
        lineId: params.id,
      },
      take: limit,
      skip: cursor ? 1 : 0,
      orderBy: {
        createdAt: "desc",
      },
      cursor,
    });

    const newLastCursorId = response.length
      ? response[response.length - 1].id
      : null;
    const hasMore = response.length === limit;

    res.code(200).send({
      list: response,
      lastCursor: newLastCursorId,
      hasMore,
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DB_CONNECTION_ERROR", 500, "DB_FAILED");
    }
    throw error;
  }
};

export const containerOverview = async (
  req: FastifyRequest,
  res: FastifyReply
) => {
  const params = req.query as SupplyOverviewProps;
  if (!params.inventoryBoxId) throw new ValidationError("Required is missing!");
  try {
    const container = await prisma.inventoryBox.findUnique({
      where: {
        id: params.inventoryBoxId,
      },
      include: {
        _count: {
          select: {},
        },
      },
    });

    if (!container) {
      throw new NotFoundError("Container not found!");
    }
    res.code(200).send({ data: container });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DB CONNECTION FAILED", 500, "DB_ERROR");
    }
    throw error;
  }
};

export const deleteInvitationLink = async (
  req: FastifyRequest,
  res: FastifyReply
) => {
  const params = req.query as { id: string; userId: string; lineId: string };
  console.log("recieve", { params });

  if (!params.id || !params.lineId || !params.userId)
    throw new ValidationError("BAD_REQUEST");

  try {
    const links = await prisma.invitationLink.findMany();
    console.log({ links });

    await prisma.$transaction(async (tx) => {
      await tx.invitationLink.delete({
        where: {
          id: params.id,
        },
      });
    });
    return res.code(200).send({ message: "OK" });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
    }
    throw error;
  }
};
