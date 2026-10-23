/**
 * Re-encrypting personal data, as something the SERVER can run.
 *
 * The same work the reencrypt_pii.ts command does, moved behind a function
 * so it can also be triggered from inside the container. That matters
 * because the alternative was exposing the production database to the
 * public internet so somebody could run a script against it from a
 * laptop, which is a poor trade for a one-off migration — the API already
 * holds the database connection and the key, so the work belongs here.
 *
 * Triggered by PII_BACKFILL=dry or PII_BACKFILL=apply, read once at boot.
 * The result is published on /health/build, because a migration whose
 * outcome you cannot see is one you have to take on trust.
 */
import fs from "fs";
import path from "path";
import { prisma } from "../barrel/prisma";
import { EncryptionService, usingV2 } from "./encryption";

/** Iv columns whose base field is not simply the name without "Iv". */
const OVERRIDES: Record<string, string> = {
  "SubmittedApplication.bdayIv": "birthDate",
  "SubmittedApplication.firsntameIv": "firstname", // the Iv column is misspelled
};

/**
 * Columns called `..._Iv` that are not initialization vectors.
 *
 * `file_url` holds a plain Cloudinary URL and `file_url_Iv` holds that
 * asset's public id. The name is a leftover; neither was ever encrypted.
 * Listed so nobody later "fixes" the omission by feeding a storage path
 * to a decipher.
 */
const NOT_ENCRYPTED = new Set([
  "ApplicationAttachedFile.file_url_Iv",
  "ApplicationProfilePic.file_url_Iv",
]);

export interface Pair {
  model: string;
  field: string;
  ivField: string;
}

export interface ReencryptResult {
  ranAt: string;
  apply: boolean;
  rekeying: boolean;
  onlyModel: string | null;
  columns: number;
  models: Array<{
    model: string;
    rows: number;
    legacy: number;
    rekey: number;
    converted: number;
    failed: number;
  }>;
  totals: { legacy: number; rekeyed: number; converted: number; failed: number };
  /** Model.field plus the reason, never a value. */
  failures: string[];
  /** True only after a FULL unfiltered pass found nothing left. */
  jwtSecretNowRotatable: boolean;
  error?: string;
}

/** Read the pairs from the schema, so a new column cannot be missed. */
export const readPairs = (schemaPath?: string): Pair[] => {
  const schema = fs.readFileSync(
    schemaPath ?? path.join(process.cwd(), "prisma", "schema.prisma"),
    "utf8",
  );
  const pairs: Pair[] = [];
  const unmatched: string[] = [];
  const modelRe = /^model (\w+) \{([\s\S]*?)^\}/gm;
  let m: RegExpExecArray | null;
  while ((m = modelRe.exec(schema))) {
    const model = m[1];
    const fields = [...m[2].matchAll(/^\s+(\w+)\s+(\w+)(\??)/gm)].map((f) => f[1]);
    const names = new Set(fields);
    for (const f of fields) {
      if (!/_?Iv$/.test(f)) continue;
      const key = `${model}.${f}`;
      if (NOT_ENCRYPTED.has(key)) continue;
      const base =
        OVERRIDES[key] ??
        [
          f.replace(/_?Iv$/, ""),
          f.replace(/_?Iv$/, "").replace(/^./, (c) => c.toLowerCase()),
        ].find((c) => names.has(c));
      if (base && names.has(base)) pairs.push({ model, field: base, ivField: f });
      else unmatched.push(key);
    }
  }
  if (unmatched.length) {
    throw new Error(
      `These Iv columns have no matching field, so their data would be left ` +
        `on the old key: ${unmatched.join(", ")}. Add them to OVERRIDES.`,
    );
  }
  return pairs;
};

const delegate = (model: string) =>
  (
    prisma as unknown as Record<
      string,
      {
        findMany: (a: unknown) => Promise<Record<string, unknown>[]>;
        update: (a: unknown) => Promise<unknown>;
      }
    >
  )[model[0].toLowerCase() + model.slice(1)];

