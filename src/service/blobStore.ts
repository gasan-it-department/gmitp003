/**
 * Object storage for the things that should never have been in Postgres.
 *
 * 91 of the database's 123 MB is file bytes in one column — three quarters
 * of the database is not data, it is attachments. Every page view pulls a
 * whole PDF out of Postgres into Node memory, which is why the API runs
 * with --max-old-space-size=4096 and why a single 77 MB document is one
 * request away from exhausting it.
 *
 * ── Why the S3 API, when we are not using Amazon ──────────────────────────
 * "S3" here is a PROTOCOL, not a vendor, the way SQL is a protocol and not
 * Oracle. Railway Bucket, Cloudflare R2, Backblaze, MinIO and DigitalOcean
 * Spaces all speak it, so one client talks to any of them and switching
 * providers is a change of four environment variables rather than a rewrite.
 * Nothing here involves an AWS account.
 *
 * ── Migrating without a cliff ─────────────────────────────────────────────
 * Rows keep their `Bytes` column until every file is confirmed readable from
 * the bucket. Reads prefer the bucket and fall back to the column, so the
 * system works at every point during the move: before the backfill, halfway
 * through it, and after. Nothing is deleted by this module — dropping the
 * columns is a separate, deliberate act once the bucket has been proven.
 */
import crypto from "crypto";

const ENDPOINT = process.env.BUCKET_ENDPOINT || "";
const ACCESS_KEY = process.env.BUCKET_ACCESS_KEY || "";
const SECRET_KEY = process.env.BUCKET_SECRET_KEY || "";
const BUCKET = process.env.BUCKET_NAME || "";
/**
 * Most S3-compatible providers that are not Amazon ignore the region but
 * require the client to send one. "auto" is what R2 documents; it is a
 * placeholder, not a location.
 */
const REGION = process.env.BUCKET_REGION || "auto";

/**
 * Path-style addressing (bucket in the URL path) rather than virtual-host
 * style (bucket as a subdomain). Amazon prefers the latter; nearly every
 * other implementation needs the former, and getting it wrong produces DNS
 * errors that look nothing like a configuration problem.
 */
const FORCE_PATH_STYLE = process.env.BUCKET_FORCE_PATH_STYLE !== "0";

export const blobStoreConfigured = (): boolean =>
  !!(ENDPOINT && ACCESS_KEY && SECRET_KEY && BUCKET);

let client: import("@aws-sdk/client-s3").S3Client | null = null;

const getClient = async () => {
  if (client) return client;
  const { S3Client } = await import("@aws-sdk/client-s3");
  client = new S3Client({
    region: REGION,
    endpoint: ENDPOINT,
    forcePathStyle: FORCE_PATH_STYLE,
    credentials: { accessKeyId: ACCESS_KEY, secretAccessKey: SECRET_KEY },
  });
  return client;
};

/**
 * Where an object lives.
 *
 * Keyed by what the row IS, not by a random id, so a bucket listing is
 * readable by a human six years from now when somebody is answering a
 * records request and has no database to join against.
 */
export const keyFor = (
  kind: "document" | "signature" | "profile" | "evidence" | "receive-page" | "stamp" | "chat",
  id: string,
  ext = "bin",
): string => `${kind}/${id}.${ext}`;

export const sha256 = (b: Buffer): string =>
  crypto.createHash("sha256").update(b).digest("hex");

export interface PutResult {
  key: string;
  bytes: number;
  sha256: string;
}

/** Store an object. Returns what is needed to find and verify it again. */
export const putBlob = async (
  key: string,
  body: Buffer,
  contentType = "application/octet-stream",
): Promise<PutResult> => {
  if (!blobStoreConfigured()) {
    throw new Error(
      "Object storage is not configured — set BUCKET_ENDPOINT, " +
        "BUCKET_ACCESS_KEY, BUCKET_SECRET_KEY and BUCKET_NAME.",
    );
  }
  const { PutObjectCommand } = await import("@aws-sdk/client-s3");
  const c = await getClient();
  const digest = sha256(body);
  await c.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: body,
      ContentType: contentType,
      /*
        The digest travels WITH the object. A bucket that has silently
        corrupted a file is indistinguishable from one that has not unless
        the expected hash is stored somewhere the file itself carries, and
        for municipal records "probably fine" is not an answer.
      */
      Metadata: { sha256: digest },
    }),
  );
  return { key, bytes: body.length, sha256: digest };
};

/** Fetch an object. Returns null when it is simply not there. */
export const getBlob = async (key: string): Promise<Buffer | null> => {
  if (!blobStoreConfigured()) return null;
  try {
    const { GetObjectCommand } = await import("@aws-sdk/client-s3");
    const c = await getClient();
    const res = await c.send(
      new GetObjectCommand({ Bucket: BUCKET, Key: key }),
    );
    const body = res.Body as unknown as AsyncIterable<Uint8Array>;
    const chunks: Buffer[] = [];
    for await (const chunk of body) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks);
  } catch (e) {
    const name = (e as { name?: string }).name;
    // Absent is a normal answer during a migration, not a failure.
    if (name === "NoSuchKey" || name === "NotFound") return null;
    throw e;
  }
};

/**
 * Read a blob that may live in either place.
 *
 * This is the whole migration strategy in one function: prefer the bucket,
 * fall back to the column. Before the backfill every read falls back; after
 * it every read hits the bucket; during it, both work. There is no moment
 * where the system is broken, and no deploy that has to be timed against a
 * data move.
 */
export const readBlob = async (
  key: string | null,
  fallback: Uint8Array | null | undefined,
): Promise<Buffer | null> => {
  if (key) {
    const fromBucket = await getBlob(key);
    if (fromBucket) return fromBucket;
  }
  return fallback ? Buffer.from(fallback) : null;
};

/** Remove an object. Used by the backfill's rollback, not by normal code. */
export const deleteBlob = async (key: string): Promise<void> => {
  if (!blobStoreConfigured()) return;
  const { DeleteObjectCommand } = await import("@aws-sdk/client-s3");
  const c = await getClient();
  await c.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
};

/** Does the bucket actually work? For /health/build and the backfill. */
export const blobStoreStatus = async (): Promise<{
  configured: boolean;
  reachable: boolean;
  bucket: string | null;
  endpoint: string | null;
  error?: string;
}> => {
  if (!blobStoreConfigured()) {
    return { configured: false, reachable: false, bucket: null, endpoint: null };
  }
  const probe = `__healthcheck__/probe.txt`;
  try {
    const stamp = Buffer.from(new Date().toISOString());
    await putBlob(probe, stamp, "text/plain");
    const back = await getBlob(probe);
    await deleteBlob(probe);
    return {
      configured: true,
      // A write that cannot be read back is worse than no bucket, so the
      // probe round-trips rather than just writing.
      reachable: !!back && back.equals(stamp),
      bucket: BUCKET,
      endpoint: ENDPOINT,
    };
  } catch (e) {
    return {
      configured: true,
      reachable: false,
      bucket: BUCKET,
      endpoint: ENDPOINT,
      error: e instanceof Error ? e.message : String(e),
    };
  }
};
