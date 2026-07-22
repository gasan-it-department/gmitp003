import { FastifyRequest, FastifyReply } from "../barrel/fastify";
import { Prisma, prisma } from "../barrel/prisma";
import {
  PagingProps,
  AddPositionProps,
  LineUserRegister,
} from "../models/route";
import { AppError, NotFoundError, ValidationError, dbError } from "../errors/errors";
import argon from "argon2";
import { getAreaData, sendEmail } from "../middleware/handler";
import { createUserNotification } from "../service/notificationEvents";
import { EncryptionService } from "../service/encryption";
import { semaphoreKey } from "../class/Semaphore";
import cloudinary from "../class/Cloundinary";

import fs from "fs";
import path from "path";

const frontEnd = process.env.VITE_LOCAL_FRONTEND_URL;
export const positionList = async (req: FastifyRequest, res: FastifyReply) => {
  const params = req.query as PagingProps;

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
            occupied: true,
            // Occupant info so the Vacant flow can list filled slots with
            // the person currently sitting in each one.
            userId: true,
            user: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                accountId: true,
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
      throw dbError(error);
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

    if (!slot || slot.length === 0) {
      throw new ValidationError("Add at least one position slot.");
    }

    // Validate the salary grade on EVERY slot up front. The web form defaults a
    // slot's salaryGrade to a placeholder ("1"), not a real id — if it isn't
    // changed, that placeholder lands in the `salaryGradeId` foreign key and the
    // whole create fails with an opaque 500. Catch it here with a clear message.
    const gradeIds = slot.map((s) => s.salaryGrade).filter(Boolean);
    if (gradeIds.length !== slot.length) {
      throw new ValidationError("Choose a salary grade for every slot.");
    }
    const validGrades = await prisma.salaryGrade.findMany({
      where: { id: { in: gradeIds } },
      select: { id: true },
    });
    const validSet = new Set(validGrades.map((g) => g.id));
    if (slot.some((s) => !validSet.has(s.salaryGrade))) {
      throw new ValidationError(
        "One of the selected salary grades doesn't exist. Re-pick the salary grade for each slot.",
      );
    }

    const unit = await prisma.department.findUnique({
      where: { id: body.unitId },
      select: { id: true, name: true },
    });
    if (!unit) throw new NotFoundError("UNIT NOT FOUND!");

    const response = await prisma.$transaction(async (tx) => {
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
      return {
        name: craetedPosition?.name ?? title,
        id: craetedPosition?.id ?? slots?.id ?? null,
      };
    });

    // Audit is best-effort and OUTSIDE the transaction, so a logging failure can
    // never roll back the position that was just created.
    try {
      await prisma.humanResourcesLogs.create({
        data: {
          tab: 7,
          lineId: lineId,
          action: "Added",
          userId: userId,
          desc:
            `Added new position: ${response.name} (${response.id}) to Unit ` +
            `${unit.name} on Line ${body.lineId}. Created ${body.slot.length} ` +
            `position slot(s) with item number: ${body.itemNumber || "N/A"}.`,
        },
      });
    } catch (e) {
      console.warn("[addPosition] audit log skipped:", e);
    }

    return res.code(200).send({ message: "OK" });
  } catch (error) {
    if (error instanceof ValidationError || error instanceof NotFoundError)
      throw error;
    throw dbError(error, "add position");
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
      throw dbError(error);
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
      throw dbError(error);
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
      throw dbError(error);
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
      throw dbError(error);
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
      throw dbError(error);
    }
    throw error;
  }
};

// Default invitation lifetime — long enough for an applicant to schedule
// a registration session, short enough that HR can re-send if it lapses.
const INVITE_TTL_DAYS = 7;

const isValidEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);

/**
 * Send a Fill Position invitation.
 *
 * What this enforces (the legacy version skipped most of these and was
 * easy to misuse from the dashboard):
 *
 *   1. The target slot belongs to the named unitPosition.
 *   2. The slot is still VACANT — can't invite into an occupied chair.
 *   3. No active (non-concluded, non-expired) invite already exists for
 *      the same email + slot — prevents accidental duplicate emails.
 *   4. Email is syntactically valid.
 *   5. The persisted row carries `message`, `expiresAt`, and the canonical
 *      front-end origin so the registration link is reconstructable.
 *   6. HR logs the action with the slot id for traceability.
 */
export const fillPositionInvite = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const body = req.body as {
    email: string;
    message?: string | null;
    lineId: string;
    unitPositionId: string;
    userId: string;
    slotId: string;
    /** "full" (default) → PDS invite · "quick" → essentials-only invite. */
    mode?: string;
  };

  if (
    !body.email ||
    !body.lineId ||
    !body.unitPositionId ||
    !body.slotId ||
    !body.userId
  ) {
    throw new ValidationError("INVALID REQUIRED FIELDS");
  }
  if (!isValidEmail(body.email)) {
    throw new ValidationError("Email address is not valid.");
  }
  if (!frontEnd) {
    throw new ValidationError(
      "Server misconfigured: FRONTEND_URL is not set.",
    );
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      // 1 + 2: slot must belong to this unitPosition and be vacant.
      const slot = await tx.positionSlot.findUnique({
        where: { id: body.slotId },
        select: {
          id: true,
          occupied: true,
          unitPositionId: true,
          userId: true,
          salaryGrade: { select: { grade: true, amount: true } },
        },
      });
      if (!slot || slot.unitPositionId !== body.unitPositionId) {
        throw new ValidationError("Slot does not belong to this position.");
      }
      if (slot.occupied || !!slot.userId) {
        throw new ValidationError("That slot is already filled.");
      }

      // 3: block duplicate active invites for the same email + slot.
      const now = new Date();
      const existingActive = await tx.fillPositionInvitation.findFirst({
        where: {
          email: body.email,
          positionSlotId: body.slotId,
          concluded: false,
          OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
        },
      });
      if (existingActive) {
        throw new ValidationError(
          "An active invitation already exists for this email + slot. Cancel it first or wait for it to expire.",
        );
      }

      const [line, position] = await Promise.all([
        tx.line.findUnique({ where: { id: body.lineId } }),
        tx.unitPosition.findUnique({
          where: { id: body.unitPositionId },
          select: { id: true, position: { select: { name: true } } },
        }),
      ]);
      if (!line || !position) throw new ValidationError("INVALID LINE");

      const [municipal, province] = await Promise.all([
        getAreaData(line.municipalId, 1),
        getAreaData(line.provinceId, 0),
      ]);
      if (!municipal || !province) {
        throw new ValidationError("INVALID AREA DATA");
      }

      const expiresAt = new Date(now.getTime() + INVITE_TTL_DAYS * 86_400_000);
      const link = await tx.fillPositionInvitation.create({
        data: {
          email: body.email,
          message: body.message?.trim() || null,
          lineId: body.lineId,
          unitPositionId: body.unitPositionId,
          positionSlotId: body.slotId,
          expiresAt,
          mode: body.mode === "quick" ? "quick" : "full",
        },
      });

      await tx.humanResourcesLogs.create({
        data: {
          action: "ADD",
          desc: `FILL POSITION (Invite -> email: ${body.email}, slot: ${body.slotId})`,
          lineId: body.lineId,
          userId: body.userId,
        },
      });

      return { link, municipal, province, position };
    });

    // Email is fire-and-forget: a transient SMTP failure shouldn't roll
    // back the invitation row (HR can re-send from the dashboard).
    const personalMsg = body.message?.trim()
      ? `\n\nMessage from HR:\n${body.message.trim()}\n`
      : "";
    sendEmail(
      `Registration Invitation for ${result.municipal.name} Portal Position: ${result.position.position.name}`,
      body.email,
      `
Good day,

You are invited to register and create an account on the Gasan Portal
for the position of ${result.position.position.name}.

Please click the link below to proceed with your registration. This
invitation expires on ${result.link.expiresAt?.toLocaleString()}.

${frontEnd}/position/register/${result.link.id}
${personalMsg}
Best regards,
Human Resource Management Office (HRMO)
${result.municipal.name}, ${result.province.name}
`,
      "",
    ).catch((e) => console.warn("[fillPositionInvite] email send failed", e));

    return res.code(200).send({
      message: "OK",
      invitation: {
        id: result.link.id,
        email: result.link.email,
        expiresAt: result.link.expiresAt,
        slotId: result.link.positionSlotId,
      },
    });
  } catch (error) {
    if (error instanceof ValidationError) throw error;
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw dbError(error);
    }
    throw error;
  }
};

