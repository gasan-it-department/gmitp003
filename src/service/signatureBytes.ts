/**
 * A signature's image bytes, from wherever they live.
 *
 * Unlike a document, a signature is a PNG of a hundred kilobytes or so, and
 * the column is still SELECTed alongside the key as the fallback rather than
 * fetched lazily on a miss. A second query per signature would cost more
 * than the bytes it saved moving — the lazy path in `documentBytes` exists
 * because a PDF can be 77 MB, not as a general rule.
 *
 * Takes the row rather than an id so it works for every one of the shapes
 * the stamping code selects, including the ones that fetch many at once.
 */
import { readBlob } from "./blobStore";

export const signatureBytes = async (row: {
  signature?: Uint8Array | null;
  storageKey?: string | null;
}): Promise<Buffer | null> => readBlob(row.storageKey ?? null, row.signature);
