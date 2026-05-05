import { FastifyRequest, FastifyReply } from "../barrel/fastify";
import { Prisma, prisma } from "../barrel/prisma";
import { AppError, NotFoundError, ValidationError } from "../errors/errors";
import { embeddingService } from "../service/Embedding";
import fs from "fs";

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
import { extractTextFromFile, getFileType } from "../utils/document";
import path from "path";
import { archiveDocType } from "../utils/helper";

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

  if (!params.id) {
    throw new ValidationError("INVALID REQUIRED ID");
  }

  try {
    const limit = params.limit ? parseInt(params.limit, 10) : 20;
    const searchTerms = params.query;

    const where: any = {
      lineId: params.id,
    };

    if (searchTerms && searchTerms.trim()) {
      where.abstract = {
        content: {
          contains: searchTerms,
          mode: "insensitive",
        },
      };
    }

    const cursor = params.lastCursor ? { id: params.lastCursor } : undefined;

    const response = await prisma.archiveDocument.findMany({
      take: limit,
      skip: cursor ? 1 : 0,
      cursor,
      orderBy: {
        timestamp: "desc",
      },
      select: {
        id: true,
        lineId: true,
        abstract: true,
        timestamp: true,
        docType: true,
        document: {
          select: {
            id: true,
            title: true,
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
      hasMore,
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
    }
    throw error;
  }
};

export const searchArchiveDocsAI = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const params = req.query as PagingProps & { query?: string };
  console.log("Search Archives: ", { params });

  try {
    const cursor = params.lastCursor ? { id: params.lastCursor } : undefined;
    const limit = params.limit ? parseInt(params.limit, 10) : 20;
    const lineId = params.lineId as string | undefined;
    const roomId = params.id;
    const searchQuery = params.query?.trim();
    await embeddingService.initialize();
    const similar = params.query
      ? await embeddingService.findSimilar(params.query, roomId, 20)
      : [];

    // Build search conditions for abstract content
    // const buildAbstractSearch = () => {
    //   if (!searchQuery) return {};

    //   const searchTerms = searchQuery
    //     .split(/\s+/)
    //     .filter((term) => term.length > 0);

    //   if (searchTerms.length === 1) {
    //     return {
    //       abstract: {
    //         content: {
    //           contains: searchTerms[0],
    //           mode: "insensitive" as const,
    //         },
    //       },
    //     };
    //   }

    //   // For multiple terms, match if any term is present in abstract
    //   return {
    //     OR: searchTerms.map((term) => ({
    //       abstract: {
    //         content: {
    //           contains: term,
    //           mode: "insensitive" as const,
    //         },
    //       },
    //     })),
    //   };
    // };

    // const response = await prisma.$transaction(async (tx) => {
    //   const abstractSearch = buildAbstractSearch();

    //   const roomArchive = await tx.archiveDocument.findMany({
    //     where: {
    //       receivingRoomId: roomId,
    //       ...(searchQuery && abstractSearch),
    //     },
    //     take: limit,
    //     skip: cursor ? 1 : 0,
    //     cursor,
    //     orderBy: {
    //       timestamp: "desc",
    //     },
    //     select: {
    //       id: true,
    //       lineId: true,
    //       abstract: true,
    //       timestamp: true,
    //       document: {
    //         select: {
    //           title: true,
    //           id: true,
    //         },
    //       },
    //     },
    //   });

    //   // Other archives search - from same line but different rooms
    //   const otherArchives = await tx.archiveDocument.findMany({
    //     where: {
    //       lineId: lineId,
    //       receivingRoomId: {
    //         not: roomId,
    //       },
    //       ...(searchQuery && abstractSearch),
    //     },
    //     take: limit,
    //     skip: cursor ? 1 : 0,
    //     cursor,
    //     orderBy: {
    //       timestamp: "desc",
    //     },
    //     select: {
    //       id: true,
    //       lineId: true,
    //       abstract: true,
    //       timestamp: true,
    //       document: {
    //         select: {
    //           title: true,
    //           id: true,
    //         },
    //       },
    //     },
    //   });

    //   return [...roomArchive, ...otherArchives];
    // });

    // // Sort combined results by timestamp
    // const sortedResponse = response.sort(
    //   (a, b) =>
    //     new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
    // );

    const newLastCursor =
      similar.length > 0 ? similar[similar.length - 1].id : null;
    const hasMore = similar.length === limit;

    return res.code(200).send({
      list: similar,
      hasMore,
      lastCursor: newLastCursor,
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
    }
    throw error;
  }
};

export const searchArchiveDocs = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const params = req.query as PagingProps & { query?: string };
  console.log("Reg", { params });

  try {
    const cursor = params.lastCursor ? { id: params.lastCursor } : undefined;
    const limit = params.limit ? parseInt(params.limit, 10) : 20;
    const lineId = params.lineId as string | undefined;
    const roomId = params.id;

    const filter: any = {};
    const searchQuery = params.query?.trim();

    if (searchQuery) {
      filter.document = {
        title: {
          contains: searchQuery,
          mode: "insensitive",
        },
      };
    }

    const response = await prisma.$transaction(async (tx) => {
      const lineArchives = await tx.archiveDocument.findMany({
        where: {
          lineId: lineId,
          ...filter,
        },
        take: limit,
        cursor,
      });

      const roomAcrhives = await tx.archiveDocument.findMany({
        where: {
          receivingRoomId: roomId,
          ...filter,
        },
        take: limit,
        cursor,
      });

      return [...roomAcrhives, ...lineArchives];
    });

    const newLastCursorId =
      response.length > 0 ? response[response.length - 1].id : null;
    const hasMore = response.length === limit;

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

    // console.log({ file, formData: JSON.stringify(formData) });

    if (!formData.userId || !formData.lineId || !formData.receivingRoomId) {
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

    const docTypeIndex = formData.docType ? parseInt(formData.docType, 10) : 0;
    const docType = archiveDocType[docTypeIndex];

    const response = await prisma.$transaction(async (tx) => {
      const doc = await tx.document.create({
        data: {
          file: {
            create: {
              fileName: file.filename,
              fileDecoded: file.buffer,
              fileSize: file.buffer.length.toString(),
              fileType: fileType,
            },
          },
          docType: docTypeIndex,
          size: file.buffer.length,
          title: formData.title,
          lineId: formData.lineId,
          userId: formData.userId,
          receivingRoomId: formData.receivingRoomId,
        },
      });

      const abstractVector = await embeddingService.generateEmbedding(
        formData.abstract,
      );

      const titleVector = await embeddingService.generateEmbedding(
        formData.title,
      );

      const typeVector = await embeddingService.generateEmbedding(docType);

      await tx.archiveDocument.create({
        data: {
          abstract: {
            create: {
              content: formData.abstract,
              title: `${formData.title}`,
              embedding: {
                create: {
                  vector: [...abstractVector, ...titleVector, ...typeVector],
                  model: "Xenova/all-MiniLM-L6-v2",
                  dimensions: 384,
                },
              },
            },
          },
          receivingRoom: {
            connect: {
              id: formData.receivingRoomId,
            },
          },
          document: {
            connect: {
              id: doc.id,
            },
          },
          line: {
            connect: {
              id: formData.lineId,
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
    console.log({ error });
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

export const removeRoom = async (req: FastifyRequest, res: FastifyReply) => {
  const params = req.query as { id: string; userId: string; lineId: string };

  if (!params.id || !params.lineId || !params.userId) {
    throw new ValidationError("INVALID REQUIRED ID");
  }

  try {
    const response = await prisma.$transaction(async (tx) => {
      const room = await tx.receivingRoom.delete({
        where: {
          id: params.id,
        },
      });

      await tx.humanResourcesLogs.create({
        data: {
          action: "DELETE",
          desc: `REMOVE RECEIVING ROOM: ${room.address}-${room.code}`,
          userId: params.userId,
          lineId: params.lineId,
        },
      });

      return true;
    });

    if (!response) {
      throw new ValidationError("TRANSACTION FAILED");
    }

    return res.code(200).send({ message: "Ok" });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DB_CONNECTION", 500, "DB_FAILED");
    }

    throw error;
  }
};

export const updateRoomStatus = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const body = req.body as {
    id: string;
    lineId: string;
    userId: string;
    status: number;
  };

  if (!body.id || !body.lineId || !body.userId) {
    throw new Error("INVALID REQUIRED ID");
  }

  try {
    const response = await prisma.$transaction(async (tx) => {
      const updatedRoom = await tx.receivingRoom.update({
        where: {
          id: body.id,
        },
        data: {
          status: body.status,
        },
      });

      await tx.humanResourcesLogs.create({
        data: {
          action: "UPDATE",
          desc: `UPDATE RECEIVING ROOM: ${updatedRoom.address}-${updatedRoom}`,
          userId: body.userId,
          lineId: body.lineId,
        },
      });

      return true;
    });

    if (!response) {
      throw new ValidationError("TRANSACTION FAILED");
    }

    return res.code(200).send({ message: "Ok" });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DB_CONNECTION", 500, "DB_FAILED");
    }

    throw error;
  }
};

export const archiveDetail = async (req: FastifyRequest, res: FastifyReply) => {
  const params = req.query as { id: string };

  try {
    const response = await prisma.archiveDocument.findUnique({
      where: {
        id: params.id,
      },
      include: {
        abstract: true,
      },
    });

    if (!response) {
      throw new NotFoundError("ARCHIVE NOT FOUND");
    }

    return res.code(200).send(response);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DB_CONNECTION", 500, "DB_FAILED");
    }

    throw error;
  }
};

export const downloadArchiveFile = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const params = req.query as { id: string };

  if (!params.id) throw new ValidationError("INVALID REQUIRED ID");

  try {
    const response = await prisma.archiveDocument.findUnique({
      where: {
        id: params.id,
      },
      include: {
        document: {
          select: {
            file: true,
          },
        },
      },
    });

    if (!response) throw new NotFoundError("ARCHIVE NOT FOUND");

    const buffered = response.document?.file;
    if (!buffered) {
      throw new ValidationError("INVALID FILE FORMAT");
    }

    if (!buffered.fileDecoded) {
      throw new ValidationError("FILE DATA IS MISSING OR CORRUPTED");
    }

    const fileBuffer = Buffer.from(buffered.fileDecoded);

    // Set headers for file download
    const filename =
      buffered.fileName ||
      `document_${params.id}.${buffered.fileType?.split("/")[1] || "bin"}`;

    res.header("Content-Type", buffered.fileType || "application/octet-stream");
    res.header("Content-Disposition", `attachment; filename="${filename}"`);
    res.header("Content-Length", fileBuffer.length.toString());

    // Send the file
    return res.code(200).send(fileBuffer);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DB_CONNECTION", 500, "DB_FAILED");
    }
    throw error;
  }
};

export const createDocumentRoute = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const body = req.body as {
    roomName: string;
    lineId: string;
    userId: string;
    roomId: string;
  };

  if (!body.roomName || !body.lineId || !body.userId || !body.roomId) {
    throw new ValidationError("INVALID REQUIRED ID");
  }
  try {
    const response = await prisma.$transaction(async (tx) => {
      const room = await tx.signatureQueueRoom.create({
        data: {
          title: body.roomName,
          receivingRoomId: body.roomId,
          userId: body.userId,
          status: 0,
          step: 0,
        },
      });

      await tx.documentActivityLogs.create({
        data: {
          userId: body.userId,
          lineId: body.lineId,
          title: `Created Document Room - ${body.roomName}`,
          desc: `Document Room "${body.roomName}" was created.`,
          action: 1,
        },
      });

      return room.id;
    });

    if (!response) throw new ValidationError("TRANSACTION FAILED");
    return res.code(200).send({ id: response });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DB_CONNECTION", 500, "DB_FAILED");
    }
    throw error;
  }
};

export const routerInfo = async (req: FastifyRequest, res: FastifyReply) => {
  const params = req.query as { id: string };
  console.log("Route: ", params);

  if (!params.id) {
    throw new ValidationError("INVALID REQUIRED PARAMETERS");
  }
  try {
    const response = await prisma.signatureQueueRoom.findUnique({
      where: {
        id: params.id,
      },
    });

    if (!response) throw new NotFoundError("DATA NOT FOUND");

    return res.code(200).send(response);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DB_CONNECTION", 500, "DB_FAILED");
    }
    throw error;
  }
};

export const generateAbstract = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  if (!req.isMultipart()) {
    throw new ValidationError("INVALID REQUIRED FIELD");
  }

  try {
    const parts = req.parts();
    console.log("Gen. Abstract: ", parts);

    const tmpDir = path.join(process.cwd(), "tmp_uploads");

    // Ensure tmp directory exists
    if (!fs.existsSync(tmpDir)) {
      fs.mkdirSync(tmpDir, { recursive: true });
    }

    let fileBuffer: Buffer | null = null;
    let filename = "";

    for await (let part of parts) {
      if (part.type === "file") {
        fileBuffer = await part.toBuffer(); // Get the buffer from the part
        filename = part.filename;
        break; // Exit after getting the first file
      }
    }

    if (!fileBuffer) {
      throw new ValidationError("NO_FILE_UPLOADED");
    }

    const safe = filename.replace(/[^\w.-]/g, "_");
    const tmpPath = path.join(tmpDir, safe);

    // Write buffer to file
    fs.writeFileSync(tmpPath, fileBuffer);

    // Generate abstract
    const response = await embeddingService.generateAbstractFromPDF(tmpPath);

    // Clean up
    fs.unlinkSync(tmpPath);
    console.log({ abstract: response });

    return res.code(200).send({ abstract: response });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DB_CONNECTION", 500, "DB_FAILED");
    }
    throw error;
  }
};

export const removeArchiveFile = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const params = req.query as { id: string; userId: string; lineId: string };

  if (!params.id || !params.lineId || !params.userId) {
    throw new ValidationError("INVALID REQUIRED FIELD");
  }

  try {
    const response = await prisma.$transaction(async (tx) => {
      const archiveDocs = await tx.archiveDocument.delete({
        where: {
          id: params.id,
        },
        select: {
          id: true,
          document: {
            select: {
              title: true,
            },
          },
          documentId: true,
        },
      });

      await tx.documentActivityLogs.create({
        data: {
          action: 0,
          desc: `Removed ${archiveDocs.document?.title || "Document not found"} from archives`,
          title: "REMOVE FROM ARCHIVE",
          userId: params.userId,
          lineId: params.lineId,
          documentId: archiveDocs.documentId,
        },
      });

      return true;
    });

    if (!response) {
      throw new ValidationError("TRACTION FAILED");
    }

    return res.code(200).send({ message: "OK" });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DB_CONNECTION", 500, "DB_FAILED");
    }
    throw error;
  }
};

export const userSignatures = async (
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

    const response = await prisma.signature.findMany({
      where: {
        userId: params.id,
      },
      take: limit,
      skip: cursor ? 1 : 0,
      cursor,
    });

    const processed = response.forEach((sign) => {
      const buffered = sign.signature;
      if (!buffered) {
        throw new ValidationError("INVALID FILE FORMAT");
      }

      if (!buffered) {
        throw new ValidationError("FILE DATA IS MISSING OR CORRUPTED");
      }

      const fileBuffer = Buffer.from(buffered);
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DB_CONNECTION", 500, "DB_FAILED");
    }
    throw error;
  }
};
