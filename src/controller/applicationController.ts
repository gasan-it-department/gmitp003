import { FastifyReply, FastifyRequest } from "../barrel/fastify";
import {
  prisma,
  Prisma,
  SubmittedApplication as SubmittedApplicationProps,
} from "../barrel/prisma";
import fs from "fs";
import path from "path";
import cloudinary from "../class/Cloundinary";
import argon from "argon2";
import { EncryptionService } from "../service/encryption";
import { AppError, NotFoundError, ValidationError } from "../errors/errors";
import {
  PagingProps,
  PostNewJobProps,
  ApplicationConversation,
  UpdateApplicationStatus,
} from "../models/route";
import { semaphoreKey } from "../class/Semaphore";
import { phNumberFormat, sendEmail } from "../middleware/handler";
import { notificationSocket } from "..";
import { semaphoreService } from "../class/Semaphore";
import axios from "axios";

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
      const position = await tx.unitPosition.findUnique({
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
          status: 1,
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
            unitPositionId: position.id,
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
        console.log({ check });
      } else {
        jobPost = check;
      }
      return jobPost.id;
    });
    if (!response) throw new AppError("Something went wrong", 500, "DB_ERROR");
    return res.code(200).send({ message: "OK", id: response });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DATABASE_CONNECTION_FAILED", 500, "DB_ERROR");
    }
    throw error;
  }
};

export const updatePostApplication = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const body = req.body as {
    id: string;
    status: number;
    userId: string;
    lineId: string;
  };

  if (!body.id || !body.userId || !body.lineId)
    throw new ValidationError("INVALID REQUIRED ID");
  try {
    const response = await prisma.$transaction(async (tx) => {
      const post = await tx.jobPost.update({
        where: {
          id: body.id,
        },
        data: {
          status: body.status,
        },
        include: {
          position: {
            select: {
              name: true,
            },
          },
        },
      });

      console.log({ post });

      await tx.humanResourcesLogs.create({
        data: {
          userId: body.userId,
          action: "UPDATE",
          lineId: body.lineId,
          desc: `UPDATED JOB POST STATUS: ${post.position?.name ?? "N/A"}`,
        },
      });
      return true;
    });

    if (!response) throw new ValidationError("TRANSACTION FAILED");
    return res.code(200).send({ message: "OK" });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DATABASE_CONNECTION_FAILED", 500, "DB_ERROR");
    }
    throw error;
  }
};

/**
 * Update a job posting's editable fields.
 *
 * Caller sends only what changed (undefined = leave alone). To CLEAR a
 * deadline, send `deadline: null`. Status transitions are validated
 * against a small whitelist (draft → published, published ↔ paused).
 */
export const updatePostJob = async (req: FastifyRequest, res: FastifyReply) => {
  const param = req.body as Partial<PostNewJobProps> & {
    id: string;
    userId: string;
    lineId: string;
    deadline?: string | null;
  };

  if (!param.id) throw new ValidationError("INVALID REQUIRED ID");

  try {
    const result = await prisma.$transaction(async (tx) => {
      const jobPost = await tx.jobPost.findUnique({
        where: { id: param.id },
        include: { position: { select: { id: true, name: true } } },
      });
      if (!jobPost) throw new NotFoundError("JOB POST NOT FOUND");

      // Validate status transition. 0 = draft, 1 = published, 3 = paused.
      if (param.status !== undefined && param.status !== jobPost.status) {
        const allowed: Record<number, number[]> = {
          0: [1], // draft → published
          1: [3], // published → paused
          3: [1, 0], // paused → published or back to draft
        };
        const ok = allowed[jobPost.status]?.includes(param.status) ?? false;
        if (!ok) {
          throw new ValidationError(
            `Cannot move status from ${jobPost.status} to ${param.status}.`,
          );
        }
      }

      const data: any = {};
      if (param.desc !== undefined) data.desc = param.desc;
      if (param.hideSG !== undefined) data.hideSG = param.hideSG;
      if (param.showApplicationCount !== undefined)
        data.showApplicationCount = param.showApplicationCount;
      if (param.salaryGrade !== undefined)
        data.salaryGradeId = param.salaryGrade || null;
      if (param.status !== undefined) data.status = param.status;
      if (param.deadline !== undefined) {
        data.deadline = param.deadline ? new Date(param.deadline) : null;
      }
      if (param.location !== undefined) data.location = param.location;

      if (Object.keys(data).length > 0) {
        await tx.jobPost.update({ where: { id: jobPost.id }, data });
      }

      const wasStatusChange =
        param.status !== undefined && param.status !== jobPost.status;

      await tx.humanResourcesLogs.create({
        data: {
          action: wasStatusChange ? "STATUS" : "UPDATED",
          userId: param.userId,
          lineId: param.lineId,
          desc:
            `Job posting "${jobPost.position?.name ?? "N/A"}" ` +
            (wasStatusChange
              ? `status ${jobPost.status} → ${param.status}`
              : `updated (hideSG=${param.hideSG ?? jobPost.hideSG}, ` +
                `showCount=${param.showApplicationCount ?? jobPost.showApplicationCount})`),
        },
      });

      return { id: jobPost.id, fields: Object.keys(data) };
    });

    return res.code(200).send({ message: "OK", ...result });
  } catch (error) {
    if (error instanceof NotFoundError) throw error;
    if (error instanceof ValidationError) throw error;
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DATABASE_CONNECTION_FAILED", 500, "DB_ERROR");
    }
    throw error;
  }
};

