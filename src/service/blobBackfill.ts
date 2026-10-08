/**
 * Move file bytes out of Postgres and into the bucket.
 *
 * 91 of the database's 123 MB is file bytes in one column. This walks every
 * blob-bearing model, uploads what is still only in Postgres, and records
 * the key on the row. Reads already prefer the bucket and fall back to the
 * column, so running this does not require a deploy, a window, or anybody
 * watching.
 *
 * ── The rules it works by ─────────────────────────────────────────────────
 *
 * NOTHING IS DELETED. A row only gains a `storageKey`; its `Bytes` column
 * is left exactly as it was. Dropping those columns is a separate decision
 * for a later day, once the bucket has proven itself in use — and because
 * reads prefer the bucket, that day arrives with no behaviour left to
 * change.
 *
 * EVERY UPLOAD IS CONFIRMED BEFORE IT IS TRUSTED. The object is read back
 * and compared byte for byte against the source before the key is written.
 * A storageKey pointing at a corrupt object is worse than no key at all,
 * because reads would then prefer the corruption over the good copy still
 * sitting in the column.
 *
 * MEMORY STAYS FLAT. Ids are listed first and the bytes fetched one row at
 * a time. Selecting every document at once would pull all 91 MB into the
 * heap — on a container that is already sized for a single large PDF, that
 * is how a migration takes the API down with it.
 *
 * IT IS RE-RUNNABLE. Rows already migrated are skipped, so an interrupted
 * run is resumed by starting it again.
 */
import { prisma } from "../barrel/prisma";
import {
  BlobKind,
  blobStoreConfigured,
  blobStoreStatus,
  getBlob,
  keyFor,
  putBlob,
  sha256,
} from "./blobStore";

interface Target {
  /** Prisma model name; the client accessor is its camelCase. */
  model: string;
  /** The `Bytes` column holding the file. */
  column: string;
  kind: BlobKind;
  ext: string;
  /**
   * Key the object by this field instead of the row id.
   *
   * For rows that are upserted rather than created — an avatar keyed by
   * user, a stamp keyed by room — the live upload path keys the object the
   * same way. Matching it here means a re-upload overwrites the object the
   * backfill made, instead of leaving it behind as an orphan.
   */
  keyBy?: string;
}

export const TARGETS: Target[] = [
  { model: "DecodedFile", column: "fileDecoded", kind: "document", ext: "pdf" },
  { model: "Signature", column: "signature", kind: "signature", ext: "png" },
  {
    model: "UserProfilePicture",
    column: "bytes",
    kind: "profile",
    ext: "jpg",
    keyBy: "userId",
  },
  {
    model: "ComplaintEvidence",
    column: "data",
    kind: "evidence",
    ext: "bin",
  },
  { model: "ChatImage", column: "bytes", kind: "chat", ext: "img" },
  { model: "ChatFile", column: "bytes", kind: "chat", ext: "bin" },
  {
    model: "DocumentReceivePage",
    column: "bytes",
    kind: "receive-page",
    ext: "img",
  },
  {
    model: "ReceiveStamp",
    column: "image",
    kind: "stamp",
    ext: "png",
    keyBy: "roomId",
  },
];

const delegate = (model: string): any =>
  (prisma as unknown as Record<string, any>)[
    model[0].toLowerCase() + model.slice(1)
  ];

export interface ModelReport {
  model: string;
  pending: number;
  moved: number;
  failed: number;
  bytes: number;
  verifiedOk: number;
  verifiedBad: number;
  notes: string[];
}

export interface BackfillReport {
  objectStorage: Awaited<ReturnType<typeof blobStoreStatus>>;
  dryRun: boolean;
  models: ModelReport[];
  totals: { moved: number; failed: number; bytes: number };
}

/**
 * Check what has already been moved.
 *
 * A migration nobody verified is a migration nobody can trust. Each
 * migrated row's object is fetched and hashed against the digest recorded
 * at upload time.
 */
