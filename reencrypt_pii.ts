/* Rewrite every legacy-encrypted field under PII_ENCRYPTION_KEY.
 *
 *   npx ts-node --transpile-only reencrypt_pii.ts            # dry run
 *   npx ts-node --transpile-only reencrypt_pii.ts --apply    # write
 *
 * Until this has run, personal data is still encrypted with JWT_SECRET and
 * rotating that secret would destroy it. The new code reads both schemes,
 * so the application works either way — this is what actually breaks the
 * coupling.
 *
 * ── The one rule ──────────────────────────────────────────────────────────
 *
 * Nothing is written until the NEW ciphertext has been decrypted again and
 * compared with the original plaintext. A re-encryption that silently
 * produced unreadable output would be indistinguishable from success until
 * somebody opened a record months later, and by then the legacy ciphertext
 * is gone.
 *
 * Fields are paired by name — `emailIv` protects `email` — which works for
 * 50 of the 54 columns. The other four do not follow the pattern and are
 * listed explicitly below, because guessing that `bdayIv` belongs to
 * `birthDate` is the kind of guess that corrupts birth dates. Any Iv column
 * that cannot be paired stops the run rather than being skipped: a column
 * quietly left behind keeps the whole database tied to JWT_SECRET.
 */
import fs from "fs";
import path from "path";

const entry = path.join(process.cwd(), "src", "index.ts");
require.cache[entry] = {
  id: entry, filename: entry, loaded: true,
  exports: { notificationSocket: { emitUserNotification: () => undefined } },
} as never;

import { prisma } from "./src/barrel/prisma";
import { EncryptionService, usingV2 } from "./src/service/encryption";

const APPLY = process.argv.includes("--apply");
const BATCH = 200;
/*
  --model=User restricts the run to one model. Worth having for the real
  thing: convert User, check the portal still shows names, then do the
  rest, rather than rewriting 450 values in one go and hoping.
*/
const ONLY = (process.argv.find((a) => a.startsWith("--model=")) || "")
  .split("=")[1];
/*
  --from-key=<64 hex> RE-KEYS: v2 values are read with that key and
  rewritten with the one in PII_ENCRYPTION_KEY. Needed because a key that
  cannot be rotated is the fault this whole change was meant to remove —
  without this, replacing a leaked PII_ENCRYPTION_KEY would destroy
  everything it protected.
*/
const FROM_KEY = (process.argv.find((a) => a.startsWith("--from-key=")) || "")
  .split("=")[1];

/** Iv columns whose base field is not simply the name without "Iv". */
const OVERRIDES: Record<string, string> = {
  "SubmittedApplication.bdayIv": "birthDate",
  "SubmittedApplication.firsntameIv": "firstname", // the Iv column is misspelled
};

/**
 * Columns called `..._Iv` that are not initialization vectors.
 *
 * `file_url` holds a plain Cloudinary URL and `file_url_Iv` holds that
 * asset's public id — "job_requirements_assets/ASH-COS_pxrtfs.docx". The
 * name is a leftover; neither column was ever encrypted. Listed here so
 * that a later reader does not "fix" the omission and feed a storage path
 * to a decipher.
 */
const NOT_ENCRYPTED = new Set([
  "ApplicationAttachedFile.file_url_Iv",
  "ApplicationProfilePic.file_url_Iv",
]);

interface Pair { model: string; field: string; ivField: string }

/** Read the pairs straight from the schema, so a new column cannot be missed. */
const readPairs = (): Pair[] => {
  const schema = fs.readFileSync(
    path.join(process.cwd(), "prisma", "schema.prisma"), "utf8",
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
      const base = OVERRIDES[key]
        ?? [f.replace(/_?Iv$/, ""), f.replace(/_?Iv$/, "").replace(/^./, (c) => c.toLowerCase())]
             .find((c) => names.has(c));
      if (base && names.has(base)) pairs.push({ model, field: base, ivField: f });
      else unmatched.push(key);
    }
  }
  if (unmatched.length) {
    throw new Error(
      `These Iv columns have no matching field, so their data would be ` +
      `left on the old key: ${unmatched.join(", ")}. Add them to OVERRIDES.`,
    );
  }
  return pairs;
};

const delegate = (model: string) =>
  (prisma as unknown as Record<string, {
    findMany: (a: unknown) => Promise<Record<string, unknown>[]>;
    update: (a: unknown) => Promise<unknown>;
  }>)[model[0].toLowerCase() + model.slice(1)];