export const createPobJobRequirements = async (
  req: FastifyRequest,
  res: FastifyReply,
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
            const fileExtension = path.extname(part.filename).toLowerCase();
            const isDocument = [
              ".pdf",
              ".doc",
              ".docx",
              ".txt",
              ".xls",
              ".xlsx",
            ].includes(fileExtension);

            const result = await cloudinary.uploader.upload(tmpPath, {
              folder: "job_requirements_assets",
              resource_type: isDocument ? "raw" : "auto",
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

            // console.log(`Uploaded file: ${part.filename}`);
            // console.log(`Cloudinary URL: ${result.secure_url}`);
            // console.log(`Resource type: ${result.resource_type}`);
          } catch (err) {
            throw new AppError(
              `Failed to upload file "${part.filename}" to Cloudinary`,
              500,
              "UPLOAD_FAILED",
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
  res: FastifyReply,
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
  res: FastifyReply,
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
              "UPLOAD_FAILED",
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
  res: FastifyReply,
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
  res: FastifyReply,
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

/**
 * Public job-board listing for one municipality.
 *
 * Returns only published posts (`status: 1`) whose deadline (if any) is
 * still in the future. Each row carries enough metadata (position, unit,
 * salary grade, requirements, submitted-application count, municipality
 * label) for the public board to render without secondary calls.
 *
 * `id` (query param) — the Municipal id taken from the route.
 */
export const jobPost = async (req: FastifyRequest, res: FastifyReply) => {
  const params = req.query as PagingProps;
  if (!params.id) throw new ValidationError("INVALID ID");

  try {
    const cursor = params.lastCursor ? { id: params.lastCursor } : undefined;
    const limit = params.limit ? parseInt(params.limit, 10) : 20;
    const now = new Date();

    // Build the where clause as a single AND list so combining OR-blocks
    // with other top-level fields can't be misinterpreted by Prisma.
    const andClauses: any[] = [
      { status: 1 },
      { line: { municipalId: params.id } },
      // Drop expired postings. Posts without a deadline are open-ended.
      { OR: [{ deadline: null }, { deadline: { gte: now } }] },
    ];

    if (params.query) {
      const q = params.query.trim();
      andClauses.push({
        OR: [
          { position: { name: { contains: q, mode: "insensitive" } } },
          { desc: { contains: q, mode: "insensitive" } },
          { unitPos: { unit: { name: { contains: q, mode: "insensitive" } } } },
          // PESO / external posts have no internal position — search their
          // free-text title and employer instead.
          { jobTitle: { contains: q, mode: "insensitive" } },
          { employerName: { contains: q, mode: "insensitive" } },
        ],
      });
    }

    const where: any = { AND: andClauses };

    const [municipality, list] = await Promise.all([
      prisma.municipal.findUnique({
        where: { id: params.id },
        select: {
          id: true,
          name: true,
          Province: { select: { id: true, name: true } },
        },
      }),
      prisma.jobPost.findMany({
        where,
        include: {
          position: { select: { id: true, name: true } },
          requirements: {
            select: {
              id: true,
              title: true,
              asset: {
                select: {
                  id: true,
                  fileName: true,
                  fileSize: true,
                  fileUrl: true,
                },
              },
            },
          },
          salaryGrade: { select: { id: true, grade: true } },
          _count: { select: { submittedApplications: true } },
          unitPos: { select: { unit: { select: { name: true } } } },
          line: { select: { id: true, name: true, municipalId: true } },
        },
        skip: cursor ? 1 : 0,
        take: limit,
        orderBy: { timestamp: "desc" },
        cursor,
      }),
    ]);

    // Normalize `_count` to the application-count shape the UI already
    // reads (`item._count.application`). Server now counts SUBMITTED
    // applications, which is what HR actually cares about.
    const shaped = list.map((j) => ({
      ...j,
      _count: { application: j._count?.submittedApplications ?? 0 },
    }));

    const lastCursor = shaped.length > 0 ? shaped[shaped.length - 1].id : null;
    const hasMore = shaped.length === limit;

    // ── Diagnostic block ────────────────────────────────────────────
    // Pulls a few signals so we can pinpoint exactly why a published post
    // might not surface here: wrong municipal id, deadline already past,
    // or simply nothing published.
    const [totalForMuni, publishedForMuni, allPublished] = await Promise.all([
      prisma.jobPost.count({
        where: { line: { municipalId: params.id } },
      }),
      prisma.jobPost.count({
        where: { line: { municipalId: params.id }, status: 1 },
      }),
      prisma.jobPost.findMany({
        where: { status: 1 },
        select: {
          id: true,
          status: true,
          deadline: true,
          position: { select: { name: true } },
          line: {
            select: {
              id: true,
              name: true,
              municipalId: true,
            },
          },
        },
        take: 20,
        orderBy: { timestamp: "desc" },
      }),
    ]);

    console.log(
      `[jobPost] muni=${params.id} q="${params.query ?? ""}" ` +
        `published=${publishedForMuni}/${totalForMuni} returned=${shaped.length} now=${now.toISOString()}`,
    );
    if (allPublished.length > 0) {
      console.log(
        "[jobPost] published posts (any muni):",
        allPublished.map((p) => ({
          id: p.id.slice(0, 8),
          name: p.position?.name,
          lineId: p.line?.id?.slice(0, 8),
          lineMuni: p.line?.municipalId,
          deadline: p.deadline,
          expired: p.deadline ? new Date(p.deadline) < now : false,
        })),
      );
    } else {
      console.log("[jobPost] no published posts in DB at all.");
    }

    return res.code(200).send({
      list: shaped,
      hasMore,
      lastCursor,
      municipality,
      debug: {
        totalForMuni,
        publishedForMuni,
        requestedMuni: params.id,
        // Surface the municipal IDs of every published post so the UI can
        // tell the operator "your post's municipality is X, you opened Y".
        publishedMunis: Array.from(
          new Set(
            allPublished
              .map((p) => p.line?.municipalId)
              .filter((m): m is string => !!m),
          ),
        ),
      },
    });
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

    const jobPost = await prisma.jobPost.findUnique({
      where: {
        id: formData.jobPostId,
      },
      select: {
        id: true,
        unitPositionId: true,
      },
    });

    if (!jobPost) {
      throw new NotFoundError("JOB POST NOT FOUND");
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

        // CS Form 212 sections VI–VIII + references (stored as plain JSON,
        // same as the other structured sections above).
        voluntaryWork: parseArrayField("voluntaryWork", []),
        learningDev: parseArrayField("learningDev", []),
        otherInfo: parseArrayField("otherInfo", []),
        references: parseArrayField("references", []),

        // Page-4 disclosure questionnaire (Q34–40).
        disclosures: parseObjectField("disclosures", {}),

        // gov ID - use object parser
        govId: parseObjectField("govId", {
          type: "",
          number: "",
          dateIssuance: "",
          placeIssuance: "",
        }),

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
        byBirth: String(clean.dualCitizen || "").toLowerCase().includes("birth"),
        byNatural: String(clean.dualCitizen || "")
          .toLowerCase()
          .includes("atural"),

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

        // CS Form 212 sections VI–VIII + references + disclosures (Json/Json[])
        voluntaryWork: clean.voluntaryWork,
        learningDev: clean.learningDev,
        otherInfo: clean.otherInfo,
        references: clean.references,
        disclosures: clean.disclosures,

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
        lineId: position.line?.id as string,
        positionId: formData.positionId,
        unitPositionId: jobPost.unitPositionId,
        // REQUIRED Date
        batch: new Date(),
      };

      console.log("Application Data: ", { applicationData });

      // Add profile picture relation if it exists
      if (profilePicture) {
        applicationData.applicationProfilePicId = profilePicture.id;
      }

      const application = await tx.submittedApplication.create({
        data: applicationData,
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

      return {
        applicationId: application.id,
        positionName: position.name,
        municipalName: municipal.name,
      };
    });

    // Confirmation email + SMS are NON-FATAL and run OUTSIDE the transaction:
    // the application is already committed, so a mail/SMS failure must never
    // roll it back or 500 the request.
    if (formData.email) {
      try {
        await sendEmail(
          "Application Received",
          formData.email,
          `Dear ${formData.firstName} ${formData.lastName},

This is to confirm that we have successfully received your application for the position of ${result.positionName} at ${result.municipalName}.

We will inform you of any further instructions regarding the next steps in the hiring process once your application has been reviewed.

You can check the status of your application by clicking this link: ${officialUrl}/public/application/${result.applicationId}

Sincerely,
The HR Team
${result.municipalName}`,
          `${result.municipalName} HR Team`,
        );
      } catch (mailErr) {
        console.warn(
          "[application submit] confirmation email failed:",
          mailErr instanceof Error ? mailErr.message : mailErr,
        );
      }
    }

    if (formData.mobileNo && semaphoreKey) {
      try {
        const contact = phNumberFormat(formData.mobileNo);
        await axios.post(
          `https://api.semaphore.co/api/v4/messages`,
          {
            number: contact,
            message: `Dear ${formData.firstName} ${formData.lastName},

This is to confirm that we have successfully received your application for the position of ${result.positionName} at ${result.municipalName}.

We will inform you of any further instructions regarding the next steps in the hiring process once your application has been reviewed.

Sincerely,
The HR Team
${result.municipalName}`,
            apikey: semaphoreKey,
          },
          { headers: { "Content-Type": "application/json" } },
        );
      } catch (smsErr) {
        console.warn(
          "[application submit] confirmation SMS failed:",
          smsErr instanceof Error ? smsErr.message : smsErr,
        );
      }
    }

    return res.send({
      success: true,
      applicationId: result.applicationId,
      filesUploaded: uploaded.length,
      profilePictureUploaded: !!profilePicture,
    });
  } catch (err) {
    return res.status(500).send({
      success: false,
      message: "Failed to submit application",
      error: err instanceof Error ? err.message : "Unknown error",
    });
  }
};

export const applicationList = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const params = req.query as PagingProps & {
    /** When set, drops applications that are already accounted for —
     *  used by the Position → Select from Applications picker so HR
     *  can't accidentally invite somebody who's already been onboarded
     *  or has a live invitation in flight. */
    eligibleOnly?: string | boolean;
  };

  if (!params.id) throw new ValidationError("INVALID REQUIRED ID");
  try {
    const cursor = params.lastCursor ? { id: params.lastCursor } : undefined;
    const limit = params.limit ? parseInt(params.limit, 10) : 20;
    const eligibleOnly =
      params.eligibleOnly === true ||
      params.eligibleOnly === "true" ||
      params.eligibleOnly === "1";

    // Build the where clause conditionally
    const whereClause: any = {
      lineId: params.id,
    };

    if (eligibleOnly) {
      // Drop applications already converted into a User — at that point
      // the applicant has finished registration and shouldn't be invited
      // again. Live-invite dedup happens after the fetch (see below) so
      // the prisma where clause stays simple.
      whereClause.userId = null;
    }

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
        userId: true,
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
        // Whether this application is currently tied to a live invitation.
        // The @unique on FillPositionInvitation.submittedApplicationId
        // means at most one row per application; we read it to flag the
        // row in the UI even when the caller didn't ask to filter.
        fillPositionInvitations: {
          select: {
            id: true,
            concluded: true,
            concludedReason: true,
            expiresAt: true,
          },
        },
      },
    });

    // ── Eligibility annotation + optional drop ─────────────────────────
    // An application's invitation is "live" when it isn't concluded AND
    // either has no expiresAt or hasn't expired yet. Once that's true,
    // the applicant can't be re-invited (FE disables the row; eligibleOnly
    // strips it from the list entirely).
    const now = Date.now();
    const decorated = response.map((row) => {
      const inv = row.fillPositionInvitations;
      const invExpired = !!(
        inv?.expiresAt && new Date(inv.expiresAt).getTime() < now
      );
      const liveInvite = !!inv && !inv.concluded && !invExpired;
      const accepted =
        !!inv && inv.concluded && inv.concludedReason === "accepted";
      const converted = !!row.userId;
      const eligibility = converted
        ? "registered"
        : accepted
          ? "accepted"
          : liveInvite
            ? "invited"
            : "eligible";
      return { ...row, eligibility };
    });

    const filtered = eligibleOnly
      ? decorated.filter((r) => r.eligibility === "eligible")
      : decorated;

    const newLastCursorId =
      filtered.length > 0 ? filtered[filtered.length - 1].id : null;
    const hasMore = limit === response.length;

    return res.code(200).send({
      list: filtered,
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
  res: FastifyReply,
) => {
  const params = req.query as SubmittedApplicationProps;
  console.log(params);

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
      umidNo,
      pagIbigNo,
      philHealthNo,
      philSys,
      tinNo,
      agencyNo,
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
            response.resProvinceIv,
          )
        : response.resProvince,
      response.resCityIv
        ? EncryptionService.decrypt(response.resCity, response.resCityIv)
        : response.resCity,
      response.resBarangayIv
        ? EncryptionService.decrypt(
            response.resBarangay,
            response.resBarangayIv,
          )
        : response.resBarangay,
      response.permaProvinceIv
        ? EncryptionService.decrypt(
            response.permaProvince,
            response.permaProvinceIv,
          )
        : response.permaProvince,
      response.permaCityIv
        ? EncryptionService.decrypt(response.permaCity, response.permaCityIv)
        : response.permaCity,
      response.permaBarangayIv
        ? EncryptionService.decrypt(
            response.permaBarangay,
            response.permaBarangayIv,
          )
        : response.permaBarangay,
      response.fatherSurname && response.fatherSurnameIv
        ? EncryptionService.decrypt(
            response.fatherSurname,
            response.fatherSurnameIv,
          )
        : Promise.resolve(response.fatherSurname || ""),
      response.fatherFirstname && response.fatherFirstnameIv
        ? EncryptionService.decrypt(
            response.fatherFirstname,
            response.fatherFirstnameIv,
          )
        : Promise.resolve(response.fatherFirstname || ""),
      response.motherSurname && response.motherSurnameIv
        ? EncryptionService.decrypt(
            response.motherSurname,
            response.motherSurnameIv,
          )
        : Promise.resolve(response.motherSurname || ""),
      response.motherFirstname && response.motherFirstnameIv
        ? EncryptionService.decrypt(
            response.motherFirstname,
            response.motherFirstnameIv,
          )
        : Promise.resolve(response.motherFirstname || ""),
      response.bdayIv
        ? EncryptionService.decrypt(response.birthDate, response.bdayIv)
        : response.birthDate,
      response.umidNoIv && response.umidNo
        ? EncryptionService.decrypt(response.umidNo, response.umidNoIv)
        : "N/A",
      response.pagIbigNo && response.pagIbigNoIv
        ? EncryptionService.decrypt(response.pagIbigNo, response.pagIbigNoIv)
        : "N/A",
      response.philHealthNo && response.philHealthNoIv
        ? EncryptionService.decrypt(
            response.philHealthNo,
            response.philHealthNoIv,
          )
        : "N/A",
      response.philSys && response.philSysIv
        ? EncryptionService.decrypt(response.philSys, response.philSysIv)
        : "N/A",
      response.tinNo && response.tinNoIv
        ? EncryptionService.decrypt(response.tinNo, response.tinNoIv)
        : "N/A",
      response.agencyNo && response.agencyNoIv
        ? EncryptionService.decrypt(response.agencyNo, response.agencyNoIv)
        : "N/A",
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
      // CS Form 212 sections VI–VIII + references + disclosures (plain JSON).
      voluntaryWork: response.voluntaryWork,
      learningDev: response.learningDev,
      otherInfo: response.otherInfo,
      references: response.references,
      disclosures: response.disclosures,
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

      umidNo,
      pagIbigNo,
      philHealthNo,
      philSys,
      tinNo,
      agencyNo,
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
  res: FastifyReply,
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
      "Missing required fields: applicationId, message, and subject are required",
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
            application.ivMobileNo,
          )
        : application.mobileNo,
    ]);

    // Send communications based on preference
    const communicationPromises: Promise<any>[] = [];

    if ((sendTo === "email" || sendTo === "both") && email) {
      communicationPromises.push(sendEmail(subject, email, message, "HR Team"));
    }

    if (sendTo === "phoneNumber" || sendTo === "both") {
      const formatted = phNumberFormat(phoneNumber ?? "");
      if (formatted) {
        communicationPromises.push(
          semaphoreService.sendSingleSMS(formatted, message, "Gasan"),
        );
      }
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
  res: FastifyReply,
) => {
  const {
    applicationId,
    message,
    subject,
    sendTo = "email",
  } = req.body as BulkContactRequest;

  if (!applicationId?.length || !message?.trim() || !subject?.trim()) {
    throw new ValidationError(
      "Missing required fields: applicationIds, message, and subject are required",
    );
  }

  if (applicationId.length > 100) {
    throw new ValidationError(
      "Cannot contact more than 100 applicants at once",
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
        `Some applications not found: ${missingIds.join(", ")}`,
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
      }),
    );

    // ── Dispatch per the chosen channel(s), shaped to each sender ──────────
    // Email: personalized per recipient, sent in small batches so we don't
    //   overwhelm the SMTP relay; failures are tolerated (not all-or-nothing).
    // SMS: Semaphore accepts a comma-joined list, so the whole transaction is
    //   ONE bulk call (it can't personalize, so {{name}} is generic there).
    const wantsEmail = sendTo === "email" || sendTo === "both";
    const wantsSms = sendTo === "phoneNumber" || sendTo === "both";

    let emailSent = 0;
    let emailFailed = 0;
    if (wantsEmail) {
      const targets = applicantsWithDecryptedInfo.filter((a) => a.email);
      const EMAIL_BATCH = 20;
      for (let i = 0; i < targets.length; i += EMAIL_BATCH) {
        const results = await Promise.allSettled(
          targets
            .slice(i, i + EMAIL_BATCH)
            .map((a) =>
              sendEmail(
                subject,
                a.email,
                message.replace(/{{name}}/g, a.name),
                "HR Team",
              ),
            ),
        );
        emailSent += results.filter((r) => r.status === "fulfilled").length;
        emailFailed += results.filter((r) => r.status === "rejected").length;
      }
    }

    let smsSent = 0;
    let smsOk = true;
    if (wantsSms) {
      const numbers = applicantsWithDecryptedInfo
        .map((a) => phNumberFormat(a.phoneNumber ?? ""))
        .filter((n) => n.length > 0);
      if (numbers.length) {
        const smsResult = await semaphoreService.sendBulkSMS(
          numbers,
          message.replace(/{{name}}/g, "Applicant"),
          "Gasan",
        );
        smsOk = smsResult.success;
        smsSent = smsOk ? numbers.length : 0;
      }
    }

    return res.code(200).send({
      success: true,
      message: `Contacted ${applicantsWithDecryptedInfo.length} applicant(s)`,
      recipients: applicantsWithDecryptedInfo.length,
      sentTo: sendTo,
      emailSent,
      emailFailed,
      smsSent,
      smsOk,
    });
  } catch (error) {
    if (error instanceof NotFoundError || error instanceof ValidationError) {
      throw error;
    }

    throw new AppError(
      "BULK_CONTACT_FAILED",
      500,
      "Failed to contact applicants",
    );
  }
};