/**
 * Variant of fillPositionInvite that picks the recipient from an existing
 * SubmittedApplication instead of asking HR to type the email by hand.
 *
 * Why a separate endpoint instead of overloading fillPositionInvite:
 *   - the source-of-truth email lives encrypted on SubmittedApplication
 *     so the server has to decrypt it here (the dashboard never sees
 *     plaintext)
 *   - we link the invitation back to the source application via
 *     `submittedApplicationId`, which makes accept-link landing pages
 *     able to pre-fill the candidate's data
 *
 * Validation:
 *   - slot must belong to the named unitPosition and be vacant
 *   - application must exist and belong to the same line
 *   - dedupe by (resolved email + slot) so we don't spam the same person
 */
export const inviteFromApplication = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const body = req.body as {
    applicationId: string;
    slotId: string;
    unitPositionId: string;
    userId: string;
    lineId: string;
    message?: string | null;
    // Provisional hiring: optional employment type + contract end date.
    empType?: string | null;
    term?: string | null;
  };

  if (
    !body.applicationId ||
    !body.slotId ||
    !body.unitPositionId ||
    !body.userId ||
    !body.lineId
  ) {
    throw new ValidationError("INVALID REQUIRED FIELDS");
  }
  if (!frontEnd) {
    throw new ValidationError(
      "Server misconfigured: FRONTEND_URL is not set.",
    );
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      // 1. Slot must belong to this UnitPosition and be vacant.
      const slot = await tx.positionSlot.findUnique({
        where: { id: body.slotId },
        select: {
          id: true,
          occupied: true,
          unitPositionId: true,
          userId: true,
        },
      });
      if (!slot || slot.unitPositionId !== body.unitPositionId) {
        throw new ValidationError("Slot does not belong to this position.");
      }
      if (slot.occupied || !!slot.userId) {
        throw new ValidationError("That slot is already filled.");
      }

      // 2. Application must exist and belong to the line, AND be eligible
      //    (no userId set, and any prior invite must be concluded as
      //    cancelled/expired — accepted/live invites can't be reused).
      const application = await tx.submittedApplication.findUnique({
        where: { id: body.applicationId },
        select: {
          id: true,
          lineId: true,
          firstname: true,
          lastname: true,
          email: true,
          emailIv: true,
          userId: true,
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
      if (!application) throw new NotFoundError("Application not found.");
      if (application.lineId !== body.lineId) {
        throw new ValidationError("Application is not in this line.");
      }
      if (application.userId) {
        throw new ValidationError(
          "This applicant has already completed registration.",
        );
      }
      const prevInv = application.fillPositionInvitations;
      if (prevInv) {
        const prevExpired = !!(
          prevInv.expiresAt &&
          new Date(prevInv.expiresAt).getTime() < Date.now()
        );
        const reusable =
          prevInv.concluded &&
          (prevInv.concludedReason === "cancelled" ||
            prevInv.concludedReason === "expired" ||
            prevExpired);
        if (!reusable) {
          throw new ValidationError(
            prevInv.concluded
              ? "This application was already accepted — pick a different applicant."
              : "This application already has a live invitation — cancel it first.",
          );
        }
      }

      // 3. Decrypt the applicant's email so we can dedupe + send.
      let plainEmail: string | null = null;
      if (application.email && application.emailIv) {
        try {
          plainEmail = await EncryptionService.decrypt(
            application.email,
            application.emailIv,
          );
        } catch (e) {
          console.warn(
            "[inviteFromApplication] failed to decrypt email",
            e,
          );
        }
      }
      if (!plainEmail) {
        throw new ValidationError(
          "Couldn't read the applicant's email address.",
        );
      }

      // 4. Block duplicate active invites for the same email + slot.
      const now = new Date();
      const existingActive = await tx.fillPositionInvitation.findFirst({
        where: {
          email: plainEmail,
          positionSlotId: body.slotId,
          concluded: false,
          OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
        },
      });
      if (existingActive) {
        throw new ValidationError(
          "An active invitation already exists for this applicant + slot.",
        );
      }

      // 5. Look up the line + area so we can address the email.
      const [line, position] = await Promise.all([
        tx.line.findUnique({ where: { id: body.lineId } }),
        tx.unitPosition.findUnique({
          where: { id: body.unitPositionId },
          select: { id: true, position: { select: { name: true } } },
        }),
      ]);
      if (!line || !position) throw new ValidationError("INVALID LINE");
      const [municipal, province] = await Promise.all([
        getAreaData(line.municipalId, 1),
        getAreaData(line.provinceId, 0),
      ]);
      if (!municipal || !province) {
        throw new ValidationError("INVALID AREA DATA");
      }

      const expiresAt = new Date(now.getTime() + INVITE_TTL_DAYS * 86_400_000);
      const link = await tx.fillPositionInvitation.create({
        data: {
          email: plainEmail,
          message: body.message?.trim() || null,
          lineId: body.lineId,
          unitPositionId: body.unitPositionId,
          positionSlotId: body.slotId,
          submittedApplicationId: body.applicationId,
          expiresAt,
          empType: body.empType?.trim() || null,
          term: body.term ? new Date(body.term) : null,
        },
      });

      await tx.humanResourcesLogs.create({
        data: {
          action: "ADD",
          desc: `FILL POSITION (from application) -> applicant: ${application.firstname} ${application.lastname} (${plainEmail}), slot: ${body.slotId}`,
          lineId: body.lineId,
          userId: body.userId,
        },
      });

      return {
        link,
        plainEmail,
        applicant: application,
        line,
        municipal,
        province,
        position,
      };
    });

    // Email — fire-and-forget.
    const personalMsg = body.message?.trim()
      ? `\n\nMessage from HR:\n${body.message.trim()}\n`
      : "";
    sendEmail(
      `Registration Invitation for ${result.municipal.name} Portal Position: ${result.position.position.name}`,
      result.plainEmail,
      `
Good day ${result.applicant.firstname},

Based on your submitted application, you are invited to register and
create an account on the Gasan Portal for the position of
${result.position.position.name}.

Please click the link below to proceed with your registration. This
invitation expires on ${result.link.expiresAt?.toLocaleString()}.

${frontEnd}/position/register/${result.link.id}
${personalMsg}
Best regards,
Human Resource Management Office (HRMO)
${result.municipal.name}, ${result.province.name}
`,
      "",
    ).catch((e) =>
      console.warn("[inviteFromApplication] email send failed", e),
    );

    return res.code(200).send({
      message: "OK",
      invitation: {
        id: result.link.id,
        email: result.link.email,
        expiresAt: result.link.expiresAt,
        slotId: result.link.positionSlotId,
        applicantName: `${result.applicant.firstname} ${result.applicant.lastname}`,
      },
    });
  } catch (error) {
    if (error instanceof ValidationError) throw error;
    if (error instanceof NotFoundError) throw error;
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw dbError(error);
    }
    throw error;
  }
};

