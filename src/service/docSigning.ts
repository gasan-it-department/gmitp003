import {
  createCipheriv,
  createDecipheriv,
  createHash,
  generateKeyPairSync,
  randomBytes,
  scryptSync,
  sign as edSign,
  verify as edVerify,
  createPrivateKey,
  createPublicKey,
} from "crypto";
import { prisma } from "../barrel/prisma";

/**
 * Cryptographic signing for the Document module.
 *
 * Ed25519 throughout: small keys, small signatures, no parameter choices to
 * get wrong, and native in Node with no dependency.
 *
 * Private keys are wrapped with AES-256-GCM using a RANDOM per-key salt and
 * iv, and the auth tag is verified on unwrap. This deliberately does not reuse
 * the app's older `EncryptionService`, which is aes-192-cbc with the literal
 * string "salt" as its salt — unauthenticated (so ciphertext is malleable) and
 * static-salted (so identical plaintexts wrap identically). Acceptable for the
 * PII it already guards; not acceptable for the keys that make a document
 * legally checkable.
 */

const WRAP_SECRET =
  process.env.DOC_SIGNING_SECRET ?? process.env.ENCRYPTION_KEY ?? "";

if (!WRAP_SECRET) {
  console.warn(
    "[docSigning] Neither DOC_SIGNING_SECRET nor ENCRYPTION_KEY is set. " +
      "Document sealing is DISABLED — documents will still sign and download, " +
      "they just won't be verifiable. Set one and redeploy to enable it.",
  );
}

/**
 * Refuses to touch key material without a real secret.
 *
 * Wrapping with an empty string would "work" and silently produce keys that
 * are not protected at all — and worse, setting a proper secret later would
 * leave every one of them permanently un-unwrappable, breaking signing for
 * anyone who had already signed once.
 *
 * Every caller of this sits behind a try/catch that degrades to "unsealed", so
 * throwing here costs a verification guarantee, never a user's signature.
 */
const requireSecret = () => {
  if (!WRAP_SECRET) {
    throw new Error(
      "Document signing is not configured: set DOC_SIGNING_SECRET (or " +
        "ENCRYPTION_KEY) in the environment.",
    );
  }
};

/**
 * True when sealing is usable. Lets callers skip the work quietly instead of
 * throwing and logging on every single download.
 */
export const signingConfigured = () => !!WRAP_SECRET;

/**
 * Which secret a key was wrapped with. Recorded so that if DOC_SIGNING_SECRET
 * is introduced later, existing keys are identifiable rather than mysterious.
 */
export const wrapSource = (): string =>
  process.env.DOC_SIGNING_SECRET
    ? "DOC_SIGNING_SECRET"
    : process.env.ENCRYPTION_KEY
      ? "ENCRYPTION_KEY"
      : "none";

// ── Key wrapping ───────────────────────────────────────────────────────────
interface Wrapped {
  privateKey: string;
  salt: string;
  iv: string;
  authTag: string;
}

const wrap = (pkcs8: Buffer): Wrapped => {
  requireSecret();
  const salt = randomBytes(16);
  const iv = randomBytes(12); // 96-bit, the GCM standard
  const key = scryptSync(WRAP_SECRET, salt, 32);
  const c = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([c.update(pkcs8), c.final()]);
  return {
    privateKey: ct.toString("base64"),
    salt: salt.toString("base64"),
    iv: iv.toString("base64"),
    authTag: c.getAuthTag().toString("base64"),
  };
};

const unwrap = (w: Wrapped): Buffer => {
  requireSecret();
  const key = scryptSync(WRAP_SECRET, Buffer.from(w.salt, "base64"), 32);
  const d = createDecipheriv("aes-256-gcm", key, Buffer.from(w.iv, "base64"));
  // Throws if the ciphertext was altered — that is the point of GCM.
  d.setAuthTag(Buffer.from(w.authTag, "base64"));
  return Buffer.concat([
    d.update(Buffer.from(w.privateKey, "base64")),
    d.final(),
  ]);
};

// ── Canonical payloads ─────────────────────────────────────────────────────
/**
 * Deterministic JSON: keys sorted at every level.
 *
 * Verification re-serializes nothing — it checks the STORED payload string —
 * but every payload must still be built the same way, or two signatures over
 * "the same" data would differ and comparisons across records break.
 */
export const canonical = (value: unknown): string => {
  const walk = (v: unknown): unknown => {
    if (v === null || typeof v !== "object") return v;
    if (Array.isArray(v)) return v.map(walk);
    const o = v as Record<string, unknown>;
    return Object.keys(o)
      .sort()
      .reduce<Record<string, unknown>>((acc, k) => {
        if (o[k] !== undefined) acc[k] = walk(o[k]);
        return acc;
      }, {});
  };
  return JSON.stringify(walk(value));
};

export const sha256Hex = (data: Buffer | Uint8Array | string): string =>
  createHash("sha256").update(data).digest("hex");

