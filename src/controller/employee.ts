import fastify, { FastifyRequest, FastifyReply } from "../barrel/fastify";
import { Prisma, prisma } from "../barrel/prisma";
import { AppError, NotFoundError, ValidationError } from "../errors/errors";
import { EmployeesProps } from "../models/Employee";
import { PagingProps } from "../models/route";
import { getYearRange } from "../utils/date";
import { EncryptionService } from "../service/encryption";
import { getAreaData } from "../middleware/handler";
import {
  PROVISIONAL_STATUSES,
  PROVISIONAL_ENDED,
} from "./provisionalController";
import QRCode from "qrcode";
import { randomUUID } from "crypto";
import { tempURL } from "../service/url";
import { getCardExtras } from "./idCardController";

export const getAllEmpoyees = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  try {
    const {
      page,
      office,
      sgFrom,
      sgTo,
      year,
      dateApp,
      dateLast,
      lastCursorId,
      query,
    } = req.body as EmployeesProps;
    if (!page) {
      return res.code(400).send({ message: "Bad request" });
    }
    const filter: any = {};

    // Keep provisional (temporary/contract) staff — and ended provisional
    // engagements — out of the plantilla Employees list. They live in the
    // Provisional > Personnel tab.
    filter.status = { notIn: [...PROVISIONAL_STATUSES, PROVISIONAL_ENDED] };

    if (office) {
      filter.departmentId = office;
    }
    if (sgFrom || sgTo) {
      if (sgFrom) {
        filter.SalaryGrade = {
          grade: { equals: sgFrom },
        };
      }

      if (sgTo) {
        filter.SalaryGrade = {
          grade: { equals: sgTo },
        };
      }

      if (sgFrom && sgTo) {
        filter.SalaryGrade = {
          AND: [{ grade: { gte: sgFrom } }, { grade: { lte: sgTo } }],
        };
      }
    }
    const yearFilter =
      year !== "all"
        ? {
            Promotions: {
              some: {
                timestamp: getYearRange(year),
              },
            },
          }
        : {};

    if (query) {
      const searchTerms = query.trim().split(/\s+/); // Split on any whitespace

      if (searchTerms.length === 1) {
        filter.OR = [
          { lastName: { contains: searchTerms[0], mode: "insensitive" } },
          { firstName: { contains: searchTerms[0], mode: "insensitive" } },
          { middleName: { contains: searchTerms[0], mode: "insensitive" } },
        ];
      } else {
        filter.AND = searchTerms.map((term) => ({
          OR: [
            { firstname: { contains: term, mode: "insensitive" } },
            { lastname: { contains: term, mode: "insensitive" } },
          ],
        }));

        filter.OR = [
          { AND: filter.AND },
          { middleName: { contains: query.trim(), mode: "insensitive" } },
        ];
        delete filter.AND; // Remove the AND since we've incorporated it into OR
      }
    }
    const cursor = lastCursorId ? { id: lastCursorId } : undefined;
    const response = await prisma.user.findMany({
      where: {
        ...filter,
        ...yearFilter,
      },
      cursor,
      take: 20,
      include: {
        department: true,
        SalaryGrade: true,
        Promotions: true,
      },
    });

    const newLastCursorId =
      response.length > 0 ? response[response.length - 1].id : null;

    const hasMore = response.length === 20;

    return res
      .code(200)
      .send({ list: response, lastCursorId: newLastCursorId, hasMore });
  } catch (error) {
    console.log(error);

    res.code(500).send({ message: "Internal Server Error" });
  }
};

export const searchUser = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const { query, limit, lastCursor, inUnitOnly, departId } =
      req.query as PagingProps;
    console.log(query, limit, lastCursor, inUnitOnly, departId);

    const filter: any = {};
    if (inUnitOnly && departId) {
      filter.departmentId = departId;
    }
    if (query) {
      const searchTerms = query.trim().split(/\s+/); // Split on any whitespace

      if (searchTerms.length === 1) {
        filter.OR = [
          { lastName: { contains: searchTerms[0], mode: "insensitive" } },
          { firstName: { contains: searchTerms[0], mode: "insensitive" } },
          { middleName: { contains: searchTerms[0], mode: "insensitive" } },
        ];
      } else {
        filter.AND = searchTerms.map((term) => ({
          OR: [
            { firstname: { contains: term, mode: "insensitive" } },
            { lastname: { contains: term, mode: "insensitive" } },
          ],
        }));

        filter.OR = [
          { AND: filter.AND },
          { middleName: { contains: query.trim(), mode: "insensitive" } },
        ];
        delete filter.AND; // Remove the AND since we've incorporated it into OR
      }
    }

    const cursor = lastCursor ? { id: lastCursor } : undefined;

    const response = await prisma.user.findMany({
      where: filter,
      cursor,
      take: parseInt(limit, 10),
      skip: parseInt(limit, 10),
      include: {
        userProfilePictures: {
          select: {
            file_name: true,
            file_url: true,
            file_size: true,
          },
        },
      },
    });

    const newLastCursorId =
      response.length > 0 ? response[response.length - 1].id : null;
    const hasMore = response.length === parseInt(limit, 10);

    return res
      .code(200)
      .send({ list: response, lastCursor: newLastCursorId, hasMore });
  } catch (error) {
    res.code(500).send({ message: "Internal Server Error" });
  }
};

