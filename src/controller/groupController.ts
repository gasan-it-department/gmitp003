import { FastifyReply, FastifyRequest } from "../barrel/fastify";
import { prisma, Department } from "../barrel/prisma";

export const groupList = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const body = req.params as {};
    const groups = await prisma.department.findMany();
    return res.code(200).send(groups);
  } catch (error) {
    console.log(error);
    res.code(500).send({ message: "Internal Server Error" });
  }
};

export const createGroup = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const body = req.body as {
      name: string;
      description?: string;
      line: string;
    };

    if (!body || !body.name) {
      return res.code(400).send({ message: "Invalid request" });
    }

    const existingGroup = await prisma.department.findUnique({
      where: { name: body.name },
    });

    if (existingGroup) {
      return res.code(400).send({ message: "Group already exists" });
    }

    const newGroup = await prisma.department.create({
      data: {
        name: body.name,
        description: body.description,
      },
    });

    return res.code(201).send(newGroup);
  } catch (error) {
    console.log(error);
    return res.code(500).send({ message: "Internal Server Error" });
  }
};
