import { FastifyReply, FastifyRequest } from "../barrel/fastify";
import { prisma, Line, Prisma } from "../barrel/prisma";
import { AppError, NotFoundError, ValidationError } from "../errors/errors";
import { LineUserRegister, PagingProps } from "../models/route";
import { lineStatus, sendEmail } from "../middleware/handler";
import { getAreaData } from "../middleware/handler";
import argon from "argon2";
import { EncryptionService } from "../service/encryption";

const temp_url = process.env.VITE_LOCAL_FRONTEND_URL;

export const createLine = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const body = req.body as Line;

    if (!body || !body.name || !body.email) {
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
    const [province, municipal, barangay, region] = await Promise.all([
      getAreaData(body.provinceId, 0),
      getAreaData(body.municipalId, 1),
      getAreaData(body.barangayId, 2),
      getAreaData(body.regionId, 3),
    ]);

    if (!province || !municipal || !barangay || !region) {
      throw new ValidationError("INVALID AREA");
    }

    const response = await prisma.$transaction(async (tx) => {
      let checkBarangay = await tx.barangay.findUnique({
        where: {
          id: barangay.code,
        },
      });

      let checkMunicipal = await tx.municipal.findUnique({
        where: {
          id: municipal.code,
        },
      });

      let checkProvince = await tx.province.findUnique({
        where: {
          id: province.code,
        },
      });

      let checkRegion = await tx.region.findUnique({
        where: {
          id: region.code,
        },
      });

      if (!checkProvince) {
        checkProvince = await tx.province.create({
          data: {
            id: province.code,
            name: province.name,
          },
        });
      }

      if (!checkMunicipal) {
        checkMunicipal = await tx.municipal.create({
          data: {
            id: municipal.code,
            name: municipal.name,
            provinceId: province.code,
          },
        });
      }
      if (!checkBarangay) {
        checkBarangay = await tx.barangay.create({
          data: {
            id: barangay.code,
            name: barangay.name,
            municipalId: municipal.code,
          },
        });
      }

      if (!checkRegion) {
        checkRegion = await tx.region.create({
          data: {
            id: region.code,
            name: region.name,
          },
        });
      }

      const newLine = await prisma.line.create({
        data: {
          name: body.name,
          barangayId: checkBarangay.id,
          municipalId: checkMunicipal.id,
          provinceId: checkProvince.id,
          regionId: checkRegion.id,
        },
      });

      const sg = await tx.salaryGrade.createManyAndReturn({
        data: Array.from({ length: 33 }).map((_, i) => {
          return {
            grade: i + 1,
            amount: 1,
            lineId: newLine.id,
          };
        }),
      });

      await tx.salaryGradeHistory.createMany({
        data: sg.map((item) => {
          return {
            amount: 1,
            userId: "",
            effectiveDate: new Date(),
            salaryGradeId: item.id,
          };
        }),
      });

      const department = await tx.department.create({
        data: {
          name: "Human Resources",
          lineId: newLine.id,
        },
      });

      const position = await tx.position.create({
        data: {
          name: "Human Resources Management Officer",
          departmentId: department.id,
          lineId: newLine.id,
          unitPositions: {
            create: {
              departmentId: department.id,
              lineId: newLine.id,
              fixToUnit: true,
              slot: {
                create: {
                  occupied: true,
                },
              },
            },
          },
        },
        include: {
          unitPositions: {
            where: {
              departmentId: department.id,
            },
            select: {
              slot: {
                where: {
                  occupied: true,
                  userId: null,
                },
              },
            },
          },
        },
      });

      return { newLine, position, sgId: sg[0].id };
    });

    if (!province || !municipal || !barangay || !temp_url || !response) {
      throw new ValidationError("TRANSACTION FAILED");
    }

    const emailContent = `New Line Registration

Hello,

Your new line "${body.name}" has been successfully registered in our system.

Line Details:
- Line Name: ${body.name}
- Location: ${barangay.name}, ${municipal.name}, ${province.name}

Next Steps to Manage Your Line:
1. Click the link below to complete your account registration:
   ${temp_url}line/register/${response.newLine.id}/${response.position.unitPositions[0].slot[0].id}/${response.sgId}

2. Once registered, you can:
   - Manage line operations
   - View reports and analytics
   - Access on Module: Human resources

If you have any questions, contact our support team.

Best regards,
Your Organization Team`;
    await sendEmail("New Line Registration", body.email, emailContent, "");
    return res.code(200).send({
      message: "Line created successfully",
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

export const getAllLine = async (req: FastifyRequest, res: FastifyReply) => {
  const params = req.query as PagingProps;
  console.log({ params });

  try {
    const cursor = params.lastCursor ? { id: params.id } : undefined;
    const limit = params.limit ? parseInt(params.limit, 10) : 20;
    const filter: any = {};

    if (params.query) {
      filter.name = {
        contains: params.query,
        mode: "insensitive",
      };
    }
    const response = await prisma.line.findMany({
      where: filter,
      skip: cursor ? 1 : 0,
      take: limit,
      orderBy: {
        createdAt: "desc",
      },
      cursor,
      include: {
        _count: {
          select: {
            User: true,
          },
        },
      },
    });
    console.log(response);

    const newLastCursor =
      response.length > 0 ? response[response.length - 1].id : null;
    const hasMore = limit === response.length;

    return res
      .code(200)
      .send({ list: response, hasMore, lastCursor: newLastCursor });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
    }
    throw error;
  }
};

export const newLineRegister = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const body = req.body as { lineId: string; module: string };
  try {
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DB_CONNECTION_ERROR", 500, "DB_FAILED");
    }
    throw error;
  }
};