const verifyMigrated = async (
  t: Target,
  report: ModelReport,
  limit: number,
) => {
  const rows: Array<{ id: string; storageKey: string; storageSha256: string | null }> =
    await delegate(t.model).findMany({
      where: { storageKey: { not: null } },
      select: { id: true, storageKey: true, storageSha256: true },
      take: limit,
    });
  for (const r of rows) {
    try {
      const obj = await getBlob(r.storageKey);
      const ok = !!obj && (!r.storageSha256 || sha256(obj) === r.storageSha256);
      if (ok) report.verifiedOk++;
      else {
        report.verifiedBad++;
        report.notes.push(
          `MISMATCH ${r.id} -> ${r.storageKey} (${obj ? "digest differs" : "object missing"})`,
        );
      }
    } catch (e) {
      report.verifiedBad++;
      report.notes.push(
        `ERROR ${r.id} -> ${r.storageKey}: ${e instanceof Error ? e.message : e}`,
      );
    }
  }
};

export const runBlobBackfill = async (opts: {
  dryRun: boolean;
  /** Cap per model, so a first run can be tried small. */
  limit?: number;
  verifyLimit?: number;
  log?: (line: string) => void;
}): Promise<BackfillReport> => {
  const log = opts.log ?? (() => undefined);
  const limit = opts.limit ?? 10_000;
  const status = await blobStoreStatus();
  const report: BackfillReport = {
    objectStorage: status,
    dryRun: opts.dryRun,
    models: [],
    totals: { moved: 0, failed: 0, bytes: 0 },
  };
  if (!blobStoreConfigured() || !status.reachable) {
    log(
      "The bucket is not usable, so nothing was moved. Set BUCKET_ENDPOINT, " +
        "BUCKET_ACCESS_KEY, BUCKET_SECRET_KEY and BUCKET_NAME.",
    );
    return report;
  }

  for (const t of TARGETS) {
    const mr: ModelReport = {
      model: t.model,
      pending: 0,
      moved: 0,
      failed: 0,
      bytes: 0,
      verifiedOk: 0,
      verifiedBad: 0,
      notes: [],
    };
    report.models.push(mr);

    await verifyMigrated(t, mr, opts.verifyLimit ?? 2_000);

    /*
      Ids only. Selecting the bytes for every row at once is the one thing
      this script must never do.
    */
    const select: Record<string, boolean> = { id: true };
    if (t.keyBy) select[t.keyBy] = true;
    const ids: Array<Record<string, string | null>> = await delegate(
      t.model,
    ).findMany({
      where: { [t.column]: { not: null }, storageKey: null },
      select,
      take: limit,
    });
    mr.pending = ids.length;
    log(`${t.model}: ${ids.length} pending`);
    if (opts.dryRun || ids.length === 0) continue;

    for (const row of ids) {
      const id = row.id as string;
      try {
        const full = await delegate(t.model).findUnique({
          where: { id },
          select: { [t.column]: true },
        });
        const raw: Uint8Array | null = full?.[t.column] ?? null;
        if (!raw || raw.length === 0) continue;
        const bytes = Buffer.from(raw);

        // Key by the stable subject where the live write does the same.
        const keySubject = (t.keyBy && row[t.keyBy]) || id;
        const key = keyFor(t.kind, keySubject, t.ext);

        const put = await putBlob(key, bytes);
        const back = await getBlob(key);
        if (!back || !back.equals(bytes)) {
          mr.failed++;
          mr.notes.push(
            `FAIL ${id}: read-back ${back?.length ?? 0} of ${bytes.length} bytes`,
          );
          continue;
        }
        await delegate(t.model).update({
          where: { id },
          data: { storageKey: key, storageSha256: put.sha256 },
        });
        mr.moved++;
        mr.bytes += bytes.length;
        log(`  ok ${t.model} ${id} -> ${key} (${bytes.length} bytes)`);
      } catch (e) {
        mr.failed++;
        mr.notes.push(`FAIL ${id}: ${e instanceof Error ? e.message : e}`);
      }
    }
    report.totals.moved += mr.moved;
    report.totals.failed += mr.failed;
    report.totals.bytes += mr.bytes;
  }

  return report;
};
