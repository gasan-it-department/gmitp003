/**
 * The bytes of a document's file.
 *
 * Kept as its own function even though it is now a one-liner: every place
 * that opens a PDF goes through here, so if documents ever move again
 * there is one thing to change rather than seven.
 *
 * It used to prefer the bucket and fall back to the `fileDecoded` column.
 * That column was dropped once every object had been verified in the
 * bucket, so there is nothing left to fall back to.
 */
import { readBlob } from "./blobStore";

export const documentBytes = async (
  _documentId: string,
  storageKey: string | null,
): Promise<Buffer | null> => readBlob(storageKey);