export const exportPersonalDataSheet = async () => {
  try {
  } catch (error) {}
};

export const applicationConvertion = async (
  req: FastifyRequest,
  res: FastifyReply,
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
        fromHr: true,
      },
    });

    const descryptedConversation = await Promise.all(
      response.map(async (item) => {
        try {
          const decryptedMessage = await EncryptionService.decrypt(
            item.message,
            item.messageIv,
          );

          return { messageContent: decryptedMessage, ...item };
        } catch (err) {
          console.error("ERROR decrypting item:", item.id, err);
          throw err; // <--- VERY IMPORTANT (forces error to bubble)
        }
      }),
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
    console.log(error);

    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DB_CONNECTION_ERROR", 500, "DB_ERROR");
    }
    throw error;
  }
};

export const adminApplicationSendConversation = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const body = req.body as ApplicationConversation;
  // console.log({ body });

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
      const created = await tx.applicationConversation.create({
        data: {
          message: encryptedMessage.encryptedData,
          messageIv: encryptedMessage.iv,
          userId: body.userId,
          submittedApplicationId: body.applicationId,
          title: "New message",
          lineId: user.lineId as string,
          fromHr: true,
        },
        select: {
          id: true,
          timestamp: true,
          submittedApplicationId: true,
          fromHr: true,
          hrAdmin: {
            select: { id: true, firstName: true, lastName: true },
          },
        },
      });
      return created;
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
      return created;
    });
    if (!response) {
      throw new AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
    }

    // Emit real-time payload to anyone joined to this chat room (applicant
    // side + every HR session viewing this application). Plaintext is OK
    // because socket delivery is scoped to the room.
    try {
      notificationSocket.emitChatMessage(body.applicationId, {
        id: response.id,
        messageContent: body.message,
        fromHr: response.fromHr ?? true,
        timestamp:
          typeof response.timestamp === "string"
            ? response.timestamp
            : new Date(response.timestamp).toISOString(),
        submittedApplicationId: response.submittedApplicationId,
        hrAdmin: response.hrAdmin,
      });
    } catch (e) {
      console.warn("[chat] failed to emit admin message:", e);
    }

    return res.code(200).send({ message: "OK", id: response.id });
  } catch (error) {
    console.log(error);

    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DB_CONNECTION_ERROR", 500, "DB_ERROR");
    }
    throw error;
  }
};

