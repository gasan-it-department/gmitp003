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
import { PdfParsedData, PdfPage, PagingProps } from "../models/route";

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

export const signatories = async (req: FastifyRequest, res: FastifyReply) => {
  const params = req.query as PagingProps;

  if (!params.query) {
    return res.code(200).send({ list: [], lastCursor: null, hasMore: false });
  }

  try {
    const cursor = params.lastCursor ? { id: params.lastCursor } : undefined;
    const limit = params.limit ? parseInt(params.limit) : 10;

    const response = await prisma.signatory.findMany({
      where: {
        user: {
          firstName: { contains: params.query, mode: "insensitive" },
          lastName: { contains: params.query, mode: "insensitive" },
        },
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

  if (!req.isMultipart()) {
    throw new ValidationError("INVALID_REQUEST");
  }
  console.log("Clicked");

  try {
    const tmpDir = path.join(process.cwd(), "tmp_uploads");

    let lineId: string | null = null;
    let address: string | null = null;
    let receivers: any[] = [];
    let signature: Buffer | null = null;
    let userId: string | null = null;
    let signatureFilename: string | null = null;
    let signatureMimetype: string | null = null;

    const files: Array<{
      fieldname: string;
      filename: string;
      mimetype: string;
      buffer: Buffer;
    }> = [];

    const parts = req.parts();

    for await (const part of parts) {
      if (part.type === "field") {
        switch (part.fieldname) {
          case "lineId":
            lineId = part.value as string;
            break;
          case "address":
            address = part.value as string;
            break;
          case "userId":
            userId = part.value as string;
            break;
          case "receivers":
            receivers = JSON.parse(part.value as string);
            break;
          default:
            console.log(`Unknown field: ${part.fieldname} = ${part.value}`);
        }
      } else if (part.type === "file") {
        // Handle file uploads
        const chunks: Buffer[] = [];

        for await (const chunk of part.file) {
          chunks.push(chunk);
        }

        const fileBuffer = Buffer.concat(chunks);

        // Check if this is the signature file
        if (part.fieldname === "signature") {
          signature = fileBuffer;
          signatureFilename = part.filename;
          signatureMimetype = part.mimetype;
        }

        files.push({
          fieldname: part.fieldname,
          filename: part.filename,
          mimetype: part.mimetype,
          buffer: fileBuffer,
        });
      }
    }

    if (!lineId) {
      throw new ValidationError("MISSING_FIELD");
    }

    if (!address) {
      throw new ValidationError("MISSING_FIELD");
    }

    if (!signature) {
      throw new ValidationError("MISSING_FIELD");
    }

    if (!userId) {
      throw new ValidationError("MISSING_FIELD");
    }

    const allowedSignatureTypes = ["image/png"];
    if (
      signatureMimetype &&
      !allowedSignatureTypes.includes(signatureMimetype)
    ) {
      throw new ValidationError("INVALID_FILE_TYPE");
    }

    const maxFileSize = 5 * 1024 * 1024; // 5MB
    if (signature && signature.length > maxFileSize) {
      throw new ValidationError("FILE_TOO_LARGE");
    }

    // If you want to save files to disk
    // for (const file of files) {
    //   await saveFileToDisk(file.buffer, file.filename);
    // }
    const response = await prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({ where: { id: userId! } });
      if (!user) throw new ValidationError("USER_NOT_FOUND");
      if (receivers.length === 0) throw new ValidationError("NO_RECEIVERS");
      const checkedReceiver = await tx.user.findMany({
        where: {
          id: { in: receivers.map((item) => item.userId) },
        },
      });

      if (checkedReceiver.length !== receivers.length) {
        throw new ValidationError("INVALID_RECEIVERS");
      }

      const safe = signatureFilename!.replace(/[^\w.-]/g, "_");
      const tmpPath = path.join(tmpDir, safe);
      fs.writeFileSync(tmpPath, signature!);
      const uploadedSignatureFilename = await cloudinary.uploader.upload(
        tmpPath,
        {
          folder: "document_signature",
          resource_type: "auto",
          use_filename: true,
          unique_filename: true,
        },
      );
      if (!uploadedSignatureFilename.secure_url) {
        throw new ValidationError("SIGNATURE_UPLOAD_FAILED");
      }
      const roomRegistration = await tx.roomRegistration.create({
        data: {
          lineId: lineId,
          address,
          userId,
          receivers: {
            createMany: {
              data: checkedReceiver.map((item) => {
                return { userId: item.id, nickname: item.firstName };
              }),
            },
          },
          roomRegistrationSignatures: {
            create: {
              file_name: uploadedSignatureFilename.original_filename,
              file_url: uploadedSignatureFilename.url,
              file_public_id: uploadedSignatureFilename.public_id,
            },
          },
        },
      });

      return roomRegistration;
    });

    if (!response) {
      throw new ValidationError("ROOM_REGISTRATION_FAILED");
    }
    console.log({ lineId, address, signature, receivers, userId });

    // Send success response
    return res.status(200).send({
      message: "OK",
      data: response,
    });
  } catch (error) {
    console.log(error);

    // Handle Prisma errors
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

    console.error("Unexpected error in roomRegister:", error);
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
  console.log("Reg: ", params);

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
      prisma.signatory.findFirst({
        where: {
          userId: params.userId,
        },
      }),
      prisma.receivingRoom.findFirst({
        where: {
          signatory: {
            some: {
              userId: params.userId,
            },
          },
        },
      }),
    ]);
    console.log({ roomRegistration, signatory, room });

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
    throw new ValidationError("");
  }

  try {
    const response = await prisma.$transaction(async (tx) => {
      const resolve: any = {};
      if (body.status === 1) {
        resolve.dateApproved = new Date().toISOString();
      }
      if (body.status === 2) {
        resolve.dateRejected = new Date().toISOString();
      }
      const request = await tx.roomRegistration.update({
        where: {
          id: body.id,
        },
        data: {
          status: body.status,
          ...resolve,
        },
      });

      if (body.status === 1) {
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
        receivers: {
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
