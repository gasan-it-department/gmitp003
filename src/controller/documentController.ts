import { FastifyRequest, FastifyReply } from "../barrel/fastify";
import { Prisma, prisma } from "../barrel/prisma";
import { AppError, NotFoundError, ValidationError } from "../errors/errors";
import path from "path";
import fs from "fs";
import cloudinary from "../class/Cloundinary";

export const addDocument = async (req: FastifyRequest, res: FastifyReply) => {
  if (!req.isMultipart()) {
    throw new ValidationError("INVALID REQUEST");
  }
  try {
    const parts = req.parts();
    const files: any[] = [];
    const formData: any = {};

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
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
    }
    throw error;
  }
};

import PDFParser from "pdf2json";
import {
  PdfParsedData,
  PdfPage,
  PagingProps,
  DocumentRoomApplicationProps,
} from "../models/route";
import { getFileType } from "../utils/document";

async function parsePdfWithPdf2Json(buffer: Buffer): Promise<PdfParsedData> {
  return new Promise((resolve, reject) => {
    const pdfParser = new PDFParser();

    pdfParser.on("pdfParser_dataError", (errData: any) => {
      reject(new Error(errData.parserError));
    });

    pdfParser.on("pdfParser_dataReady", (pdfData: any) => {
      const pages: PdfPage[] = [];
      let fullText = "";

      if (pdfData.Pages) {
        pdfData.Pages.forEach((page: any, index: number) => {
          let pageText = "";
          if (page.Texts) {
            page.Texts.forEach((textItem: any) => {
              // Decode the text (it might be encoded)
              const decodedText = decodeURIComponent(textItem.R[0].T);
              pageText += decodedText + " ";
            });
          }

          pages.push({
            pageNumber: index + 1,
            text: pageText.trim(),
            charCount: pageText.length,
          });

          fullText += pageText + "\n";
        });
      }

      resolve({
        numPages: pages.length,
        text: fullText.trim(),
        pages,
        metadata: pdfData.Meta || {},
        textStats: {
          totalCharacters: fullText.length,
          totalWords: fullText.split(/\s+/).filter((word) => word.length > 0)
            .length,
        },
      });
    });

    // Parse the buffer
    pdfParser.parseBuffer(buffer);
  });
}

export const authorizedUsers = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const params = req.query as PagingProps;

  if (!params.query) {
    return res.code(200).send({ list: [], lastCursor: null, hasMore: false });
  }

  if (!params.type && typeof params.type != "number") {
    throw new ValidationError("INVALID TYPE");
  }

  try {
    const cursor = params.lastCursor ? { id: params.lastCursor } : undefined;
    const limit = params.limit ? parseInt(params.limit) : 10;

    const response = await prisma.roomAuthorizedUser.findMany({
      where: {
        user: {
          firstName: { contains: params.query, mode: "insensitive" },
          lastName: { contains: params.query, mode: "insensitive" },
        },
        type: params.type,
      },
      skip: cursor ? 1 : 0,
      take: limit,
      cursor: cursor,
      orderBy: { user: { lastName: "desc", firstName: "desc" } },
      include: {
        receivingRoom: {
          select: {
            address: true,
            code: true,
          },
        },
        user: {
          select: {
            firstName: true,
            lastName: true,
            middleName: true,
            userProfilePictures: {
              select: {
                file_name: true,
                file_url: true,
                file_size: true,
              },
            },
          },
        },
      },
    });

    const newLastCursorId =
      response.length > 0 ? response[response.length - 1].id : null;
    const hasMore = response.length === limit;

    return res.code(200).send({
      list: response,
      lastCursor: newLastCursorId,
      hasMore: hasMore,
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
    }
    throw error;
  }
};