export const employees = async (req: FastifyRequest, res: FastifyReply) => {
  const params = req.query as PagingProps;

  if (!params.id) throw new ValidationError("BAD_REQUEST");

  try {
    const cursor = params.lastCursor ? { id: params.lastCursor } : undefined;
    const filter: any = {};
    const limit = params.limit ? parseInt(params.limit, 10) : 20;

    if (params.query) {
      const searchTerms = params.query.trim().split(/\s+/); // Split on any whitespace

      if (searchTerms.length === 1) {
        filter.OR = [
          { lastName: { contains: searchTerms[0], mode: "insensitive" } },
          { firstName: { contains: searchTerms[0], mode: "insensitive" } },
          { middleName: { contains: searchTerms[0], mode: "insensitive" } },
          { username: { contains: searchTerms[0], mode: "insensitive" } },
          { email: { contains: searchTerms[0], mode: "insensitive" } },
        ];
      } else {
        filter.AND = searchTerms.map((term) => ({
          OR: [
            { firstName: { contains: term, mode: "insensitive" } },
            { lastName: { contains: term, mode: "insensitive" } },
            { middleName: { contains: term, mode: "insensitive" } },
            { username: { contains: term, mode: "insensitive" } },
            { email: { contains: term, mode: "insensitive" } },
          ],
        }));

        filter.OR = [
          { AND: filter.AND },
          {
            middleName: { contains: params.query.trim(), mode: "insensitive" },
          },
        ];
        delete filter.AND;
      }
    }

    if (params.departId && params.departId !== "all") {
      filter.departmentId = params.departId;
    }

    const response = await prisma.user.findMany({
      where: {
        lineId: params.id,
        // Concluded/separated personnel live on the Archived page, not here.
        archivedAt: null,
        ...filter,
      },
      skip: cursor ? 1 : 0,
      take: limit,
      cursor,
      select: {
        userProfilePictures: {
          select: {
            file_name: true,
            file_size: true,
            file_url: true,
          },
        },
        id: true,
        firstName: true,
        lastName: true,
        middleName: true,
        suffix: true,
        username: true,
        email: true,
        birthDate: true,
        PositionSlot: {
          select: {
            pos: {
              select: {
                name: true,
              },
            },
          },
        },
        Position: {
          select: {
            name: true,
          },
        },
        department: {
          select: {
            name: true,
            id: true,
          },
        },
      },
    });

    const newLastCursorId =
      response.length > 0 ? response[response.length - 1].id : null;
    const hasMore = response.length === limit;

    return res
      .code(200)
      .send({ list: response, lastCursor: newLastCursorId, hasMore });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DATABASE_CONNECTION_ERROR", 500, "DB_FAILED");
    }
    throw error;
  }
};

export const viewUserProfile = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const params = req.query as { userProfileId: string; userId: string };

  if (!params.userProfileId || !params.userId)
    throw new ValidationError("INVALID REQUIRED ID");
  try {
    const response = await prisma.$transaction(async (tx) => {
      const currUser = await tx.user.findUnique({
        where: { id: params.userId },
      });

      const targetUser = await tx.user.findUnique({
        where: { id: params.userProfileId },
      });

      if (!currUser || !targetUser) throw new ValidationError("USER NOT FOUND");

      await tx.profileView.create({
        data: {
          userId: currUser.id,
          targetUserId: targetUser.id,
          descryption: true,
        },
      });

      return "OK";
    });
    if (!response) throw new ValidationError("FAILED TO VIEW");
    return res.code(200).send({ message: "OK" });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DATABASE_CONNECTION_ERROR", 500, "DB_FAILED");
    }
    throw error;
  }
};

