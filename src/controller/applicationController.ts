import { FastifyReply, FastifyRequest } from "../barrel/fastify";
import {
  prisma,
  Prisma,
  SubmittedApplication as SubmittedApplicationProps,
} from "../barrel/prisma";
import fs from "fs";
import path from "path";
import cloudinary from "../class/Cloundinary";
import { EncryptionService } from "../service/encryption";
import { AppError, NotFoundError, ValidationError } from "../errors/errors";
import {
  PagingProps,
  PostNewJobProps,
  AddNewPostJobRequiementsProps,
  ApplicationSubmissionProps,
  ApplicationConversation,
  UpdateApplicationStatus,
} from "../models/route";
import { file } from "../route/file";
import { sendEmail } from "../middleware/handler";
import { semaphoreService } from "../class/Semaphore";

const officialUrl = process.env.VITE_LOCAL_FRONTEND_URL;

export const applications = async (req: FastifyRequest, res: FastifyReply) => {
  const params = req.query as PagingProps;

  if (!params.id) {
    throw new ValidationError("BAD_REQUEST");
  }
  try {
    const cursor = params.lastCursor ? { id: params.lastCursor } : null;
    const limit = params.limit ? parseInt(params.limit) : 20;

    const response = await prisma.application.findMany({
      where: {
        lineId: params.id,
      },
      take: limit,
      skip: cursor ? 1 : 0,
      orderBy: {
        createdAt: "desc",
      },
    });

    const newLastCursorId =
      response.length > 0 ? response[response.length - 1].id : null;
    const hasMore = limit === response.length;

    return res
      .code(200)
      .send({ list: response, hasMore, lastCursor: newLastCursorId });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DATABASE_CONNECTION_FAILED", 500, "DB_ERROR");
    }
    throw error;
  }
};

export const postJob = async (req: FastifyRequest, res: FastifyReply) => {
  const body = req.body as PostNewJobProps;

  if (!body.id || !body.lineId) throw new ValidationError("BAD_REQUEST");
  try {
    const response = await prisma.$transaction(async (tx) => {
      const position = await tx.unitPosition.findFirst({
        where: {
          id: body.id,
        },
        include: {
          position: {
            select: {
              name: true,
            },
          },
        },
      });
      if (!position) throw new NotFoundError("Position not found!");
      const check = await tx.jobPost.findFirst({
        where: {
          positionId: position.positionId,
          lineId: body.lineId,
        },
      });
      let jobPost;
      if (!check) {
        jobPost = await tx.jobPost.create({
          data: {
            positionId: position.positionId,
            hideSG: body.hideSG ? body.hideSG : false,
            slot: 1,
            status: 0,
            salaryGradeId: null,
            location: body.location ? body.location : "N/A",
            showApplicationCount: body.showApplicationCount
              ? body.showApplicationCount
              : false,
            lineId: body.lineId,
          },
        });

        await tx.humanResourcesLogs.create({
          data: {
            action: "ADDED",
            userId: body.userId,
            lineId: body.lineId,
            desc: `New job posting created: ${
              position.position.name || position.designation
            } | Location: ${body.location || "N/A"} | Hide SG: ${
              body.hideSG ? "Yes" : "No"
            } | Show App Count: ${body.showApplicationCount ? "Yes" : "No"}`,
          },
        });
      } else if (check && check.status > 0) {
        return check.id;
      } else {
        return check.id;
      }
    });
    if (!response) throw new AppError("Something went wrong", 500, "DB_ERROR");
    return res.code(200).send({ message: "OK", id: response });
  } catch (error) {
    console.log(error);

    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DATABASE_CONNECTION_FAILED", 500, "DB_ERROR");
    }
    throw error;
  }
};