export const lineUpdateStatus = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const body = req.body as { id: string; status: number; userId: string };
  console.log(body);

  if (!body.id || body.status > 2) {
    throw new ValidationError("INVALID REQUEST");
  }
  try {
    const response = await prisma.$transaction(async (tx) => {
      const line = await tx.line.update({
        where: {
          id: body.id,
        },
        data: {
          status: body.status,
        },
      });

      await tx.adminLogs.create({
        data: {
          adminId: body.userId,
          action: 0,
          desc: `UPDATE LINE STATUS - ${line.name}: -> ${lineStatus[body.status]}`,
        },
      });

      return line;
    });

    if (!response) {
      throw new ValidationError("TRANSACTION FAILED");
    }
    return res.code(200).send({ message: "OK" });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
    }
    throw error;
  }
};

export const deleteLine = async (req: FastifyRequest, res: FastifyReply) => {
  const body = req.query as { id: string; userId: string };

  if (!body.id || !body.userId) {
    throw new ValidationError("INVALID REQUEST");
  }
  try {
    const response = await prisma.$transaction(async (tx) => {
      const user = await tx.admin.findUnique({
        where: {
          id: body.userId,
        },
      });

      if (!user) {
        throw new ValidationError("INVALID USER");
      }

      const line = await tx.line.delete({
        where: {
          id: body.id,
        },
      });

      await tx.adminLogs.create({
        data: {
          adminId: user.id,
          action: 2,
          desc: `REMOVED LINE: ${line.name}`,
        },
      });
      return true;
    });

    if (!response) {
      throw new ValidationError("TRANSACTION FAILED");
    }

    return res.code(200).send({ message: "OK" });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
    }
    throw error;
  }
};

