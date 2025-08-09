import { FastifyReply, FastifyRequest } from "../barrel/fastify";
import { prisma, Line } from "../barrel/prisma";

export const createLine = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const body = req.body as Line;
    if (!body || !body.name) {
      return res.code(400).send({ message: "Invalid request" });
    }
    const existingLine = await prisma.line.findUnique({
      where: { name: body.name },
    });
    if (existingLine) {
      return res
        .code(400)
        .send({ message: "Line with this name already exists" });
    }
    const newLine = await prisma.line.create({
      data: {
        name: body.name,
        barangayId: body.barangayId,
        municipalId: body.municipalId,
        provinceId: body.provinceId,
        regionId: body.regionId,
      },
    });
    return res.code(201).send({
      message: "Line created successfully",
      line: newLine,
      error: 0,
    });
  } catch (error) {
    console.log(error);
    res.code(500).send({ message: "Internal server error" });
    return;
  }
};

export const getLines = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const response = await prisma.line.findMany();
    await prisma.account.updateMany({
      data: {
        lineId: "c039c8fd-8058-4e07-820e-7a3f36dc108d",
      },
    });
    return response;
  } catch (error) {
    console.log(error);

    res.code(500).send({ message: "Internal Server Error" });
  }
};