(async () => {
  if (!usingV2()) {
    console.error(
      "PII_ENCRYPTION_KEY is not set (or is not 64 hex characters), so there\n" +
      "is nothing to re-encrypt TO. Generate one with:\n" +
      '  node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"\n' +
      "set it, restart the API, then run this again.",
    );
    process.exit(1);
  }
  if (!process.env.JWT_SECRET) {
    console.error("JWT_SECRET is not set — the legacy values cannot be read.");
    process.exit(1);
  }

  if (FROM_KEY !== undefined) {
    if (!/^[0-9a-fA-F]{64}$/.test(FROM_KEY)) {
      console.error("--from-key must be 64 hex characters (32 bytes).");
      process.exit(1);
    }
    if (FROM_KEY.toLowerCase() === (process.env.PII_ENCRYPTION_KEY || "").toLowerCase()) {
      console.error(
        "--from-key is the SAME as PII_ENCRYPTION_KEY — there is nothing to " +
        "re-key. Set PII_ENCRYPTION_KEY to the NEW key first.",
      );
      process.exit(1);
    }
    console.log(
      "RE-KEYING: v2 values will be read with --from-key and rewritten " +
      "with PII_ENCRYPTION_KEY.",
    );
    console.log("");
  }

  const pairs = readPairs();
  const byModel = new Map<string, Pair[]>();
  for (const p of pairs) {
    if (!byModel.has(p.model)) byModel.set(p.model, []);
    byModel.get(p.model)!.push(p);
  }

  console.log(
    `${pairs.length} encrypted columns across ${byModel.size} models` +
    `${APPLY ? "" : "   (DRY RUN — nothing will be written)"}\n`,
  );

  let totalLegacy = 0, totalRekeyed = 0, totalConverted = 0, totalFailed = 0;
  const failures: string[] = [];

  for (const [model, cols] of byModel) {
    if (ONLY && model.toLowerCase() !== ONLY.toLowerCase()) continue;
    const d = delegate(model);
    if (!d) { console.log(`  ${model}: no prisma delegate, skipped`); continue; }

    const select: Record<string, boolean> = { id: true };
    for (const c of cols) { select[c.field] = true; select[c.ivField] = true; }

    let cursor: string | undefined;
    let seen = 0, legacy = 0, rekeyed = 0, converted = 0, failed = 0;

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
          if (!value || !iv) continue;              // never encrypted

          const isLegacy = EncryptionService.isLegacy(value);
          if (!isLegacy && !FROM_KEY) continue;     // already v2, not re-keying

          try {
            let plain: string;
            if (isLegacy) {
              plain = await EncryptionService.decrypt(value, iv);
            } else {
              /*
                Try the CURRENT key first. A value already rewritten by an
                earlier (perhaps interrupted) run reads cleanly and is left
                alone, which makes this safe to re-run. GCM authenticates,
                so a wrong key throws rather than returning rubbish — that
                is what makes the distinction reliable.
              */
              try {
                await EncryptionService.decrypt(value, iv);
                continue; // already under the new key
              } catch {
                plain = await EncryptionService.decryptV2With(
                  value, iv, FROM_KEY as string,
                );
                rekeyed++;
              }
            }
            if (isLegacy) legacy++;
            const next = await EncryptionService.encrypt(plain);
            /*
              Prove the new ciphertext reads back as the same text BEFORE
              the old one is overwritten. This is the whole safety margin.
            */
            const check = await EncryptionService.decrypt(
              next.encryptedData, next.iv,
            );
            if (check !== plain) {
              throw new Error("re-encrypted value did not read back equal");
            }
            data[c.field] = next.encryptedData;
            data[c.ivField] = next.iv;
          } catch (e) {
            failed++;
            const why = e instanceof Error ? e.message : String(e);
            failures.push(`${model}.${c.field} id=${row.id}: ${why.slice(0, 110)}`);
          }
        }
        if (Object.keys(data).length) {
          if (APPLY) await d.update({ where: { id: row.id }, data });
          converted += Object.keys(data).length / 2;
        }
      }
      if (rows.length < BATCH) break;
    }

    totalLegacy += legacy; totalRekeyed += rekeyed;
    totalConverted += converted; totalFailed += failed;
    console.log(
      `  ${model.padEnd(26)} rows=${String(seen).padStart(5)}  ` +
      `legacy=${String(legacy).padStart(5)}  ` +
      (FROM_KEY ? `rekey=${String(rekeyed).padStart(5)}  ` : "") +
      `${APPLY ? "rewritten" : "would rewrite"}=${String(converted).padStart(5)}` +
      (failed ? `  FAILED=${failed}` : ""),
    );
  }

  console.log(
    `\n${totalLegacy} legacy values found, ` +
    `${totalConverted} ${APPLY ? "rewritten" : "would be rewritten"}, ` +
    `${totalFailed} failed.`,
  );
  if (failures.length) {
    console.log("\nFailures (first 20) — these were left untouched:");
    for (const f of failures.slice(0, 20)) console.log("  " + f);
    console.log(
      "\nA value that will not decrypt was most likely never encrypted, or\n" +
      "was written under a different JWT_SECRET. It is left exactly as it\n" +
      "was; nothing is destroyed by this script.",
    );
  }
  if (!APPLY && totalLegacy) {
    console.log("\nDry run. Re-run with --apply to write.");
  }
  /*
    Only say this when it is actually true. The claim is about the WHOLE
    database: a --model run has not looked at the other models, and a
    --from-key run was rotating the PII key, which says nothing at all
    about JWT_SECRET. Getting this wrong invites somebody to rotate
    JWT_SECRET while legacy values still depend on it, destroying them —
    the exact failure this script exists to prevent.
  */
  if (APPLY && !totalFailed && !totalLegacy && !ONLY && !FROM_KEY) {
    console.log(
      "\nNo legacy values remain anywhere — JWT_SECRET can now be rotated.",
    );
  } else if (APPLY && !totalFailed && ONLY) {
    console.log(
      `\nOnly --model=${ONLY} was processed. Run without --model before ` +
        "drawing any conclusion about JWT_SECRET.",
    );
  } else if (APPLY && !totalFailed && FROM_KEY) {
    console.log(
      "\nRe-keyed to the new PII_ENCRYPTION_KEY. That says nothing about " +
        "JWT_SECRET — run without --from-key to check for legacy values.",
    );
  }

  await prisma.$disconnect();
  process.exit(totalFailed ? 1 : 0);
})();
