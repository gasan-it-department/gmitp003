/**
 * A signature's image bytes.
 *
 * Takes the row rather than a key so it works for every shape the stamping
 * code selects, including the ones that fetch many signatures at once.
 */
import { readBlob } from "./blobStore";

export const signatureBytes = async (row: {
  storageKey?: string | null;
}): Promise<Buffer | null> => readBlob(row.storageKey ?? null);