export const sendPublicApplicationMessage = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const body = req.body as { message: string; applicationId: string };

  if (!body.applicationId || !body.message) {
    throw new ValidationError("INVALID REQUIRED FIELD");
  }
  try {
    const encryptedMessage = await EncryptionService.encrypt(body.message);
    const response = await prisma.$transaction(async (tx) => {
      const application = await tx.submittedApplication.findUnique({
        where: {
          id: body.applicationId,
        },
        include: {
          forPosition: {
            select: {
              name: true,
              lineId: true,
            },
          },
        },
      });

      if (!application) throw new NotFoundError("APPLICATION NOT FOUND");

      const created = await tx.applicationConversation.create({
        data: {
          message: encryptedMessage.encryptedData,
          messageIv: encryptedMessage.iv,
          // SubmittedApplication.lineId is always set (required); forPosition is
          // null for public/job-post applicants, so don't depend on it.
          lineId: (application.lineId ??
            application.forPosition?.lineId) as string,
          title: "",
          fromHr: false,
          submittedApplicationId: body.applicationId,
        },
        select: {
          id: true,
          timestamp: true,
          submittedApplicationId: true,
          fromHr: true,
        },
      });
      return created;
    });

    if (!response) throw new ValidationError("TRANSACTION FAILED");

    // Real-time push to anyone in this chat room (HR side).
    try {
      notificationSocket.emitChatMessage(body.applicationId, {
        id: response.id,
        messageContent: body.message,
        fromHr: response.fromHr ?? false,
        timestamp:
          typeof response.timestamp === "string"
            ? response.timestamp
            : new Date(response.timestamp).toISOString(),
        submittedApplicationId: response.submittedApplicationId,
        hrAdmin: null,
      });
    } catch (e) {
      console.warn("[chat] failed to emit applicant message:", e);
    }

    return res.code(200).send({ message: "OK", id: response.id });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DB_CONNECTION_ERROR", 500, "DB_ERROR");
    }
    throw error;
  }
};

