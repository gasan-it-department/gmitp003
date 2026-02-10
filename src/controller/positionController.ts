import { FastifyRequest, FastifyReply } from "../barrel/fastify";
import { Prisma, prisma } from "../barrel/prisma";
import {
  PagingProps,
  AddPositionProps,
  LineUserRegister,
} from "../models/route";
import { AppError, NotFoundError, ValidationError } from "../errors/errors";
import argon from "argon2";
import { getAreaData, sendEmail } from "../middleware/handler";
import { EncryptionService } from "../service/encryption";
import { semaphoreKey } from "../class/Semaphore";
import cloudinary from "../class/Cloundinary";

import fs from "fs";
import path from "path";

const frontEnd = process.env.VITE_LOCAL_FRONTEND_URL;
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
  res: FastifyReply,
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
  res: FastifyReply,
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
  res: FastifyReply,
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
  res: FastifyReply,
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
  res: FastifyReply,
) => {
  const params = req.query as PagingProps;
  console.log({ params });

  if (!params.id) throw new ValidationError("BAD_REQUEST");
  try {
    const filter: any = { lineId: params.id };

    if (params.query) {
      filter.position = {
        name: {
          contains: params.query,
          mode: "insensitive",
        },
      };
    }
    const cursor = params.lastCursor ? { id: params.lastCursor } : undefined;
    const limit = params.limit ? parseInt(params.limit, 10) : 10;
    const response = await prisma.unitPosition.findMany({
      where: filter,
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

export const fillPositionInvite = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const body = req.body as {
    email: string;
    message: string;
    lineId: string;
    unitPositionId: string;
    userId: string;
    slotId: string;
  };
  console.log({ body });

  if (!body.email || !body.lineId || !frontEnd) {
    throw new ValidationError("INVALID REQUIRED FIELDS");
  }
  try {
    const response = await prisma.$transaction(async (tx) => {
      const line = await tx.line.findUnique({
        where: {
          id: body.lineId,
        },
      });
      const position = await tx.unitPosition.findUnique({
        where: {
          id: body.unitPositionId,
        },
        select: {
          id: true,
          position: {
            select: {
              name: true,
            },
          },
        },
      });

      if (!line || !position) throw new ValidationError("INVALID LINE");

      const [municipal, province] = await Promise.all([
        getAreaData(line.municipalId, 1),
        getAreaData(line.provinceId, 0),
      ]);

      if (!municipal || !province) {
        throw new ValidationError("INVALID AREA DATA");
      }
      const optional: any = {};

      if (body.message) {
        optional.message = body.message;
      }
      const link = await tx.fillPositionInvitation.create({
        data: {
          email: body.email,
          lineId: body.lineId,
          unitPositionId: body.unitPositionId,
          positionSlotId: body.slotId,
        },
      });

      await tx.humanResourcesLogs.create({
        data: {
          action: "ADD",
          desc: `FILL POSITION (Invite -> email: ${body.email})`,
          lineId: body.lineId,
          userId: body.userId,
        },
      });

      await sendEmail(
        `Registration Invitation for ${municipal.name} Portal Position: ${position.position.name}`,
        body.email,
        `
  Good day,

  You are invited to register and create an account on the Gasan Portal.

  Please click the link below to proceed with your registration:
  ${frontEnd}position/register/${link.id}

  Best regards,
  Human Resource Management Office (HRMO)
  ${municipal.name}, ${province.name}
  `,
        "",
      );
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

export const positionCheckInvitation = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const body = req.query as { id: string };

  if (!body.id) {
    throw new ValidationError("INVALID REQUIRED ID");
  }

  try {
    const response = await prisma.fillPositionInvitation.findUnique({
      where: {
        id: body.id,
      },
      include: {
        unitPoistion: {
          select: {
            id: true,
            position: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
      },
    });

    if (!response) {
      throw new NotFoundError("LINK NOT FOUND");
    }

    const invitationDate = new Date(response.timestamp);
    const currentDate = new Date();

    // Calculate the difference in days
    const timeDifference = currentDate.getTime() - invitationDate.getTime();
    const daysDifference = timeDifference / (1000 * 3600 * 24);

    // Check if 3 or more days have passed
    if (daysDifference >= 3) {
      throw new ValidationError("INVITATION LINK HAS EXPIRED");
    }

    return res.code(200).send(response);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
    }
    throw error;
  }
};

export const positionRegister = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const body = req.body as LineUserRegister;
  console.log({ body });

  if (
    !body.lineId ||
    !body.password ||
    !body.username ||
    !body.slotId ||
    !body.applicationId ||
    !body.linkId
  ) {
    throw new ValidationError("INVALID REQUIRED DATA");
  }

  try {
    const response = await prisma.$transaction(async (tx) => {
      const slot = await tx.positionSlot.findUnique({
        where: {
          id: body.slotId,
        },
        select: {
          id: true,
          positionId: true,
          unitPosition: {
            select: {
              departmentId: true,
              position: {
                select: {
                  name: true,
                },
              },
            },
          },
          occupied: true,
          userId: true,
        },
      });
      console.log({ slot });

      const application = await tx.submittedApplication.findUnique({
        where: {
          id: body.applicationId,
        },
      });

      if (!slot) {
        throw new ValidationError("SLOT NOT FOUND");
      }
      if (slot.userId) {
        throw new ValidationError("ALREADY OCCUPIED");
      }

      if (!application) {
        throw new ValidationError("APPLICATION NOT FOUND");
      }
      const hashedPassword = await argon.hash(body.password);

      const account = await tx.account.create({
        data: {
          username: body.username,
          password: hashedPassword,
          lineId: body.lineId,
        },
      });

      const user = await tx.user.create({
        data: {
          firstName: application.firstname,
          lastName: application.lastname,
          username: account.username,
          accountId: account.id,
          email: application.email,
          emailIv: application.emailIv,
          lineId: body.lineId,
          positionId: slot.positionId,
          departmentId: slot.unitPosition?.departmentId,
          phoneNumber: application.mobileNo,
          phoneNumberIv: application.ivMobileNo,
        },
      });

      await tx.submittedApplication.update({
        where: {
          id: body.applicationId,
        },
        data: {
          userId: user.id,
        },
      });

      await tx.positionSlot.update({
        where: {
          id: slot.id,
        },
        data: {
          userId: user.id,
          salaryGradeId: body.sgId,
          occupied: true,
        },
      });
      await tx.notification.create({
        data: {
          recipientId: user.id,
          title: "Welcome to the Portal!",
          content: `Welcome ${body.firstname} ${body.lastname}! You have been successfully registered as the ${slot.unitPosition?.position.name || "Unknown"}. Your username is: ${body.username}. You now have full access to the Human Resources module.`,
          senderId: user.id,
        },
      });
      return true;
    });

    if (!response) {
      throw new ValidationError("TRANSACTION FAILED");
    }

    return res.code(200).send({ message: "OK" });
  } catch (error) {
    console.log(error);

    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
    }
    throw error;
  }
};

export const vacentPosition = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const body = req.body as {
    slotId: string;
    userId: string;
    lineId: string;
    slotUserId: string;
  };

  if (!body.lineId || !body.slotId || !body.userId) {
    throw new ValidationError("INVALID REQUIRED ID");
  }
  try {
    const response = await prisma.$transaction(async (tx) => {
      const slot = await tx.positionSlot.update({
        where: {
          id: body.slotId,
        },
        data: {
          occupied: false,
          userId: null,
        },
        include: {
          pos: {
            select: {
              name: true,
            },
          },
        },
      });

      const user = await tx.user.update({
        where: {
          id: body.slotUserId,
        },
        data: {
          departmentId: null,
          positionId: null,
          salaryGradeId: null,
        },
      });

      await tx.humanResourcesLogs.create({
        data: {
          userId: body.userId,
          action: "UPDATE",
          desc: `UPDATE POSITION SLOT: Vacant ${slot.pos?.name}'s position slot'`,
          lineId: body.lineId,
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

export const submitApplication = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  if (!req.isMultipart()) throw new Error("NOT MULTI PARTS");

  try {
    const parts = req.parts();
    const formData: any = {};
    const files: any[] = [];
    const uploads: Promise<any>[] = [];
    let profilePicture: any = null;

    for await (const part of parts) {
      if (part.type === "file") {
        const buffers = [];
        for await (const chunk of part.file) buffers.push(chunk);

        files.push({
          fieldname: part.fieldname,
          filename: part.filename,
          mimetype: part.mimetype,
          buffer: Buffer.concat(buffers),
        });
      } else {
        formData[part.fieldname] = part.value;
      }
    }

    const inviteLink = await prisma.fillPositionInvitation.findUnique({
      where: {
        id: formData.positionInviteLinkId,
      },
      select: {
        positionSlotId: true,
        id: true,
        unitPositionId: true,
        lineId: true,
      },
    });

    if (!inviteLink) {
      throw new NotFoundError("JOB POST NOT FOUND");
    }

    console.log({ inviteLink });
    const tmpDir = path.join(process.cwd(), "tmp_uploads");
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

    for (const f of files) {
      const safe = f.filename.replace(/[^\w.-]/g, "_");
      const tmpPath = path.join(tmpDir, safe);
      fs.writeFileSync(tmpPath, f.buffer);

      if (f.fieldname === "profilePicture") {
        const profile = await cloudinary.uploader.upload(tmpPath, {
          folder: "job_requirements_assets",
          resource_type: "auto",
          use_filename: true,
          unique_filename: true,
        });

        fs.unlinkSync(tmpPath);

        profilePicture = await prisma.applicationProfilePic.create({
          data: {
            file_name: f.filename,
            file_url: profile.url,
            file_url_Iv: profile.public_id,
            file_size: profile.bytes.toString(),
            file_type: 1,
          },
        });
      } else {
        uploads.push(
          cloudinary.uploader
            .upload(tmpPath, {
              folder: "job_requirements_assets",
              resource_type: "auto",
              use_filename: true,
              unique_filename: true,
            })
            .then((r) => {
              fs.unlinkSync(tmpPath); // Delete temp file after upload
              return { ...r, originalName: f.filename, fieldname: f.fieldname };
            }),
        );
      }
    }
    const uploaded = await Promise.all(uploads);

    function normalizeForm(formData: any) {
      const parseArrayField = (fieldName: string, defaultValue: any = []) => {
        if (!formData[fieldName]) return defaultValue;
        try {
          const parsed = JSON.parse(formData[fieldName]);
          return Array.isArray(parsed) ? parsed : defaultValue;
        } catch (e) {
          console.warn(`Failed to parse ${fieldName}:`, e);
          return defaultValue;
        }
      };

      const parseObjectField = (fieldName: string, defaultValue: any = {}) => {
        if (!formData[fieldName]) return defaultValue;
        try {
          const parsed = JSON.parse(formData[fieldName]);
          return typeof parsed === "object" && parsed !== null
            ? parsed
            : defaultValue;
        } catch (e) {
          console.warn(`Failed to parse ${fieldName}:`, e);
          return defaultValue;
        }
      };

      return {
        // personal
        firstName: formData.firstName,
        lastName: formData.lastName,
        middleName: formData.middleName || "N/A",
        birthDate: formData.birthDate,
        email: formData.email,
        civilStatus: formData.civilStatus,

        bloodType: formData.bloodType,
        height: formData.height,
        weight: formData.weight,

        umidNo: formData.umidNo,
        pagIbigNo: formData.pagIbigNo,
        philHealthNo: formData.philHealthNo,
        philSys: formData.philSys,
        tinNo: formData.tinNo,
        agencyNo: formData.agencyNo,
        // citizenship
        citizenship: formData["citizenship[citizenship]"],
        dualCitizen: formData["citizenship[by]"],
        country: formData["citizenship[country]"],

        // residential
        resProvince: formData["residentialAddress[province]"],
        resCity: formData["residentialAddress[cityMunicipality]"],
        resBarangay: formData["residentialAddress[barangay]"],
        resZipCode: formData["residentialAddress[zipCode]"],

        // permanent
        permaProvince: formData["permanentAddress[province]"],
        permaCity: formData["permanentAddress[cityMunicipality]"],
        permaBarangay: formData["permanentAddress[barangay]"],
        permaZipCode: formData["permanentAddress[zipCode]"],

        // contact
        mobileNo: formData.mobileNo,
        telephoneNumber: formData.telephoneNumber,

        // parents
        fatherSurname: formData["father[surname]"] || "N/A",
        fatherFirstname: formData["father[firstname]"] || "N/A",
        fatherAge: parseInt(formData["father[age]"] ?? "0"),

        motherSurname: formData["mother[surname]"] || "N/A",
        motherFirstname: formData["mother[firstname]"] || "N/A",
        motherAge: parseInt(formData["mother[age]"] ?? "0"),

        //education - ensure all fields have proper fallbacks
        elementary: {
          to: formData["elementary[to]"] || "N/A",
          from: formData["elementary[from]"] || "N/A",
          name: formData["elementary[name]"] || "N/A",
          course: formData["elementary[course]"] || "N/A",
          highestAttained: formData["elementary[highestAttained]"] || "N/A",
          yearGraduate: formData["elementary[yearGraduate]"] || "N/A",
          records: formData["elementary[records]"] || "N/A",
        },
        secondary: {
          to: formData["secondary[to]"] || "N/A",
          from: formData["secondary[from]"] || "N/A",
          name: formData["secondary[name]"] || "N/A",
          course: formData["secondary[course]"] || "N/A",
          highestAttained: formData["secondary[highestAttained]"] || "N/A",
          yearGraduate: formData["secondary[yearGraduate]"] || "N/A",
          records: formData["secondary[records]"] || "N/A",
        },
        vocational: {
          to: formData["vocational[to]"] || "N/A",
          from: formData["vocational[from]"] || "N/A",
          name: formData["vocational[name]"] || "N/A",
          course: formData["vocational[course]"] || "N/A",
          highestAttained: formData["vocational[highestAttained]"] || "N/A",
          yearGraduate: formData["vocational[yearGraduate]"] || "N/A",
          records: formData["vocational[records]"] || "N/A",
        },
        college: {
          to: formData["college[to]"] || "N/A",
          from: formData["college[from]"] || "N/A",
          name: formData["college[name]"] || "N/A",
          course: formData["college[course]"] || "N/A",
          highestAttained: formData["college[highestAttained]"] || "N/A",
          yearGraduate: formData["college[yearGraduate]"] || "N/A",
          records: formData["college[records]"] || "N/A",
        },
        graduateCollege: {
          to: formData["graduateCollege[to]"] || "N/A",
          from: formData["graduateCollege[from]"] || "N/A",
          name: formData["graduateCollege[name]"] || "N/A",
          course: formData["graduateCollege[course]"] || "N/A",
          highestAttained:
            formData["graduateCollege[highestAttained]"] || "N/A",
          yearGraduate: formData["graduateCollege[yearGraduate]"] || "N/A",
          records: formData["graduateCollege[records]"] || "N/A",
        },

        // arrays - use helper function for safe parsing
        children: parseArrayField("children", []),
        civiService: parseArrayField("civiService", []),
        experience: parseArrayField("experience", []),
        tags: parseArrayField("tags", []),

        // gov ID - use object parser
        govId: parseObjectField("govId", { type: "", number: "" }),

        // job
        municipalId: formData.municipalId,
        positionId: formData.positionId,

        // other fields from form
        gender: formData.gender,
        suffix: formData.suffix,
      };
    }

    const clean = normalizeForm(formData);
    console.log("Normalized form data:", JSON.stringify(clean, null, 2));

    // -----------------------------------------
    // 3. Encrypt EVERYTHING BEFORE TX
    // -----------------------------------------
    const fieldsToEncrypt: Record<string, any> = {
      firstName: clean.firstName,
      lastName: clean.lastName,
      email: clean.email,
      civilStatus: clean.civilStatus,
      mobileNo: clean.mobileNo,

      resProvince: clean.resProvince,
      resCity: clean.resCity,
      resBarangay: clean.resBarangay,
      resZipCode: clean.resZipCode,

      permaProvince: clean.permaProvince,
      permaCity: clean.permaCity,
      permaBarangay: clean.permaBarangay,
      permaZipCode: clean.permaZipCode,

      fatherSurname: clean.fatherSurname,
      fatherFirstname: clean.fatherFirstname,
      motherSurname: clean.motherSurname,
      motherFirstname: clean.motherFirstname,

      birthDate: clean.birthDate,

      umidNo: clean.umidNo,
      pagIbigNo: clean.pagIbigNo,
      philHealthNo: clean.philHealthNo,
      philSys: clean.philSys,
      tinNo: clean.tinNo,
      agencyNo: clean.agencyNo,
    };

    const encrypted: Record<string, any> = {};
    const encPromises = [];

    for (const key in fieldsToEncrypt) {
      if (fieldsToEncrypt[key] === undefined || fieldsToEncrypt[key] === null)
        continue;

      encPromises.push(
        EncryptionService.encrypt(String(fieldsToEncrypt[key])).then((r) => {
          encrypted[key] = r;
        }),
      );
    }

    await Promise.all(encPromises);

    console.log({ encrypted });

    const result = await prisma.$transaction(async (tx) => {
      // Handle missing parent age fields safely
      const fatherAge = parseInt(formData["father[age]"] ?? "0") || 0;
      const motherAge = parseInt(formData["mother[age]"] ?? "0") || 0;

      // Check if profile picture was created
      if (!profilePicture) {
        console.warn("No profile picture found for application");
      }

      const applicationData: any = {
        // PERSONAL INFO
        firstname: formData.firstName,
        firsntameIv: "",
        lastnameIv: "",
        lastname: formData.lastName,
        middleName: formData.middleName || "N/A",
        email: encrypted.email?.encryptedData || "",
        emailIv: encrypted.email?.iv || "",
        cvilStatus: encrypted.civilStatus?.encryptedData || "",
        cvilStatusIv: encrypted.civilStatus?.iv || "",

        birthDate: encrypted.birthDate?.encryptedData || "",
        bdayIv: encrypted.birthDate?.iv || "",

        gender: formData.gender || "male",
        filipino: clean.citizenship === "filipino",
        dualCitizen: clean.citizenship === "dual",
        byBirth: false,
        byNatural: false,

        // REQUIRED → NO ENCRYPTION
        dualCitizenHalf: clean.country || "N/A",

        // RESIDENTIAL ADDRESS
        resProvince: encrypted.resProvince?.encryptedData || "",
        resProvinceIv: encrypted.resProvince?.iv || "",
        resCity: encrypted.resCity?.encryptedData || "",
        resCityIv: encrypted.resCity?.iv || "",
        resBarangay: encrypted.resBarangay?.encryptedData || "",
        resBarangayIv: encrypted.resBarangay?.iv || "",
        resZipCode: clean.resZipCode || "",
        resZipCodeIv: null,

        // PERMANENT ADDRESS
        permaProvince: encrypted.permaProvince?.encryptedData || "",
        permaProvinceIv: encrypted.permaProvince?.iv || "",
        permaCity: encrypted.permaCity?.encryptedData || "",
        permaCityIv: encrypted.permaCity?.iv || "",
        permaBarangay: encrypted.permaBarangay?.encryptedData || "",
        permaBarangayIv: encrypted.permaBarangay?.iv || "",
        permaZipCode: clean.permaZipCode || "",
        permaZipCodeIv: null,

        // CONTACTS
        mobileNo: encrypted.mobileNo?.encryptedData || "",
        ivMobileNo: encrypted.mobileNo?.iv || "",
        teleNo: formData.telephoneNumber || "",

        // PHYSICAL INFO
        height: parseFloat(formData.height) || 0,
        weight: parseFloat(formData.weight) || 0,
        bloodType: formData.bloodType || "N/A",

        // PARENTS — REQUIRED FIELDS
        fatherSurname: encrypted.fatherSurname?.encryptedData || "N/A",
        fatherSurnameIv: encrypted.fatherSurname?.iv || null,
        fatherFirstname: encrypted.fatherFirstname?.encryptedData || "N/A",
        fatherFirstnameIv: encrypted.fatherFirstname?.iv || null,
        fatherAge: fatherAge,

        motherSurname: encrypted.motherSurname?.encryptedData || "N/A",
        motherSurnameIv: encrypted.motherSurname?.iv || null,
        motherFirstname: encrypted.motherFirstname?.encryptedData || "N/A",
        motherFirstnameIv: encrypted.motherFirstname?.iv || null,
        motherAge: motherAge,

        // EDUCATION - These are Json fields (pass objects directly)
        elementary: clean.elementary,
        secondary: clean.secondary,
        vocational: clean.vocational,
        college: clean.college,
        graduateCollege: clean.graduateCollege,

        // CHILDREN - This is a String field (must be stringified)
        children: JSON.stringify(clean.children),

        // CIVIL SERVICE AND EXPERIENCE - These are Json[] fields (pass arrays directly)
        civilService: clean.civiService,
        experience: clean.experience,

        // GOV ID - This is a Json field (pass object directly)
        govId: clean.govId,
        umidNo: encrypted.umidNo?.encryptedData || "N/A",
        umidNoIv: encrypted.umidNo?.iv || null,
        pagIbigNo: encrypted.pagIbigNo?.encryptedData || "N/A",
        pagIbigNoIv: encrypted.pagIbigNo?.iv || null,
        philHealthNo: encrypted.philHealthNo?.encryptedData || "N/A",
        philHealthNoIv: encrypted.philHealthNo?.iv || null,
        philSys: encrypted.philSys?.encryptedData || "N/A",
        philSysIv: encrypted.philSys?.iv || null,
        tinNo: encrypted.tinNo?.encryptedData || "N/A",
        tinNoIv: encrypted.tinNo?.iv || null,
        agencyNo: encrypted.agencyNo?.encryptedData || "N/A",
        agencyNoIv: encrypted.agencyNo?.iv || null,

        // job linking
        lineId: inviteLink.lineId,
        positionId: formData.positionId,
        unitPositionId: inviteLink.unitPositionId,
        // REQUIRED Date
        batch: new Date(),
        status: 2,
      };

      console.log("Application Data: ", { applicationData });

      // Add profile picture relation if it exists
      if (profilePicture) {
        applicationData.applicationProfilePicId = profilePicture.id;
      }

      const application = await tx.submittedApplication.create({
        data: applicationData,
      });
      await tx.fillPositionInvitation.update({
        where: {
          id: inviteLink.id,
        },
        data: {
          step: 1,
          submittedApplicationId: application.id,
          concluded: true,
          concludedAt: new Date().toISOString(),
        },
      });

      await tx.fillPositionInvitation.update({
        data: {
          step: 1,
        },
        where: {
          id: inviteLink.id,
        },
      });

      console.log("Submitted Application: ", { application });

      // Create skill tags if they exist
      if (clean.tags && clean.tags.length > 0) {
        await tx.applicationSkillTags.createMany({
          data: clean.tags.map((item: any) => ({
            submittedApplicationId: application.id,
            tags: item.tag, // Handle both object and string formats
          })),
        });
      }

      // Create attached files if they exist
      if (uploaded.length > 0) {
        await tx.applicationAttachedFile.createMany({
          data: uploaded.map((u) => ({
            submittedApplicationId: application.id,
            file_name: u.originalName,
            file_url: u.secure_url,
            file_url_Iv: u.public_id,
            file_size: u.bytes.toString(),
            file_type: 0,
          })),
        });
      }

      return application.id;
    });

    return res.send({
      success: true,
      applicationId: result,
      filesUploaded: uploaded.length,
      profilePictureUploaded: !!profilePicture,
    });
  } catch (err) {
    console.log(err);

    return res.status(500).send({
      success: false,
      message: "Failed to submit application",
      error: err instanceof Error ? err.message : "Unknown error",
    });
  }
};