/**
 * List invitations for a given unitPosition (or for a specific slot).
 * Used by the Fill Position modal so HR can see who's already been
 * invited and avoid spamming candidates.
 */
export const listPositionInvitations = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const params = req.query as {
    unitPositionId?: string;
    slotId?: string;
    /** "active" (default) | "all" — gate concluded/expired out by default. */
    status?: "active" | "all";
  };
  if (!params.unitPositionId && !params.slotId) {
    throw new ValidationError(
      "Either unitPositionId or slotId is required.",
    );
  }

  const now = new Date();
  const where: any = {};
  if (params.unitPositionId) where.unitPositionId = params.unitPositionId;
  if (params.slotId) where.positionSlotId = params.slotId;
  if ((params.status ?? "active") === "active") {
    where.concluded = false;
    where.OR = [{ expiresAt: null }, { expiresAt: { gt: now } }];
  }

  try {
    const rows = await prisma.fillPositionInvitation.findMany({
      where,
      orderBy: { timestamp: "desc" },
      select: {
        id: true,
        email: true,
        message: true,
        timestamp: true,
        expiresAt: true,
        concluded: true,
        concludedAt: true,
        concludedReason: true,
        positionSlotId: true,
        slot: {
          select: {
            id: true,
            occupied: true,
            salaryGrade: { select: { grade: true } },
          },
        },
        submittedApplicationId: true,
      },
    });

    // Tag rows whose expiresAt has already passed but were never marked
    // concluded — keeps the dashboard counts honest without an extra job.
    const decorated = rows.map((r) => {
      const expired =
        !r.concluded && r.expiresAt && r.expiresAt.getTime() <= now.getTime();
      const status = r.concluded
        ? (r.concludedReason ?? "concluded")
        : expired
          ? "expired"
          : "pending";
      return { ...r, status, isExpired: !!expired };
    });

    return res.code(200).send({ list: decorated });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw dbError(error);
    }
    throw error;
  }
};

/**
 * Cancel (soft-conclude) a pending invitation. Safe no-op if already
 * concluded.
 */
