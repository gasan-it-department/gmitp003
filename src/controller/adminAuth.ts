import { error } from "console";
import { FastifyRequest, FastifyReply } from "../barrel/fastify";
import { prisma } from "../barrel/prisma";
import argon from "argon2";
//
import { AdminLoginProps } from "../models/route";

export const adminAuth = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const params = req.body as AdminLoginProps;
    console.log({ params });

    if (!params.username || !params.password) {
      return res.code(400).send({ message: "Bad Request!" });
    }
    const admin = await prisma.admin.findFirst({
      where: {
        username: { contains: params.username, mode: "insensitive" },
      },
    });

    if (!admin) {
      return res.code(200).send({ error: 1, message: "Account not found!" });
    }
    const verified = await argon.verify(admin.password, params.password);
    if (!verified) {
      return res.code(200).send({ error: 2, message: "Incorrect Password!" });
    }
    const token = await res.jwtSign({ id: admin.id, username: admin.username });

    return res
      .code(200)
      .send({ admin: { id: admin.id, username: admin.username, token } });
  } catch (error) {
    console.log(error);
  }
};

export const creteAdmin = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const body = req.body as AdminLoginProps;
    if (!body.username || !body.password) {
      return res.code(400).send({ message: "Bad Request!" });
    }
    const { username, password } = body;
    const admin = await prisma.admin.findFirst({
      where: {
        username: { contains: username, mode: "insensitive" },
      },
    });
    if (admin) {
      return res
        .code(200)
        .send({ error: 1, message: "Username already exist!" });
    }
    const hashedPassword = await argon.hash(password);
    const response = await prisma.admin.create({
      data: {
        username,
        password: hashedPassword,
      },
    });
    if (!response) {
      res
        .code(409)
        .send({ message: "Something went wrong, please try again!" });
    }
    res.code(200).send({ error: 0, message: "OK" });
  } catch (error) {
    res.code(500).send({ message: "Internal Server Error" });
  }
};