export const registerLine = async (req: FastifyRequest, res: FastifyReply) => {
  const body = req.body as LineUserRegister;

  if (
    !body.firstname ||
    !body.lastname ||
    !body.teleNumber ||
    !body.email ||
    !body.username ||
    !body.lineId ||
    !body.password ||
    !body.unitPosId
  ) {
    throw new ValidationError("INVALID REQUIRED FIELD");
  }

  try {
    const response = await prisma.$transaction(async (tx) => {
      const existedUser = await tx.account.findFirst({
        where: {
          username: {
            contains: body.username,
            mode: "insensitive",
          },
        },
      });

      const slot = await tx.positionSlot.findUnique({
        where: {
          id: body.unitPosId,
        },
        include: {
          unitPosition: {
            select: {
              departmentId: true,
            },
          },
        },
      });

      if (!slot) {
        throw new NotFoundError("POSITION SLOT NOT FOUND");
      }
      if (existedUser) {
        return {
          error: 1,
          message: "Username already exist.",
        };
      }
      const hashed = await argon.hash(body.password);
      const account = await tx.account.create({
        data: {
          username: body.username,
          password: hashed,
          lineId: body.lineId,
        },
      });
      const optional: any = {};
      const [personalEmail, personalNumber] = await Promise.all([
        EncryptionService.encrypt(body.personalEmail),
        body.personalPhoneNumber
          ? EncryptionService.encrypt(body.personalPhoneNumber)
          : undefined,
      ]);

      if (personalNumber) {
        optional.phoneNumber = personalNumber.encryptedData;
        optional.phoneNumberIv = personalNumber.iv;
      }

      const user = await tx.user.create({
        data: {
          firstName: body.firstname,
          lastName: body.lastname,
          username: account.username,
          accountId: account.id,
          email: personalEmail.encryptedData,
          emailIv: personalEmail.iv,
          lineId: body.lineId,
          positionId: slot.positionId,
          departmentId: slot.unitPosition?.departmentId,
          ...optional,
        },
      });
      await tx.positionSlot.update({
        where: {
          id: slot.id,
        },
        data: {
          userId: user.id,
          salaryGradeId: body.sgId,
        },
      });
      await tx.module.create({
        data: {
          moduleName: "human-resources",
          userId: user.id,
          lineId: body.lineId,
          privilege: 1,
          moduleIndex: "1",
        },
      });
      await tx.line.update({
        where: {
          id: body.lineId,
        },
        data: {
          hrmoEmail: body.email,
          hrmoTelePhone: body.teleNumber,
          userId: user.id,
        },
      });

      await tx.notification.create({
        data: {
          recipientId: user.id,
          title: "Module Access Granted",
          content: "Module: Human resources",
          senderId: user.id,
        },
      });

      await tx.notification.create({
        data: {
          recipientId: user.id,
          title: "Welcome to the System!",
          content: `Welcome ${body.firstname} ${body.lastname}! You have been successfully registered as the HRMO Administrator. Your username is: ${body.username}. You now have full access to the Human Resources module.`,
          senderId: user.id,
        },
      });

      return {
        error: 0,
        message: "OK",
      };
    });

    return res.code(200).send(response);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
    }
    throw error;
  }
};
export const backUpInventoryLineData = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const body = req.body as { lineId: string; userId: string };

  if (!body.lineId || !body.userId) {
    throw new ValidationError("INVALID REQUIRED ID");
  }

  try {
    const response = await prisma.$transaction(async (tx) => {
      const containers = await tx.inventoryBox.findMany({
        where: {
          lineId: body.lineId,
        },
      });
      const list = await tx.supplyBatch.findMany({
        where: {
          box: {
            lineId: body.lineId,
          },
        },
      });
      const order = await tx.supplyBatchOrder.findMany({
        where: {
          lineId: body.lineId,
        },
      });

      const orderItem = await tx.supplyBatchOrder.findMany({
        where: {
          lineId: body.lineId,
        },
      });

      const supplies = await tx.supplies.findMany({
        where: {
          lineId: body.lineId,
        },
      });

      const supplier = await tx.supplier.findMany({
        where: {
          lineId: body.lineId,
        },
      });

      const recievedSupply = await tx.supplieRecieveHistory.findMany();

      const dispenseRecord = await tx.supplyDispenseRecord.findMany({
        where: {
          containerId: {
            lineId: body.lineId,
          },
        },
      });

      return {
        containers,
        list,
        order,
        orderItem,
        recievedSupply,
        dispenseRecord,
        supplies,
        supplier,
      };
    });

    // Send as JSON with proper headers
    res
      .header("Content-Type", "application/json")
      .header(
        "Content-Disposition",
        'attachment; filename="inventory-backup.json"',
      )
      .send(JSON.stringify(response, null, 2));
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
    }
    throw error;
  }
};