export const cancelPositionInvitation = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const body = req.body as { id: string; userId: string; lineId: string };
  if (!body.id || !body.userId || !body.lineId) {
    throw new ValidationError("INVALID REQUIRED FIELDS");
  }

  try {
    const updated = await prisma.$transaction(async (tx) => {
      const row = await tx.fillPositionInvitation.findUnique({
        where: { id: body.id },
        select: { id: true, concluded: true, email: true, lineId: true },
      });
      if (!row) throw new NotFoundError("Invitation not found");
      if (row.lineId !== body.lineId) {
        throw new ValidationError("Line mismatch.");
      }
      if (row.concluded) return row;
      const out = await tx.fillPositionInvitation.update({
        where: { id: body.id },
        data: {
          concluded: true,
          concludedAt: new Date(),
          concludedReason: "cancelled",
          // Release the @unique link on submittedApplicationId so the
          // same application can be picked again from the picker page.
          // The cancelled row stays in history with its email, the rest
          // of its metadata, and a `null` submittedApplicationId.
          submittedApplicationId: null,
        },
      });
      await tx.humanResourcesLogs.create({
        data: {
          action: "DELETE",
          desc: `CANCEL FILL POSITION INVITE -> email: ${row.email}`,
          lineId: body.lineId,
          userId: body.userId,
        },
      });
      return out;
    });
    return res.code(200).send({ ok: true, id: updated.id });
  } catch (error) {
    if (error instanceof ValidationError) throw error;
    if (error instanceof NotFoundError) throw error;
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw dbError(error);
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
        provisionalPosition: {
          select: {
            id: true,
            title: true,
            empType: true,
            termMonths: true,
          },
        },
        department: { select: { id: true, name: true } },
      },
    });

    if (!response) {
      throw new NotFoundError("LINK NOT FOUND");
    }

    // One-time link: once registration completed (concluded = accepted), the
    // link is dead — surface that to the register page instead of loading it.
    if (response.concluded) {
      throw new ValidationError(
        response.concludedReason === "accepted"
          ? "This registration link has already been used."
          : "This invitation link is no longer active.",
      );
    }

    const currentDate = new Date();

    // Provisional invites carry an explicit `expiresAt` (7 days). Fall back to
    // the legacy 3-days-from-`timestamp` rule for older plantilla invites.
    if (response.expiresAt) {
      if (currentDate > new Date(response.expiresAt)) {
        throw new ValidationError("INVITATION LINK HAS EXPIRED");
      }
    } else {
      const invitationDate = new Date(response.timestamp);
      const daysDifference =
        (currentDate.getTime() - invitationDate.getTime()) / (1000 * 3600 * 24);
      if (daysDifference >= 3) {
        throw new ValidationError("INVITATION LINK HAS EXPIRED");
      }
    }

    return res.code(200).send(response);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw dbError(error);
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
    !body.applicationId ||
    !body.linkId
  ) {
    throw new ValidationError("INVALID REQUIRED DATA");
  }

  try {
    const response = await prisma.$transaction(async (tx) => {
      // Load the invitation first: provisional (temp/contract) invites have no
      // PositionSlot and take a different create path — status = empType, term
      // computed from the ProvisionalPosition's termMonths, unit from the invite.
      const invite = await tx.fillPositionInvitation.findUnique({
        where: { id: body.linkId },
        select: {
          concluded: true,
          concludedReason: true,
          empType: true,
          term: true,
          provisionalPositionId: true,
          departmentId: true,
          unitPositionId: true,
          provisionalPosition: {
            select: { empType: true, termMonths: true, salaryGradeId: true },
          },
        },
      });

      // One-time link: once a registration has completed, the invite is
      // concluded — block any reuse (double-submit, shared link, etc.).
      if (invite?.concluded) {
        throw new ValidationError("This registration link has already been used.");
      }

      const application = await tx.submittedApplication.findUnique({
        where: {
          id: body.applicationId,
        },
      });
      if (!application) {
        throw new ValidationError("APPLICATION NOT FOUND");
      }

      // ---- Provisional hire: no plantilla slot ----
      if (invite?.provisionalPositionId) {
        const empStatus =
          invite.provisionalPosition?.empType ||
          invite.empType?.trim() ||
          "Provisional";
        const months = invite.provisionalPosition?.termMonths ?? 0;
        let empTerm = invite.term ?? null;
        if (months > 0) {
          empTerm = new Date();
          empTerm.setMonth(empTerm.getMonth() + months);
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
            departmentId: invite.departmentId ?? null,
            status: empStatus,
            ...(empTerm ? { term: empTerm } : {}),
            ...(invite.provisionalPosition?.salaryGradeId
              ? { salaryGradeId: invite.provisionalPosition.salaryGradeId }
              : {}),
            phoneNumber: application.mobileNo,
            phoneNumberIv: application.ivMobileNo,
          },
        });
        await tx.submittedApplication.update({
          where: { id: body.applicationId },
          data: { userId: user.id },
        });
        await tx.fillPositionInvitation.update({
          where: { id: body.linkId },
          data: {
            concluded: true,
            concludedAt: new Date(),
            concludedReason: "accepted",
            step: 1,
          },
        });
        const provName = [application.firstname, application.lastname]
          .filter(Boolean)
          .join(" ")
          .trim();
        await createUserNotification(tx, {
          recipientId: user.id,
          title: "Welcome to the Portal!",
          content: `Welcome ${provName || body.username}! You have been registered as ${empStatus}${empTerm ? ` (until ${empTerm.toLocaleDateString()})` : ""}. Your username is: ${body.username}.`,
          senderId: null,
        });
        return true;
      }

      // ---- Plantilla hire: requires a PositionSlot ----
      if (!body.slotId) {
        throw new ValidationError("INVALID REQUIRED DATA");
      }
      // The invited slot if still vacant, else any vacant sibling slot of
      // the same position (several invites usually point at one open slot).
      const slot = await resolveVacantSlot(
        tx,
        body.slotId,
        invite?.unitPositionId,
      );
      // Resolve the *effective* position / department / SG from the slot
      // OR its parent UnitPosition. `PositionSlot.positionId` is
      // optional in the schema and is usually NULL — the canonical
      // position id lives on the UnitPosition. Same for salary grade,
      // which is normally set on the Position row rather than per-slot.
      const effectivePositionId =
        slot.positionId ?? slot.unitPosition?.positionId ?? null;
      const effectiveDepartmentId = slot.unitPosition?.departmentId ?? null;
      const effectiveSalaryGradeId =
        body.sgId ??
        slot.salaryGradeId ??
        slot.unitPosition?.position?.salaryGradeId ??
        null;

      if (!effectivePositionId) {
        // Shouldn't happen for a well-formed UnitPosition; bail loudly
        // so HR can fix the data instead of getting a silent "No position".
        throw new ValidationError(
          "Slot has no resolvable position — check that the UnitPosition references a Position.",
        );
      }

      // Plantilla designations are "Regular"; a non-plantilla slot (rare path)
      // falls back to "Provisional". The `invite` was loaded at the top of the
      // transaction.
      const empStatus =
        slot.unitPosition?.plantilla === false ? "Provisional" : "Regular";
      const empTerm = invite?.term ?? null;

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
          positionId: effectivePositionId,
          departmentId: effectiveDepartmentId,
          status: empStatus,
          ...(empTerm ? { term: empTerm } : {}),
          ...(effectiveSalaryGradeId
            ? { salaryGradeId: effectiveSalaryGradeId }
            : {}),
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

      // Atomic claim: backfills positionId/salaryGradeId on the slot and
      // guards against a concurrent registrant taking it mid-transaction.
      await claimSlot(
        tx,
        slot.id,
        user.id,
        effectivePositionId,
        effectiveSalaryGradeId,
      );
      // Name comes from the submitted application — the register body
      // doesn't carry firstname/lastname (that's why the old message
      // rendered "Welcome undefined undefined").
      const fullName = [application.firstname, application.lastname]
        .filter(Boolean)
        .join(" ")
        .trim();
      const positionName =
        slot.unitPosition?.position?.name ?? "your new position";
      await createUserNotification(tx, {
        recipientId: user.id,
        title: "Welcome to the Portal!",
        content: `Welcome ${fullName || body.username}! You have been successfully registered as ${positionName}. Your username is: ${body.username}. You now have full access to the Human Resources module.`,
        senderId: null,
      });

      // Burn the one-time link so it can't be reused after registration.
      await tx.fillPositionInvitation.update({
        where: { id: body.linkId },
        data: {
          concluded: true,
          concludedAt: new Date(),
          concludedReason: "accepted",
          step: 1,
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
      throw dbError(error);
    }
    throw error;
  }
};

/**
 * Resolve which PositionSlot a registrant actually receives.
 *
 * Invites bake a specific slotId at send time, but the slot stays VACANT
 * until someone registers — so when HR sends several invites for the same
 * position (rollout day!), they all point at the same open slot. The first
 * registrant wins that exact slot; without this fallback every later
 * registrant dies on a hard "ALREADY OCCUPIED" 400 even though the position
 * still has other vacant slots.
 *
 * Order: (1) the invited slot if still vacant, (2) any other vacant slot of
 * the same UnitPosition, (3) a clear error — either the slot id is unknown
 * or the position is genuinely full.
 */
const REGISTER_SLOT_SELECT = {
  id: true,
  positionId: true,
  salaryGradeId: true,
  occupied: true,
  userId: true,
  unitPositionId: true,
  unitPosition: {
    select: {
      id: true,
      departmentId: true,
      positionId: true,
      plantilla: true,
      position: { select: { id: true, name: true, salaryGradeId: true } },
    },
  },
} as const;

const resolveVacantSlot = async (
  tx: Prisma.TransactionClient,
  slotId: string,
  fallbackUnitPositionId?: string | null,
) => {
  const slot = await tx.positionSlot.findUnique({
    where: { id: slotId },
    select: REGISTER_SLOT_SELECT,
  });
  if (slot && !slot.userId && !slot.occupied) return slot;

  const upId = slot?.unitPositionId ?? fallbackUnitPositionId ?? null;
  if (upId) {
    const alt = await tx.positionSlot.findFirst({
      where: { unitPositionId: upId, occupied: false, userId: null },
      orderBy: { id: "asc" },
      select: REGISTER_SLOT_SELECT,
    });
    if (alt) return alt;
  }

  if (!slot) throw new ValidationError("SLOT NOT FOUND");
  throw new ValidationError(
    "This position has already been fully filled — every slot is taken. " +
      "Please contact HR for an invitation to another position.",
  );
};

/**
 * Atomically claim a slot for a newly registered user. The vacancy condition
 * in the WHERE guards against two registrants racing into the same slot —
 * the loser's transaction rolls back with a clear message instead of silently
 * overwriting the winner.
 */
const claimSlot = async (
  tx: Prisma.TransactionClient,
  slotId: string,
  userId: string,
  effectivePositionId: string,
  effectiveSalaryGradeId?: string | null,
) => {
  const claimed = await tx.positionSlot.updateMany({
    where: { id: slotId, occupied: false, userId: null },
    data: {
      userId,
      positionId: effectivePositionId,
      ...(effectiveSalaryGradeId
        ? { salaryGradeId: effectiveSalaryGradeId }
        : {}),
      occupied: true,
    },
  });
  if (claimed.count === 0) {
    throw new ValidationError(
      "Someone registered into this slot a moment ago — please submit again.",
    );
  }
};

// Public base URL for building the served-photo link (mirrors employee.ts).
const selfBaseUrl = (req: FastifyRequest): string => {
  const env = process.env.API_PUBLIC_URL;
  if (env) return env.replace(/\/+$/, "");
  const proto = String(
    req.headers["x-forwarded-proto"] || req.protocol || "http",
  ).split(",")[0];
  const host = (req.headers["x-forwarded-host"] as string) || req.headers.host;
  return `${proto}://${host}`;
};

/**
 * PUBLIC quick registration — the "quick invite" counterpart to
 * positionRegister. The candidate fills only the essentials (name, birthday,
 * sex, address, contact) + a photo; there is NO CS Form 212 PDS. Everything is
 * written straight to the User record, the slot is occupied, and the one-time
 * invite is burned. Multipart so the profile photo can ride along.
 *
 * Fields (multipart form-data): linkId, lineId, slotId, username, password,
 *   firstName, lastName, middleName?, suffix?, birthDate (ISO), gender,
 *   email, mobileNumber, regionId?, provinceId?, municipalId?, barangayId?
 *   photo (file, optional, image/*)
 */
export const positionQuickRegister = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  if (!req.isMultipart()) throw new ValidationError("NOT_MULTIPART");

  const f: Record<string, string> = {};
  let photo: { filename: string; mimetype: string; buffer: Buffer } | null =
    null;
  for await (const part of req.parts()) {
    if (part.type === "file") {
      if (part.fieldname === "photo") {
        const chunks: Buffer[] = [];
        for await (const chunk of part.file) chunks.push(chunk as Buffer);
        photo = {
          filename: part.filename,
          mimetype: part.mimetype,
          buffer: Buffer.concat(chunks),
        };
      } else {
        // Drain unexpected file parts so the multipart stream can continue.
        await part.toBuffer();
      }
    } else {
      f[part.fieldname] = String(part.value ?? "");
    }
  }

  if (
    !f.linkId ||
    !f.lineId ||
    !f.slotId ||
    !f.username ||
    !f.password ||
    !f.firstName ||
    !f.lastName ||
    !f.email
  ) {
    throw new ValidationError("INVALID REQUIRED DATA");
  }
  if (!isValidEmail(f.email)) {
    throw new ValidationError("Email address is not valid.");
  }
  if (f.password.length < 8) {
    throw new ValidationError("Password must be at least 8 characters.");
  }
  if (photo) {
    if (!photo.mimetype.startsWith("image/"))
      throw new ValidationError("FILE_MUST_BE_AN_IMAGE");
    if (photo.buffer.length > 8 * 1024 * 1024)
      throw new ValidationError("IMAGE_TOO_LARGE");
  }

  try {
    // Encrypt PII exactly like the rest of the app (email + phone).
    const encEmail = await EncryptionService.encrypt(f.email);
    const encPhone = f.mobileNumber
      ? await EncryptionService.encrypt(f.mobileNumber)
      : null;

    // The public form's address dropdowns are fed by the external PSGC API,
    // while User.regionId/provinceId/municipalId/barangayId are FOREIGN KEYS
    // into our own (partially seeded) tables — and the dropdowns' degenerate
    // rows ("loading", "noData", …) are selectable too. Keep an id only when
    // that row actually exists here; anything else becomes NULL. The address
    // is optional — it must NEVER fail a registration with a P2003 400.
    const junk = new Set(["loading", "noData", "error", "errors", "undefined", "null"]);
    const cleanId = (v?: string) => (v && !junk.has(v) ? v : null);
    const keep = async (
      id: string | null,
      find: (id: string) => Promise<{ id: string } | null>,
    ) => (id ? (await find(id))?.id ?? null : null);
    const [addrRegionId, addrProvinceId, addrMunicipalId, addrBarangayId] =
      await Promise.all([
        keep(cleanId(f.regionId), (id) =>
          prisma.region.findUnique({ where: { id }, select: { id: true } }),
        ),
        keep(cleanId(f.provinceId), (id) =>
          prisma.province.findUnique({ where: { id }, select: { id: true } }),
        ),
        keep(cleanId(f.municipalId), (id) =>
          prisma.municipal.findUnique({ where: { id }, select: { id: true } }),
        ),
        keep(cleanId(f.barangayId), (id) =>
          prisma.barangay.findUnique({ where: { id }, select: { id: true } }),
        ),
      ]);

    const userId = await prisma.$transaction(async (tx) => {
      const invite = await tx.fillPositionInvitation.findUnique({
        where: { id: f.linkId },
        select: { concluded: true, mode: true, unitPositionId: true },
      });
      if (!invite) throw new NotFoundError("LINK NOT FOUND");
      if (invite.concluded)
        throw new ValidationError("This registration link has already been used.");
      if (invite.mode !== "quick")
        throw new ValidationError("This link is not a quick-registration link.");

      // The invited slot if still vacant, else any vacant sibling slot of
      // the same position (several invites usually point at one open slot).
      const slot = await resolveVacantSlot(tx, f.slotId, invite.unitPositionId);

      const effectivePositionId =
        slot.positionId ?? slot.unitPosition?.positionId ?? null;
      const effectiveDepartmentId = slot.unitPosition?.departmentId ?? null;
      const effectiveSalaryGradeId =
        slot.salaryGradeId ??
        slot.unitPosition?.position?.salaryGradeId ??
        null;
      if (!effectivePositionId) {
        throw new ValidationError(
          "Slot has no resolvable position — check that the UnitPosition references a Position.",
        );
      }

      const empStatus =
        slot.unitPosition?.plantilla === false ? "Provisional" : "Regular";

      const hashedPassword = await argon.hash(f.password);
      const account = await tx.account.create({
        data: { username: f.username, password: hashedPassword, lineId: f.lineId },
      });

      const user = await tx.user.create({
        data: {
          firstName: f.firstName,
          lastName: f.lastName,
          middleName: f.middleName?.trim() || null,
          suffix: f.suffix?.trim() || null,
          ...(f.birthDate ? { birthDate: new Date(f.birthDate) } : {}),
          ...(f.gender === "male" || f.gender === "female"
            ? { gender: f.gender }
            : {}),
          username: account.username,
          accountId: account.id,
          email: encEmail.encryptedData,
          emailIv: encEmail.iv,
          ...(encPhone
            ? { phoneNumber: encPhone.encryptedData, phoneNumberIv: encPhone.iv }
            : {}),
          regionId: addrRegionId,
          provinceId: addrProvinceId,
          municipalId: addrMunicipalId,
          barangayId: addrBarangayId,
          lineId: f.lineId,
          positionId: effectivePositionId,
          departmentId: effectiveDepartmentId,
          status: empStatus,
          ...(effectiveSalaryGradeId
            ? { salaryGradeId: effectiveSalaryGradeId }
            : {}),
        },
      });

      await claimSlot(
        tx,
        slot.id,
        user.id,
        effectivePositionId,
        effectiveSalaryGradeId,
      );

      await tx.fillPositionInvitation.update({
        where: { id: f.linkId },
        data: {
          concluded: true,
          concludedAt: new Date(),
          concludedReason: "accepted",
          step: 1,
        },
      });

      await createUserNotification(tx, {
        recipientId: user.id,
        title: "Welcome to the Portal!",
        content: `Welcome ${f.firstName} ${f.lastName}! Your account has been created. Your username is: ${f.username}.`,
        senderId: null,
      });

      return user.id;
    });

    // Photo is non-critical: store it AFTER the account commits so a photo
    // failure never rolls back a successful registration.
    if (photo) {
      try {
        const fileUrl = `${selfBaseUrl(req)}/user/photo/${userId}?v=${Date.now()}`;
        const picData = {
          file_name: photo.filename || "avatar",
          file_url: fileUrl,
          file_public_id: "",
          file_size: String(photo.buffer.length),
          file_type: "image",
          mime: photo.mimetype,
          bytes: photo.buffer,
        };
        await prisma.userProfilePicture.upsert({
          where: { userId },
          update: picData,
          create: { userId, ...picData },
        });
      } catch (e) {
        console.warn("[positionQuickRegister] photo save failed", e);
      }
    }

    return res.code(200).send({ message: "OK" });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      // Duplicate username → let the client show a friendly field error.
      if (error.code === "P2002") {
        return res.code(200).send({ error: 1, message: "Username already exists" });
      }
      throw dbError(error);
    }
    throw error;
  }
};

