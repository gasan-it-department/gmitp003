/* Shared helpers for the end-to-end scripts.
 *
 * The bytes columns were dropped when blobs moved to object storage, so a
 * test can no longer create a signature or a document file by putting a
 * Buffer in the row — the bytes have to exist in the store, and the row
 * carries only a key. Six test files were still doing it the old way and
 * had been failing ever since.
 *
 * `putTestBlob` returns exactly the two columns a row needs, so the fix at
 * each call site is a spread in place of the old field:
 *
 *     signature: Buffer.from("x")        ->  ...(await putTestBlob(Buffer.from("x")))
 *
 * Set BLOB_LOCAL_DIR to run without a bucket; see src/service/blobStore.ts.
 */
import os from "os";
import path from "path";
import { putBlob, blobStoreConfigured } from "./src/service/blobStore";

/*
  Default the scratch directory so a test run needs no setup. An explicit
  BLOB_LOCAL_DIR still wins, and a configured bucket beats both.
*/
if (!process.env.BLOB_LOCAL_DIR) {
  process.env.BLOB_LOCAL_DIR = path.join(os.tmpdir(), "gmitp003-e2e-blobs");
}

let seq = 0;

/** Store bytes and return the columns that point at them. */
export const putTestBlob = async (
  bytes: Buffer,
  ext = "bin",
): Promise<{ storageKey: string; storageSha256: string }> => {
  if (!blobStoreConfigured()) {
    throw new Error(
      "No blob store for the test run. Set BLOB_LOCAL_DIR (or the BUCKET_* " +
        "variables) — the bytes columns no longer exist, so a row without a " +
        "storageKey points at nothing.",
    );
  }
  const key = `e2e/${process.pid}-${Date.now()}-${seq++}.${ext}`;
  const r = await putBlob(key, bytes, "application/octet-stream");
  return { storageKey: r.key, storageSha256: r.sha256 };
};

/**
 * Give every signatory in a queue a signature box.
 *
 * Dispatch refuses a slot with no box: that signatory would sign
 * successfully and produce nothing visible, so the rule is correct and
 * these fixtures simply predate it. Only slots WITHOUT a box get one, so
 * calling this twice is safe.
 */
export const giveBoxesTo = async (signatureQueueRoomId: string) => {
  const { prisma } = await import("./src/barrel/prisma");
  const slots = await prisma.signatoryArrangement.findMany({
    where: { signatureQueueRoomId },
    select: { id: true, sign: { select: { id: true }, take: 1 } },
  });
  for (const s of slots) {
    if (s.sign.length) continue;
    await prisma.signatureCoor.create({
      // Basis points, top-left origin — see the signature placement notes.
      data: {
        xAxis: 1000,
        yAxis: 8000,
        width: 2000,
        height: 600,
        signatoryArrangementId: s.id,
      },
    });
  }
};