export const runReencryption = async (opts: {
  apply: boolean;
  fromKey?: string;
  onlyModel?: string;
  batch?: number;
  log?: (line: string) => void;
}): Promise<ReencryptResult> => {
  const log = opts.log ?? (() => undefined);
  const BATCH = opts.batch ?? 200;
  const FROM_KEY = opts.fromKey;
  const ONLY = opts.onlyModel;

  const result: ReencryptResult = {
    ranAt: new Date().toISOString(),
    apply: opts.apply,
    rekeying: !!FROM_KEY,
    onlyModel: ONLY ?? null,
    columns: 0,
    models: [],
    totals: { legacy: 0, rekeyed: 0, converted: 0, failed: 0 },
    failures: [],
    jwtSecretNowRotatable: false,
  };

  if (!usingV2()) {
    result.error =
      "PII_ENCRYPTION_KEY is not set (or is not 64 hex characters), so " +
      "there is nothing to re-encrypt to.";
    return result;
  }
  if (!process.env.JWT_SECRET) {
    result.error = "JWT_SECRET is not set — legacy values cannot be read.";
    return result;
  }
  if (FROM_KEY) {
    if (!/^[0-9a-fA-F]{64}$/.test(FROM_KEY)) {
      result.error = "fromKey must be 64 hex characters (32 bytes).";
      return result;
    }
    if (
      FROM_KEY.toLowerCase() ===
      (process.env.PII_ENCRYPTION_KEY || "").trim().toLowerCase()
    ) {
      result.error =
        "fromKey is the SAME as PII_ENCRYPTION_KEY — nothing to re-key.";
      return result;
    }
  }

  const pairs = readPairs();
  result.columns = pairs.length;
  const byModel = new Map<string, Pair[]>();
  for (const p of pairs) {
    if (!byModel.has(p.model)) byModel.set(p.model, []);
    byModel.get(p.model)!.push(p);
  }

  for (const [model, cols] of byModel) {
    if (ONLY && model.toLowerCase() !== ONLY.toLowerCase()) continue;
    const d = delegate(model);
    if (!d) {
      log(`  ${model}: no prisma delegate, skipped`);
      continue;
    }

    const select: Record<string, boolean> = { id: true };
    for (const c of cols) {
      select[c.field] = true;
      select[c.ivField] = true;
    }

    let cursor: string | undefined;
    let seen = 0,
      legacy = 0,
      rekeyed = 0,
      converted = 0,
      failed = 0;

    for (;;) {
      const rows = await d.findMany({
        take: BATCH,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
        orderBy: { id: "asc" },
        select,
      });
      if (!rows.length) break;
      seen += rows.length;
      cursor = rows[rows.length - 1].id as string;

      for (const row of rows) {
        const data: Record<string, string> = {};
        for (const c of cols) {
          const value = row[c.field] as string | null;
          const iv = row[c.ivField] as string | null;
          if (!value || !iv) continue;

          const isLegacy = EncryptionService.isLegacy(value);
          if (!isLegacy && !FROM_KEY) continue;

          try {
            let plain: string;
            if (isLegacy) {
              plain = await EncryptionService.decrypt(value, iv);
              legacy++;
            } else {
              /*
                Try the CURRENT key first: a value already rewritten by an
                earlier (perhaps interrupted) run reads cleanly and is left
                alone, which is what makes this safe to re-run. GCM
                authenticates, so a wrong key throws rather than returning
                rubbish.
              */
              try {
                await EncryptionService.decrypt(value, iv);
                continue;
              } catch {
                plain = await EncryptionService.decryptV2With(
                  value,
                  iv,
                  FROM_KEY as string,
                );
                rekeyed++;
              }
            }
            const next = await EncryptionService.encrypt(plain);
            /*
              Prove the new ciphertext reads back as the same text BEFORE
              the old one is overwritten. This is the whole safety margin.
            */
            const check = await EncryptionService.decrypt(
              next.encryptedData,
              next.iv,
            );
            if (check !== plain) {
              throw new Error("re-encrypted value did not read back equal");
            }
            data[c.field] = next.encryptedData;
            data[c.ivField] = next.iv;
          } catch (e) {
            failed++;
            const why = e instanceof Error ? e.message : String(e);
            result.failures.push(
              `${model}.${c.field} id=${String(row.id).slice(0, 8)}: ` +
                why.slice(0, 110),
            );
          }
        }
        if (Object.keys(data).length) {
          if (opts.apply) await d.update({ where: { id: row.id }, data });
          converted += Object.keys(data).length / 2;
        }
      }
      if (rows.length < BATCH) break;
    }

    result.models.push({ model, rows: seen, legacy, rekey: rekeyed, converted, failed });
    result.totals.legacy += legacy;
    result.totals.rekeyed += rekeyed;
    result.totals.converted += converted;
    result.totals.failed += failed;
    log(
      `  ${model.padEnd(26)} rows=${String(seen).padStart(5)}  ` +
        `legacy=${String(legacy).padStart(5)}  ` +
        (FROM_KEY ? `rekey=${String(rekeyed).padStart(5)}  ` : "") +
        `${opts.apply ? "rewritten" : "would rewrite"}=${String(converted).padStart(5)}` +
        (failed ? `  FAILED=${failed}` : ""),
    );
  }

  /*
    Claimed only when it is actually true: a --model run has not looked at
    the other models, and a re-key run says nothing about JWT_SECRET.
    Getting this wrong invites rotating JWT_SECRET while legacy values
    still depend on it, destroying them.
  */
  /*
    A DRY run that finds nothing is the proof, which is why `apply` is not
    required here. Requiring it made the flag unreachable: an apply run
    counts the legacy values it has just converted, so `legacy` is never
    zero on the pass that does the work, and a dry run was disqualified
    for not writing. The question being answered is "does anything still
    depend on JWT_SECRET", and a full unfiltered scan reporting zero
    answers it whether or not it was willing to write.
  */
  result.jwtSecretNowRotatable =
    !result.totals.failed && !result.totals.legacy && !ONLY && !FROM_KEY;

  return result;
};

