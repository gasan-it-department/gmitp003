import { FastifyReply, FastifyRequest } from "../barrel/fastify";
import { prisma, Prisma } from "../barrel/prisma";
import { PagingProps } from "../models/route";
import { AppError, NotFoundError, ValidationError, dbError } from "../errors/errors";
import { sendEmail } from "../middleware/handler";
import { EncryptionService } from "../service/encryption";
import { createUserNotification } from "../service/notificationEvents";

export const modules = async (req: FastifyRequest, res: FastifyReply) => {
  const params = req.query as { id: string; indexes: string }; // indexes is a string
  console.log("Params: ", params);

  if (!params.id) {
    throw new ValidationError("INVALID REQUIRED ID OR INDEXES");
  }

  // Parse the comma-separated indexes string into an array of numbers
  const indexes = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];

  try {
    const response = await prisma.module.groupBy({
      by: ["moduleIndex", "moduleName"],
      _count: {
        userId: true,
      },
      where: {
        lineId: params.id,
      },
    });
    console.log({ response });

    const modulesWithUserCount = response.map((module) => ({
      moduleIndex: module.moduleIndex,
      moduleName: module.moduleName,
      totalUsers: module._count.userId,
    }));

    return res.code(200).send(modulesWithUserCount);
  } catch (error) {
    console.log(error);

    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw dbError(error);
    }
    throw error;
  }
};

export const moduleUsers = async (req: FastifyRequest, res: FastifyReply) => {
  const params = req.query as PagingProps;
  // Module access is per line — scope the membership list by lineId when the
  // caller provides it, so "who has this module" (and the Add-page badges that
  // read it) are accurate for the current line rather than counting every line.
  const lineId = (req.query as { lineId?: string }).lineId;

  if (!params.id) throw new ValidationError("INVALID REQUIRED ID");
  try {
    const cursor = params.lastCursor ? { id: params.lastCursor } : undefined;
    const limit = params.limit ? parseInt(params.limit, 10) : 20;

    const filter: any = {};

    if (params.query) {
      const searchTerms = params.query.trim().split(/\s+/); // Split on any whitespace

      if (searchTerms.length === 1) {
        filter.OR = [
          { lastName: { contains: searchTerms[0], mode: "insensitive" } },
          { firstName: { contains: searchTerms[0], mode: "insensitive" } },
          { middleName: { contains: searchTerms[0], mode: "insensitive" } },
        ];
      } else {
        filter.AND = searchTerms.map((term) => ({
          OR: [
            { firstname: { contains: term, mode: "insensitive" } },
            { lastname: { contains: term, mode: "insensitive" } },
          ],
        }));

        filter.OR = [
          { AND: filter.AND },
          {
            middleName: { contains: params.query.trim(), mode: "insensitive" },
          },
        ];
        delete filter.AND; // Remove the AND since we've incorporated it into OR
      }
    }

    const response = await prisma.user.findMany({
      where: {
        modules: {
          some: {
            moduleName: params.id,
            ...(lineId ? { lineId } : {}),
          },
        },
        ...filter,
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        username: true,
        modules: {
          where: {
            moduleName: params.id,
          },
        },
      },
      take: limit,
      skip: cursor ? 1 : 0,
      orderBy: {
        lastName: "desc",
      },
      cursor,
    });

    console.log({ response });

    const newLastCursorId =
      response.length > 0 ? response[response.length - 1].id : null;
    const hasMore = response.length === limit;

    return res
      .code(200)
      .send({ list: response, lastCursor: newLastCursorId, hasMore });
  } catch (error) {
    console.log(error);

    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw dbError(error);
    }
    throw error;
  }
};

export const addModuleAccess = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const body = req.body as {
    userId: string;
    privilege?: number;
    module: string;
    lineId: string;
    currUserId: string;
  };

  // Privilege selection was removed from the grant UI — granting access now
  // gives full module access by default. Stay tolerant of an old client that
  // still sends a privilege.
  const privilege = typeof body.privilege === "number" ? body.privilege : 1;

  if (!body.userId || !body.module || !body.currUserId)
    throw new ValidationError("INVALID REQUIRED");

  try {
    const response = await prisma.$transaction(async (tx) => {
      // Get user details
      const user = await tx.user.findUnique({
        where: {
          id: body.userId,
        },
        include: {
          Position: true,
          department: true,
        },
      });

      if (!user) throw new ValidationError("USER NOT FOUND!");

      // Module access is stored PER LINE (Module.lineId = the grantee's line),
      // so scope the duplicate check by lineId too — otherwise a user who has
      // this module in a different line wrongly reads as "already assigned".
      // Also make it IDEMPOTENT: if a row already exists, return calmly instead
      // of throwing a hard "ALREADY ASSIGNED". The end state (user has access)
      // is identical, so HR is never blocked by a pre-existing/stale row.
      const existing = await tx.module.findFirst({
        where: {
          moduleName: body.module,
          userId: user.id,
          lineId: user.lineId as string,
        },
      });

      if (existing) return "EXISTS";

      // Get current user who is assigning the module
      const currentUser = await tx.user.findUnique({
        where: {
          id: body.currUserId,
        },
        select: {
          firstName: true,
          lastName: true,
          Position: true,
          email: true,
          emailIv: true,
        },
      });

      if (!currentUser) {
        throw new ValidationError("CURRENT USER NOT FOUND");
      }

      const decryptedData = currentUser.emailIv
        ? await EncryptionService.decrypt(
            currentUser.email,
            currentUser.emailIv,
          )
        : undefined;

      // Create module access
      const access = await tx.module.create({
        data: {
          userId: user.id,
          privilege,
          moduleName: body.module,
          moduleIndex: "1",
          lineId: user.lineId as string,
        },
      });

      // Create notification (with real-time push)
      await createUserNotification(tx, {
        recipientId: user.id,
        senderId: body.currUserId,
        title: "Module Access Granted",
        content: `${
          currentUser?.firstName || "A system administrator"
        } has granted you access to the ${
          body.module
        } module. You can now access this module from your dashboard.`,
        path: `${body.module}`,
      });

      // Send email
      const emailSubject = `Access Granted: ${body.module} Module`;
      const emailContent = `
Dear ${user.firstName} ${user.lastName},

You have been granted access to the ${body.module} module.

Details:
• Module: ${body.module}
• Granted By: ${currentUser?.firstName || "System Administrator"} ${
        currentUser?.lastName || ""
      }
• Date: ${new Date().toLocaleDateString()}

You can now access this module from your dashboard. If you have any questions, please contact your system administrator.

Best regards,
System Administrator
      `;

      if (decryptedData) {
        await sendEmail(
          emailSubject,
          decryptedData,
          emailContent,
          "module-access-granted",
        );
      }

      return "OK";
    });

    if (!response) {
      throw new AppError("SOMETHING WENT WRONG");
    }

    return res.status(200).send({
      success: true,
      alreadyHad: response === "EXISTS",
      message:
        response === "EXISTS"
          ? "User already has access to this module."
          : "Module access granted successfully",
    });
  } catch (error) {
    console.log(error);

    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw dbError(error);
    }
    throw error;
  }
};