/**
 * Vacate an occupied position slot.
 *
 * Body:
 *   slotId  — the PositionSlot to free up
 *   userId  — the ACTOR (HR user performing the action), for the audit log
 *   lineId  — line scope guard
 *   action  — what to do with the displaced occupant:
 *               0 "Remove User"     → unassign them from the slot/position
 *                                     (account stays active, becomes
 *                                     position-less)
 *               1 "Disable Access"  → also suspend their account so they
 *                                     can no longer sign in (data retained)
 *
 * Always: clears slot.userId + occupied, clears the occupant's
 * position/department/salaryGrade, records a UnitPositionHistory row and
 * an HR audit log, and notifies the displaced user.
 */
export const vacantPosition = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const body = req.body as {
    slotId: string;
    userId: string;
    lineId: string;
    action?: number | string;
  };

  if (!body.lineId || !body.slotId || !body.userId) {
    throw new ValidationError("INVALID REQUIRED ID");
  }

  // Normalise action → 0 (remove) | 1 (disable access). Anything else
  // falls back to a plain unassign (0).
  const action = Number(body.action ?? 0) === 1 ? 1 : 0;

  try {
    const result = await prisma.$transaction(async (tx) => {
      const slot = await tx.positionSlot.findUnique({
        where: { id: body.slotId },
        select: {
          id: true,
          occupied: true,
          userId: true,
          unitPositionId: true,
          pos: { select: { name: true } },
          unitPosition: {
            select: { lineId: true, position: { select: { name: true } } },
          },
          user: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              accountId: true,
            },
          },
        },
      });

      if (!slot) throw new NotFoundError("Slot not found.");
      if (slot.unitPosition && slot.unitPosition.lineId !== body.lineId) {
        throw new ValidationError("Slot does not belong to this line.");
      }
      if (!slot.userId || !slot.user) {
        throw new ValidationError("This slot is already vacant.");
      }

      // An HR officer must not vacate their OWN seat — doing so would strip
      // their position/department (and optionally suspend their account),
      // potentially locking the line out of its only HR administrator.
      // Only a *different* administrator may vacate this slot.
      if (slot.userId === body.userId) {
        throw new ValidationError(
          "You can't vacate your own seat. Ask another administrator to do this for you.",
        );
      }

      const occupant = slot.user;
      const positionName =
        slot.pos?.name ?? slot.unitPosition?.position?.name ?? "the position";

      // 1. Free the slot.
      await tx.positionSlot.update({
        where: { id: slot.id },
        data: { occupied: false, userId: null },
      });

      // 2. Unassign the occupant from their position/department/SG. When the
      //    account is also being disabled (action 1 = separation), archive them
      //    so they leave the active Employees list for the Archived page.
      await tx.user.update({
        where: { id: occupant.id },
        data: {
          departmentId: null,
          positionId: null,
          salaryGradeId: null,
          ...(action === 1
            ? {
                archivedAt: new Date(),
                archiveReason: `Vacated from ${positionName} and access disabled`,
              }
            : {}),
        },
      });

      // 3. Optionally suspend the account (Disable Access).
      if (action === 1 && occupant.accountId) {
        await tx.account.update({
          where: { id: occupant.accountId },
          data: { status: 2, active: false },
        });
      }

      // 4. History — record the vacancy against the unit position.
      if (slot.unitPositionId) {
        await tx.unitPositionHistory.create({
          data: {
            unitPositionId: slot.unitPositionId,
            positionSlotId: slot.id,
            userId: occupant.id,
          },
        });
      }

      // 5. HR audit log.
      await tx.humanResourcesLogs.create({
        data: {
          userId: body.userId,
          action: action === 1 ? "DELETE" : "UPDATE",
          desc:
            action === 1
              ? `VACATE + DISABLE ACCESS: ${occupant.firstName} ${occupant.lastName} removed from ${positionName} and account suspended.`
              : `VACATE SLOT: ${occupant.firstName} ${occupant.lastName} unassigned from ${positionName}.`,
          lineId: body.lineId,
        },
      });

      return { occupant, positionName };
    });

    // 6. Notify the displaced user (outside the tx isn't necessary — the
    //    helper participates in the tx — but we already committed, so
    //    fire a standalone notification here).
    try {
      await prisma.notification.create({
        data: {
          recipientId: result.occupant.id,
          title:
            action === 1 ? "Account access disabled" : "Position vacated",
          content:
            action === 1
              ? `You have been removed from ${result.positionName} and your account access has been disabled. Contact HR for assistance.`
              : `You have been unassigned from ${result.positionName}. Contact HR if you believe this is a mistake.`,
        },
      });
    } catch (e) {
      console.warn("[vacantPosition] notification failed:", e);
    }

    return res.code(200).send({ message: "OK" });
  } catch (error) {
    if (error instanceof ValidationError) throw error;
    if (error instanceof NotFoundError) throw error;
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw dbError(error);
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
      // Mark the invite as accepted in one shot. The legacy code did
      // this twice (once with everything, then again with just step),
      // which was redundant and accidentally widened the failure window.
      await tx.fillPositionInvitation.update({
        where: { id: inviteLink.id },
        data: {
          step: 1,
          submittedApplicationId: application.id,
          concluded: true,
          concludedAt: new Date(),
          concludedReason: "accepted",
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
    // Pull as much useful detail as we can out of *whatever* was thrown
    // so the FE doesn't just see "Unknown error". Prisma's known errors
    // are Error instances but carry a `code` + `meta`; plain thrown
    // strings/numbers used to fall through and surface "Unknown error".
    const prismaCode = (err as any)?.code;
    const prismaMeta = (err as any)?.meta;
    const errorMsg =
      err instanceof Error
        ? err.message
        : typeof err === "string"
          ? err
          : (err as any)?.message
            ? String((err as any).message)
            : `Unhandled (${typeof err})`;
    console.error("[submitApplication] failed:", {
      message: errorMsg,
      prismaCode,
      prismaMeta,
      stack: err instanceof Error ? err.stack : undefined,
    });
    return res.status(500).send({
      success: false,
      message: "Failed to submit application",
      error: errorMsg,
      code: prismaCode ?? null,
      meta: prismaMeta ?? null,
    });
  }
};

export const positionRecords = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const params = req.query as { id: string };

  if (!params.id) {
    throw new ValidationError("INVALID REQUIRED ID");
  }
  try {
    // Pull everything the PositionDetail header needs in one shot:
    //  - line + unit (department) names (FE was rendering departmentId uuid)
    //  - slot fill ratio (occupied vs total) for the stats badge
    //  - submittedApplications count for the Applications tab badge
    //  - position.salaryGrade so the header can display the grade + amount
    const response = await prisma.unitPosition.findUnique({
      where: {
        id: params.id,
      },
      include: {
        position: {
          select: {
            name: true,
            id: true,
            SalaryGrade: {
              select: { id: true, grade: true, amount: true },
            },
          },
        },
        unit: {
          select: { id: true, name: true },
        },
        line: {
          select: { id: true, name: true },
        },
        slot: {
          select: {
            id: true,
            occupied: true,
            userId: true,
          },
          orderBy: { id: "asc" },
        },
        _count: {
          select: {
            slot: true,
            submittedApplications: true,
            unitPositionHistories: true,
          },
        },
      },
    });

    if (!response) {
      throw new NotFoundError("UNIT POSITION NOT FOUND");
    }

    // Convenience: occupied/total numbers so FE doesn't recompute.
    const occupiedSlots = (response.slot ?? []).filter(
      (s) => s.occupied || !!s.userId,
    ).length;

    return res.code(200).send({
      ...response,
      occupiedSlots,
      totalSlots: response._count?.slot ?? response.slot?.length ?? 0,
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("Database operation failed", 500, "DB_ERROR");
    }
    throw error;
  }
};

export const positionApplications = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const params = req.query as PagingProps;

  if (!params.id) {
    throw new ValidationError("INVALID REQUIRED ID");
  }

  try {
    const cursor = params.lastCursor ? { id: params.lastCursor } : undefined;
    const limit = params.limit ? parseInt(params.limit, 10) : 20;

    // Mirror what /line-applications returns so the FE can reuse
    // <ApplicationItem /> 1:1. The position view always filters by
    // unitPositionId, so the result is a strict subset.
    const response = await prisma.submittedApplication.findMany({
      where: {
        unitPositionId: params.id,
      },
      include: {
        forPosition: { select: { id: true, name: true } },
        unitPos: { select: { id: true, designation: true } },
        ApplicationSkillTags: {
          select: { id: true, tags: true },
        },
      },
      cursor,
      skip: cursor ? 1 : 0,
      take: limit,
      orderBy: {
        timestamp: "desc",
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
      throw new AppError("Database operation failed", 500, "DB_ERROR");
    }
    throw error;
  }
};

export const unitPositionRecord = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const params = req.query as PagingProps;

  if (!params.id) {
    throw new ValidationError("INVALID REQUIRED ID");
  }

  try {
    const cursor = params.lastCursor ? { id: params.lastCursor } : undefined;
    const limit = params.limit ? parseInt(params.limit, 10) : 20;

    // Derive a stable slot "number" per UnitPosition: ordered by id, the
    // index inside that array. The PositionSlot model has no slotNumber
    // column, but the UI just needs a friendly handle ("Slot #2") instead
    // of the raw uuid.
    const slotOrder = await prisma.positionSlot.findMany({
      where: { unitPositionId: params.id },
      orderBy: { id: "asc" },
      select: { id: true },
    });
    const slotNumberById = new Map(
      slotOrder.map((s, i) => [s.id, i + 1]),
    );

    const response = await prisma.unitPositionHistory.findMany({
      where: {
        unitPositionId: params.id,
      },
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            username: true,
          },
        },
        slot: {
          select: {
            id: true,
            occupied: true,
            userId: true,
            designation: true,
          },
        },
      },
      cursor,
      skip: cursor ? 1 : 0,
      take: limit,
      orderBy: {
        timestamp: "desc",
      },
    });

    const list = response.map((row) => {
      const slotNumber = row.positionSlotId
        ? (slotNumberById.get(row.positionSlotId) ?? null)
        : null;
      // Best-effort action label: if the slot is currently occupied by
      // this same user, this row likely represents the assignment; if a
      // newer history row exists for the same slot, this one is a vacate.
      // We don't track action explicitly, so the FE just renders
      // "Assigned" when the slot still belongs to the user.
      const currentlyHolds =
        row.slot?.userId && row.user?.id && row.slot.userId === row.user.id;
      return {
        ...row,
        slotNumber,
        action: currentlyHolds ? "assigned" : "vacated",
      };
    });

    const newLastCursorId = list.length > 0 ? list[list.length - 1].id : null;
    const hasMore = list.length === limit;

    return res
      .code(200)
      .send({ list, hasMore, lastCursor: newLastCursorId });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("Database operation failed", 500, "DB_ERROR");
    }
    throw error;
  }
};

