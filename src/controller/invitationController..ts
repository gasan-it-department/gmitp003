import path from "path";
import { FastifyReply, FastifyRequest } from "../barrel/fastify";
import { prisma, InvitationLink, Prisma } from "../barrel/prisma";
import { AppError, NotFoundError, ValidationError } from "../errors/errors";
import {
  generatedInvitationCode,
  phNumberFormat,
  sendEmail,
} from "../middleware/handler";
import { PagingProps, SupplyOverviewProps } from "../models/route";
import { EncryptionService } from "../service/encryption";
import fs from "fs";
import cloudinary from "../class/Cloundinary";
import { axios } from "../db/axios";
import { semaphoreKey } from "../class/Semaphore";

const officialUrl = process.env.VITE_LOCAL_FRONTEND_URL;

/**
 * Generate a unique 6-digit invitation code. Retries until findFirst returns
 * null for the candidate. Kept short because the previous implementation
 * picked a single number and looped against the same value forever.
 */
const generateInvitationCode = async (
  tx: Prisma.TransactionClient,
): Promise<string> => {
  for (let attempt = 0; attempt < 20; attempt++) {
    const candidate = Math.floor(100000 + Math.random() * 900000).toString();
    const clash = await tx.invitationLink.findFirst({
      where: { code: candidate },
      select: { id: true },
    });
    if (!clash) return candidate;
  }
  throw new AppError(
    "CODE_GEN_FAILED",
    500,
    "Could not generate a unique invitation code.",
  );
};

export const createInvitationLink = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  try {
    const body = req.body as {
      date?: string;
      time?: string;
      lineId: string;
    };
    if (!body || !body.lineId) {
      throw new ValidationError("Line is required");
    }

    // Build expiresAt. Default is 24 h from now if the caller didn't pick
    // a date.
    let expiresAt: Date;
    if (body.date && body.time) {
      expiresAt = new Date(`${body.date}T${body.time}:00`);
    } else if (body.date) {
      expiresAt = new Date(`${body.date}T23:59:59`);
    } else {
      expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    }
    if (Number.isNaN(expiresAt.getTime())) {
      throw new ValidationError("Invalid expiration date.");
    }
    if (expiresAt <= new Date()) {
      throw new ValidationError("Expiration must be in the future.");
    }

    const created = await prisma.$transaction(async (tx) => {
      const code = await generateInvitationCode(tx);
      const row = await tx.invitationLink.create({
        data: {
          code,
          expiresAt,
          url: "",
          used: false,
          lineId: body.lineId,
          status: 1,
        },
      });
      // Persist the public URL using the row id we just created.
      return tx.invitationLink.update({
        where: { id: row.id },
        data: { url: `/invitation/${row.id}` },
      });
    });

    return res.code(200).send({
      message: "OK",
      id: created.id,
      code: created.code,
      url: created.url,
      expiresAt: created.expiresAt,
    });
  } catch (error) {
    if (error instanceof ValidationError) throw error;
    if (error instanceof AppError) throw error;
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw dbError(error);
    }
    throw error;
  }
};

export const invitationAuth = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  try {
    const body = req.query as { id: string };
    console.log({ body });

    if (body.id === undefined || body.id === null) {
      throw new ValidationError("BAD_REQUEST");
    }
    const invitations = await prisma.invitationLink.findUnique({
      where: {
        id: body.id,
      },
      include: {
        line: {
          select: {
            barangay: {
              select: {
                name: true,
              },
            },
            municipal: {
              select: {
                name: true,
              },
            },
            province: {
              select: {
                name: true,
              },
            },
            name: true,
          },
        },
      },
    });
    const currentDate = new Date();
    let response;
    // if (!invitations) {
    //   response = {
    //     message: "Application link not found",
    //     error: 0,
    //     data: invitations,
    //   };
    // } else if (invitations?.expiresAt && invitations.expiresAt < currentDate) {
    //   response = {
    //     message: "Application link has expired",
    //     error: 1,
    //     data: invitations,
    //   };
    // } else if (invitations?.status === 2) {
    //   response = {
    //     message: "Application link maybe suspeded or removed",
    //     error: 2,
    //     data: invitations,
    //   };
    // } else {
    //   response = {
    //     message: "Invitation link is valid",
    //     data: {
    //       ...invitations,
    //     },
    //   };
    // }
    return res.code(200).send({ data: invitations });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DB_CONNECTION_ERROR", 500, "DB_FAILED");
    }
    throw error;
  }
};

