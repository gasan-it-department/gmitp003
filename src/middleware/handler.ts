import fastify, { FastifyReply, FastifyRequest } from "../barrel/fastify";
import { User } from "../barrel/prisma";
import { jwt } from "../barrel/fastify";
import { prisma } from "../barrel/prisma";

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
