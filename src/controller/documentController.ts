import { FastifyRequest, FastifyReply } from "../barrel/fastify";
import { Prisma, prisma } from "../barrel/prisma";
import { AppError, NotFoundError, ValidationError } from "../errors/errors";
import { embeddingService } from "../service/Embedding";
import { createUserNotification } from "../service/notificationEvents";

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
    // Bug fix: was `{ id: params.id }` (the lineId), so pagination would
    // restart at the first row on every page. The cursor must be the
    // last row id from the previous page.
    const cursor = params.lastCursor ? { id: params.lastCursor } : undefined;
    const limit = params.limit ? parseInt(params.limit, 10) : 20;

    const filter: any = { lineId: params.id };

    if (
      params.status &&
      typeof params.status === "string" &&
      params.status !== "all"
    ) {
      filter.status = parseInt(params.status, 10);
    }

    if (params.query && params.query.trim()) {
      const q = params.query.trim();
      // Search across user fields AND the request's own address. We
      // wrap everything in a top-level OR so any match qualifies.
      filter.OR = [
        { address: { contains: q, mode: "insensitive" } },
        {
          user: {
            OR: [
              { firstName: { contains: q, mode: "insensitive" } },
              { lastName: { contains: q, mode: "insensitive" } },
              { email: { contains: q, mode: "insensitive" } },
              { username: { contains: q, mode: "insensitive" } },
            ],
          },
        },
      ];
    }

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

      // Only create a room on approval — previously this ran for every
      // status update including rejections, which left orphaned rooms.
      if (body.status === 1) {
        const room = await tx.receivingRoom.create({
          data: {
            address: request.address,
            code: `RM-${Math.random().toString(36).slice(2, 9).toUpperCase()}`,
            lineId: request.lineId,
          },
        });

        // Always include the requester themselves as an authorized user
        // (type 0 = owner). Previously only `request.authorizedUser` (the
        // co-signatories they listed) were added, which left the requester
        // without a membership if they didn't list themselves.
        const members = [
          { userId: request.userId, type: 0 },
          ...request.authorizedUser.map((item) => ({
            userId: item.userId,
            type: item.type,
          })),
        ];
        const seen = new Set<string>();
        const uniqueMembers = members.filter((m) => {
          if (seen.has(m.userId)) return false;
          seen.add(m.userId);
          return true;
        });

        await tx.roomAuthorizedUser.createMany({
          data: uniqueMembers.map((m) => ({
            userId: m.userId,
            type: m.type,
            receivingRoomId: room.id,
          })),
        });

        await createUserNotification(tx, {
          recipientId: request.userId,
          content: `You can now access and manage Document.`,
          title: "Document Room Approved",
          senderId: body.userId,
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
  if (!params.id) throw new ValidationError("INVALID REQUIRED ID");

  try {
    const response = await prisma.roomRegistration.findUnique({
      where: { id: params.id },
      include: {
        authorizedUser: {
          select: {
            id: true,
            userId: true,
            user: {
              select: {
                id: true,
                lastName: true,
                firstName: true,
                username: true,
                email: true,
              },
            },
          },
        },
        roomRegistrationSignatures: true,
        roomRegistrationConversations: {
          orderBy: { timestamp: "desc" },
          take: 25,
        },
        line: { select: { id: true, name: true } },
        user: {
          select: {
            id: true,
            username: true,
            lastName: true,
            firstName: true,
            email: true,
          },
        },
      },
    });

    if (!response) throw new NotFoundError("REQUEST NOT FOUND");

    // The frontend historically reads `receivers`; alias the relation so
    // both shapes are available without breaking the existing type.
    const payload = {
      ...response,
      receivers: (response as any).authorizedUser ?? [],
    };
    return res.code(200).send(payload);
  } catch (error) {
    if (error instanceof NotFoundError) throw error;
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
    const q = params.query?.trim();
    const roomId = (params as PagingProps & { roomId?: string }).roomId;

    const where: any = { lineId: params.id, status: 1 };
    if (roomId) where.receivingRoomId = roomId;

    // Keyword filter searches BOTH document.title and abstract content/title
    if (q) {
      where.OR = [
        { document: { title:    { contains: q, mode: "insensitive" } } },
        { abstract: { title:    { contains: q, mode: "insensitive" } } },
        { abstract: { content:  { contains: q, mode: "insensitive" } } },
      ];
    }

    const cursor = params.lastCursor ? { id: params.lastCursor } : undefined;

    const response = await prisma.archiveDocument.findMany({
      where,
      take: limit,
      skip: cursor ? 1 : 0,
      cursor,
      orderBy: { timestamp: "desc" },
      include: {
        document: {
          select: {
            id: true,
            title: true,
            timestamp: true,
            size: true,
          },
        },
        abstract: {
          select: { id: true, title: true, content: true, timestamp: true },
        },
        preservation: {
          select: {
            id: true,
            retentionDate: true,
            safeDate: true,
            detentionDate: true,
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

/**
 * Semantic search across archived documents.
 *
 * Strategy:
 *   1) Pre-filter candidate archives by line / room (cheap SQL).
 *   2) Embed the query once (384 dims, all-MiniLM-L6-v2).
 *   3) Cosine-compare against each candidate's stored composite vector
 *      (title + type + abstract embedded together at write time).
 *   4) Drop results below a similarity threshold.
 *   5) Sort by score and apply offset-based pagination.
 *
 * Returns each item with a `similarity` score so the UI can display
 * "relevance" badges. Falls back to recency order when no query is given.
 */
export const searchArchiveDocsAI = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const params = req.query as PagingProps & {
    query?: string;
    threshold?: string;
    offset?: string;
  };

  try {
    const limit = params.limit ? parseInt(params.limit, 10) : 20;
    // Accept either `offset` or `lastCursor` (treated as a stringified offset)
    const offset =
      params.offset !== undefined
        ? parseInt(params.offset, 10) || 0
        : params.lastCursor
          ? parseInt(params.lastCursor, 10) || 0
          : 0;
    const lineId = params.lineId as string | undefined;
    const roomId = params.id;
    const q = params.query?.trim() ?? "";
    // Mean-pooled MiniLM embeddings typically score 0.10–0.45 for paraphrases.
    // Default of 0.15 catches genuine matches without flooding with noise.
    const threshold = params.threshold
      ? Math.max(0, Math.min(1, parseFloat(params.threshold)))
      : 0.15;

    // Pre-filter candidates: scope by room/line + exclude removed (status=0).
    // Using `not: 0` so legacy NULL/unset status values are still included.
    const whereScope: any = { status: { not: 0 } };
    if (roomId) whereScope.receivingRoomId = roomId;
    if (lineId) whereScope.lineId = lineId;

    const baseInclude = {
      document: { select: { id: true, title: true } },
      abstract: {
        select: {
          id: true,
          title: true,
          content: true,
          embedding: { select: { vector: true, dimensions: true } },
        },
      },
      receivingRoom: { select: { id: true, code: true, address: true } },
    } as const;

    // ── No query → recency order (with simple offset paging) ──────────
    if (!q) {
      const items = await prisma.archiveDocument.findMany({
        where: whereScope,
        orderBy: { timestamp: "desc" },
        skip: offset,
        take: limit + 1,
        include: baseInclude,
      });
      const hasMore = items.length > limit;
      const list = items.slice(0, limit).map((i) => ({ ...i, similarity: 0 }));
      return res.code(200).send({
        list,
        hasMore,
        nextOffset: hasMore ? offset + limit : null,
        lastCursor: hasMore ? String(offset + limit) : null,
      });
    }

    // ── Embedded query → vector similarity ────────────────────────────
    let queryVector: number[];
    try {
      await embeddingService.initialize();
      queryVector = await embeddingService.generateEmbedding(q);
    } catch (e) {
      console.error("[searchArchiveDocsAI] embedder failed to load:", e);
      throw new AppError(
        "EMBEDDING_INIT_FAILED",
        503,
        "AI search is temporarily unavailable. Please try keyword search instead.",
      );
    }

    const candidates = await prisma.archiveDocument.findMany({
      where: whereScope,
      include: baseInclude,
    });

    // Lazy re-index: any candidate whose embedding is missing OR not the
    // expected 384 dims (legacy records had broken 1152-dim concat vectors)
    // gets regenerated from its title+type+abstract on the fly. After one
    // Deep Search, all candidates end up with correct composite vectors.
    const EXPECTED_DIM = 384;
    let reindexed = 0;
    for (const c of candidates) {
      const v = c.abstract?.embedding?.vector as number[] | undefined;
      const needsFix =
        !v || !Array.isArray(v) || v.length !== EXPECTED_DIM;
      if (!needsFix) continue;
      if (!c.abstract?.id) continue;

      const title = c.document?.title ?? c.abstract?.title ?? "";
      const typeLabel = archiveDocType[c.docType ?? 0] ?? "Other";
      const content = c.abstract?.content ?? "";
      const composite = [title, `[${typeLabel}]`, content]
        .filter(Boolean)
        .join("\n");
      if (!composite.trim()) continue;

      try {
        const fresh = await embeddingService.generateEmbedding(composite);
        await prisma.archiveEmbedding.upsert({
          where: { documentAbstractId: c.abstract.id },
          update: {
            vector: fresh,
            dimensions: fresh.length,
            model: "Xenova/all-MiniLM-L6-v2",
            updatedAt: new Date(),
          },
          create: {
            documentAbstractId: c.abstract.id,
            vector: fresh,
            dimensions: fresh.length,
            model: "Xenova/all-MiniLM-L6-v2",
          },
        });
        // mutate in-memory so this request uses the fresh vector
        if (c.abstract?.embedding) {
          (c.abstract.embedding as any).vector = fresh;
          (c.abstract.embedding as any).dimensions = fresh.length;
        } else if (c.abstract) {
          (c.abstract as any).embedding = { vector: fresh, dimensions: fresh.length };
        }
        reindexed += 1;
      } catch (e) {
        console.warn("[searchArchiveDocsAI] reindex failed for", c.id, e);
      }
    }

    const cosine = (a: number[], b: number[]) => {
      if (!a || !b || a.length === 0 || b.length === 0) return 0;
      const n = Math.min(a.length, b.length);
      let dot = 0, ma = 0, mb = 0;
      for (let i = 0; i < n; i++) {
        dot += a[i] * b[i];
        ma += a[i] * a[i];
        mb += b[i] * b[i];
      }
      const denom = Math.sqrt(ma) * Math.sqrt(mb);
      return denom ? dot / denom : 0;
    };

    let withEmbeddings = 0;
    const scored = candidates
      .map((c) => {
        const v = c.abstract?.embedding?.vector as number[] | undefined;
        if (v) withEmbeddings += 1;
        return { ...c, similarity: v ? cosine(queryVector, v) : 0 };
      })
      .filter((c) => c.similarity >= threshold)
      .sort((a, b) => b.similarity - a.similarity);

    const topScores = scored.slice(0, 5).map((s) => +s.similarity.toFixed(3));
    console.log(
      `[searchArchiveDocsAI] q="${q}" candidates=${candidates.length} ` +
      `withEmb=${withEmbeddings} reindexed=${reindexed} ` +
      `≥${threshold}=${scored.length} top=${JSON.stringify(topScores)}`,
    );

    // ── Fallback: if vector search finds nothing above threshold,
    // run a keyword search across title + abstract so the user always
    // gets *something* useful (paired with a `fallback: "keyword"` flag).
    if (scored.length === 0) {
      const fallback = await prisma.archiveDocument.findMany({
        where: {
          ...whereScope,
          OR: [
            { document: { title:   { contains: q, mode: "insensitive" } } },
            { abstract: { title:   { contains: q, mode: "insensitive" } } },
            { abstract: { content: { contains: q, mode: "insensitive" } } },
          ],
        },
        take: limit + 1,
        skip: offset,
        orderBy: { timestamp: "desc" },
        include: baseInclude,
      });
      const hasMore = fallback.length > limit;
      const list = fallback
        .slice(0, limit)
        .map((i) => ({ ...i, similarity: 0 }));
      return res.code(200).send({
        list,
        hasMore,
        nextOffset: hasMore ? offset + limit : null,
        lastCursor: hasMore ? String(offset + limit) : null,
        totalCandidates: candidates.length,
        totalMatches: list.length,
        withEmbeddings,
        threshold,
        fallback: "keyword",
        note: "No semantic matches above threshold; showing keyword matches instead.",
      });
    }

    const sliced = scored.slice(offset, offset + limit);
    const hasMore = scored.length > offset + limit;

    return res.code(200).send({
      list: sliced,
      hasMore,
      nextOffset: hasMore ? offset + limit : null,
      lastCursor: hasMore ? String(offset + limit) : null,
      totalCandidates: candidates.length,
      totalMatches: scored.length,
      withEmbeddings,
      threshold,
      topScores,
    });
  } catch (error) {
    if (error instanceof AppError) throw error;
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
    }
    console.error("[searchArchiveDocsAI] unexpected error:", error);
    throw error;
  }
};

/**
 * Plain-text (keyword) search across archived documents.
 *
 * Matches against BOTH the document title and the abstract content.
 * Scoped to the current room (preferred) or the line (fallback). Uses
 * cursor pagination on the single query — no more duplicated rows from
 * concatenating two queries.
 */
export const searchArchiveDocs = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const params = req.query as PagingProps & { query?: string };

  try {
    const cursor = params.lastCursor ? { id: params.lastCursor } : undefined;
    const limit = params.limit ? parseInt(params.limit, 10) : 20;
    const lineId = params.lineId as string | undefined;
    const roomId = params.id;
    const q = params.query?.trim();

    // Scope: room (preferred), else line, else everything visible
    const scope: any = { status: 1 };
    if (roomId) scope.receivingRoomId = roomId;
    else if (lineId) scope.lineId = lineId;

    // Keyword OR across title + abstract content (case-insensitive)
    let searchClause: any = {};
    if (q) {
      searchClause.OR = [
        { document: { title:    { contains: q, mode: "insensitive" } } },
        { abstract: { title:    { contains: q, mode: "insensitive" } } },
        { abstract: { content:  { contains: q, mode: "insensitive" } } },
      ];
    }

    const where = { ...scope, ...searchClause };

    const response = await prisma.archiveDocument.findMany({
      where,
      take: limit,
      skip: cursor ? 1 : 0,
      cursor,
      orderBy: { timestamp: "desc" },
      include: {
        document: { select: { id: true, title: true } },
        abstract: { select: { title: true, content: true } },
        receivingRoom: { select: { id: true, code: true, address: true } },
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
    if (!formData.title?.trim() || !formData.abstract?.trim()) {
      throw new ValidationError("Title and abstract are required.");
    }

    const fileType = getFileType({
      mimetype: file.mimetype,
      filename: file.filename,
      buffer: file.buffer,
    });

    const docTypeIndex = formData.docType ? parseInt(formData.docType, 10) : 0;
    const docTypeLabel = archiveDocType[docTypeIndex] ?? "Other";

    // ── Single composite embedding ────────────────────────────────────────
    // Concatenating multiple separate 384-dim vectors does NOT compose
    // semantically (cosine similarity would only compare each slice with
    // its own slice). Instead, build a single text that captures title +
    // type + abstract, then embed once. This keeps stored dim = 384 and
    // makes query-time similarity correct.
    const compositeText = [
      formData.title.trim(),
      `[${docTypeLabel}]`,
      formData.abstract.trim(),
    ].join("\n");
    const compositeVector = await embeddingService.generateEmbedding(
      compositeText,
    );

    // ── Parse optional preservation dates ────────────────────────────────
    const toDate = (v?: string) =>
      v && /^\d{4}-\d{2}-\d{2}/.test(v) ? new Date(v) : undefined;
    const retentionDate = toDate(formData.retentionDate);
    const safeDate = toDate(formData.safeDate);
    const wantsPreservation = !!(retentionDate || safeDate);

    const result = await prisma.$transaction(async (tx) => {
      // 1) Document + file blob — created in two steps so the binary write
      // doesn't have to fit inside Prisma's nested-create payload (large
      // bytea blobs in a single nested create were tripping the FK
      // constraint when the inner DecodedFile row landed before the parent
      // Document was visible to the connection).
      const doc = await tx.document.create({
        data: {
          docType: docTypeIndex,
          size: file.buffer.length,
          title: formData.title,
          lineId: formData.lineId,
          userId: formData.userId,
          receivingRoomId: formData.receivingRoomId,
        },
      });
      await tx.decodedFile.create({
        data: {
          documentId: doc.id,
          fileName: file.filename,
          fileDecoded: file.buffer,
          fileSize: file.buffer.length.toString(),
          fileType: fileType,
        },
      });

      // 2) Optional preservation record
      let preservationId: string | undefined;
      if (wantsPreservation) {
        const pres = await tx.archivePreservation.create({
          data: {
            type: 1,
            retentionDate,
            safeDate,
          },
        });
        preservationId = pres.id;
      }

      // 3) Archive + abstract + embedding
      const archive = await tx.archiveDocument.create({
        data: {
          docType: docTypeIndex,
          retentionDate,
          abstract: {
            create: {
              content: formData.abstract,
              title: formData.title,
              embedding: {
                create: {
                  vector: compositeVector,
                  model: "Xenova/all-MiniLM-L6-v2",
                  dimensions: compositeVector.length,
                },
              },
            },
          },
          receivingRoom: { connect: { id: formData.receivingRoomId } },
          document:      { connect: { id: doc.id } },
          line:          { connect: { id: formData.lineId } },
          ...(preservationId
            ? { preservation: { connect: { id: preservationId } } }
            : {}),
        },
      });

      // 4) Activity log
      await tx.documentActivityLogs.create({
        data: {
          userId: formData.userId,
          lineId: formData.lineId,
          title: `Archived — ${file.filename}`,
          desc: `Document "${formData.title}" archived. Abstract: ${formData.abstract.substring(0, 80)}${formData.abstract.length > 80 ? "…" : ""}`,
          action: 1,
          documentId: doc.id,
        },
      });

      return { archiveId: archive.id, documentId: doc.id };
    }, {
      // Large bytea writes can take far longer than Prisma's 5s default.
      maxWait: 60_000,   // wait up to 1m to acquire the tx
      timeout: 30 * 60_000, // tx may run up to 30m for huge files
    });

    return res.code(200).send({
      message: "OK",
      id: result.archiveId,
      documentId: result.documentId,
    });
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
  if (!params.id) throw new ValidationError("INVALID REQUIRED ID");

  try {
    const cursor = params.lastCursor ? { id: params.lastCursor } : undefined;
    const limit = params.limit ? parseInt(params.limit, 10) : 20;

    const where: any = {
      lineId: params.id,
    };
    if (params.query && params.query.trim()) {
      const q = params.query.trim();
      where.OR = [
        { address: { contains: q, mode: "insensitive" } },
        { code: { contains: q, mode: "insensitive" } },
      ];
    }

    const [list, total] = await Promise.all([
      prisma.receivingRoom.findMany({
        where,
        take: limit,
        skip: cursor ? 1 : 0,
        cursor,
        orderBy: { timestamp: "desc" },
        // Include a count of authorized users on each room so the
        // list can surface "N users" at a glance.
        include: {
          _count: {
            select: {
              authorizedUser: true,
            },
          },
        },
      }),
      prisma.receivingRoom.count({ where: { lineId: params.id } }),
    ]);

    const newLastCursorId = list.length ? list[list.length - 1].id : null;
    const hasMore = list.length === limit;

    return res
      .code(200)
      .send({ list, lastCursor: newLastCursorId, hasMore, total });
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
  if (!params.id) throw new ValidationError("INVALID REQUIRED ID");

  try {
    const response = await prisma.receivingRoom.findUnique({
      where: { id: params.id },
      include: {
        line: { select: { id: true, name: true } },
        authorizedUser: {
          select: {
            id: true,
            userId: true,
            type: true,
            user: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                username: true,
                email: true,
              },
            },
          },
        },
        _count: {
          select: {
            authorizedUser: true,
            targetRooms: true,
          },
        },
      },
    });

    if (!response) throw new NotFoundError("ROOM NOT FOUND");

    return res.code(200).send(response);
  } catch (error) {
    if (error instanceof NotFoundError) throw error;
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DB_CONNECTION", 500, "DB_FAILED");
    }
    throw error;
  }
};

/**
 * Soft-delete a receiving room (status: 0). Hard delete would cascade
 * across documents and authorizedUser rows; we'd lose the audit chain.
 */
export const removeRoom = async (req: FastifyRequest, res: FastifyReply) => {
  const params = req.query as { id: string; userId: string; lineId: string };

  if (!params.id || !params.lineId || !params.userId) {
    throw new ValidationError("INVALID REQUIRED ID");
  }

  try {
    const response = await prisma.$transaction(async (tx) => {
      const room = await tx.receivingRoom.findUnique({
        where: { id: params.id },
      });
      if (!room) throw new NotFoundError("ROOM NOT FOUND");
      if (room.status === 0) return true; // already removed

      await tx.receivingRoom.update({
        where: { id: room.id },
        data: { status: 0 },
      });

      await tx.humanResourcesLogs.create({
        data: {
          action: "DELETE",
          desc: `REMOVE RECEIVING ROOM: ${room.address ?? ""}-${room.code}`,
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

  if (!params.id) throw new ValidationError("INVALID REQUIRED ID");

  try {
    const response = await prisma.archiveDocument.findUnique({
      where: { id: params.id },
      include: {
        document: {
          select: {
            id: true,
            title: true,
            timestamp: true,
            size: true,
            docType: true,
            file: {
              select: {
                id: true,
                fileName: true,
                fileSize: true,
                fileType: true,
              },
            },
          },
        },
        abstract: {
          select: { id: true, title: true, content: true, timestamp: true },
        },
        preservation: {
          select: {
            id: true,
            type: true,
            retentionDate: true,
            safeDate: true,
            detentionDate: true,
            timestamp: true,
          },
        },
        line: {
          select: { id: true, name: true },
        },
        receivingRoom: {
          select: { id: true, code: true, address: true },
        },
      },
    });

    if (!response) throw new NotFoundError("ARCHIVE NOT FOUND");

    return res.code(200).send(response);
  } catch (error) {
    if (error instanceof ValidationError) throw error;
    if (error instanceof NotFoundError) throw error;
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DB_CONNECTION", 500, "DB_FAILED");
    }
    throw error;
  }
};

/**
 * Soft-remove an archived document.
 *
 * Flips `status` → 0 so the document disappears from active archive listings
 * while preserving the row, its abstract/embedding, and the original file
 * for audit/compliance. Logs the action to documentActivityLogs.
 */
export const removeArchive = async (req: FastifyRequest, res: FastifyReply) => {
  const params = req.query as {
    id?: string;
    userId?: string;
    lineId?: string;
  };

  if (!params.id || !params.userId || !params.lineId)
    throw new ValidationError("INVALID REQUIRED IDS");

  try {
    const result = await prisma.$transaction(async (tx) => {
      const existing = await tx.archiveDocument.findUnique({
        where: { id: params.id },
        select: {
          id: true,
          status: true,
          lineId: true,
          documentId: true,
          document: { select: { title: true } },
        },
      });

      if (!existing) throw new NotFoundError("ARCHIVE_NOT_FOUND");
      if (existing.status === 0)
        throw new ValidationError("Archive is already removed.");
      // Scope: ensure the user is removing within their line
      if (existing.lineId && existing.lineId !== params.lineId)
        throw new ValidationError(
          "You can only remove archives from your own line.",
        );

      // Soft delete
      const updated = await tx.archiveDocument.update({
        where: { id: params.id },
        data: { status: 0 },
      });

      // Audit log
      await tx.documentActivityLogs.create({
        data: {
          userId: params.userId!,
          lineId: params.lineId!,
          title: `Removed — ${existing.document?.title ?? "Untitled"}`,
          desc: `Archive ${params.id} marked as removed.`,
          action: 2,
          documentId: existing.documentId ?? undefined,
        },
      });

      return updated;
    });

    return res.code(200).send({ message: "OK", id: result.id });
  } catch (error) {
    console.error("Error in removeArchive:", error);
    if (error instanceof ValidationError) throw error;
    if (error instanceof NotFoundError) throw error;
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
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

/**
 * Generate an abstract from an uploaded file (PDF only — for now).
 * Runs entirely in-memory. Caps the file size at 10MB to avoid OOM and
 * limits the parsed text we feed the summarizer to ~3000 chars (the
 * model's effective input window).
 */
export const generateAbstract = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  if (!req.isMultipart()) {
    throw new ValidationError("Missing multipart payload");
  }

  // Abstract generation is memory-heavy (PDF parse + summarizer), so we
  // keep this cap lower than the archive upload limit. Big PDFs should
  // have the abstract typed in manually.
  const MAX_BYTES = 100 * 1024 * 1024; // 100MB

  try {
    let fileBuffer: Buffer | null = null;
    let filename = "";
    let mimetype = "";

    for await (const part of req.parts()) {
      if (part.type === "file") {
        fileBuffer = await part.toBuffer();
        filename = part.filename;
        mimetype = part.mimetype;
        break;
      }
    }

    if (!fileBuffer) {
      throw new ValidationError("No file uploaded");
    }
    if (fileBuffer.length > MAX_BYTES) {
      throw new ValidationError(
        `File too large for in-server abstract generation (max ${(MAX_BYTES / 1024 / 1024).toFixed(0)}MB).`,
      );
    }

    const isPdf =
      mimetype === "application/pdf" ||
      filename.toLowerCase().endsWith(".pdf");
    if (!isPdf) {
      throw new ValidationError(
        "Auto-abstract currently supports PDF files only. Type one in manually for other formats.",
      );
    }

    const abstract = await embeddingService.generateAbstractFromBuffer(
      fileBuffer,
    );

    return res.code(200).send({ abstract });
  } catch (error) {
    if (error instanceof ValidationError) throw error;
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DB_CONNECTION", 500, "DB_FAILED");
    }
    throw error;
  }
};