export const decryptUserData = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const params = req.query as { userProfileId: string };

  if (!params.userProfileId) throw new ValidationError("INVALID REQUIRED ID");

  try {
    const targetUser = await prisma.user.findUnique({
      where: {
        id: params.userProfileId,
      },
      select: {
        username: true,
        createdAt: true,
        accountId: true,
        status: true,
        firstName: true,
        lastName: true,
        account: {
          select: {
            status: true,
          },
        },
        department: {
          select: {
            name: true,
          },
        },
        // Position + salary grade so the profile can render the role and
        // level badges. Relations are PascalCase on the User model.
        Position: {
          select: {
            id: true,
            name: true,
          },
        },
        SalaryGrade: {
          select: {
            id: true,
            grade: true,
            amount: true,
          },
        },
        userProfilePictures: { select: { file_url: true } },
        email: true,
        emailIv: true,
        submittedApplications: {
          select: {
            firstname: true,
            lastname: true,
            middleName: true,
            email: true,
            emailIv: true,
            birthDate: true,
            bdayIv: true,
            mobileNo: true,
            ivMobileNo: true,
            agencyNo: true,
            agencyNoIv: true,
            cvilStatus: true,
            cvilStatusIv: true,
            pagIbigNo: true,
            pagIbigNoIv: true,
            tinNo: true,
            tinNoIv: true,
            philSys: true,
            philSysIv: true,
            umidNo: true,
            umidNoIv: true,
            elementary: true,
            secondary: true,
            vocational: true,
            college: true,
            graduateCollege: true,
            civilService: true,
            children: true,
            childrenIv: true,
            fatherFirstname: true,
            fatherFirstnameIv: true,
            fatherMiddlename: true,
            fatherSurname: true,
            fatherSurnameIv: true,
            motherFirstname: true,
            motherFirstnameIv: true,
            motherMiddlename: true,
            motherMiddlenameIv: true,
            motherSurname: true,
            motherSurnameIv: true,
            spouseFirstname: true,
            spouseFirstnameIv: true,
            spouseMiddle: true,
            spouseMiddleIv: true,
            spouseSurname: true,
            spouseSurnameIv: true,
            resBarangay: true,
            resBarangayIv: true,
            resCity: true,
            resCityIv: true,
            resProvince: true,
            resProvinceIv: true,
            reshouseBlock: true,
            reshouseBlockIv: true,
            resStreet: true,
            resZipCode: true,
            resZipCodeIv: true,
            resStreetIv: true,
            permaBarangay: true,
            permaBarangayIv: true,
            permaCity: true,
            permaCityIv: true,
            permaProvince: true,
            permaStreet: true,
            permaStreetIv: true,
            permaZipCode: true,
            permaZipCodeIv: true,
            permahouseBlock: true,
            permahouseBlockIv: true,
            permaProvinceIv: true,
            permaSub: true,
            permaSubIv: true,
            experience: true,
          },
        },
        modules: {
          select: {
            moduleName: true,
            id: true,
          },
        },
      },
    });

    if (!targetUser) throw new NotFoundError("USER NOT FOUND!");

    // ── Legacy application recovery ──────────────────────────────────
    // Some accounts have no linked SubmittedApplication — either they were
    // created before the application↔user link was wired, or their
    // application was submitted under a different line. Without the link
    // the mobile profile wrongly reports "HR application hasn't been
    // submitted." Recover it by matching the user's name + decrypted email
    // against orphaned applications (userId still null), then self-heal the
    // link so subsequent reads use the direct relation.
    if (!targetUser.submittedApplications) {
      try {
        const decOne = async (d: string | null, iv: string | null) => {
          if (!d || !iv) return null;
          try {
            return await EncryptionService.decrypt(d, iv);
          } catch {
            return null;
          }
        };

        const userEmail =
          (await decOne(targetUser.email, targetUser.emailIv))?.toLowerCase() ??
          null;

        const candidates = await prisma.submittedApplication.findMany({
          where: {
            userId: null,
            firstname: { equals: targetUser.firstName, mode: "insensitive" },
            lastname: { equals: targetUser.lastName, mode: "insensitive" },
          },
          orderBy: { id: "desc" }, // most-recent submission first
        });

        let recovered: (typeof candidates)[number] | null = null;
        for (const c of candidates) {
          // Name + email is a strong identity match. If the user has no
          // stored email to compare, fall back to the name match alone.
          if (!userEmail) {
            recovered = c;
            break;
          }
          const e = (await decOne(c.email, c.emailIv))?.toLowerCase();
          if (e && e === userEmail) {
            recovered = c;
            break;
          }
        }

        if (recovered) {
          // Best-effort self-heal — bind the application to this user so we
          // never need to recover again (ignore unique-constraint races).
          try {
            await prisma.submittedApplication.update({
              where: { id: recovered.id },
              data: { userId: params.userProfileId },
            });
          } catch (e) {
            console.warn("[decryptUserData] self-heal link failed:", e);
          }
          // Feed the recovered row into the decrypt pipeline below. It's a
          // superset of the original select, so every field accessed there
          // is present.
          (targetUser as any).submittedApplications = recovered;
        }
      } catch (e) {
        console.warn("[decryptUserData] application recovery failed:", e);
      }
    }

    // Create a mutable copy of the user object with proper typing
    const decryptedUser: any = {
      username: targetUser.username,
      createdAt: targetUser.createdAt,
      accountId: targetUser.accountId,
      status: targetUser.status,
      account: targetUser.account,
      modules: targetUser.modules,
      firstName: targetUser.firstName,
      lastName: targetUser.lastName,
      department: targetUser.department,
      // Position + salary grade. Expose under both the relation name the
      // web app already reads (Position/SalaryGrade) and a lowercase
      // `position` alias the mobile profile consumes.
      Position: targetUser.Position,
      position: targetUser.Position,
      SalaryGrade: targetUser.SalaryGrade,
      userProfilePictures: targetUser.userProfilePictures,
    };

    // Decrypt submitted application if it exists
    if (targetUser.submittedApplications) {
      const application = targetUser.submittedApplications;

      // Helper function to decrypt field if it exists
      const decryptField = async (
        encryptedData: string | null,
        iv: string | null,
      ): Promise<string | null> => {
        if (encryptedData && iv) {
          try {
            return await EncryptionService.decrypt(encryptedData, iv);
          } catch (error) {
            console.log(encryptedData, "das", iv);
            console.error(`Failed to decrypt field:`, error);
            return encryptedData; // Return original if decryption fails
          }
        }
        return encryptedData;
      };

      // Create decrypted application object
      const decryptedApplication: any = {
        firstname: targetUser.submittedApplications.firstname,
        lastname: targetUser.submittedApplications.lastname,
        middleName: targetUser.submittedApplications.middleName,
        elementary: targetUser.submittedApplications.elementary,
        secondary: targetUser.submittedApplications.secondary,
        vocational: targetUser.submittedApplications.vocational,
        college: targetUser.submittedApplications.college,
        graduateCollege: targetUser.submittedApplications.graduateCollege,
        civilService: targetUser.submittedApplications.civilService,
        fatherMiddlename: targetUser.submittedApplications.fatherMiddlename,
        reshouseBlock: targetUser.submittedApplications.reshouseBlock,
        resStreet: targetUser.submittedApplications.resStreet,
        resZipCode: targetUser.submittedApplications.resZipCode,
        permaStreet: targetUser.submittedApplications.permaStreet,
        permaZipCode: targetUser.submittedApplications.permaZipCode,
        permahouseBlock: targetUser.submittedApplications.permahouseBlock,
        permaSub: targetUser.submittedApplications.permaSub,
        experience: targetUser.submittedApplications.experience,
      };

      const permaBarangayCode = await decryptField(
        targetUser.submittedApplications.permaBarangay,
        targetUser.submittedApplications.permaBarangayIv,
      );
      const permaMunicipalCode = await decryptField(
        targetUser.submittedApplications.permaCity,
        targetUser.submittedApplications.permaCityIv,
      );
      const permaProvinceCode = await decryptField(
        targetUser.submittedApplications.permaProvince,
        targetUser.submittedApplications.permaProvinceIv,
      );

      const resBarangayCode = await decryptField(
        targetUser.submittedApplications.resBarangay,
        targetUser.submittedApplications.resBarangayIv,
      );

      const resMuicipalCode = await decryptField(
        targetUser.submittedApplications.resCity,
        targetUser.submittedApplications.resCityIv,
      );

      const resProvinceCode = await decryptField(
        targetUser.submittedApplications.resProvince,
        targetUser.submittedApplications.resProvinceIv,
      );

      // Decrypt each field and assign to decryptedApplication
      decryptedApplication.email = await decryptField(
        targetUser.email,
        targetUser.emailIv,
      );
      decryptedApplication.birthDate = await decryptField(
        application.birthDate,
        application.bdayIv,
      );
      decryptedApplication.mobileNo = await decryptField(
        application.mobileNo,
        application.ivMobileNo,
      );
      decryptedApplication.agencyNo = await decryptField(
        application.agencyNo,
        application.agencyNoIv,
      );
      decryptedApplication.cvilStatus = await decryptField(
        application.cvilStatus,
        application.cvilStatusIv,
      );
      decryptedApplication.pagIbigNo = await decryptField(
        application.pagIbigNo,
        application.pagIbigNoIv,
      );
      decryptedApplication.tinNo = await decryptField(
        application.tinNo,
        application.tinNoIv,
      );
      decryptedApplication.philSys = await decryptField(
        application.philSys,
        application.philSysIv,
      );
      decryptedApplication.umidNo = await decryptField(
        application.umidNo,
        application.umidNoIv,
      );
      decryptedApplication.children = await decryptField(
        application.children,
        application.childrenIv,
      );
      decryptedApplication.fatherFirstname = await decryptField(
        application.fatherFirstname,
        application.fatherFirstnameIv,
      );
      decryptedApplication.fatherSurname = await decryptField(
        application.fatherSurname,
        application.fatherSurnameIv,
      );
      decryptedApplication.motherFirstname = await decryptField(
        application.motherFirstname,
        application.motherFirstnameIv,
      );
      decryptedApplication.motherMiddlename = await decryptField(
        application.motherMiddlename,
        application.motherMiddlenameIv,
      );
      decryptedApplication.motherSurname = await decryptField(
        application.motherSurname,
        application.motherSurnameIv,
      );
      decryptedApplication.spouseFirstname = await decryptField(
        application.spouseFirstname,
        application.spouseFirstnameIv,
      );
      decryptedApplication.spouseMiddle = await decryptField(
        application.spouseMiddle,
        application.spouseMiddleIv,
      );
      decryptedApplication.spouseSurname = await decryptField(
        application.spouseSurname,
        application.spouseSurnameIv,
      );

      const resProvince = resProvinceCode
        ? await getAreaData(resProvinceCode, 0)
        : null;
      const resMunicipal = resMuicipalCode
        ? await getAreaData(resMuicipalCode, 1)
        : null;
      const resBarangay = resBarangayCode
        ? await getAreaData(resBarangayCode, 2)
        : null;

      const permaBarangay = permaBarangayCode
        ? await getAreaData(permaBarangayCode, 2)
        : null;

      const permaMunicipa = permaMunicipalCode
        ? await getAreaData(permaMunicipalCode, 1)
        : null;

      const permaProvince = permaProvinceCode
        ? await getAreaData(permaProvinceCode, 0)
        : null;

      decryptedApplication.resBarangay = resBarangay?.name;
      decryptedApplication.resCity = resMunicipal?.name;
      decryptedApplication.resProvince = resProvince?.name;
      decryptedApplication.permaBarangay = permaBarangay?.name;
      decryptedApplication.permaCity = permaMunicipa?.name;
      decryptedApplication.permaProvince = permaProvince?.name;

      decryptedUser.submittedApplications = decryptedApplication;
    }

    return res.code(200).send(decryptedUser);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DATABASE_CONNECTION_ERROR", 500, "DB_FAILED");
    }
    throw error;
  }
};
export const supsendAccount = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const body = req.body as {
    userId: string;
    accountId: string;
    lineId: string;
  };
  console.log({ body });

  if (!body.accountId || !body.userId || !body.lineId)
    throw new ValidationError("INVALID REQUIRED ID");

  try {
    const response = await prisma.$transaction(async (tx) => {
      const targetuser = await tx.account.findUnique({
        where: {
          id: body.accountId,
        },
      });

      if (!targetuser) throw new NotFoundError("USER NOT FOUND!");
      if (targetuser.status === 0)
        throw new ValidationError("ALREADY SUSPENDED");
      const updated = await tx.account.update({
        where: {
          id: targetuser.id,
        },
        data: {
          status: 2,
        },
      });

      await tx.humanResourcesLogs.create({
        data: {
          desc: `Suspend ${updated.username} account.`,
          userId: body.userId,
          lineId: body.lineId,
          action: "UPDATE",
        },
      });

      return "OK";
    });

    if (!response) throw new ValidationError("FAILED TO FETCH");
    return res.code(200).send({ message: "OK" });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DB_CONNECTION_ERROR", 500, "DB_FAILED");
    }
    throw error;
  }
};