// ── Signing / verifying ────────────────────────────────────────────────────
const signWith = (pkcs8: Buffer, message: string): string => {
  const key = createPrivateKey({ key: pkcs8, format: "der", type: "pkcs8" });
  // Ed25519 takes a null algorithm — it hashes internally.
  return edSign(null, Buffer.from(message, "utf8"), key).toString("base64");
};

export const verifyWith = (
  publicKeyB64: string,
  message: string,
  signatureB64: string,
): boolean => {
  try {
    const key = createPublicKey({
      key: Buffer.from(publicKeyB64, "base64"),
      format: "der",
      type: "spki",
    });
    return edVerify(
      null,
      Buffer.from(message, "utf8"),
      key,
      Buffer.from(signatureB64, "base64"),
    );
  } catch {
    // A malformed key or signature is a failed verification, never a crash —
    // this runs on a public endpoint fed arbitrary uploads.
    return false;
  }
};

// ── Per-user keys ──────────────────────────────────────────────────────────
/** Returns the user's active key, minting one on first use. */
export const getOrCreateUserKey = async (userId: string) => {
  const existing = await prisma.signingKey.findFirst({
    where: { scope: "user", userId, active: true, revokedAt: null },
  });
  if (existing) return existing;

  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const spki = publicKey.export({ format: "der", type: "spki" }) as Buffer;
  const pkcs8 = privateKey.export({ format: "der", type: "pkcs8" }) as Buffer;
  const w = wrap(pkcs8);

  return prisma.signingKey.create({
    data: {
      scope: "user",
      userId,
      publicKey: spki.toString("base64"),
      privateKey: w.privateKey,
      salt: w.salt,
      iv: w.iv,
      authTag: w.authTag,
    },
  });
};

/** Signs a canonical payload as the given user. */
export const signAsUser = async (userId: string, payload: string) => {
  const key = await getOrCreateUserKey(userId);
  const signature = signWith(unwrap(key), payload);
  return { signature, signingKeyId: key.id, publicKey: key.publicKey };
};

/**
 * Rotates a user's key. Old keys are kept and stay verifiable — revoking must
 * never retroactively invalidate documents someone already signed.
 */
export const rotateUserKey = async (userId: string, note?: string) => {
  await prisma.signingKey.updateMany({
    where: { scope: "user", userId, active: true },
    data: { active: false, revokedAt: new Date(), revokeNote: note ?? null },
  });
  return getOrCreateUserKey(userId);
};

// ── Organization key ───────────────────────────────────────────────────────
/**
 * The Municipality's seal, used to sign each issued document's hash.
 *
 * It belongs to no user, so it is stored with `scope: "org"` and a null
 * userId. (An earlier draft faked this with a sentinel userId string; the
 * foreign key to User rejected it, correctly.)
 */
export const getOrgKey = async () => {
  const existing = await prisma.signingKey.findFirst({
    where: { scope: "org", active: true, revokedAt: null },
  });
  if (existing) return existing;

  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const spki = publicKey.export({ format: "der", type: "spki" }) as Buffer;
  const pkcs8 = privateKey.export({ format: "der", type: "pkcs8" }) as Buffer;
  const w = wrap(pkcs8);

  return prisma.signingKey.create({
    data: {
      scope: "org",
      userId: null,
      publicKey: spki.toString("base64"),
      privateKey: w.privateKey,
      salt: w.salt,
      iv: w.iv,
      authTag: w.authTag,
    },
  });
};

export const signAsOrg = async (payload: string) => {
  const key = await getOrgKey();
  return { signature: signWith(unwrap(key), payload), orgKeyId: key.id };
};

// ── Serials ────────────────────────────────────────────────────────────────
/**
 * Human-transcribable serial, e.g. GSN-7Q4K-2M8P-XR3T. Crockford-ish alphabet
 * with I/O/0/1/U removed so a serial read off paper can't be mistyped into a
 * different valid one.
 */
const ALPHABET = "23456789ABCDEFGHJKLMNPQRSTVWXYZ";
export const newSerial = (): string => {
  const bytes = randomBytes(12);
  let out = "";
  for (let i = 0; i < 12; i++) {
    if (i > 0 && i % 4 === 0) out += "-";
    out += ALPHABET[bytes[i] % ALPHABET.length];
  }
  return `GSN-${out}`;
};

// ── Attestation payload ────────────────────────────────────────────────────
export interface AttestationInput {
  documentId: string;
  userId: string;
  slot: number;
  signedAt: string;
  geo?: { lat: number; lng: number; accuracy: number | null } | null;
  prevHash?: string | null;
}

export const attestationPayload = (i: AttestationInput): string =>
  canonical({
    v: 1,
    kind: "gasan.document.attestation",
    documentId: i.documentId,
    userId: i.userId,
    slot: i.slot,
    signedAt: i.signedAt,
    geo: i.geo ?? null,
    prevHash: i.prevHash ?? null,
  });

export const sealPayload = (i: {
  serial: string;
  documentId: string;
  sha256: string;
  issuedAt: string;
}): string =>
  canonical({
    v: 1,
    kind: "gasan.document.seal",
    serial: i.serial,
    documentId: i.documentId,
    sha256: i.sha256,
    issuedAt: i.issuedAt,
  });