/* ── the boot hook ──────────────────────────────────────────────────── */

let lastRun: ReencryptResult | null = null;
/** What /health/build reports about the migration. */
export const lastReencryption = () => lastRun;

/**
 * Run once at boot when PII_BACKFILL is set, so the migration can be
 * driven by a variable rather than by opening the database to the world.
 *
 * "dry" reports what it would do and writes nothing. "apply" writes.
 * Safe to leave set: once there is nothing on the old key the run is a
 * no-op, but it should be removed afterwards all the same.
 */
export const maybeRunReencryptionAtBoot = async () => {
  const mode = (process.env.PII_BACKFILL || "").trim().toLowerCase();
  if (mode !== "dry" && mode !== "apply") return;

  const fromKey = (process.env.PII_BACKFILL_FROM_KEY || "").trim() || undefined;
  console.log(
    `[pii] PII_BACKFILL=${mode}${fromKey ? " with a from-key" : ""} — running.`,
  );
  try {
    lastRun = await runReencryption({
      apply: mode === "apply",
      fromKey,
      onlyModel: (process.env.PII_BACKFILL_MODEL || "").trim() || undefined,
      log: (l) => console.log(l),
    });
    const t = lastRun.totals;
    console.log(
      `[pii] ${mode}: legacy=${t.legacy} rekeyed=${t.rekeyed} ` +
        `converted=${t.converted} failed=${t.failed}` +
        (lastRun.error ? ` ERROR: ${lastRun.error}` : ""),
    );
    if (lastRun.jwtSecretNowRotatable) {
      console.log("[pii] nothing left on the old key — JWT_SECRET can be rotated.");
    }
  } catch (e) {
    lastRun = {
      ranAt: new Date().toISOString(),
      apply: mode === "apply",
      rekeying: !!fromKey,
      onlyModel: null,
      columns: 0,
      models: [],
      totals: { legacy: 0, rekeyed: 0, converted: 0, failed: 0 },
      failures: [],
      jwtSecretNowRotatable: false,
      error: e instanceof Error ? e.message : String(e),
    };
    console.error("[pii] backfill failed:", lastRun.error);
  }
};