export const userModuleAccess = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  // Super-admin impersonation session (imp:true) → full access; skip the
  // per-user module check so access never depends on the target line's setup.
  try {
    const authz = req.headers.authorization?.split(" ")[1];
    const decoded = authz
      ? (req.server.jwt.decode(authz) as { imp?: boolean } | null)
      : null;
    if (decoded?.imp === true) {
      return res.code(200).send({ message: "OK" });
    }
  } catch {
    /* fall through to the normal per-user check */
  }

  const params = req.query as {
    moduleName: string;
    userId: string;
    lineId: string;
  };
  console.log({ params });

  if (!params.userId || !params.moduleName)
    throw new ValidationError("INVALID REQUIRED FIELD");
  try {
    const paths = params.moduleName.split("/");
    console.log({ paths });

    const response = await prisma.module.findFirst({
      where: {
        moduleName: paths[2],
        userId: params.userId,
      },
    });
    console.log({ response });

    if (!response) {
      await prisma.activityLogs.create({
        data: {
          userId: params.userId,
          action: 2,
          desc: `Unauthorized access attempt to module: ${params.moduleName}`,
          lineId: params.lineId,
        },
      });
      return res.code(401).send({ message: "UNAUTHORIZED ACCESS" });
    }

    return res.code(200).send({ message: "OK" });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
    }
    throw error;
  }
};

