/**
 * The bytes of a document's file, from wherever they actually live.
 *
 * One function so that every caller behaves the same way: the bucket once
 * the row has been migrated, the `fileDecoded` column until then, and the
 * column is never SELECTed unless it is genuinely needed. Spreading that
 * rule across the seven places that open a PDF is how one of them ends up
 * still pulling 77 MB through Postgres a year from now.
 */
import { prisma } from "../barrel/prisma";
import { readBlobLazy } from "./blobStore";

export const documentBytes = async (
  documentId: string,
  storageKey: string | null,
): Promise<Buffer | null> =>
  readBlobLazy(storageKey, async () => {
    const row = await prisma.decodedFile.findUnique({
      where: { documentId },
      select: { fileDecoded: true },
    });
    return row?.fileDecoded;
  });