export const updateApplicationStatus = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const body = req.body as UpdateApplicationStatus;

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

export const concludeApplication = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const body = req.body as {
    applicationId: string;
    accepted: boolean;
    sendInviteLink: boolean;
  };

  if (!body.applicationId) throw new ValidationError("INVALID REQUIRED ID");

  try {
    const response = await prisma.$transaction(async (tx) => {
      const application = await tx.submittedApplication.findUnique({
        where: {
          id: body.applicationId,
        },
        include: {
          forPosition: {
            select: {
              name: true,
            },
          },
          jobPost: {
            select: {
              salaryGrade: {
                select: {
                  grade: true,
                  amount: true,
                },
              },
              position: {
                select: {
                  name: true,
                  id: true,
                },
              },
            },
          },
        },
      });

      if (!application) {
        throw new NotFoundError("APPLICATION NOT FOUND");
      }

      const email = application.emailIv
        ? await EncryptionService.decrypt(
            application.email,
            application.emailIv,
          )
        : undefined;

      const mobileNo = application.ivMobileNo
        ? await EncryptionService.decrypt(
            application.mobileNo,
            application.ivMobileNo,
          )
        : undefined;

      if (!email) throw new ValidationError("FAILED TO PARSE EMAIL");

      const link = `${officialUrl}/public/${application.lineId}/application/${application.id}`;

      await tx.submittedApplication.update({
        where: {
          id: application.id,
        },
        data: {
          status: 3,
        },
      });

      // Generate professional text email content
      const emailContent = generateInvitationEmail(
        `${application.lastname}, ${application.firstname}` || "Applicant",
        application.forPosition?.name || "the position",
        link,
      );

      await sendEmail(
        "Invitation to Complete Your Registration - Gasan Portal",
        email,
        emailContent,
        "HR Team -  Municipal Government",
      );

      if (mobileNo) {
        const contact = phNumberFormat(mobileNo);

        await axios.post(
          `https://api.semaphore.co/api/v4/messages`,
          {
            number: contact,
            message: `
Your application for ${
              application.forPosition?.name || "{Error}"
            } has been approved, please check your email for the invitation link.

Sincerely,
The HR Team`,
            apikey: semaphoreKey,
          },
          {
            headers: {
              "Content-Type": "application/json",
            },
          },
        );
      }

      return "OK";
    });

    return res
      .status(200)
      .send({ message: "Invitation sent successfully", data: response });
  } catch (error) {
    console.error("Error concluding application:", error);

    if (error instanceof NotFoundError) {
      return res.status(404).send({ error: "Application not found" });
    }
    if (error instanceof ValidationError) {
      return res.status(400).send({ error: "Failed to process email" });
    }

    return res.status(500).send({ error: "Internal server error" });
  }
};