export const updatePostJob = async (req: FastifyRequest, res: FastifyReply) => {
  const param = req.body as PostNewJobProps;

  if (!param.id) throw new ValidationError("INVALID REQUIRED ID");
  try {
    const response = await prisma.$transaction(async (tx) => {
      const jobPost = await tx.jobPost.findUnique({
        where: {
          id: param.id,
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
      if (!jobPost) throw new NotFoundError("JOB POST NOT FOUND");

      const optional: any = {};

      if (jobPost.desc !== param.desc) {
        optional.desc = param.desc;
      }
      await tx.jobPost.update({
        where: {
          id: jobPost.id,
        },
        data: {
          hideSG: param.hideSG,
          showApplicationCount: param.showApplicationCount,
          status: param.status,
          ...optional,
        },
      });

      await tx.humanResourcesLogs.create({
        data: {
          action: "UPDATED",
          userId: param.userId,
          lineId: param.lineId,
          desc: `New job posting created: ${
            jobPost.position.name || "N/A"
          } | Hide SG: ${param.hideSG ? "Yes" : "No"} | Show App Count: ${
            param.showApplicationCount ? "Yes" : "No"
          }`,
        },
      });
      return "OK";
    });
    if (response !== "OK") throw new AppError("DB_CONNECTION", 500, "DB_ERROR");
    return res.code(200).send({ message: "OK" });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DATABASE_CONNECTION_FAILED", 500, "DB_ERROR");
    }
    throw error;
  }
};

export const createPobJobRequirements = async (
  req: FastifyRequest,
  res: FastifyReply
) => {
  if (!req.isMultipart()) {
    console.log("Not multipart");
    return res.status(400).send({ error: "Not multipart" });
  }

  const fields: Record<string, any> = {};
  const uploadedFiles: {
    filename: string;
    url: string;
    size: number;
    publicId: string;
  }[] = [];

  try {
    await prisma.$transaction(async (tx) => {
      for await (const part of req.parts()) {
        if (part.type === "file") {
          // Read file buffer
          const buffers: Buffer[] = [];
          for await (const chunk of part.file) buffers.push(chunk);
          const buffer = Buffer.concat(buffers);

          // Save temporarily to disk
          const tmpDir = path.join(process.cwd(), "tmp_uploads");
          if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

          const safeName = part.filename.replace(/[^\w.-]/g, "_");
          const tmpPath = path.join(tmpDir, safeName);
          fs.writeFileSync(tmpPath, buffer);

          try {
            // Determine resource type based on file extension
            const fileExtension = path.extname(part.filename).toLowerCase();
            const isDocument = [
              ".pdf",
              ".doc",
              ".docx",
              ".txt",
              ".xls",
              ".xlsx",
            ].includes(fileExtension);

            // Upload to Cloudinary with proper resource type
            const result = await cloudinary.uploader.upload(tmpPath, {
              folder: "job_requirements_assets",
              resource_type: isDocument ? "raw" : "auto", // Use "raw" for documents
              type: "upload",
              use_filename: true,
              unique_filename: true,
            });

            uploadedFiles.push({
              filename: part.filename,
              url: result.secure_url,
              size: buffer.length,
              publicId: result.public_id,
            });

            console.log(`Uploaded file: ${part.filename}`);
            console.log(`Cloudinary URL: ${result.secure_url}`);
            console.log(`Resource type: ${result.resource_type}`);
          } catch (err) {
            throw new AppError(
              `Failed to upload file "${part.filename}" to Cloudinary`,
              500,
              "UPLOAD_FAILED"
            );
          } finally {
            // Always remove temp file
            if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
          }
        } else if (part.type === "field") {
          fields[part.fieldname] = part.value;
        }
      }

      // Insert requirement record
      const requirements = await tx.jobPostRequirements.create({
        data: {
          jobPostId: fields.postId,
          title: fields.title,
        },
      });

      // Insert all uploaded files
      await tx.jobPostAssets.createMany({
        data: uploadedFiles.map((item) => ({
          fileName: item.filename,
          fileSize: item.size.toString(),
          fileUrl: item.url,
          jobPostRequirementsId: requirements.id,
          fileType: path.extname(item.filename),
          filePublicId: item.publicId,
        })),
      });
    });

    return res.code(200).send({
      message: "Success",
      files: uploadedFiles, // Return uploaded files info
    });
  } catch (error) {
    return res.status(500).send({
      message: "Failed to create job requirement",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
};

export const postJobRequirements = async (
  req: FastifyRequest,
  res: FastifyReply
) => {
  const params = req.query as PagingProps;

  if (!params.id) throw new ValidationError("REQUIRED ID NOT FOUND!");
  try {
    const cursor = params.lastCursor ? { id: params.id } : undefined;
    const limit = params.limit ? parseInt(params.limit) : 20;

    const response = await prisma.jobPostRequirements.findMany({
      where: {
        jobPostId: params.id,
      },
      include: {
        asset: {
          select: {
            id: true,
            fileName: true,
            fileSize: true,
            fileUrl: true,
          },
        },
      },
      skip: cursor ? 1 : 0,
      take: limit,
      cursor,
    });

    const newLastCursorId =
      response.length > 0 ? response[response.length - 1].id : null;
    const hasMore = response.length === limit;

    return res
      .code(200)
      .send({ list: response, lastCursor: newLastCursorId, hasMore });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
    }
    throw error;
  }
};
export const updatePostJobRequiments = async (
  req: FastifyRequest,
  res: FastifyReply
) => {
  if (!req.isMultipart()) {
    return res.status(400).send({ error: "Not multipart" });
  }

  const fields: Record<string, any> = {};
  const uploadedFiles: {
    filename: string;
    url: string;
    size: number;
    publicId: string;
  }[] = [];

  try {
    await prisma.$transaction(async (tx) => {
      for await (const part of req.parts()) {
        if (part.type === "file") {
          // Read file buffer
          const buffers: Buffer[] = [];
          for await (const chunk of part.file) buffers.push(chunk);
          const buffer = Buffer.concat(buffers);

          // Save temporarily to disk
          const tmpDir = path.join(process.cwd(), "tmp_uploads");
          if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

          const safeName = part.filename.replace(/[^\w.-]/g, "_");
          const tmpPath = path.join(tmpDir, safeName);
          fs.writeFileSync(tmpPath, buffer);

          try {
            // Upload to Cloudinary
            const result = await cloudinary.uploader.upload(tmpPath, {
              folder: "job_requirements_assets",
              resource_type: "auto",
            });

            uploadedFiles.push({
              filename: part.filename,
              url: result.secure_url,
              size: buffer.length,
              publicId: result.public_id,
            });
          } catch (err) {
            throw new AppError(
              `Failed to upload file "${part.filename}" to Cloudinary`,
              500,
              "UPLOAD_FAILED"
            );
          } finally {
            // Always remove temp file
            if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
          }
        } else if (part.type === "field") {
          fields[part.fieldname] = part.value;
        }
      }

      // Insert requirement record
      const requirement = await tx.jobPostRequirements.findUnique({
        where: {
          id: fields.id,
        },
      });
      let requirements: any = {};
      if (requirement && requirement.desc !== fields.title) {
        requirements = await tx.jobPostRequirements.update({
          where: {
            id: fields.id,
          },
          data: {
            title: fields.title,
          },
        });
      }

      if (uploadedFiles.length > 0) {
        await tx.jobPostAssets.createMany({
          data: uploadedFiles.map((item) => ({
            fileName: item.filename,
            fileSize: item.size.toString(),
            fileUrl: item.url,
            jobPostRequirementsId: requirements.id,
            fileType: "",
            filePublicId: item.publicId,
          })),
        });
      }
    });

    return res.code(200).send({
      message: "Success",
    });
  } catch (error) {
    return res.status(500).send({
      message: "Failed to create job requirement",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
};
export const removePostJobRequirements = async (
  req: FastifyRequest,
  res: FastifyReply
) => {
  const params = req.query as { id: string };

  if (!params.id) throw new ValidationError("INVALID JOB POST ID");

  try {
    await prisma.jobPostRequirements.delete({
      where: {
        id: params.id,
      },
    });

    return res.code(200).send({ message: "OK" });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
    }
    throw error;
  }
};
export const postJobRequirementsRemoveAsset = async (
  req: FastifyRequest,
  res: FastifyReply
) => {
  const params = req.query as { id: string };

  if (!params.id) throw new ValidationError("INVALID REQUIRED ID");
  try {
    const response = await prisma.$transaction(async (tx) => {
      const jobPost = await tx.jobPostAssets.findUnique({
        where: {
          id: params.id,
        },
      });
      if (!jobPost) throw new NotFoundError("FILE NOT FOUND");
      await cloudinary.uploader.destroy(jobPost.filePublicId);
      await tx.jobPostAssets.delete({
        where: {
          id: jobPost.id,
        },
      });
      return "OK";
    });

    if (response !== "OK")
      throw new AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");

    return res.code(200).send({ message: "OK" });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
    }
    throw error;
  }
};

export const jobPost = async (req: FastifyRequest, res: FastifyReply) => {
  const params = req.query as PagingProps;

  if (!params.id) throw new ValidationError("INVALID ID");
  try {
    const cursor = params.lastCursor ? { id: params.lastCursor } : undefined;
    const limit = params.limit ? parseInt(params.limit, 10) : 20;

    const filter: any = {};
    if (params.query) {
      filter.position = {
        name: {
          contains: params.query,
          mode: "insensitive",
        },
      };
    }

    const response = await prisma.jobPost.findMany({
      where: {
        line: {
          municipalId: params.id,
        },
        status: 1,
        ...filter,
      },
      include: {
        position: {
          select: {
            name: true,
            id: true,
          },
        },
        requirements: {
          select: {
            id: true,
            title: true,
            asset: {
              select: {
                fileName: true,
                fileSize: true,
                fileUrl: true,
                id: true,
              },
            },
          },
        },
        salaryGrade: {
          select: {
            grade: true,
          },
        },
        _count: {
          select: {
            application: {
              where: {
                status: "pending",
              },
            },
          },
        },
      },
      skip: cursor ? 1 : 0,
      take: limit,
      orderBy: {
        timestamp: "desc",
      },
      cursor,
    });

    const newLastCursorId =
      response.length > 0 ? response[response.length - 1].id : null;
    const hasMore = limit === response.length;

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

export const submitApplication = async (
  req: FastifyRequest,
  res: FastifyReply
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
            })
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

        // physical attributes
        height: formData.height,
        weight: formData.weight,
        bloodType: formData.bloodType,

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
    };

    const encrypted: Record<string, any> = {};
    const encPromises = [];

    for (const key in fieldsToEncrypt) {
      if (fieldsToEncrypt[key] === undefined || fieldsToEncrypt[key] === null)
        continue;

      encPromises.push(
        EncryptionService.encrypt(String(fieldsToEncrypt[key])).then((r) => {
          encrypted[key] = r;
        })
      );
    }

    await Promise.all(encPromises);

    const result = await prisma.$transaction(async (tx) => {
      const municipal = await tx.municipal.findUnique({
        where: { id: formData.municipalId },
      });

      const position = await tx.position.findUnique({
        where: { id: formData.positionId },
        include: { line: true },
      });

      if (!municipal || !position) {
        throw new ValidationError("INVALID REQUIRED DATA");
      }

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

        // job linking
        lineId: position.line?.id as string,
        positionId: formData.positionId,

        // REQUIRED Date
        batch: new Date(),
      };

      // Add profile picture relation if it exists
      if (profilePicture) {
        applicationData.applicationProfilePicId = profilePicture.id;
      }

      const application = await tx.submittedApplication.create({
        data: applicationData,
      });

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

      if (formData.email) {
        await sendEmail(
          "Application Received",
          formData.email,
          `
          Dear ${formData.firstName} ${formData.lastName},
          Thank you for submitting your application for the position of ${position.name} at ${municipal.name}.
          We have received your application and our team will review it shortly. If your qualifications match our requirements, we will contact you for the next steps in the hiring process.
          We appreciate your interest in joining our team and look forward to the possibility of working together.

          You can check the status of your application, click this ${officialUrl}/public/application/${application.id} .

          Sincerely,
          The HR Team
        `,
          `${municipal.name} HR Team <no-reply@${municipal.name}.gov.ph>`
        );
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

export const applicationList = async (
  req: FastifyRequest,
  res: FastifyReply
) => {
  const params = req.query as PagingProps;

  if (!params.id) throw new ValidationError("INVALID REQUIRED ID");
  try {
    const cursor = params.lastCursor ? { id: params.lastCursor } : undefined;
    const limit = params.limit ? parseInt(params.limit, 10) : 20;

    // Build the where clause conditionally
    const whereClause: any = {
      lineId: params.id,
    };

    // Add positionId filter if provided
    if (params.positionId) {
      whereClause.positionId = params.positionId;
    }

    // Add text search filter if provided
    if (params.query) {
      whereClause.OR = [
        { firstname: { contains: params.query, mode: "insensitive" } },
        { lastname: { contains: params.query, mode: "insensitive" } },
      ];
    }

    // Add date range filter if provided - PROPERLY FIXED
    if (params.dateFrom || params.dateTo) {
      whereClause.timestamp = {};

      if (params.dateFrom && typeof params.dateFrom === "string") {
        // Start of the day for dateFrom
        const fromDate = new Date(params.dateFrom);
        fromDate.setHours(0, 0, 0, 0);
        whereClause.timestamp.gte = fromDate;
      }

      if (params.dateTo && typeof params.dateTo === "string") {
        // End of the day for dateTo
        const toDate = new Date(params.dateTo);
        toDate.setHours(23, 59, 59, 999);
        whereClause.timestamp.lte = toDate;
      }
    }

    // Normalize tags - handle both string and array cases
    const tagsParam = params["tags[]"];
    if (tagsParam) {
      // Convert to array if it's a string, otherwise use the array as-is
      const tagsArray = Array.isArray(tagsParam) ? tagsParam : [tagsParam];

      // Only add filter if we have valid tags
      if (
        tagsArray.length > 0 &&
        tagsArray.every((tag) => typeof tag === "string")
      ) {
        whereClause.ApplicationSkillTags = {
          some: {
            tags: {
              in: tagsArray,
            },
          },
        };
      }
    }
    console.log({ whereClause });

    const response = await prisma.submittedApplication.findMany({
      where: whereClause,
      take: limit,
      skip: cursor ? 1 : 0,
      orderBy: {
        timestamp: "desc",
      },
      cursor,
      select: {
        id: true,
        firstname: true,
        lastname: true,
        status: true,
        forPosition: {
          select: {
            name: true,
          },
        },
        timestamp: true,
        profilePic: {
          select: {
            file_url: true,
            file_name: true,
          },
        },
      },
    });

    const newLastCursorId =
      response.length > 0 ? response[response.length - 1].id : null;
    const hasMore = limit === response.length;

    return res.code(200).send({
      list: response,
      hasMore,
      lastCursor: newLastCursorId,
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DB_CONNECTION_ERROR", 500, "DB_ERROR");
    }
    throw error;
  }
};
export const applicationData = async (
  req: FastifyRequest,
  res: FastifyReply
) => {
  const params = req.query as SubmittedApplicationProps;
  if (!params.id) throw new ValidationError("INVALID REQUIRED ID");

  try {
    const response = await prisma.submittedApplication.findUnique({
      where: {
        id: params.id,
      },
      include: {
        forPosition: {
          select: {
            name: true,
            id: true,
          },
        },
        fileAttached: {
          select: {
            file_name: true,
            file_size: true,
          },
        },
        profilePic: {
          select: {
            file_url: true,
            file_name: true,
            id: true,
          },
        },
        ApplicationSkillTags: {
          select: {
            id: true,
            tags: true,
          },
        },
      },
    });

    if (!response) {
      throw new NotFoundError("DATA NOT FOUND!");
    }

    // Decrypt all encrypted fields in parallel
    const [
      email,
      civilStatus,
      mobileNo,
      resProvince,
      resCity,
      resBarangay,
      permaProvince,
      permaCity,
      permaBarangay,
      fatherSurname,
      fatherFirstname,
      motherSurname,
      motherFirstname,
      birthDate,
    ] = await Promise.all([
      response.emailIv
        ? EncryptionService.decrypt(response.email, response.emailIv)
        : response.email,
      response.cvilStatusIv
        ? EncryptionService.decrypt(response.cvilStatus, response.cvilStatusIv)
        : response.cvilStatus,
      EncryptionService.decrypt(response.mobileNo, response.ivMobileNo),
      response.resProvinceIv
        ? EncryptionService.decrypt(
            response.resProvince,
            response.resProvinceIv
          )
        : response.resProvince,
      response.resCityIv
        ? EncryptionService.decrypt(response.resCity, response.resCityIv)
        : response.resCity,
      response.resBarangayIv
        ? EncryptionService.decrypt(
            response.resBarangay,
            response.resBarangayIv
          )
        : response.resBarangay,
      response.permaProvinceIv
        ? EncryptionService.decrypt(
            response.permaProvince,
            response.permaProvinceIv
          )
        : response.permaProvince,
      response.permaCityIv
        ? EncryptionService.decrypt(response.permaCity, response.permaCityIv)
        : response.permaCity,
      response.permaBarangayIv
        ? EncryptionService.decrypt(
            response.permaBarangay,
            response.permaBarangayIv
          )
        : response.permaBarangay,
      response.fatherSurname && response.fatherSurnameIv
        ? EncryptionService.decrypt(
            response.fatherSurname,
            response.fatherSurnameIv
          )
        : Promise.resolve(response.fatherSurname || ""),
      response.fatherFirstname && response.fatherFirstnameIv
        ? EncryptionService.decrypt(
            response.fatherFirstname,
            response.fatherFirstnameIv
          )
        : Promise.resolve(response.fatherFirstname || ""),
      response.motherSurname && response.motherSurnameIv
        ? EncryptionService.decrypt(
            response.motherSurname,
            response.motherSurnameIv
          )
        : Promise.resolve(response.motherSurname || ""),
      response.motherFirstname && response.motherFirstnameIv
        ? EncryptionService.decrypt(
            response.motherFirstname,
            response.motherFirstnameIv
          )
        : Promise.resolve(response.motherFirstname || ""),
      response.bdayIv
        ? EncryptionService.decrypt(response.birthDate, response.bdayIv)
        : response.birthDate,
    ]);

    // Create decrypted response object
    const decryptedResponse = {
      // Non-encrypted fields
      id: response.id,
      firstname: response.firstname,
      lastname: response.lastname,
      middleName: response.middleName,
      gender: response.gender,
      filipino: response.filipino,
      dualCitizen: response.dualCitizen,
      byBirth: response.byBirth,
      byNatural: response.byNatural,
      dualCitizenHalf: response.dualCitizenHalf,
      resZipCode: response.resZipCode,
      permaZipCode: response.permaZipCode,
      teleNo: response.teleNo,
      height: response.height,
      weight: response.weight,
      bloodType: response.bloodType,
      fatherAge: response.fatherAge,
      motherAge: response.motherAge,
      children: response.children,
      govId: response.govId,
      lineId: response.lineId,
      positionId: response.positionId,
      batch: response.batch,
      timestamp: response.timestamp,
      forPosition: response.forPosition,
      fileAttached: response.fileAttached,
      profilePic: response.profilePic,
      ApplicationSkillTags: response.ApplicationSkillTags,
      experience: response.experience,
      civilService: response.civilService,
      elementary: response.elementary,
      secondary: response.secondary,
      vocational: response.vocational,
      college: response.college,
      graduateCollege: response.graduateCollege,
      status: response.status,
      // Decrypted fields

      email,
      civilStatus,
      mobileNo,
      birthDate,

      // Residential address (decrypted)
      resProvince,
      resCity,
      resBarangay,

      // Permanent address (decrypted)
      permaProvince,
      permaCity,
      permaBarangay,

      // Parents (decrypted)
      fatherSurname,
      fatherFirstname,
      motherSurname,
      motherFirstname,
    };

    return res.code(200).send(decryptedResponse);
  } catch (error) {
    console.log(error);

    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DB_CONNECTION_ERROR", 500, "DB_ERROR");
    }
    throw error;
  }
};

interface ContactRequest {
  message: string;
  subject: string;
  applicationId: string;
  sendTo?: "email" | "phoneNumber" | "both";
}

interface BulkContactRequest {
  message: string;
  subject: string;
  applicationId: string[];
  sendTo?: "email" | "phoneNumber" | "both";
}

export const contactApplicant = async (
  req: FastifyRequest,
  res: FastifyReply
) => {
  const {
    applicationId,
    message,
    subject,
    sendTo = "email",
  } = req.body as ContactRequest;

  // Validate required fields
  if (!applicationId?.trim() || !message?.trim() || !subject?.trim()) {
    throw new ValidationError(
      "Missing required fields: applicationId, message, and subject are required"
    );
  }

  try {
    const application = await prisma.submittedApplication.findUnique({
      where: { id: applicationId },
      select: {
        email: true,
        emailIv: true,
        mobileNo: true,
        ivMobileNo: true,
      },
    });

    if (!application) {
      throw new NotFoundError("Application not found");
    }

    // Decrypt contact information in parallel
    const [email, phoneNumber] = await Promise.all([
      application.emailIv
        ? EncryptionService.decrypt(application.email, application.emailIv)
        : application.email,
      application.ivMobileNo
        ? EncryptionService.decrypt(
            application.mobileNo,
            application.ivMobileNo
          )
        : application.mobileNo,
    ]);

    // Send communications based on preference
    const communicationPromises: Promise<any>[] = [];

    if ((sendTo === "email" || sendTo === "both") && email) {
      communicationPromises.push(sendEmail(subject, email, message, "HR Team"));
    }

    if (sendTo === "phoneNumber" || sendTo === "both") {
      // Add SMS sending logic here if available
      // communicationPromises.push(sendSMS(phoneNumber, message));
      await semaphoreService.sendSingleSMS(phoneNumber, "TEst", "Gasan");
    }

    await Promise.all(communicationPromises);

    // Log the contact attempt
    // await prisma.applicationConversation.create({
    //   data: {
    //     submittedApplicationId: applicationId,
    //     message: message,
    //     subject: subject,
    //     sentTo: sendTo,
    //     timestamp: new Date(),
    //   },
    // });

    return res.code(200).send({
      success: true,
      message: "Message sent successfully",
      sentTo: sendTo,
    });
  } catch (error) {
    console.error("Contact applicant error:", error);

    if (error instanceof NotFoundError || error instanceof ValidationError) {
      throw error;
    }

    throw new AppError("CONTACT_FAILED", 500, "Failed to contact applicant");
  }
};

export const contactManyApplicants = async (
  req: FastifyRequest,
  res: FastifyReply
) => {
  const {
    applicationId,
    message,
    subject,
    sendTo = "email",
  } = req.body as BulkContactRequest;

  if (!applicationId?.length || !message?.trim() || !subject?.trim()) {
    throw new ValidationError(
      "Missing required fields: applicationIds, message, and subject are required"
    );
  }

  if (applicationId.length > 100) {
    throw new ValidationError(
      "Cannot contact more than 100 applicants at once"
    );
  }

  try {
    const applications = await prisma.submittedApplication.findMany({
      where: {
        id: { in: applicationId },
      },
      select: {
        id: true,
        email: true,
        emailIv: true,
        mobileNo: true,
        ivMobileNo: true,
        firstname: true,
        lastname: true,
        firsntameIv: true,
        lastnameIv: true,
        forPosition: {
          select: {
            name: true,
          },
        },
      },
    });

    if (applications.length !== applicationId.length) {
      const foundIds = new Set(applications.map((app) => app.id));
      const missingIds = applicationId.filter((id) => !foundIds.has(id));
      throw new NotFoundError(
        `Some applications not found: ${missingIds.join(", ")}`
      );
    }

    // Decrypt all contact information in parallel
    const applicantsWithDecryptedInfo = await Promise.all(
      applications.map(async (app) => {
        const [email, phoneNumber, firstName, lastName] = await Promise.all([
          app.emailIv
            ? EncryptionService.decrypt(app.email, app.emailIv)
            : app.email,
          app.ivMobileNo
            ? EncryptionService.decrypt(app.mobileNo, app.ivMobileNo)
            : app.mobileNo,
          app.firsntameIv
            ? EncryptionService.decrypt(app.firstname, app.firsntameIv)
            : app.firstname,
          app.lastnameIv
            ? EncryptionService.decrypt(app.lastname, app.lastnameIv)
            : app.lastname,
        ]);

        return {
          id: app.id,
          email,
          phoneNumber,
          name: `${firstName} ${lastName}`.trim(),
        };
      })
    );

    const BATCH_SIZE = 10;
    const communicationPromises: Promise<any>[] = [];

    for (let i = 0; i < applicantsWithDecryptedInfo.length; i += BATCH_SIZE) {
      const batch = applicantsWithDecryptedInfo.slice(i, i + BATCH_SIZE);

      const batchPromises = batch.map((applicant) => {
        const individualPromises: Promise<any>[] = [];

        if (sendTo === "email" || sendTo === "both") {
          // Personalize message for each applicant
          const personalizedMessage = message.replace(
            /{{name}}/g,
            applicant.name
          );
          individualPromises.push(
            sendEmail(subject, applicant.email, personalizedMessage, "HR Team")
          );
        }

        if (sendTo === "phoneNumber" || sendTo === "both") {
          // Add SMS sending logic here if available
          // individualPromises.push(sendSMS(applicant.phoneNumber, message));
        }

        // Log each contact attempt

        return Promise.all(individualPromises);
      });

      communicationPromises.push(...batchPromises);
    }

    await Promise.all(communicationPromises);

    return res.code(200).send({
      success: true,
      message: `Messages sent successfully to ${applicantsWithDecryptedInfo.length} applicants`,
      recipients: applicantsWithDecryptedInfo.length,
      sentTo: sendTo,
    });
  } catch (error) {
    if (error instanceof NotFoundError || error instanceof ValidationError) {
      throw error;
    }

    throw new AppError(
      "BULK_CONTACT_FAILED",
      500,
      "Failed to contact applicants"
    );
  }
};

export const exportPersonalDataSheet = async () => {
  try {
  } catch (error) {}
};

export const applicationConvertion = async (
  req: FastifyRequest,
  res: FastifyReply
) => {
  const params = req.query as PagingProps;

  if (!params.id) throw new ValidationError("INVALID REQUIRED ID");

  try {
    const cursor = params.lastCursor ? { id: params.lastCursor } : undefined;
    const limit = params.limit ? parseInt(params.limit, 10) : 20;

    const response = await prisma.applicationConversation.findMany({
      where: {
        submittedApplicationId: params.id,
      },
      take: limit,
      skip: cursor ? 1 : 0,
      orderBy: {
        timestamp: "asc",
      },
      cursor,
      select: {
        hrAdmin: {
          select: {
            firstName: true,
            lastName: true,
            id: true,
          },
        },
        applicant: {
          select: {
            firstname: true,
            lastname: true,
          },
        },
        message: true,
        messageIv: true,
        timestamp: true,
        title: true,
        id: true,
      },
    });

    const descryptedConversation = await Promise.all(
      response.map(async (item) => {
        try {
          const decryptedMessage = await EncryptionService.decrypt(
            item.message,
            item.messageIv
          );

          return { messageContent: decryptedMessage, ...item };
        } catch (err) {
          console.error("ERROR decrypting item:", item.id, err);
          throw err; // <--- VERY IMPORTANT (forces error to bubble)
        }
      })
    );

    const newLastCursorId =
      descryptedConversation.length > 0
        ? descryptedConversation[descryptedConversation.length - 1].id
        : null;
    const hasMore = limit === descryptedConversation.length;

    return res.code(200).send({
      list: descryptedConversation,
      hasMore,
      lastCursor: newLastCursorId,
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DB_CONNECTION_ERROR", 500, "DB_ERROR");
    }
    throw error;
  }
};

export const adminApplicationSendConversation = async (
  req: FastifyRequest,
  res: FastifyReply
) => {
  const body = req.body as ApplicationConversation;
  console.log({ body });

  if (!body.userId || !body.applicationId)
    throw new ValidationError("INVALID REQUIRED ID");
  try {
    const encryptedMessage = await EncryptionService.encrypt(body.message);
    const response = await prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({
        where: {
          id: body.userId,
        },
      });
      const applicant = await tx.submittedApplication.findUnique({
        where: {
          id: body.applicationId,
        },
      });
      if (!applicant || !user)
        throw new NotFoundError("RECIPIENT or SENDER NOT FOUND");
      const [email] = await Promise.all([
        applicant.emailIv &&
          EncryptionService.decrypt(applicant.email, applicant.emailIv),
      ]);
      await tx.applicationConversation.create({
        data: {
          message: encryptedMessage.encryptedData,
          messageIv: encryptedMessage.iv,
          userId: body.userId,
          submittedApplicationId: body.applicationId,
          title: "New message",
          lineId: user.lineId as string,
        },
      });
      //       if (email) {
      //         await sendEmail(
      //           "New Message Regarding Your Application",
      //           email,
      //           `
      // Dear ${applicant.firstname} ${applicant.lastname},

      // You have received a new message regarding your job application.

      // Message: ${body.message}

      // Please log in to your applicant portal to view the full message and respond if needed.

      // Best regards,
      // ${user.firstName} ${user.lastName}
      // HR Team
      //   `,
      //           `HR Team <${user.lastName}, ${user.firstName}>`
      //         );
      //       }
      return "OK";
    });
    if (response !== "OK") {
      throw new AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
    }
    return res.code(200).send({ message: "OK" });
  } catch (error) {
    console.log(error);

    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DB_CONNECTION_ERROR", 500, "DB_ERROR");
    }
    throw error;
  }
};

export const updateApplicationStatus = async (
  req: FastifyRequest,
  res: FastifyReply
) => {
  const body = req.body as UpdateApplicationStatus;
  console.log(body);

  if (!body.userId || !body.applicantId)
    throw new ValidationError("INVALID REQUIRED ID");
  try {
    const response = await prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({
        where: {
          id: body.userId,
        },
      });

      const applicant = await tx.submittedApplication.findUnique({
        where: {
          id: body.applicantId,
        },
        select: {
          firstname: true,
          lastname: true,
          id: true,
          forPosition: {
            select: {
              name: true,
            },
          },
        },
      });

      if (!applicant || !user) throw new NotFoundError("ITEM_NOT_FOUND");

      await tx.submittedApplication.update({
        where: {
          id: applicant.id,
        },
        data: {
          status: body.status,
        },
      });
      await tx.humanResourcesLogs.create({
        data: {
          userId: body.userId,
          lineId: body.lineId,
          action: "UPDATE",
          desc: `UPDATE ${applicant.lastname}, ${applicant.firstname} application for ${applicant.forPosition?.name}`,
        },
      });

      return "OK";
    });
    if (response !== "OK")
      throw new AppError("DB_CONNECTION_ERROR", 500, "DB_ERROR");

    return res.code(200).send({ message: "OK" });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DB_CONNECTION_ERROR", 500, "DB_ERROR");
    }
    throw error;
  }
};
