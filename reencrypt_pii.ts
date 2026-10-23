/* Rewrite every legacy-encrypted field under PII_ENCRYPTION_KEY.
 *
 *   node dist/reencrypt_pii.js                      # dry run
 *   node dist/reencrypt_pii.js --apply              # write
 *   node dist/reencrypt_pii.js --model=User         # one model
 *   node dist/reencrypt_pii.js --from-key=<64 hex>  # re-key v2 values
 *
 * Until this has run, personal data is still encrypted with JWT_SECRET and
 * rotating that secret would destroy it. The new code reads both schemes,
 * so the application works either way — this is what breaks the coupling.
 *
 * The work itself lives in src/service/reencryptPii.ts so the SERVER can
 * run it too, triggered by PII_BACKFILL. That exists because the
 * alternative was exposing the production database to the public internet
 * so this command could be run against it from a laptop.
 *
 * Nothing is written until the NEW ciphertext has been decrypted again and
 * compared with the original plaintext.
 */
import path from "path";

const entry = path.join(process.cwd(), "src", "index.ts");
require.cache[entry] = {
  id: entry,
  filename: entry,
  loaded: true,
  exports: { notificationSocket: { emitUserNotification: () => undefined } },
} as never;

import { prisma } from "./src/barrel/prisma";
import { runReencryption } from "./src/service/reencryptPii";

const arg = (name: string) =>
  (process.argv.find((a) => a.startsWith(`--${name}=`)) || "").split("=")[1];

const APPLY = process.argv.includes("--apply");
const ONLY = arg("model");
const FROM_KEY = arg("from-key");

(async () => {
  const result = await runReencryption({
    apply: APPLY,
    fromKey: FROM_KEY,
    onlyModel: ONLY,
    log: (line) => console.log(line),
  });

  if (result.error) {
    console.error(`\n${result.error}`);
    if (/PII_ENCRYPTION_KEY is not set/.test(result.error)) {
      console.error(
        'Generate one with:\n  node -e "console.log(require(\'crypto\')' +
          ".randomBytes(32).toString('hex'))\"",
      );
    }
    await prisma.$disconnect();
    process.exit(1);
  }

  console.log(
    `\n${result.columns} encrypted columns` +
      `${APPLY ? "" : "   (DRY RUN — nothing was written)"}`,
  );
  const t = result.totals;
  console.log(
    `${t.legacy} legacy value(s)` +
      (FROM_KEY ? `, ${t.rekeyed} to re-key` : "") +
      `, ${t.converted} ${APPLY ? "rewritten" : "would be rewritten"}, ` +
      `${t.failed} failed.`,
  );

  if (result.failures.length) {
    console.log("\nFailures (first 20) — these were left untouched:");
    for (const f of result.failures.slice(0, 20)) console.log("  " + f);
    console.log(
      "\nA value that will not decrypt was most likely never encrypted, or\n" +
        "was written under a different JWT_SECRET. It is left exactly as it\n" +
        "was; nothing is destroyed by this script.",
    );
  }

  if (!APPLY && t.legacy + t.rekeyed > 0) {
    console.log("\nDry run. Re-run with --apply to write.");
  }
  if (result.jwtSecretNowRotatable) {
    console.log(
      "\nNo legacy values remain anywhere — JWT_SECRET can now be rotated.",
    );
  } else if (APPLY && !t.failed && ONLY) {
    console.log(
      `\nOnly --model=${ONLY} was processed. Run without --model before ` +
        "drawing any conclusion about JWT_SECRET.",
    );
  } else if (APPLY && !t.failed && FROM_KEY) {
    console.log(
      "\nRe-keyed to the new PII_ENCRYPTION_KEY. That says nothing about " +
        "JWT_SECRET — run without --from-key to check for legacy values.",
    );
  }

  await prisma.$disconnect();
  process.exit(t.failed ? 1 : 0);
})();
