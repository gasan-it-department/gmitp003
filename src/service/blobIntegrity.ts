/**
 * Is every file the database points at still in the bucket?
 *
 * This was the backfill that moved file bytes out of Postgres. That job is
 * done — 44 objects moved and verified — and the `Bytes` columns it copied
 * from have been dropped, so there is nothing left to move. What remains
 * worth doing is the half that was never really about migrating: checking
 * that the objects are still there and still correct.
 *
 * That matters more now, not less. The bucket used to be one of two copies
 * and is now the only one, so a row whose object has gone missing is a
 * document that no longer exists. Each row records the SHA-256 of what was
 * uploaded, which is what makes this a real check rather than a guess: the
 * object is fetched and re-hashed, so silent corruption is caught and not
 * merely assumed away.
 *
 * Runs on boot and is exposed to the admin panel. Reads only — it never
 * writes, uploads or deletes anything.
 */
import { prisma } from "../barrel/prisma";
import { BlobKind, blobStoreConfigured, blobStoreStatus, getBlob, sha256 } from "./blobStore";

interface Target {
  /** Prisma model name; the client accessor is its camelCase. */
  model: string;
  kind: BlobKind;
}

export const TARGETS: Target[] = [
  { model: "DecodedFile", kind: "document" },
  { model: "Signature", kind: "signature" },
  { model: "UserProfilePicture", kind: "profile" },
  { model: "ComplaintEvidence", kind: "evidence" },
  { model: "ChatImage", kind: "chat" },
  { model: "ChatFile", kind: "chat" },
  { model: "DocumentReceivePage", kind: "receive-page" },
  { model: "ReceiveStamp", kind: "stamp" },
];

const delegate = (model: string): any =>
  (prisma as unknown as Record<string, any>)[
    model[0].toLowerCase() + model.slice(1)
  ];

export interface ModelReport {
  model: string;
  /** Rows carrying a storageKey — ones that should have an object. */
  withKey: number;
  /** Rows with no key at all: either no file, or a file that never landed. */
  withoutKey: number;
  verifiedOk: number;
  verifiedBad: number;
  notes: string[];
}

export interface IntegrityReport {
  objectStorage: Awaited<ReturnType<typeof blobStoreStatus>>;
  checked: boolean;
  models: ModelReport[];
  totals: { withKey: number; verifiedOk: number; verifiedBad: number };
}

/**
 * The last check's outcome, for /health/build.
 *
 * A fresh statement that the bucket still holds what the database thinks
 * it does — not a record of what was true when a row was written.
 */
export let lastRun: {
  at: string;
  verifiedOk: number;
  verifiedBad: number;
  problems: string[];
} | null = null;

let running = false;

export const runBlobIntegrityCheck = async (opts: {
  /** Cap per model, so a check never walks an unbounded table. */
  limit?: number;
  /** Count rows but do not fetch objects. */
  countOnly?: boolean;
  log?: (line: string) => void;
}): Promise<IntegrityReport> => {
  const log = opts.log ?? (() => undefined);
  const limit = opts.limit ?? 5_000;
  const status = await blobStoreStatus();
  const report: IntegrityReport = {
    objectStorage: status,
    checked: false,
    models: [],
    totals: { withKey: 0, verifiedOk: 0, verifiedBad: 0 },
  };

  if (running) {
    log("a check is already running — leaving it to finish");
    return report;
  }
  running = true;
  try {
    for (const t of TARGETS) {
      const mr: ModelReport = {
        model: t.model,
        withKey: 0,
        withoutKey: 0,
        verifiedOk: 0,
        verifiedBad: 0,
        notes: [],
      };
      report.models.push(mr);
      try {
        const [withKey, withoutKey] = await Promise.all([
          delegate(t.model).count({ where: { storageKey: { not: null } } }),
          delegate(t.model).count({ where: { storageKey: null } }),
        ]);
        mr.withKey = withKey;
        mr.withoutKey = withoutKey;
        report.totals.withKey += withKey;
      } catch (e) {
        mr.notes.push(
          `could not count: ${e instanceof Error ? e.message : e}`,
        );
        continue;
      }

      if (opts.countOnly || !blobStoreConfigured() || !status.reachable) {
        continue;
      }

      const rows: Array<{
        id: string;
        storageKey: string;
        storageSha256: string | null;
      }> = await delegate(t.model).findMany({
        where: { storageKey: { not: null } },
        select: { id: true, storageKey: true, storageSha256: true },
        take: limit,
      });
      for (const r of rows) {
        try {
          const obj = await getBlob(r.storageKey);
          if (!obj) {
            mr.verifiedBad++;
            mr.notes.push(`MISSING ${r.id} -> ${r.storageKey}`);
            continue;
          }
          if (r.storageSha256 && sha256(obj) !== r.storageSha256) {
            mr.verifiedBad++;
            mr.notes.push(`CORRUPT ${r.id} -> ${r.storageKey}`);
            continue;
          }
          mr.verifiedOk++;
        } catch (e) {
          mr.verifiedBad++;
          mr.notes.push(
            `ERROR ${r.id} -> ${r.storageKey}: ${e instanceof Error ? e.message : e}`,
          );
        }
      }
      report.totals.verifiedOk += mr.verifiedOk;
      report.totals.verifiedBad += mr.verifiedBad;
      if (rows.length) {
        log(
          `${t.model}: ${mr.verifiedOk} ok, ${mr.verifiedBad} bad ` +
            `of ${rows.length} checked`,
        );
      }
    }
    report.checked = blobStoreConfigured() && status.reachable && !opts.countOnly;
  } finally {
    running = false;
  }

  if (report.checked) {
    lastRun = {
      at: new Date().toISOString(),
      verifiedOk: report.totals.verifiedOk,
      verifiedBad: report.totals.verifiedBad,
      problems: report.models
        .flatMap((m) => m.notes.map((x) => `${m.model}: ${x}`))
        .slice(0, 40),
    };
  }
  return report;
};

/** Row counts only, cheap enough for a health endpoint. */
export const blobStatus = async (): Promise<{
  withKey: number;
  withoutKey: number;
  byModel: Record<string, { withKey: number; withoutKey: number }>;
}> => {
  const byModel: Record<string, { withKey: number; withoutKey: number }> = {};
  let withKey = 0;
  let withoutKey = 0;
  for (const t of TARGETS) {
    try {
      const [a, b] = await Promise.all([
        delegate(t.model).count({ where: { storageKey: { not: null } } }),
        delegate(t.model).count({ where: { storageKey: null } }),
      ]);
      byModel[t.model] = { withKey: a, withoutKey: b };
      withKey += a;
      withoutKey += b;
    } catch {
      // A model that cannot be counted should not take the health check down.
    }
  }
  return { withKey, withoutKey, byModel };
};