export const deleteUser = async (req: FastifyRequest, res: FastifyReply) => {
  const params = req.query as { id: string; userId: string; lineId: string };
  console.log({ params });

  if (!params.id || !params.lineId || !params.userId) {
    throw new ValidationError("INVALID REQUIRED ID");
  }

  if (params.id === params.userId) {
    throw new ValidationError("INVALID ID");
  }

  try {
    const response = await prisma.$transaction(async (tx) => {
      const account = await tx.account.delete({
        where: {
          id: params.id,
        },
      });

      await tx.humanResourcesLogs.create({
        data: {
          userId: params.userId,
          lineId: params.lineId,
          action: "DELETE",
          desc: `REMOVE USER: ${account.username} `,
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

// GET /user/record?userId=&lineId=
// Read-only platform history for one person, merged into a single timeline:
//   • appointment — position/slot placements (UnitPositionHistory)
//   • employment  — provisional hire/renew/transfer/end. HR logs are keyed by
//                   the ACTOR, so we match the subject by their plain-text name
//                   inside the log description (how those actions write it).
//   • leave       — leave records (Leave)
//   • activity    — account/system activity (ActivityLogs)
export const userRecord = async (req: FastifyRequest, res: FastifyReply) => {
  const q = req.query as { userId?: string; lineId?: string };
  if (!q.userId) throw new ValidationError("INVALID REQUIRED USER ID");

  const user = await prisma.user.findUnique({
    where: { id: q.userId },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      status: true,
      term: true,
      lineId: true,
    },
  });
  if (!user) throw new NotFoundError("USER NOT FOUND");

  const lineId = q.lineId || user.lineId || undefined;
  const TAKE = 100;

  const [appointments, leaves, activity, hrLogs] = await Promise.all([
    prisma.unitPositionHistory.findMany({
      where: { userId: user.id },
      orderBy: { timestamp: "desc" },
      take: TAKE,
      select: {
        id: true,
        timestamp: true,
        unitPost: {
          select: {
            designation: true,
            itemNumber: true,
            position: { select: { name: true } },
            unit: { select: { name: true } },
          },
        },
      },
    }),
    prisma.leave.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      take: TAKE,
      select: {
        id: true,
        type: true,
        days: true,
        startDate: true,
        endDate: true,
        status: true,
        createdAt: true,
      },
    }),
    prisma.activityLogs.findMany({
      where: { userId: user.id },
      orderBy: { timestamp: "desc" },
      take: TAKE,
      select: { id: true, action: true, desc: true, timestamp: true },
    }),
    lineId
      ? prisma.humanResourcesLogs.findMany({
          where: {
            lineId,
            desc: {
              contains: `${user.firstName} ${user.lastName}`,
              mode: "insensitive",
            },
          },
          orderBy: { timestamp: "desc" },
          take: TAKE,
          select: { id: true, action: true, desc: true, timestamp: true },
        })
      : Promise.resolve([] as { id: string; action: string; desc: string; timestamp: Date }[]),
  ]);

  type Item = {
    id: string;
    type: "appointment" | "employment" | "leave" | "activity";
    title: string;
    detail: string;
    timestamp: Date;
  };
  const timeline: Item[] = [];

  for (const a of appointments) {
    const pos =
      a.unitPost?.position?.name || a.unitPost?.designation || "a position";
    const bits = [
      a.unitPost?.unit?.name,
      a.unitPost?.itemNumber && a.unitPost.itemNumber !== "N/A"
        ? `Item ${a.unitPost.itemNumber}`
        : null,
    ].filter(Boolean);
    timeline.push({
      id: `appt-${a.id}`,
      type: "appointment",
      title: `Appointed to ${pos}`,
      detail: bits.join(" · "),
      timestamp: a.timestamp,
    });
  }
  for (const l of leaves) {
    timeline.push({
      id: `leave-${l.id}`,
      type: "leave",
      title: `${l.type} leave — ${l.status}`,
      detail: `${l.days} day(s) · ${new Date(l.startDate).toLocaleDateString()} – ${new Date(l.endDate).toLocaleDateString()}`,
      timestamp: l.createdAt,
    });
  }
  for (const h of hrLogs) {
    timeline.push({
      id: `hr-${h.id}`,
      type: "employment",
      title: h.desc,
      detail: h.action,
      timestamp: h.timestamp,
    });
  }
  for (const ac of activity) {
    timeline.push({
      id: `act-${ac.id}`,
      type: "activity",
      title: ac.desc || `Activity #${ac.action}`,
      detail: "",
      timestamp: ac.timestamp,
    });
  }

  timeline.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

  return res.code(200).send({
    user: {
      id: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      status: user.status,
      term: user.term,
    },
    counts: {
      appointment: appointments.length,
      employment: hrLogs.length,
      leave: leaves.length,
      activity: activity.length,
    },
    timeline,
  });
};

// GET /archived-personnel?id=lineId&query&lastCursor&limit
// Concluded/separated personnel (plantilla + non-plantilla) — anyone with an
// archivedAt set. Mirrors the Employees select plus status/term/archive info.
export const archivedPersonnel = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const params = req.query as PagingProps;
  if (!params.id) throw new ValidationError("BAD_REQUEST");

  try {
    const cursor = params.lastCursor ? { id: params.lastCursor } : undefined;
    const limit = params.limit ? parseInt(params.limit, 10) : 20;
    const filter: any = {};

    if (params.query) {
      const q = params.query.trim();
      filter.OR = [
        { lastName: { contains: q, mode: "insensitive" } },
        { firstName: { contains: q, mode: "insensitive" } },
        { middleName: { contains: q, mode: "insensitive" } },
        { username: { contains: q, mode: "insensitive" } },
      ];
    }

    const response = await prisma.user.findMany({
      where: {
        lineId: params.id,
        // "archived" = archivedAt is set. Prisma 7 rejects { not: null }, so
        // express it as NOT { archivedAt: null }.
        NOT: { archivedAt: null },
        ...filter,
      },
      skip: cursor ? 1 : 0,
      take: limit,
      cursor,
      orderBy: [{ archivedAt: "desc" }, { id: "desc" }],
      select: {
        id: true,
        firstName: true,
        lastName: true,
        middleName: true,
        username: true,
        status: true,
        term: true,
        archivedAt: true,
        archiveReason: true,
        userProfilePictures: { select: { file_url: true } },
        PositionSlot: { select: { pos: { select: { name: true } } } },
        Position: { select: { name: true } },
        department: { select: { name: true, id: true } },
      },
    });

    const newLastCursorId =
      response.length > 0 ? response[response.length - 1].id : null;
    const hasMore = response.length === limit;

    return res
      .code(200)
      .send({ list: response, lastCursor: newLastCursorId, hasMore });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DATABASE_CONNECTION_ERROR", 500, "DB_FAILED");
    }
    throw error;
  }
};

// POST /archived-personnel/restore  { userId, lineId, actorId }
// Un-archive a person and re-enable their account login.
export const restorePersonnel = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const body = req.body as {
    userId?: string;
    lineId?: string;
    actorId?: string;
  };
  if (!body.userId || !body.lineId) {
    throw new ValidationError("INVALID REQUIRED FIELDS");
  }
  const lineId = body.lineId;
  const actorId = body.actorId;

  const user = await prisma.user.findFirst({
    where: { id: body.userId, lineId },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      accountId: true,
    },
  });
  if (!user) throw new NotFoundError("USER NOT FOUND");

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: user.id },
      data: { archivedAt: null, archiveReason: null },
    });
    if (user.accountId) {
      await tx.account.update({
        where: { id: user.accountId },
        data: { active: true, status: 1 },
      });
    }
    if (actorId) {
      await tx.humanResourcesLogs.create({
        data: {
          action: "UPDATE",
          desc: `RESTORED -> ${user.firstName} ${user.lastName} un-archived and account re-enabled`,
          lineId,
          userId: actorId,
        },
      });
    }
  });

  return res.code(200).send({ message: "OK" });
};

