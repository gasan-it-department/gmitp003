/* Move file bytes out of Postgres and into the bucket.
 *
 *   npx ts-node --transpile-only backfill_blobs.ts            # report only
 *   npx ts-node --transpile-only backfill_blobs.ts --run      # do it
 *   npx ts-node --transpile-only backfill_blobs.ts --verify   # re-check
 *
 * Deliberately conservative, because this moves municipal records:
 *
 *   - NOTHING is deleted. The Bytes column is left exactly as it was; the
 *     row only gains a storageKey. Dropping the columns is a later,
 *     separate decision made once the bucket has proven itself in use.
 *   - Every upload is read back and compared BYTE FOR BYTE before the row
 *     is marked as migrated. A storageKey that points at a corrupt object
 *     is worse than no storageKey, because reads would prefer it.
 *   - Re-runnable. Rows already migrated and verified are skipped, so an
 *     interrupted run is resumed by running it again.
 */
import path from "path";
const entry = path.join(process.cwd(), "src", "index.ts");
require.cache[entry] = {
  id: entry, filename: entry, loaded: true,
  exports: { notificationSocket: { emitUserNotification: () => undefined } },
} as never;

import { prisma } from "./src/barrel/prisma";
import {
  blobStoreConfigured,
  blobStoreStatus,
  getBlob,
  keyFor,
  putBlob,
  sha256,
} from "./src/service/blobStore";

const RUN = process.argv.includes("--run");
const VERIFY_ONLY = process.argv.includes("--verify");

type Kind = Parameters<typeof keyFor>[0];

interface Target {
  model: string;
  column: string;
  kind: Kind;
  ext: string;
  /** Rows with bytes still only in Postgres. */
  pending: () => Promise<Array<{ id: string; bytes: Buffer | null }>>;
  mark: (id: string, key: string, digest: string) => Promise<void>;
  migrated: () => Promise<Array<{ id: string; storageKey: string; storageSha256: string | null }>>;
}

const mb = (n: number) => `${(n / 1024 / 1024).toFixed(1)} MB`;

const targets: Target[] = [
  {
    model: "DecodedFile", column: "fileDecoded", kind: "document", ext: "pdf",
    pending: async () =>
      (await prisma.decodedFile.findMany({
        where: { fileDecoded: { not: null }, storageKey: null },
        select: { id: true, fileDecoded: true },
      })).map((r) => ({ id: r.id, bytes: r.fileDecoded ? Buffer.from(r.fileDecoded) : null })),
    mark: async (id, key, digest) => {
      await prisma.decodedFile.update({
        where: { id }, data: { storageKey: key, storageSha256: digest },
      });
    },
    migrated: async () =>
      prisma.decodedFile.findMany({
        where: { storageKey: { not: null } },
        select: { id: true, storageKey: true, storageSha256: true },
      }) as never,
  },
  {
    model: "Signature", column: "signature", kind: "signature", ext: "png",
    pending: async () =>
      (await prisma.signature.findMany({
        where: { signature: { not: null }, storageKey: null },
        select: { id: true, signature: true },
      })).map((r) => ({ id: r.id, bytes: r.signature ? Buffer.from(r.signature) : null })),
    mark: async (id, key, digest) => {
      await prisma.signature.update({
        where: { id }, data: { storageKey: key, storageSha256: digest },
      });
    },
    migrated: async () =>
      prisma.signature.findMany({
        where: { storageKey: { not: null } },
        select: { id: true, storageKey: true, storageSha256: true },
      }) as never,
  },
  {
    model: "UserProfilePicture", column: "bytes", kind: "profile", ext: "jpg",
    pending: async () =>
      (await prisma.userProfilePicture.findMany({
        where: { bytes: { not: null }, storageKey: null },
        select: { id: true, bytes: true },
      })).map((r) => ({ id: r.id, bytes: r.bytes ? Buffer.from(r.bytes) : null })),
    mark: async (id, key, digest) => {
      await prisma.userProfilePicture.update({
        where: { id }, data: { storageKey: key, storageSha256: digest },
      });
    },
    migrated: async () =>
      prisma.userProfilePicture.findMany({
        where: { storageKey: { not: null } },
        select: { id: true, storageKey: true, storageSha256: true },
      }) as never,
  },
];

(async () => {
  const status = await blobStoreStatus();
  console.log("\n── object storage ──");
  console.log("  configured :", status.configured);
  console.log("  reachable  :", status.reachable, status.error ? `(${status.error})` : "");
  console.log("  bucket     :", status.bucket ?? "—");
  if (!blobStoreConfigured() || !status.reachable) {
    console.log(
      "\nThe bucket is not usable yet, so nothing was moved. Set " +
        "BUCKET_ENDPOINT / BUCKET_ACCESS_KEY / BUCKET_SECRET_KEY / BUCKET_NAME.",
    );
    await prisma.$disconnect();
    process.exitCode = 1;
    return;
  }

  // ── Verify what has already been moved ─────────────────────────────
  console.log("\n── already migrated ──");
  let verifiedOk = 0, verifiedBad = 0;
  for (const t of targets) {
    const rows = await t.migrated();
    for (const r of rows) {
      const obj = await getBlob(r.storageKey);
      const ok = !!obj && (!r.storageSha256 || sha256(obj) === r.storageSha256);
      if (ok) verifiedOk++;
      else {
        verifiedBad++;
        console.log(`  MISMATCH  ${t.model} ${r.id} -> ${r.storageKey}`);
      }
    }
    if (rows.length) console.log(`  ${t.model}: ${rows.length} checked`);
  }
  console.log(`  verified ok: ${verifiedOk}   FAILED: ${verifiedBad}`);
  if (VERIFY_ONLY) {
    await prisma.$disconnect();
    process.exitCode = verifiedBad === 0 ? 0 : 1;
    return;
  }

  // ── Move what is left ──────────────────────────────────────────────
  console.log(`\n── to move ──${RUN ? "" : "   (dry run — pass --run to do it)"}`);
  let moved = 0, failed = 0, bytes = 0;
  for (const t of targets) {
    const rows = await t.pending();
    const size = rows.reduce((a, r) => a + (r.bytes?.length ?? 0), 0);
    if (!rows.length) { console.log(`  ${t.model}: nothing pending`); continue; }
    console.log(`  ${t.model}: ${rows.length} rows, ${mb(size)}`);
    if (!RUN) continue;

    for (const r of rows) {
      if (!r.bytes?.length) continue;
      const key = keyFor(t.kind, r.id, t.ext);
      try {
        const put = await putBlob(key, r.bytes);
        // Read it back before trusting it. An upload that reports success
        // and stores something else is exactly the failure this guards.
        const back = await getBlob(key);
        if (!back || !back.equals(r.bytes)) {
          failed++;
          console.log(`    FAIL  ${r.id} — read-back did not match (${back?.length ?? 0}/${r.bytes.length} bytes)`);
          continue;
        }
        await t.mark(r.id, key, put.sha256);
        moved++; bytes += r.bytes.length;
        console.log(`    ok    ${r.id} -> ${key} (${mb(r.bytes.length)})`);
      } catch (e) {
        failed++;
        console.log(`    FAIL  ${r.id} — ${e instanceof Error ? e.message : e}`);
      }
    }
  }

  if (RUN) {
    console.log(`\nmoved ${moved} objects (${mb(bytes)}), ${failed} failed`);
    console.log(
      "The Bytes columns are untouched. Reads prefer the bucket and fall " +
        "back to them, so nothing has to be done in a hurry.",
    );
  }
  await prisma.$disconnect();
  process.exitCode = failed === 0 ? 0 : 1;
})();
