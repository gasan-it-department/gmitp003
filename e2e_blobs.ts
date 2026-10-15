/* The blob layer, now that the Bytes columns are gone.
 *
 *   npx ts-node --transpile-only e2e_blobs.ts
 *
 * ── What changed, and why this test changed with it ──────────────────────
 *
 * This used to assert the opposite of what it asserts now, and that is the
 * point rather than a problem.
 *
 * While the bytes lived in both places, the contract was "prefer the
 * bucket, fall back to the column", and the valuable thing to prove was
 * that a system with NO bucket still worked exactly as before — uploads
 * succeeded, documents opened. That was true and it was tested.
 *
 * The columns have been dropped, so the bucket is the only copy. There is
 * nothing to fall back to, and an upload that cannot reach the bucket must
 * now FAIL rather than quietly succeed: a row that claims to have a file
 * and does not is worse than a refused upload, because nobody finds out
 * until somebody opens the document.
 *
 * So the thing worth proving is the new failure mode — that it fails, and
 * that it says why.
 */
import path from "path";
const entry = path.join(process.cwd(), "src", "index.ts");
require.cache[entry] = {
  id: entry,
  filename: entry,
  loaded: true,
  exports: {
    notificationSocket: { emitUserNotification: () => undefined },
  },
} as never;

import {
  blobStoreConfigured,
  keyFor,
  readBlob,
  sha256,
  storeBlob,
} from "./src/service/blobStore";

let pass = 0;
const fails: string[] = [];
const ok = (name: string, cond: boolean, detail = "") => {
  if (cond) {
    pass++;
    console.log(`  ok    ${name}`);
  } else {
    fails.push(name + (detail ? ` — ${detail}` : ""));
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
};

(async () => {
  console.log("\n── with no bucket configured ──");
  ok("bucket reports unconfigured", !blobStoreConfigured());

  const body = Buffer.from("a municipal document, pretend it is a PDF");

  // 1. An upload must now FAIL, loudly and legibly.
  let threw: Error | null = null;
  try {
    await storeBlob("document", body, "pdf", "application/pdf");
  } catch (e) {
    threw = e as Error;
  }
  ok("an upload with no bucket throws", threw !== null);
  ok(
    "and the message says what to set",
    !!threw && /BUCKET_ENDPOINT/.test(threw.message),
    threw?.message.slice(0, 120),
  );
  ok(
    "and says the column fallback is gone",
    !!threw && /no longer have a column/.test(threw.message),
    threw?.message.slice(0, 120),
  );

  // 2. Reads return null rather than throwing: a missing object is a 404,
  //    not a crash.
  ok("readBlob(null) is null", (await readBlob(null)) === null);
  ok(
    "readBlob of an unreachable key is null",
    (await readBlob("document/does-not-exist.pdf")) === null,
  );

  // 3. readBlob takes a key and nothing else — the fallback argument is
  //    gone, so no caller can still be passing a column.
  ok("readBlob takes exactly one argument", readBlob.length === 1);

  console.log("\n── key naming ──");
  ok(
    "keys are readable in a listing",
    keyFor("document", "abc", "pdf") === "document/abc.pdf",
  );
  ok(
    "profile keys name the user",
    keyFor("profile", "user-123", "jpg") === "profile/user-123.jpg",
  );
  ok("digest is stable", sha256(body) === sha256(Buffer.from(body.toString())));

  console.log("\n── the integrity checker ──");
  const { runBlobIntegrityCheck, TARGETS, blobStatus } = await import(
    "./src/service/blobIntegrity"
  );
  ok("every blob-bearing model is covered", TARGETS.length === 8);
  const models = TARGETS.map((t) => t.model);
  for (const m of [
    "DecodedFile",
    "Signature",
    "UserProfilePicture",
    "ComplaintEvidence",
    "ChatImage",
    "ChatFile",
    "DocumentReceivePage",
    "ReceiveStamp",
  ]) {
    ok(`${m} is checked`, models.includes(m));
  }

  // Counting must work with no bucket — it only reads the database, and a
  // health endpoint should not depend on object storage being up.
  const status = await blobStatus();
  ok(
    "row counts work without a bucket",
    typeof status.withKey === "number" &&
      Object.keys(status.byModel).length > 0,
    JSON.stringify(status.byModel).slice(0, 80),
  );

  const report = await runBlobIntegrityCheck({ countOnly: true });
  ok("a count-only check verifies nothing", report.totals.verifiedOk === 0);
  ok("and reports itself as not having checked", report.checked === false);

  console.log(
    `\n${pass} passed, ${fails.length} failed` +
      (fails.length ? `\n  ${fails.join("\n  ")}` : ""),
  );
  process.exit(fails.length ? 1 : 0);
})();