/**
 * Paginated list of active invitation links for a line.
 *
 * Excludes soft-deleted rows (status = 0). Computes an effective status
 * on the fly: any non-suspended row whose expiresAt has passed is
 * surfaced as `effectiveStatus: 3` (expired) so the UI can label it
 * accurately without needing a cron sweep.
 *
 * Status convention (matches utils/helper.inviteLinkStatus on the FE):
 *   0 = removed (filtered out)
 *   1 = active
 *   2 = suspended
 *   3 = expired
 */
export const invitations = async (req: FastifyRequest, res: FastifyReply) => {
  const params = req.query as PagingProps;
  if (!params.id) throw new ValidationError("BAD_REQUEST");

  try {
    const cursor = params.lastCursor ? { id: params.lastCursor } : undefined;
    const limit = params.limit ? parseInt(params.limit, 10) : 30;

    const where: any = { lineId: params.id, status: { not: 0 } };
    if (params.query) {
      where.code = { contains: params.query.trim(), mode: "insensitive" };
    }

    const rows = await prisma.invitationLink.findMany({
      where,
      take: limit,
      skip: cursor ? 1 : 0,
      orderBy: { createdAt: "desc" },
      cursor,
    });

    const now = new Date();
    const list = rows.map((r) => ({
      ...r,
      effectiveStatus:
        r.status === 1 && r.expiresAt && r.expiresAt <= now ? 3 : r.status,
    }));

    const newLastCursorId = list.length ? list[list.length - 1].id : null;
    const hasMore = list.length === limit;

    return res.code(200).send({
      list,
      lastCursor: newLastCursorId,
      hasMore,
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DB_CONNECTION_ERROR", 500, "DB_FAILED");
    }
    throw error;
  }
};

export const containerOverview = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const params = req.query as SupplyOverviewProps;
  if (!params.inventoryBoxId) throw new ValidationError("Required is missing!");
  try {
    const container = await prisma.inventoryBox.findUnique({
      where: {
        id: params.inventoryBoxId,
      },
      include: {
        _count: {
          select: {},
        },
      },
    });

    if (!container) {
      throw new NotFoundError("Container not found!");
    }
    res.code(200).send({ data: container });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DB CONNECTION FAILED", 500, "DB_ERROR");
    }
    throw error;
  }
};

/**
 * Soft-delete an invitation link. Marks status = 0 so the row disappears
 * from the list but stays in the DB for any historical references (e.g.
 * a registration that used this code).
 */
export const deleteInvitationLink = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const params = req.query as { id: string; userId: string; lineId: string };
  if (!params.id || !params.lineId || !params.userId) {
    throw new ValidationError("BAD_REQUEST");
  }

  try {
    const link = await prisma.invitationLink.findUnique({
      where: { id: params.id },
    });
    if (!link) throw new NotFoundError("Invitation link not found");
    if (link.status === 0) return res.code(200).send({ message: "OK" });

    await prisma.invitationLink.update({
      where: { id: link.id },
      data: { status: 0 },
    });
    return res.code(200).send({ message: "OK", id: link.id });
  } catch (error) {
    if (error instanceof NotFoundError) throw error;
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw dbError(error);
    }
    throw error;
  }
};

/**
 * Toggle an invitation link between active (1) and suspended (2).
 * Refuses to flip a removed (0) or expired link.
 */