// GET /user/verify-info?userId=   (authenticated)
// Returns the employee's verification QR (data URL) + the verify link. The code
// is a stable per-user token (generated once); the QR encodes the public
// /verify-id page so anyone can confirm the ID against the live record.
export const userVerifyInfo = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const q = req.query as { userId?: string };
  if (!q.userId) throw new ValidationError("INVALID REQUIRED USER ID");
  const user = await prisma.user.findUnique({
    where: { id: q.userId },
    select: { id: true, verifyCode: true },
  });
  if (!user) throw new NotFoundError("USER NOT FOUND");

  let code = user.verifyCode;
  if (!code) {
    code = randomUUID().replace(/-/g, "");
    await prisma.user.update({
      where: { id: user.id },
      data: { verifyCode: code },
    });
  }

  const base = (tempURL() || "").replace(/\/+$/, "");
  const verifyUrl = `${base}/verify-id?code=${code}`;
  const qr = await QRCode.toDataURL(verifyUrl, { margin: 1, width: 1024 });
  // optional ID-card fields (PII) — safe here since this route is authenticated
  const extras = await getCardExtras(user.id);
  return res.code(200).send({ code, verifyUrl, qr, extras });
};

// GET /id/verify?code=   (PUBLIC — scanned from the ID's QR)
// Confirms whether the code maps to a real, currently-active employee.
export const verifyId = async (req: FastifyRequest, res: FastifyReply) => {
  const q = req.query as { code?: string };
  if (!q.code) throw new ValidationError("INVALID CODE");
  const user = await prisma.user.findUnique({
    where: { verifyCode: q.code },
    select: {
      firstName: true,
      lastName: true,
      middleName: true,
      suffix: true,
      status: true,
      archivedAt: true,
      userProfilePictures: { select: { file_url: true } },
      account: { select: { active: true } },
      department: { select: { name: true } },
      Position: { select: { name: true } },
      PositionSlot: { select: { pos: { select: { name: true } } } },
      line: { select: { name: true } },
    },
  });
  if (!user) return res.code(200).send({ found: false, valid: false });

  const active = user.account?.active !== false && !user.archivedAt;
  const position =
    user.PositionSlot?.pos?.name || user.Position?.name || user.status || null;
  return res.code(200).send({
    found: true,
    valid: active,
    fullName: [user.firstName, user.middleName, user.lastName, user.suffix]
      .filter(Boolean)
      .join(" "),
    position,
    department: user.department?.name ?? null,
    line: user.line?.name ?? null,
    status: user.status,
    photoUrl: user.userProfilePictures?.file_url ?? null,
  });
};

