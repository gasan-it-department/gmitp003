import fastify, { FastifyReply, FastifyRequest } from "../barrel/fastify";
import { Prisma, User } from "../barrel/prisma";
import { jwt } from "../barrel/fastify";
import { prisma } from "../barrel/prisma";
import { AppError, ValidationError } from "../errors/errors";
import nodemailer from "nodemailer";

export const authenticated = async (
  request: FastifyRequest,
  reply: FastifyReply
) => {
  try {
    const authHeader = request.headers.authorization;

    if (!authHeader?.startsWith("Bearer ")) {
      throw new Error("Invalid authorization format. Expected: Bearer <token>");
    }

    const token = authHeader.split(" ")[1];
    if (!token) {
      throw new Error("No token provided");
    }
    const decoded = await request.jwtVerify<{ id: string }>();
    const user = await prisma.account.findUnique({
      where: {
        id: decoded.id,
      },
    });
    if (!user) {
      throw new Error("User belonging to this token no longer exists");
    }

    request.user = user;
    return; // Success - continue to route handler
  } catch (error) {
    console.log(error);

    reply.code(401).send({
      error: "Unauthorized",
      message: error instanceof Error ? error.message : "Authentication failed",
    });
  }
};

export const medicineAccessAuth = async (
  request: FastifyRequest,
  reply: FastifyReply
) => {
  try {
    const params = request.query as {
      unitId: string;
      userId: string;
      storateId: string;
    };
    if (!params.unitId || !params.userId) {
      throw new ValidationError("BAD_REQUEST");
    }
    const [user, access] = await prisma.$transaction([
      prisma.user.findUnique({
        where: {
          id: params.userId,
        },
      }),
      prisma.medicineStorageAccess.findFirst({
        where: {
          userId: params.userId,
          medicineStorageId: params.storateId,
        },
      }),
    ]);

    if (!user) {
      throw new ValidationError("USER_NOT_FOUND");
    }
    if (!access) {
      throw new ValidationError("USER_UNAUTHORIZED");
    }
    return;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DB_CONNECTION_EROR", 500, "DB_FAILED");
    }
    throw error;
  }
};

export const generatedBoxCode = async () => {
  let isUnique = false;
  const generated = Math.floor(100000 + Math.random() * 900000);
  while (!isUnique) {
    const check = await prisma.inventoryBox.findUnique({
      where: {
        code: generated,
      },
    });
    if (!check) isUnique = true;
  }
  return generated;
};

export const viewContainerAuth = async (
  req: FastifyRequest,
  res: FastifyReply
) => {
  try {
    const params = req.query as { id: string; userId: string };
    if (!params.id || !params.userId) {
      return res.code(400).send({ message: "Bad Request" });
    }
    const check = await prisma.containerAllowedUser.findFirst({
      where: {
        userId: params.userId,
        id: params.id,
      },
    });

    if (!check) {
      throw new Error("Unauthorized");
    }
    return;
  } catch (error) {
    console.log(error);
    res.code(401).send({
      error: "Unauthorized",
      message: error instanceof Error ? error.message : "Authentication failed",
    });
  }
};

export const generatedItemCode = async () => {
  let isUnique = false;
  const generated = Math.floor(100000 + Math.random() * 900000);
  while (!isUnique) {
    const check = await prisma.supplies.findFirst({
      where: {
        quantity: generated,
      },
    });
    if (!check) isUnique = true;
  }
  return generated;
};

function generateSecureRef(len: number): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let result = "";

  for (let i = 0; i < len; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }

  return result;
}

export const generateOrderRef = async () => {
  let isUnique = false;
  const generated = generateSecureRef(12);
  while (!isUnique) {
    const check = await prisma.supplyBatchOrder.findFirst({
      where: {
        refNumber: generated,
      },
    });
    if (!check) isUnique = true;
  }
  return generated;
};

export const generateItemRef = async () => {
  let isUnique = false;
  const generated = generateSecureRef(12);
  while (!isUnique) {
    const check = await prisma.supplyOrder.findFirst({
      where: {
        refNumber: generated,
      },
    });
    if (!check) isUnique = true;
  }
  return generated;
};

export const generatedInvitationCode = async () => {
  let isUnique = false;
  const generated = Math.floor(100000 + Math.random() * 900000);
  while (!isUnique) {
    const check = await prisma.invitationLink.findFirst({
      where: {
        code: generated.toString(),
      },
    });
    if (!check) isUnique = true;
  }
  return generated;
};

export const generateStorageRef = async () => {
  let isUnique = false;
  const generated = generateSecureRef(12);
  while (!isUnique) {
    const check = await prisma.medicineStorage.findUnique({
      where: {
        refNumber: generated,
      },
    });
    if (!check) isUnique = true;
  }
  return generated;
};

export const generateMedRef = async () => {
  let isUnique = false;
  const generated = generateSecureRef(12);

  while (!isUnique) {
    const check = await prisma.medicine.findFirst({
      where: {
        serialNumber: generated,
      },
    });
    if (!check) isUnique = true;
  }
  return generated;
};

export const generatePrescriptionRef = async () => {
  let isUnique = false;
  const generated = generateSecureRef(6);

  while (!isUnique) {
    const check = await prisma.prescription.findFirst({
      where: {
        refNumber: generated,
      },
    });
    if (!check) isUnique = true;
  }
  return generated;
};

export const sendEmail = async (
  sub: string,
  to: string,
  text: string,
  title: string
) => {
  try {
    console.log({ sub, text, to, title });

    const transporter = nodemailer.createTransport({
      service: "gmail", // ✅ Correct - just "gmail"
      auth: {
        user: "officeofthemayor.gasan@gmail.com",
        pass: "pgdy lfle qiaw qdrz", // Make sure this is an App Password
      },
    });

    const response = await transporter.sendMail({
      subject: sub,
      from: `"${title}" <officeofthemayor.gasan@gmail.com>`,
      to: to,
      text: text,
    });

    console.log("Email sent successfully! Message ID:", response.messageId);
    return "OK";
  } catch (error) {
    console.log("Email error:", error);
    throw error;
  }
};