export const suspendInvitationLink = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const body = req.body as {
    id: string;
    suspend: boolean;
    userId: string;
    lineId: string;
  };
  if (!body.id || !body.lineId) throw new ValidationError("BAD_REQUEST");

  try {
    const link = await prisma.invitationLink.findUnique({
      where: { id: body.id },
    });
    if (!link) throw new NotFoundError("Invitation link not found");
    if (link.status === 0) {
      throw new ValidationError("Cannot modify a removed link.");
    }
    const nextStatus = body.suspend ? 2 : 1;
    if (link.status === nextStatus) {
      return res.code(200).send({ message: "OK", status: link.status });
    }
    const updated = await prisma.invitationLink.update({
      where: { id: link.id },
      data: { status: nextStatus },
    });
    return res.code(200).send({ message: "OK", status: updated.status });
  } catch (error) {
    if (error instanceof NotFoundError) throw error;
    if (error instanceof ValidationError) throw error;
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw dbError(error);
    }
    throw error;
  }
};

export const submitToInvitationLink = async (
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

    // Invitation-link registration is LINE-level (no specific job post /
    // position). Validate the invitation and use its line.
    const invitation = await prisma.invitationLink.findUnique({
      where: { id: formData.invitationId },
      select: {
        id: true,
        lineId: true,
        status: true,
        line: { select: { id: true, name: true } },
      },
    });

    if (!invitation) {
      throw new NotFoundError("INVITATION NOT FOUND");
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

        // spouse (top-level form fields)
        spouseSurname: formData.spouseSurname,
        spouseFirstname: formData.spouseFirstname,
        spouseMiddle: formData.spouseMiddle,

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

        // CS Form 212 sections VI–VIII + references + disclosures.
        voluntaryWork: parseArrayField("voluntaryWork", []),
        learningDev: parseArrayField("learningDev", []),
        otherInfo: parseArrayField("otherInfo", []),
        references: parseArrayField("references", []),
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

      spouseSurname: clean.spouseSurname,
      spouseFirstname: clean.spouseFirstname,
      spouseMiddle: clean.spouseMiddle,

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
      // Municipal is only used for the confirmation email greeting — it's
      // optional. A line-level invitation only needs the invitation's line.
      const municipal = formData.municipalId
        ? await tx.municipal.findUnique({ where: { id: formData.municipalId } })
        : null;
      const orgName = municipal?.name ?? invitation.line?.name ?? "the LGU";

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

        // SPOUSE
        spouseSurname: encrypted.spouseSurname?.encryptedData || "N/A",
        spouseSurnameIv: encrypted.spouseSurname?.iv || null,
        spouseFirstname: encrypted.spouseFirstname?.encryptedData || "N/A",
        spouseFirstnameIv: encrypted.spouseFirstname?.iv || null,
        spouseMiddle: encrypted.spouseMiddle?.encryptedData || "N/A",
        spouseMiddleIv: encrypted.spouseMiddle?.iv || null,

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

        // job linking — invitation registration is line-level (no position)
        lineId: invitation.lineId,
        positionId: null,
        unitPositionId: null,
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

      return { applicationId: application.id, orgName };
    });

    // Confirmation email + SMS are NON-FATAL and run OUTSIDE the transaction:
    // the application is already committed, so a mail/SMS failure must never
    // roll it back or 500 the request.
    const lineName = invitation.line?.name ?? result.orgName;
    if (formData.email) {
      try {
        await sendEmail(
          "Application Received",
          formData.email,
          `Dear ${formData.firstName} ${formData.lastName},

This is to confirm that we have successfully received your application at ${lineName}.

We will inform you of any further instructions regarding the next steps in the hiring process once your application has been reviewed.

You can check the status of your application by clicking this link: ${officialUrl}/public/application/${result.applicationId}

Sincerely,
The HR Team
${result.orgName}`,
          `${result.orgName} HR Team`,
        );
      } catch (mailErr) {
        console.warn(
          "[invitation submit] confirmation email failed:",
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

This is to confirm that we have successfully received your application at ${lineName}.

We will inform you of any further instructions regarding the next steps in the hiring process once your application has been reviewed.

Sincerely,
The HR Team
${result.orgName}`,
            apikey: semaphoreKey,
          },
          { headers: { "Content-Type": "application/json" } },
        );
      } catch (smsErr) {
        console.warn(
          "[invitation submit] confirmation SMS failed:",
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
