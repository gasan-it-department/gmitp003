import { FastifyReply, FastifyRequest } from "../barrel/fastify";
import { prisma, Line, Prisma } from "../barrel/prisma";
import { AppError, NotFoundError, ValidationError } from "../errors/errors";
import { LineUserRegister, PagingProps } from "../models/route";
import { lineStatus, sendEmail } from "../middleware/handler";
import { getAreaData } from "../middleware/handler";
import argon from "argon2";
import { EncryptionService } from "../service/encryption";
import { tempURL } from "../service/url";
import cloudinary from "../class/Cloundinary";
import fs from "fs";
import path from "path";

const temp_url = process.env.VITE_LOCAL_FRONTEND_URL;

export const createLine = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const body = req.body as Line;
    const fronURL = tempURL();

    if (!fronURL) {
      throw new ValidationError("INVALID CLIENT URL");
    }

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
              id: true,
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

      const link = await tx.lineInvitation.create({
        data: {
          lineId: newLine.id,
          positionSlotId: position.unitPositions[0].slot[0].id,
          email: body.email,
          unitPositionId: position.unitPositions[0].id,
        },
      });

      return {
        newLine,
        position,
        sgId: sg[0].id,
        invitationId: link.id,
        unitPosId: position.unitPositions[0].slot[0].id,
      };
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
   ${fronURL}line/register/user/${response.newLine.id}/${response.invitationId}/${response.unitPosId}/${response.sgId}

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
  console.log({ body });

  if (
    !body.teleNumber ||
    !body.email ||
    !body.username ||
    !body.lineId ||
    !body.password ||
    !body.unitPosId ||
    !body.lineInvitationId
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
      const invitation = await tx.lineInvitation.findUnique({
        where: {
          id: body.lineInvitationId,
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
      if (!invitation) {
        throw new NotFoundError("INVITATION NOT FOUND");
      }
      const application = await tx.submittedApplication.findUnique({
        where: {
          id: invitation.submittedApplicationId as string,
        },
      });

      if (!application) {
        throw new NotFoundError("APPLICATION NOT FOUND");
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
        },
      });
      await tx.submittedApplication.update({
        where: {
          id: application.id,
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
    console.log(error);

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

export const checkLineInvitation = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const params = req.query as { lineInvitationId: string };
  console.log({ params });

  if (!params.lineInvitationId) {
    throw new ValidationError("INVALID REQUIRED ID");
  }

  try {
    const response = await prisma.lineInvitation.findUnique({
      where: {
        id: params.lineInvitationId,
      },
      include: {
        unitPosition: {
          select: {
            position: {
              select: {
                name: true,
              },
            },
          },
        },
      },
    });
    console.log(JSON.stringify(response, null, 2));

    if (!response) {
      throw new NotFoundError("INVITATION LINK NOT FOUND");
    }

    return res.status(200).send(response);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
    }
    throw error;
  }
};

export const userDataRegister = async (
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

    const inviteLink = await prisma.lineInvitation.findUnique({
      where: {
        id: formData.lineInvitationId,
      },
      select: {
        positionSlotId: true,
        id: true,
        unitPositionId: true,
        lineId: true,
        line: {
          select: {
            hrmo: {
              select: {
                id: true,
              },
            },
          },
        },
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

      await tx.lineInvitation.update({
        where: {
          id: inviteLink.id,
        },
        data: {
          status: 1,
          submittedApplicationId: application.id,
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
