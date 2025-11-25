import { error } from "console";
import { FastifyRequest, FastifyReply } from "../barrel/fastify";
import { Prisma, prisma } from "../barrel/prisma";
import { PagingProps, AddPositionProps } from "../models/route";
import { AppError, NotFoundError, ValidationError } from "../errors/errors";
import axios from "axios";
export const positionList = async (req: FastifyRequest, res: FastifyReply) => {
  const params = req.query as PagingProps;
  console.log("Pos: ", params);

  if (!params.id) throw new ValidationError("BAD_REQUEST");
  try {
    const cursor = params.lastCursor ? { id: params.lastCursor } : undefined;
    const limit = params.limit ? parseInt(params.limit, 10) : 10;
    const response = await prisma.unitPosition.findMany({
      where: {
        departmentId: params.id,
      },
      cursor,
      take: limit,
      skip: cursor ? 1 : 0,
      include: {
        slot: {
          select: {
            id: true,
            salaryGrade: {
              select: {
                grade: true,
              },
            },
          },
        },
        position: {
          select: {
            name: true,
            id: true,
            itemNumber: true,
          },
        },
      },
    });
    console.log(JSON.stringify(response, null, 2));

    const newLastCursor =
      response.length > 0 ? response[response.length - 1].id : null;

    const hasMore = response.length === 10;

    return res
      .code(200)
      .send({ list: response, lastCursor: newLastCursor, hasMore });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
    }
    throw error;
  }
};

export const addPosition = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const body = req.body as AddPositionProps;
    if (!body.unitId) throw new ValidationError("INVALID_OFFICE");

    const {
      slot,
      title,
      plantilla,
      description,
      itemNumber,
      unitId,
      lineId,
      userId,
    } = body;

    if (!slot) {
      return;
    }
    const response = await prisma.$transaction(async (tx) => {
      const unit = await tx.department.findUnique({
        where: {
          id: body.unitId,
        },
      });
      if (!unit) throw new NotFoundError("UNIT NOT FOUND!");
      const slots = await tx.position.findFirst({
        where: {
          name: { contains: title, mode: "insensitive" },
        },
      });
      let craetedPosition;
      let createdUnitPos;
      if (!slots) {
        craetedPosition = await tx.position.create({
          data: {
            name: title,
            plantilla: plantilla,
            description: description,
            lineId: lineId,
            PositionSlot: {
              createMany: {
                data: slot.map((item) => ({
                  salaryGradeId: item.salaryGrade,
                  occupied: item.status,
                })),
              },
            },
          },
        });

        createdUnitPos = await tx.unitPosition.create({
          data: {
            positionId: craetedPosition.id,
            departmentId: body.unitId,
            lineId: body.lineId,
            designation: body.designation,
            itemNumber: body.itemNumber,
            slot: {
              createMany: {
                data: body.slot.map((item) => ({
                  salaryGradeId: item.salaryGrade,
                  occupied: item.status,
                })),
              },
            },
            plantilla: body.plantilla,
            fixToUnit: body.exclusive,
          },
        });
      } else {
        createdUnitPos = await tx.unitPosition.create({
          data: {
            positionId: slots.id,
            departmentId: body.unitId,
            lineId: body.lineId,
            designation: body.designation,
            itemNumber: body.itemNumber,
            slot: {
              createMany: {
                data: body.slot.map((item) => ({
                  salaryGradeId: item.salaryGrade,
                  occupied: item.status,
                })),
              },
            },
            plantilla: body.plantilla,
            fixToUnit: body.exclusive,
          },
        });
      }
      // const checkedUnitPos = await tx.unitPosition.findFirst({
      //   where: {
      //     positionId: slots
      //   }
      // })

      await tx.humanResourcesLogs.create({
        data: {
          tab: 7,
          lineId: lineId,
          action: "Added",
          userId: userId,
          desc: `Added new position: ${craetedPosition?.name || "N/A"} (${
            craetedPosition?.id
          }) to Unit ${unit.name} on Line ${body.lineId}. Created ${
            body.slot.length
          } position slot(s) with item number: ${body.itemNumber || "N/A"}.`,
        },
      });

      return "OK";
    });
    if (response !== "OK")
      throw new AppError("SOMETHING_WENT_WRONG", 500, "DB_ERROR");
    return res.code(200).send({ message: "OK" });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
    }
    throw error;
  }
};

