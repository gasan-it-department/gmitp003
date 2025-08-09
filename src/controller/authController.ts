import { prisma, User } from "../barrel/prisma";
import argon from "argon2";
import { AuthUser } from "../models/User";
import { FastifyReply, FastifyRequest } from "../barrel/fastify";

export const authController = async (
  request: FastifyRequest,
  res: FastifyReply
) => {
  try {
    const { username, password } = request.body as AuthUser;

    if (!username || !password) {
      return res
        .code(400)
        .send({ message: "Username and password are required", error: 10 });
    }

    const user = await prisma.account.findFirst({
      where: {
        username: username,
      },
      include: {
        User: {
          select: {
            departmentId: true,
            id: true,
          },
        },
        line: {
          select: {
            status: true,
          },
        },
      },
    });
    if (!user) {
      return res.code(200).send({ message: "User not found", error: 1 });
    }
    const mathced = await argon.verify(user.password, password);
    if (!mathced) {
      return res.code(200).send({ message: "Incorrect password", error: 2 });
    }
    const token = await res.jwtSign({ id: user.id, username: user.username });
    // if (user.line?.status && user.line.status === 1) {
    //   return res.code(200).send({
    //     message: "Line must be freezed or removed",
    //     error: 4,
    //     data: {
    //       username: user.username,
    //       token: token,
    //       id: user.id,
    //     },
    //   });
    // }
    // if (user.lineId === null) {
    //   return res.code(200).send({
    //     message: "User is not assigned to a line",
    //     error: 3,
    //     data: {
    //       username: user.username,
    //       token: token,
    //       id: user.id,
    //     },
    //   });
    // }
    res.code(200).send({
      data: {
        username: user.username,
        token: token,
        id: user.User?.id,
        line: user.lineId,
        departmentId: user.User?.departmentId,
      },
    });
  } catch (error) {
    res.code(500).send({
      message: "Internal Server Error",
      error:
        error instanceof Error ? error.message : "An unexpected error occurred",
    });
  }
};

export const registerController = async (
  request: FastifyRequest,
  res: FastifyReply
) => {
  try {
    console.log("registerController called");

    const data = request.body as AuthUser;

    const existingUser = await prisma.account.findFirst({
      where: { username: { contains: data.username, mode: "insensitive" } },
    });
    console.log("existingUser", existingUser);
    if (existingUser) {
      return res.code(400).send({ message: "User already exists" });
    }
    console.log("1");

    const hashed = await argon.hash(data.password);
    console.log("hashed password", hashed);

    const newUser = await prisma.account.create({
      data: {
        username: data.username,
        password: hashed,
      },
    });
    const user = await prisma.user.create({
      data: {
        username: data.username,
        lastName: "dasdasjdkajslk",
        level: 2,
        firstName: "dasdasd",
        middleName: "dasdasd",
        email: "testEmail@gmail.com",
        accountId: newUser.id,
      },
    });

    console.log("user created", user);
  } catch (error) {
    console.log(error);

    res.code(500).send({
      message: "Internal Server Error",
      error:
        error instanceof Error ? error.message : "An unexpected error occurred",
    });
  }
};
