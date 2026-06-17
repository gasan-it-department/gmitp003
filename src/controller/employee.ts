import fastify, { FastifyRequest, FastifyReply } from "../barrel/fastify";
import { Prisma, prisma } from "../barrel/prisma";
import { AppError, NotFoundError, ValidationError } from "../errors/errors";
import { EmployeesProps } from "../models/Employee";
import { PagingProps } from "../models/route";
import { getYearRange } from "../utils/date";
import { EncryptionService } from "../service/encryption";
import { getAreaData } from "../middleware/handler";
import { PROVISIONAL_STATUSES } from "./provisionalController";

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

    // Keep provisional (temporary/contract) staff out of the plantilla
    // Employees list — they live in the Provisional > Personnel tab.
    filter.status = { notIn: PROVISIONAL_STATUSES };

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