// Helper function to convert privilege number to readable text
function getPrivilegeLevel(privilege: number): string {
  const privilegeLevels = ["Read Only", "Read and Write"];

  return privilegeLevels[privilege] || `Level ${privilege + 1}`;
}

export const userAccessModule = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const params = req.query as { userId: string };
  console.log({ params });

  if (!params.userId) throw new ValidationError("INVALID REQUIRED ID");
  try {
    const response = await prisma.module.findMany({
      where: {
        userId: params.userId,
      },
    });
    console.log({ response });

    return res.code(200).send(response);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw dbError(error);
    }
    throw error;
  }
};

export const removeAccess = async (req: FastifyRequest, res: FastifyReply) => {
  const body = req.body as {
    id: string;
    userId: string;
    module: string;
    lineId: string;
  };

  console.log({ body });

  if (!body.id || !body.userId || !body.lineId)
    throw new ValidationError("BAD REQUEST");

  try {
    const response = await prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({
        where: {
          id: body.userId,
        },
      });
      const module = await tx.module.findFirst({
        where: {
          moduleName: body.module,
          userId: body.id,
        },
      });
      if (!user) throw new NotFoundError("USER NOT FOUND");
      if (!module) throw new NotFoundError("ACCESS NOT FOUND");
      await tx.module.delete({
        where: {
          id: module.id,
        },
      });

      await tx.humanResourcesLogs.create({
        data: {
          action: "REMOVE ACCESS",
          userId: body.userId,
          desc: `REMOVE MODULE ACCESS: ${body.module} - @${user.username}`,
          lineId: body.lineId,
        },
      });
      await tx.activityLogs.create({
        data: {
          action: 5,
          desc: `You remove ${user.username}'s access to module ${body.module}`,
          lineId: body.lineId,
          userId: body.userId,
        },
      });
      return true;
    });

    if (!response) throw new ValidationError("TRANSACTION FAILED");

    return res.code(200).send({ message: "OK" });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw dbError(error);
    }
    throw error;
  }
};

export const updateModuleAccess = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const body = req.body as {
    id: string;
    userId: string;
    module: string;
    status?: number;
    privilege?: number;
    lineId: string;
  };
  console.log({ body });

  if (!body.id || !body.module || !body.userId)
    throw new ValidationError("INVALID REQUIRED FIELDS");

  try {
    const updateData: {
      status?: number;
      privilege?: number;
    } = {};

    // Cleaner check for optional status
    if (body.status !== undefined) {
      updateData.status = body.status;
    }

    // Cleaner check for optional privilege
    if (body.privilege !== undefined) {
      updateData.privilege = body.privilege;
    }

    // Check if there's actually something to update
    if (Object.keys(updateData).length === 0) {
      throw new ValidationError("NO_DATA_TO_UPDATE");
    }

    console.log({ updateData });

    const response = await prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({
        where: {
          id: body.id,
        },
      });
      if (!user) throw new NotFoundError("USER NOT FOUND");

      const module = await tx.module.findFirst({
        where: {
          moduleName: body.module,
          userId: user.id,
        },
      });

      if (!module) throw new NotFoundError("MODULE NOT FOUND");

      await tx.module.update({
        where: {
          id: module.id,
        },
        data: updateData,
      });

      await tx.humanResourcesLogs.create({
        data: {
          action: "UPDATE MODULE ACCESS",
          desc: `UPDATE MODULE ACCESS: ${body.module} - @${
            user.username
          } (status: ${updateData.status ?? "unchanged"}, privilege: ${
            updateData.privilege ?? "unchanged"
          })`,
          userId: body.userId,
          lineId: body.lineId,
        },
      });

      await tx.activityLogs.create({
        data: {
          action: 4,
          desc: `You update ${user.username}'s access to module ${body.module}`,
          userId: body.userId,
          lineId: body.lineId,
        },
      });
      return true;
    });

    if (!response) throw new ValidationError("TRANSACTION FAILED");

    return res.code(200).send({ message: "OK" });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw dbError(error);
    }
    throw error;
  }
};