/**
 * Remove a unit-position binding.
 *
 * Refuses if any slot is currently filled — would orphan the user.
 * Logged to humanResourcesLogs (was previously writing to medicineLogs
 * by mistake, which is the wrong audit table for HR actions).
 */
export const removeUnitPosition = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const params = req.query as { id: string; userId: string; lineId: string };
  if (!params.id || !params.userId || !params.lineId) {
    throw new ValidationError("INVALID REQUIRED ID");
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const target = await tx.unitPosition.findUnique({
        where: { id: params.id },
        include: {
          position: { select: { name: true } },
          slot: { select: { id: true, occupied: true, userId: true } },
        },
      });
      if (!target) throw new NotFoundError("Unit position not found");

      const filled = (target.slot ?? []).filter(
        (s) => s.occupied || !!s.userId,
      ).length;
      if (filled > 0) {
        throw new ValidationError(
          `Cannot remove — ${filled} slot${
            filled === 1 ? " is" : "s are"
          } still occupied. Vacate or transfer first.`,
        );
      }

      await tx.unitPosition.delete({ where: { id: params.id } });

      await tx.humanResourcesLogs.create({
        data: {
          action: "REMOVE",
          tab: 7,
          userId: params.userId,
          lineId: params.lineId,
          desc: `Removed unit position: ${target.position?.name ?? params.id}`,
        },
      });

      return { id: params.id };
    });

    return res
      .code(200)
      .send({ message: "OK", ...result });
  } catch (error) {
    if (error instanceof NotFoundError) throw error;
    if (error instanceof ValidationError) throw error;
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("Database operation failed", 500, "DB_ERROR");
    }
    throw error;
  }
};