// Helper function to generate professional text email content
const generateInvitationEmail = (
  applicantName: string,
  positionTitle: string,
  registrationLink: string,
): string => {
  return `
INVITATION TO COMPLETE YOUR REGISTRATION
Municipal Government of Gasan

Dear ${applicantName},

We are pleased to inform you that your application for ${positionTitle} has been reviewed and we would like to invite you to complete your registration through our online portal.

NEXT STEPS:
Please use the link below to complete your registration and set up your account credentials:

REGISTRATION LINK: ${registrationLink}

REGISTRATION INSTRUCTIONS:
1. Click on the registration link above
2. Create your username and password
3. Set up your security preferences
4. Complete your profile information

IMPORTANT NOTES:
- This link is unique to your application and should not be shared with others
- Please complete your registration within 7 days
- Ensure you use a valid email address that you have access to
- Keep your login credentials secure

For security reasons, please do not share this link with anyone. If you did not apply for this position or believe you received this email in error, please contact us immediately.

If you encounter any issues during registration or have questions, please contact our HR Department at hr@gasan.gov.ph or call (042) 123-4567.

We look forward to having you as part of the Gasan Municipal Government community.

Best regards,

HR Team
Municipal Government of Gasan
Gasan, Marinduque
Email: hr@gasan.gov.ph
Phone: (042) 123-4567

CONFIDENTIALITY NOTICE:
This email and any attachments are confidential and intended solely for the use of the individual to whom they are addressed. If you are not the intended recipient, please notify us immediately and delete this email.
  `.trim();
};

