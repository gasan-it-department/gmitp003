import { error } from "console";
import { FastifyRequest, FastifyReply } from "../barrel/fastify";
import { prisma } from "../barrel/prisma";
import { PagingProps, AddPositionProps } from "../models/route";
export const positionList = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const { lastCursor, limit } = req.params as PagingProps;

    const cursor = lastCursor ? { id: lastCursor } : undefined;
    const response = await prisma.position.findMany({
      cursor,
      take: parseInt(limit, 10) ?? 10,
    });

    const newLastCursor =
      response.length > 0 ? response[response.length - 1].id : null;

    const hasMore = response.length === 10;

    return res
      .code(200)
      .send({ list: response, lastCursor: newLastCursor, hasMore });
  } catch (error) {
    console.log(error);

    res.code(500).send({ message: "Internal Server Error" });
  }
};

export const addPosition = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const body = req.body as AddPositionProps;
    if (!body) {
      return;
    }

    const { slot, title, plantilla, description, itemNumber } = body;
    console.log({ slot, title, plantilla, description, itemNumber });

    if (!slot) {
      return;
    }
    const [slots] = await prisma.$transaction([
      prisma.position.findFirst({
        where: {
          name: { contains: title, mode: "insensitive" },
        },
      }),
    ]);
    if (!slots) {
      const newPosition = await prisma.position.create({
        data: {
          name: title,
          plantilla: plantilla,
          description: description,
          salaryGradeId: "cdbd358a-183f-458f-a5dc-d8b8db3f4fa8",
          max: slot.length,
          itemNumber: itemNumber ? itemNumber : undefined,
        },
      });
      await prisma.positionSlot.createMany({
        data: slot.map((item) => {
          return {
            positionId: newPosition.id,
            salaryGradeId: "cdbd358a-183f-458f-a5dc-d8b8db3f4fa8",
          };
        }),
      });
      return res
        .code(200)
        .send({ message: "Position created successfully!", error: 0 });
    } else {
      return res
        .code(200)
        .send({ message: "Position already exists", error: 1 });
    }
  } catch (error) {
    console.log(error);

    res.code(500).send({ message: "Internal Server Error" });
  }
};

export const deletePosition = async (
  req: FastifyRequest,
  res: FastifyReply
) => {
  try {
    const body = req.body as { id: string };
    if (!body || !body.id) {
      return res.code(400).send({ message: "Invalid request" });
    }
    const [occupied] = await prisma.$transaction([
      prisma.positionSlot.findMany({
        where: {
          userId: { not: null },
          positionId: body.id,
        },
        include: {
          user: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              middleName: true,
            },
          },
        },
      }),
    ]);

    if (occupied.length === 0) {
      await prisma.$transaction([
        prisma.positionSlot.deleteMany({
          where: {
            positionId: body.id,
          },
        }),
        prisma.position.delete({
          where: {
            id: body.id,
          },
        }),
      ]);
      return res.code(200).send({ message: "Position deleted successfully" });
    }
    return res
      .code(400)
      .send({ message: "Position is occupied by users", occupied });
  } catch (error) {}
};

export const confirmDeletePosition = async (
  req: FastifyRequest,
  res: FastifyReply
) => {
  try {
    const body = req.body as { id: string };

    if (!body || !body.id) {
      return res.code(400).send({ message: "Invalid request" });
    }
    const [slot, position] = await prisma.$transaction([
      prisma.positionSlot.findMany({
        where: {
          userId: { not: null },
          positionId: body.id,
        },
      }),
      prisma.position.findUnique({
        where: {
          id: body.id,
        },
      }),
    ]);

    if (slot.length === 0 || position) {
      await prisma.$transaction([
        prisma.position.delete({
          where: {
            id: body.id,
          },
        }),
        prisma.positionSlot.deleteMany({
          where: {
            positionId: body.id,
          },
        }),
      ]);
      return res.code(200).send({
        message: "Position can be deleted",
        position: position,
      });
    }
    return res
      .code(404)
      .send({ message: "Position and slot/s not found!", slot });
  } catch (error) {
    console.log(error);
    return { message: "Internal Server Error" };
  }
};

export const updatePosition = async (
  req: FastifyRequest,
  res: FastifyReply
) => {
  try {
    const body = req.body as AddPositionProps;
    if (!body) {
      return res.code(400).send({ message: "Invalid request" });
    }

    const { id, slot, title, plantilla, description, itemNumber } = body;

    if (!id || !slot) {
      return res.code(400).send({ message: "Invalid request" });
    }

    const position = await prisma.position.findUnique({
      where: { id },
    });

    if (!position) {
      return res.code(404).send({ message: "Position not found" });
    }

    await prisma.$transaction([
      prisma.position.update({
        where: { id },
        data: {
          name: title,
          plantilla,
          description,
          itemNumber: itemNumber ? itemNumber : undefined,
        },
      }),
      prisma.positionSlot.deleteMany({
        where: { positionId: id },
      }),
      prisma.positionSlot.createMany({
        data: slot.map((item) => ({
          positionId: id,
          salaryGradeId: "cdbd358a-183f-458f-a5dc-d8b8db3f4fa8",
        })),
      }),
    ]);

    return res.code(200).send({ message: "Position updated successfully" });
  } catch (error) {
    console.log(error);
    return { message: "Internal Server Error" };
  }
};
