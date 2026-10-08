/* Does the bucket migration behave when there is NO bucket?
 *
 * That is the question worth testing here, and it is not a contrived one.
 * It is the state of every developer machine, and it is the state Railway
 * falls into the moment the bucket is unreachable. If the answer is ever
 * "uploads fail" or "documents 404", the migration has made the system
 * fragile in exchange for disk space.
 *
 *   npx ts-node --transpile-only e2e_blobs.ts
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
  readBlobLazy,
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

  // 1. An upload must still succeed, handing the bytes back for the column.
  const stored = await storeBlob("document", body, "pdf", "application/pdf");
  ok("storeBlob returns no key", stored.storageKey === null);
  ok(
    "storeBlob hands the bytes back for the column",
    !!stored.column && stored.column.equals(body),
  );
  ok("storeBlob still mints an id", typeof stored.id === "string" && stored.id.length > 10);

  // 2. An explicit id is honoured, so upsert-keyed rows stay stable.
  const keyed = await storeBlob("profile", body, "jpg", "image/jpeg", "user-123");
  ok("explicit id is used", keyed.id === "user-123");

  // 3. Uint8Array input (what pdf-lib hands back) is accepted.
  const fromU8 = await storeBlob("document", new Uint8Array(body), "pdf");
  ok(
    "Uint8Array input round-trips",
    !!fromU8.column && fromU8.column.equals(body),
  );

  // 4. Reads fall back to the column.
  const read = await readBlob(null, body);
  ok("readBlob(null, column) returns the column", !!read && read.equals(body));

  // 5. A row that HAS a key but no reachable bucket must still read, from
  //    the column. This is the bucket-outage case, and the one that would
  //    otherwise hand somebody a 404 on a document that exists.
  const withKey = await readBlob("document/does-not-exist.pdf", body);
  ok(
    "a key with no bucket falls back to the column",
    !!withKey && withKey.equals(body),
  );

  // 6. The lazy read only touches the column when it has to, and still
  //    returns the right bytes when it does.
  let columnReads = 0;
  const lazy = await readBlobLazy(null, async () => {
    columnReads++;
    return body;
  });
  ok("lazy read returns the column bytes", !!lazy && lazy.equals(body));
  ok("lazy read consulted the column once", columnReads === 1);

  // 7. Nothing to read anywhere is null, not a throw.
  const empty = await readBlob(null, null);
  ok("no bytes anywhere reads as null", empty === null);

  console.log("\n── key naming ──");
  ok(
    "keys are readable in a listing",
    keyFor("document", "abc", "pdf") === "document/abc.pdf",
  );
  ok(
    "profile keys name the user",
    keyFor("profile", "user-123", "jpg") === "profile/user-123.jpg",
  );
  ok(
    "digest is stable",
    sha256(body) === sha256(Buffer.from(body.toString())),
  );

  console.log("\n── the backfill refuses to run without a bucket ──");
  const { runBlobBackfill, TARGETS } = await import(
    "./src/service/blobBackfill"
  );
  const report = await runBlobBackfill({ dryRun: true });
  ok("backfill moved nothing", report.totals.moved === 0);
  ok("backfill reports the bucket unusable", !report.objectStorage.reachable);
  ok("every blob model is covered", TARGETS.length === 8);
  const kinds = new Set(TARGETS.map((t) => t.kind));
  ok("each model has a distinct enough key space", kinds.size >= 6);
  // The two upsert-keyed models must key by their stable subject, or a
  // re-upload would orphan the object the backfill created.
  const byModel = Object.fromEntries(TARGETS.map((t) => [t.model, t]));
  ok(
    "avatars key by user",
    byModel["UserProfilePicture"].keyBy === "userId",
  );
  ok("stamps key by room", byModel["ReceiveStamp"].keyBy === "roomId");

  console.log(
    `\n${pass} passed, ${fails.length} failed` +
      (fails.length ? `\n  ${fails.join("\n  ")}` : ""),
  );
  process.exit(fails.length ? 1 : 0);
})();