// the API's own public base (so file_url resolves for <img> and the PDF fetch)
const selfBase = (req: FastifyRequest): string => {
  const env = process.env.API_PUBLIC_URL;
  if (env) return env.replace(/\/+$/, "");
  const proto = String(
    req.headers["x-forwarded-proto"] || req.protocol || "http",
  ).split(",")[0];
  const host = (req.headers["x-forwarded-host"] as string) || req.headers.host;
  return `${proto}://${host}`;
};

// POST /user/profile-picture   (authenticated, multipart)
// Store the picture directly in Postgres (bytea). file_url points to the
// serve endpoint below so every existing consumer keeps working.
export const updateProfilePicture = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  if (!req.isMultipart()) throw new ValidationError("NOT_MULTIPART");

  let userId = "";
  let file: { filename: string; mimetype: string; buffer: Buffer } | null =
    null;
  for await (const part of req.parts()) {
    if (part.type === "file") {
      const chunks: Buffer[] = [];
      for await (const chunk of part.file) chunks.push(chunk as Buffer);
      file = {
        filename: part.filename,
        mimetype: part.mimetype,
        buffer: Buffer.concat(chunks),
      };
    } else if (part.fieldname === "userId") {
      userId = String(part.value);
    }
  }

  if (!userId || !file) throw new ValidationError("MISSING_FILE_OR_USER");
  if (!file.mimetype.startsWith("image/"))
    throw new ValidationError("FILE_MUST_BE_AN_IMAGE");
  if (file.buffer.length > 8 * 1024 * 1024)
    throw new ValidationError("IMAGE_TOO_LARGE");

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true },
  });
  if (!user) throw new NotFoundError("USER NOT FOUND");

  // cache-busting URL so the avatar refreshes after each re-upload
  const fileUrl = `${selfBase(req)}/user/photo/${userId}?v=${Date.now()}`;
  const data = {
    file_name: file.filename || "avatar",
    file_url: fileUrl,
    file_public_id: "",
    file_size: String(file.buffer.length),
    file_type: "image",
    mime: file.mimetype,
    bytes: file.buffer,
  };
  const saved = await prisma.userProfilePicture.upsert({
    where: { userId },
    update: data,
    create: { userId, ...data },
  });

  return res.code(200).send({ file_url: saved.file_url });
};

// GET /user/photo/:userId   (PUBLIC — used as an <img> src)
// Streams the bytea image stored in Postgres.
export const servePhoto = async (req: FastifyRequest, res: FastifyReply) => {
  const { userId } = req.params as { userId?: string };
  if (!userId) throw new ValidationError("BAD_REQUEST");
  const pic = await prisma.userProfilePicture.findUnique({
    where: { userId },
    select: { bytes: true, mime: true },
  });
  if (!pic?.bytes) return res.code(404).send({ message: "No photo" });
  return res
    .header("Content-Type", pic.mime || "image/jpeg")
    .header("Cache-Control", "public, max-age=300")
    .send(Buffer.from(pic.bytes));
};