export const roomRegister = async (req: FastifyRequest, res: FastifyReply) => {
  // Check if it's multipart request
  const body = req.body as DocumentRoomApplicationProps;

  if (
    !body.address ||
    !body.lineId ||
    !body.userId ||
    body.authorizedUser.length === 0
  ) {
    throw new ValidationError("INVALID REQUIRED ID");
  }

  try {
    const response = await prisma.$transaction(async (tx) => {
      const checkUser = await tx.roomAuthorizedUser.findMany({
        where: {
          userId: {
            in: body.authorizedUser.map((item) => item.userId),
          },
        },
      });

      if (checkUser.length > 0) {
        return {
          status: 1,
          existedUserId: [...checkUser.map((item) => item.userId)],
        };
      }
      const request = await tx.roomRegistration.create({
        data: {
          address: body.address,
          authorizedUser: {
            createMany: {
              data: body.authorizedUser.map((user) => {
                return {
                  userId: user.userId,
                  type: parseInt(user.type, 10),
                };
              }),
            },
          },
          lineId: body.lineId,
          userId: body.userId,
        },
      });

      return { status: 0, existedUserId: [], requestId: request.id };
    });
    return res.code(200).send(response);
  } catch (error) {
    console.log(error);

    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === "P2002") {
        throw new ValidationError("DUPLICATE_ENTRY");
      }
      throw new AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
    }

    // Re-throw validation errors
    if (error instanceof ValidationError || error instanceof AppError) {
      throw error;
    }

    throw new AppError(
      "INTERNAL_SERVER_ERROR",
      500,
      "An unexpected error occurred",
    );
  }
};

export const signatoryRegistry = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const params = req.query as { userId: string };

  if (!params.userId) {
    throw new ValidationError("MISSING_USER_ID");
  }
  try {
    const [roomRegistration, signatory, room] = await prisma.$transaction([
      prisma.roomRegistration.findFirst({
        where: {
          userId: params.userId,
        },
      }),
      prisma.roomAuthorizedUser.findFirst({
        where: {
          userId: params.userId,
        },
        include: {
          signature: {
            select: {
              active: true,
              title: true,
              signature: true,
            },
          },
        },
      }),
      prisma.receivingRoom.findFirst({
        where: {
          authorizedUser: {
            some: {
              userId: params.userId,
            },
          },
        },
      }),
    ]);

    return res.code(200).send({ roomRegistration, signatory, room });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
    }
    throw error;
  }
};