export const applicationRegisterUser = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const body = req.body as {
    username: string;
    password: string;
    lineId: string;
    applicationId: string;
  };

  if (!body.applicationId || !body.username || !body.password || !body.lineId) {
    throw new ValidationError("INVALID REQUIRED FIELD");
  }

  try {
    const response = await prisma.$transaction(async (tx) => {
      const check = await tx.account.findFirst({
        where: {
          username: {
            contains: body.username,
            mode: "insensitive",
          },
        },
      });

      if (check) throw new ValidationError("Username alrady exiist");
      const application = await tx.submittedApplication.findUnique({
        where: {
          id: body.applicationId,
        },
        select: {
          id: true,
          firstname: true,
          lastname: true,
          middleName: true,
          email: true,
          emailIv: true,
          profilePic: {
            select: {
              file_name: true,
              file_type: true,
              file_size: true,
              file_url: true,
              file_url_Iv: true,
            },
          },
          jobPost: {
            select: {
              id: true,
              position: {
                select: {
                  name: true,
                  id: true,
                },
              },
              salaryGradeId: true,
              unitPositionId: true,
            },
          },
          positionId: true,
        },
      });

      if (!application) throw new ValidationError("Application not found!");

      const hashedPassword = await argon.hash(body.password);

      const newAccount = await tx.account.create({
        data: {
          username: body.username,
          password: hashedPassword,
          lineId: body.lineId,
        },
      });
      const optional: any = {};

      if (application.profilePic) {
        optional.userProfilePictures = {
          create: {
            file_name: application.profilePic.file_name,
            file_public_id: application.profilePic.file_url_Iv,
            file_size: application.profilePic.file_size,
            file_url: application.profilePic.file_url,
          },
        };
      }

      const user = await tx.user.create({
        data: {
          username: newAccount.username,
          lineId: body.lineId,
          accountId: newAccount.id,
          firstName: application.firstname,
          lastName: application.lastname,
          email: application.email,
          emailIv: application.emailIv,
          positionId: application.jobPost?.position?.id as string,
          salaryGradeId: application.jobPost?.salaryGradeId as string,
        },
      });

      await tx.unitPosition.update({
        where: {
          id: application.jobPost?.unitPositionId as string,
          positionId: application.positionId as string,
        },
        data: {
          slot: {
            update: {
              where: {
                occupied: false,
                userId: undefined,
              },
              data: {
                occupied: true,
                userId: user.id,
              },
            },
          },
        },
      });

      await tx.positionSlot.update({
        where: {
          userId: user.id,
          salaryGradeId: application.jobPost?.salaryGradeId as string,
        },
        data: {
          userId: user.id,
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

      return "OK";
    });

    if (response !== "OK") {
      throw new ValidationError("FAILED TO CREATE ACCOUNT");
    }
    return res.code(200).send({ message: "OK" });
  } catch (error) {
    //console.log(error);

    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
    }
    throw error;
  }
};

export const deleteApplication = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const params = req.query as { id: string; userId: string; lineId: string };
  console.log(params);

  if (!params.id || !params.userId || !params.lineId) {
    throw new ValidationError("INVALID REQUIRED PARAMETERS");
  }
  try {
    const response = await prisma.$transaction(async (tx) => {
      const application = await tx.submittedApplication.delete({
        where: {
          id: params.id,
        },
      });

      await tx.humanResourcesLogs.create({
        data: {
          userId: params.userId,
          action: "DELETE",
          desc: `DELETE application of ${application.lastname}, ${application.firstname}`,
          lineId: params.lineId,
        },
      });
      return "OK";
    });
    if (response !== "OK") {
      throw new ValidationError("FAILED TO DELETE APPLICATION");
    }
    return res.code(200).send({ message: "OK" });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
    }
    throw error;
  }
};

export const applicationDeleteMany = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const body = req.body as { ids: string[]; userId: string; lineId: string };
  console.log({ body });

  if (!body.ids?.length || !body.userId || !body.lineId) {
    throw new ValidationError("INVALID REQUIRED PARAMETERS");
  }

  try {
    const ressponse = await prisma.$transaction(async (tx) => {
      await tx.submittedApplication.deleteMany({
        where: {
          id: {
            in: body.ids,
          },
        },
      });

      await tx.humanResourcesLogs.createMany({
        data: body.ids.map((id) => ({
          userId: body.userId,
          action: "DELETE",
          desc: `DELETE application with id ${id}`,
          lineId: body.lineId,
        })),
      });
      return true;
    });

    if (!ressponse) throw new ValidationError("FAILED TO DELETE APPLICATIONS");

    return res.code(200).send({ message: "OK" });
  } catch (error) {
    console.log(error);

    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
    }
    throw error;
  }
};