export const createNewUnitPosition = async (
  req: FastifyRequest,
  res: FastifyReply
) => {
  const body = req.body as AddPositionProps;

  if (!body.id) throw new ValidationError("BAD_REQUEST");
  try {
    const optional: any = {};
    if (body.itemNumber) {
      optional.itemNumber = {
        contains: body.itemNumber,
        mode: "insensitive",
      };
    }
    if (body.designation) {
      optional.designation = {
        contains: body.designation,
        mode: "insensitive",
      };
    }
    const response = await prisma.$transaction(async (tx) => {
      const position = await tx.position.findUnique({
        where: {
          id: body.id,
        },
      });
      const unit = await tx.department.findUnique({
        where: {
          id: body.unitId,
        },
      });
      if (!unit) throw new NotFoundError("UNIT NOT FOUND!");
      if (!position) throw new NotFoundError("POSITION NOT FOUND!");
      const unitPos = await tx.unitPosition.findFirst({
        where: {
          departmentId: body.unitId,
          positionId: position.id,
          ...optional,
        },
      });
      if (unitPos) throw new ValidationError("ALREADY EXIST");
      await tx.unitPosition.create({
        data: {
          positionId: position.id,
          departmentId: body.unitId,
          lineId: body.lineId,
          designation: body.designation,
          itemNumber: body.itemNumber,
          slot: {
            createMany: {
              data: body.slot.map((item) => ({
                salaryGradeId: item.salaryGrade,
                occupied: item.status,
              })),
            },
          },
          plantilla: body.plantilla,
        },
      });
      await tx.humanResourcesLogs.create({
        data: {
          tab: 7,
          lineId: body.lineId,
          action: "Added",
          userId: body.userId,
          desc: `Added new position: ${position.name} (${
            position.id
          }) to Unit ${unit.name} on Line ${body.lineId}. Created ${
            body.slot.length
          } position slot(s) with item number: ${body.itemNumber || "N/A"}.`,
        },
      });
      return "OK";
    });
    if (response !== "OK")
      throw new AppError("SOMETHING_WENT_WRONG", 500, "DB_ERROR");
    return res.code(200).send({ message: "OK" });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
    }
    throw error;
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
    return { message: "Internal Server Error" };
  }
};

export const positionSelectionList = async (
  req: FastifyRequest,
  res: FastifyReply
) => {
  const params = req.query as PagingProps;
  console.log({ params });

  if (!params.id) throw new ValidationError("BAD_REQUEST");
  try {
    const cursor = params.lastCursor ? { id: params.lastCursor } : undefined;
    const limit = params.limit ? parseInt(params.limit, 10) : 10;
    const response = await prisma.unitPosition.findMany({
      where: {
        lineId: params.id,
      },
      cursor,
      take: limit,
      skip: cursor ? 1 : 0,
      include: {
        unit: {
          select: {
            name: true,
            id: true,
          },
        },
        position: {
          select: {
            name: true,
            id: true,
          },
        },
        _count: {
          select: {
            slot: {
              where: {
                occupied: false,
              },
            },
          },
        },
      },
    });

    const newLastCursor =
      response.length > 0 ? response[response.length - 1].id : null;

    const hasMore = response.length === 10;

    return res
      .code(200)
      .send({ list: response, lastCursor: newLastCursor, hasMore });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
    }
    throw error;
  }
};

export const positionData = async (req: FastifyRequest, res: FastifyReply) => {
  const params = req.query as { id: string };
  console.log(params);

  if (!params.id) throw new ValidationError("BAD_REQUEST");
  try {
    const response = await prisma.jobPost.findUnique({
      where: {
        id: params.id,
      },
      include: {
        position: {
          select: {
            name: true,
            id: true,
          },
        },
      },
    });

    if (!response) throw new NotFoundError("POSITION NOT FOUND!");

    return res.code(200).send(response);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
    }
    throw error;
  }
};

export const linePositions = async (req: FastifyRequest, res: FastifyReply) => {
  const params = req.query as PagingProps;
  console.log(params);

  if (!params.id) throw new ValidationError("BAD_REQUEST");
  try {
    const cursor = params.lastCursor ? { id: params.id } : undefined;
    const limit = params.limit ? parseInt(params.limit, 10) : 20;
    const filter: any = {
      lineId: params.id,
    };
    if (params.query) {
      filter.name = {
        contains: params.query,
        mode: "insensitive",
      };
    }
    const response = await prisma.position.findMany({
      where: {
        ...filter,
      },
      skip: cursor ? 1 : 0,
      take: limit,
      orderBy: {
        name: "desc",
      },
      include: {
        PositionSlot: {
          select: {
            id: true,
            salaryGrade: {
              select: {
                grade: true,
              },
            },
          },
        },
      },
    });

    console.log({ response });

    const newLastCursorId =
      response.length > 0 ? response[response.length - 1].id : null;
    const hasMore = response.length === limit;

    return res
      .code(200)
      .send({ list: response, hasMore, lastCursor: newLastCursorId });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
    }
    throw error;
  }
};

export const publicJobPost = async (req: FastifyRequest, res: FastifyReply) => {
  const params = req.query as { id: string };
  console.log({ params });

  if (!params.id) throw new ValidationError("INVALID REQUIRED ID");
  try {
    const response = await prisma.jobPost.findUnique({
      where: {
        id: params.id,
      },
      include: {
        position: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    if (!response) throw new NotFoundError("JOB POST NOT FOUND!");
    return res.code(200).send(response);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
    }
    throw error;
  }
};