export const roomRequest = async (req: FastifyRequest, res: FastifyReply) => {
  const params = req.query as PagingProps;

  if (!params.id) {
    throw new ValidationError("INVALID REQUIRED ID");
  }

  try {
    const cursor = params.lastCursor ? { id: params.id } : undefined;
    const limit = params.limit ? parseInt(params.limit, 10) : 20;

    // Start with base filter
    const filter: any = {
      lineId: params.id,
    };

    // Add status filter if provided
    if (
      params.status &&
      typeof params.status === "string" &&
      params.status !== "all"
    ) {
      filter.status = parseInt(params.status, 10);
    }

    // Add search filter if query provided
    if (params.query && params.query.trim()) {
      const searchTerms = params.query.trim().split(/\s+/);
      const searchQuery = params.query.trim();

      // Create user filter for the relation
      filter.user = {
        OR: [
          // Search in firstname
          { firstName: { contains: searchQuery, mode: "insensitive" } },
          // Search in lastname
          { lastName: { contains: searchQuery, mode: "insensitive" } },
          // Search in email
          { email: { contains: searchQuery, mode: "insensitive" } },
          // Search in username if exists
          { username: { contains: searchQuery, mode: "insensitive" } },
          // Also search address directly on roomRegistration
        ],
      };

      // If multiple search terms, also search for combinations
      if (searchTerms.length > 1) {
        // Add AND conditions for each term (more strict search)
        filter.user.OR.push({
          AND: searchTerms.map((term) => ({
            OR: [
              { firstName: { contains: term, mode: "insensitive" } },
              { lastName: { contains: term, mode: "insensitive" } },
            ],
          })),
        });
      }
    }

    console.log("Filter:", JSON.stringify(filter, null, 2));

    const response = await prisma.roomRegistration.findMany({
      where: filter,
      take: limit + 1, // Take one extra to check if there are more
      skip: cursor ? 1 : 0,
      cursor,
      orderBy: {
        timestamp: "desc",
      },
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            username: true,
          },
        },
        line: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    // Check if there are more items
    const hasMore = response.length > limit;
    const items = hasMore ? response.slice(0, -1) : response;

    const newLastCursorId =
      items.length > 0 ? items[items.length - 1].id : null;

    return res.code(200).send({
      list: items,
      lastCursor: newLastCursorId,
      hasMore,
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      console.error("Prisma error:", error);
      throw new AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
    }
    console.error("Room request error:", error);
    throw error;
  }
};

export const updateStatus = async (req: FastifyRequest, res: FastifyReply) => {
  const body = req.body as {
    id: string;
    status: number;
    lineId: string;
    userId: string;
  };

  if (!body.id || !body.lineId || !body.status || !body.userId) {
    throw new ValidationError("INVALID REQUIRED ID");
  }

  try {
    const response = await prisma.$transaction(async (tx) => {
      const dateUpdated: any = {};

      const request = await tx.roomRegistration.update({
        where: {
          id: body.id,
        },
        data: {
          status: body.status,
        },
        include: {
          authorizedUser: true,
        },
      });

      if (body.status === 1) {
        dateUpdated.dateApproved = new Date().toISOString();
      }

      if (body.status === 2) {
        dateUpdated.dateRejected = new Date().toISOString();
      }

      const room = await tx.receivingRoom.create({
        data: {
          address: request.address,
          code: `RM-${Math.random().toString(36).slice(2, 9).toUpperCase()}`,
          lineId: request.lineId,
        },
      });

      if (body.status === 1) {
        await tx.roomAuthorizedUser.createMany({
          data: request.authorizedUser.map((item) => {
            return {
              userId: item.userId,
              type: item.type,
              receivingRoomId: room.id,
            };
          }),
        });

        await tx.notification.create({
          data: {
            recipientId: request.userId,
            content: `You can now access and manage Document.`,
            title: "Document Room Approved",
            senderId: body.userId,
          },
        });
      }

      await tx.humanResourcesLogs.create({
        data: {
          lineId: body.lineId,
          userId: body.userId,
          action: "UPDATE",
          desc: `UPDATE ROOM REQUEST`,
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

export const deleteRoomRequest = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const params = req.query as { id: string; userId: string; lineId: string };

  if (!params.id || !params.lineId || !params.userId) {
    throw new ValidationError("INVALID REQUIRED ID");
  }

  try {
    const response = await prisma.$transaction(async (tx) => {
      const request = await tx.roomRegistration.delete({
        where: {
          id: params.id,
        },
        include: {
          user: {
            select: {
              username: true,
            },
          },
        },
      });

      await tx.humanResourcesLogs.create({
        data: {
          action: "DELETE",
          desc: `DELETE DOCUMENT ROOM REQUEST: ${request.user.username}`,
          userId: params.userId,
          lineId: params.lineId,
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

export const roomRequestDetails = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const params = req.query as { id: string };

  if (!params.id) {
    throw new ValidationError("INVALID REQUIRED ID");
  }

  try {
    const response = await prisma.roomRegistration.findUnique({
      where: {
        id: params.id,
      },
      include: {
        authorizedUser: {
          select: {
            id: true,
            userId: true,
            user: {
              select: {
                lastName: true,
                firstName: true,
                username: true,
              },
            },
          },
        },
        roomRegistrationSignatures: true,
        user: {
          select: {
            username: true,
            lastName: true,
            firstName: true,
            id: true,
          },
        },
      },
    });

    if (!response) {
      throw new NotFoundError("REQUEST NOT FOUND");
    }

    return res.code(200).send(response);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
    }
    throw error;
  }
};

export const archives = async (req: FastifyRequest, res: FastifyReply) => {
  const params = req.query as PagingProps;
  console.log("PARAMS:", params);

  if (!params.id) {
    throw new ValidationError("INVALID REQUIRED ID");
  }

  try {
    const cursor = params.lastCursor ? { id: params.id } : undefined;
    const limit = params.limit ? parseInt(params.limit, 10) : 20;

    const response = await prisma.archiveDocument.findMany({
      where: {
        receivingRoomId: params.id,
      },
      take: limit,
      skip: cursor ? 1 : 0,
      cursor,
      orderBy: {
        timestamp: "desc",
      },
    });

    const newLastCursorId =
      response.length > 0 ? response[response.length - 1].id : null;
    const hasMore = response.length === limit;
    console.log("REsponse: ", response);

    return res.code(200).send({
      list: response,
      lastCursor: newLastCursorId,
      hasMore,
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
    }
    throw error;
  }
};

export const archiveFile = async (req: FastifyRequest, res: FastifyReply) => {
  const isMultipart = req.isMultipart();

  if (!isMultipart) throw new ValidationError("INVALID MULTIPARTS");

  try {
    const parts = req.parts();
    console.log(JSON.stringify(parts, null, 2));

    let file: any;
    const formData: any = {};

    for await (let part of parts) {
      if (part.type === "file") {
        const buffers = [];
        for await (const chunk of part.file) buffers.push(chunk);
        file = {
          fieldname: part.fieldname,
          filename: part.filename,
          mimetype: part.mimetype,
          buffer: Buffer.concat(buffers),
        };
      } else {
        formData[part.fieldname] = part.value;
      }
    }

    console.log({ file, formData: JSON.stringify(formData) });

    if (!formData.userId || !formData.lineId) {
      throw new ValidationError("INVALID REQUIRED ID");
    }
    if (!file) {
      throw new ValidationError("INVALID FILE");
    }
    const fileType = getFileType({
      mimetype: file.mimetype,
      filename: file.filename,
      buffer: file.buffer,
    });
    const response = await prisma.$transaction(async (tx) => {
      const doc = await tx.document.create({
        data: {
          file: {
            create: {
              fileName: file.filename,
              fileDecoded: file.buffer,
              fileSize: file.buffer.length,
              fileType: fileType,
            },
          },
          docType: 1,
          size: file.buffer.length,
          title: formData.title,
          lineId: formData.lineId,
          userId: formData.userId,
          archiveDocuments: {
            create: {
              abstract: {
                create: {
                  content: formData.abstract,
                  title: `${formData.title} - ABSTRACT`,
                },
              },
              receivingRoomId: undefined,
            },
          },
        },
      });
      await tx.documentActivityLogs.create({
        data: {
          userId: formData.userId,
          lineId: formData.lineId,
          title: `Archived - ${file.filename}`,
          desc: `Document "${formData.title}" was archived with abstract: ${formData.abstract?.substring(0, 50)}${formData.abstract?.length > 50 ? "..." : ""}`,
          action: 1,
          documentId: doc.id,
        },
      });
      return true;
    });

    if (!response) throw new ValidationError("TRANSACTION FAILED");
    return res.code(200).send("OK");
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
    }
    throw error;
  }
};

export const rooms = async (req: FastifyRequest, res: FastifyReply) => {
  const params = req.query as PagingProps;

  if (!params.id) {
    throw new ValidationError("INVALID REQUIRED ID");
  }

  try {
    const cursor = params.lastCursor ? { id: params.lastCursor } : undefined;
    const limit = params.limit ? parseInt(params.limit) : 20;

    const response = await prisma.receivingRoom.findMany({
      where: {
        lineId: params.id,
      },
      take: limit,
      skip: cursor ? 1 : 0,
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
    console.log("Error: ", error);

    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DB_CONNECTION", 500, "DB_FAILED");
    }

    throw error;
  }
};

export const room = async (req: FastifyRequest, res: FastifyReply) => {
  const params = req.query as { id: string };

  if (!params.id) {
    throw new ValidationError("INVALID REQUIRED ID");
  }

  try {
    const response = await prisma.receivingRoom.findUnique({
      where: {
        id: params.id,
      },
    });

    if (!response) {
      throw new NotFoundError("ROOM NOT FOUND");
    }

    return res.code(200).send(response);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DB_CONNECTION", 500, "DB_FAILED");
    }

    throw error;
  }
};