// PATCH /position/unit/update
// Edit a unit position from PositionDetail: label/name, designation, item no.,
// salary grade, plantilla + fix-to-unit flags, and the slot count (adds vacant
// slots or removes vacant ones — never below the occupied count).
export const updateUnitPosition = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const body = req.body as {
    unitPositionId?: string;
    title?: string;
    designation?: string | null;
    itemNumber?: string | null;
    salaryGradeId?: string | null;
    plantilla?: boolean;
    fixToUnit?: boolean;
    slots?: number | string;
    occupied?: number | string;
    lineId?: string;
    userId?: string;
  };
  if (!body.unitPositionId || !body.lineId) {
    throw new ValidationError("INVALID REQUIRED FIELDS");
  }
  const { unitPositionId, lineId, userId } = body;

  try {
    await prisma.$transaction(async (tx) => {
      const up = await tx.unitPosition.findFirst({
        where: { id: unitPositionId, lineId },
        include: {
          position: { select: { id: true } },
          slot: { select: { id: true, occupied: true, userId: true } },
        },
      });
      if (!up) throw new NotFoundError("Position not found");

      // Position-level fields (name, salary grade, plantilla).
      if (up.positionId) {
        await tx.position.update({
          where: { id: up.positionId },
          data: {
            ...(body.title?.trim() ? { name: body.title.trim() } : {}),
            ...(body.plantilla !== undefined
              ? { plantilla: body.plantilla }
              : {}),
            ...(body.salaryGradeId !== undefined
              ? body.salaryGradeId
                ? { SalaryGrade: { connect: { id: body.salaryGradeId } } }
                : { SalaryGrade: { disconnect: true } }
              : {}),
          },
        });
      }

      // Unit-position-level fields.
      await tx.unitPosition.update({
        where: { id: up.id },
        data: {
          ...(body.designation !== undefined
            ? { designation: body.designation?.trim() || null }
            : {}),
          ...(body.itemNumber !== undefined
            ? { itemNumber: body.itemNumber?.trim() || null }
            : {}),
          ...(body.plantilla !== undefined ? { plantilla: body.plantilla } : {}),
          ...(body.fixToUnit !== undefined ? { fixToUnit: body.fixToUnit } : {}),
        },
      });

      // Apply the salary grade to the vacant slots too.
      if (body.salaryGradeId !== undefined) {
        await tx.positionSlot.updateMany({
          where: { unitPositionId: up.id, occupied: false, userId: null },
          data: { salaryGradeId: body.salaryGradeId || null },
        });
      }

      // Slot-count + occupied-status reconciliation. Slots filled by an
      // ASSIGNED USER (userId set) are managed via the invite/Vacate flow and
      // are never created/deleted/freed here — they're the lower bound for both
      // the total count and the occupied count. Everything else ("free" slots)
      // is HR-editable: count via `slots`, occupied flag via `occupied`.
      const userSlots = up.slot.filter((s) => !!s.userId);

      // (1) Total count — add/remove only FREE slots, keeping user slots intact.
      if (body.slots != null) {
        const want = Math.max(0, parseInt(String(body.slots), 10) || 0);
        if (want < userSlots.length) {
          throw new ValidationError(
            `Can't set fewer than ${userSlots.length} slot(s) — that many are filled by assigned users.`,
          );
        }
        const free = up.slot.filter((s) => !s.userId);
        const targetFree = want - userSlots.length;
        if (targetFree > free.length) {
          await tx.positionSlot.createMany({
            data: Array.from({ length: targetFree - free.length }, () => ({
              unitPositionId: up.id,
              positionId: up.positionId,
              salaryGradeId: body.salaryGradeId || null,
              occupied: false,
            })),
          });
        } else if (targetFree < free.length) {
          // Remove free slots, vacant ones first so manual occupancy survives.
          const removable = [...free]
            .sort((a, b) => Number(a.occupied) - Number(b.occupied))
            .slice(0, free.length - targetFree)
            .map((s) => s.id);
          if (removable.length) {
            await tx.positionSlot.deleteMany({ where: { id: { in: removable } } });
          }
        }
      }

      // (2) Occupied status — flag how many FREE slots are occupied. User slots
      // always count as occupied and act as the floor.
      if (body.occupied != null) {
        const slots = await tx.positionSlot.findMany({
          where: { unitPositionId: up.id },
          select: { id: true, userId: true },
        });
        const userCount = slots.filter((s) => !!s.userId).length;
        const free = slots.filter((s) => !s.userId);
        const target = Math.max(
          0,
          Math.min(slots.length, parseInt(String(body.occupied), 10) || 0),
        );
        if (target < userCount) {
          throw new ValidationError(
            `${userCount} slot(s) are filled by assigned users — vacate them first to lower the occupied count.`,
          );
        }
        const toMark = target - userCount; // free slots to flag occupied
        const occupyIds = free.slice(0, toMark).map((s) => s.id);
        const vacateIds = free.slice(toMark).map((s) => s.id);
        if (occupyIds.length) {
          await tx.positionSlot.updateMany({
            where: { id: { in: occupyIds } },
            data: { occupied: true },
          });
        }
        if (vacateIds.length) {
          await tx.positionSlot.updateMany({
            where: { id: { in: vacateIds } },
            data: { occupied: false },
          });
        }
      }

      if (userId) {
        await tx.humanResourcesLogs.create({
          data: {
            tab: 7,
            action: "Updated",
            lineId,
            userId,
            desc: `Updated position "${body.title ?? "—"}" (unitPosition ${up.id})`,
          },
        });
      }
    });

    return res.code(200).send({ message: "OK" });
  } catch (error) {
    if (error instanceof NotFoundError || error instanceof ValidationError) {
      throw error;
    }
    throw new AppError("POSITION_UPDATE_FAILED", 500, "DB_ERROR");
  }
};
