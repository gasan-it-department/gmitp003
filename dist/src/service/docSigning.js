"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var _a, _b;
Object.defineProperty(exports, "__esModule", { value: true });
exports.sealPayload = exports.attestationPayload = exports.newSerial = exports.signAsOrg = exports.getOrgKey = exports.rotateUserKey = exports.signAsUser = exports.getOrCreateUserKey = exports.verifyWith = exports.sha256Hex = exports.canonical = exports.wrapSource = exports.signingConfigured = void 0;
const crypto_1 = require("crypto");
const prisma_1 = require("../barrel/prisma");
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
const WRAP_SECRET = (_b = (_a = process.env.DOC_SIGNING_SECRET) !== null && _a !== void 0 ? _a : process.env.ENCRYPTION_KEY) !== null && _b !== void 0 ? _b : "";
if (!WRAP_SECRET) {
    console.warn("[docSigning] Neither DOC_SIGNING_SECRET nor ENCRYPTION_KEY is set. " +
        "Document sealing is DISABLED — documents will still sign and download, " +
        "they just won't be verifiable. Set one and redeploy to enable it.");
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
        throw new Error("Document signing is not configured: set DOC_SIGNING_SECRET (or " +
            "ENCRYPTION_KEY) in the environment.");
    }
};
/**
 * True when sealing is usable. Lets callers skip the work quietly instead of
 * throwing and logging on every single download.
 */
const signingConfigured = () => !!WRAP_SECRET;
exports.signingConfigured = signingConfigured;
/**
 * Which secret a key was wrapped with. Recorded so that if DOC_SIGNING_SECRET
 * is introduced later, existing keys are identifiable rather than mysterious.
 */
const wrapSource = () => process.env.DOC_SIGNING_SECRET
    ? "DOC_SIGNING_SECRET"
    : process.env.ENCRYPTION_KEY
        ? "ENCRYPTION_KEY"
        : "none";
exports.wrapSource = wrapSource;
const wrap = (pkcs8) => {
    requireSecret();
    const salt = (0, crypto_1.randomBytes)(16);
    const iv = (0, crypto_1.randomBytes)(12); // 96-bit, the GCM standard
    const key = (0, crypto_1.scryptSync)(WRAP_SECRET, salt, 32);
    const c = (0, crypto_1.createCipheriv)("aes-256-gcm", key, iv);
    const ct = Buffer.concat([c.update(pkcs8), c.final()]);
    return {
        privateKey: ct.toString("base64"),
        salt: salt.toString("base64"),
        iv: iv.toString("base64"),
        authTag: c.getAuthTag().toString("base64"),
    };
};
const unwrap = (w) => {
    requireSecret();
    const key = (0, crypto_1.scryptSync)(WRAP_SECRET, Buffer.from(w.salt, "base64"), 32);
    const d = (0, crypto_1.createDecipheriv)("aes-256-gcm", key, Buffer.from(w.iv, "base64"));
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
const canonical = (value) => {
    const walk = (v) => {
        if (v === null || typeof v !== "object")
            return v;
        if (Array.isArray(v))
            return v.map(walk);
        const o = v;
        return Object.keys(o)
            .sort()
            .reduce((acc, k) => {
            if (o[k] !== undefined)
                acc[k] = walk(o[k]);
            return acc;
        }, {});
    };
    return JSON.stringify(walk(value));
};
exports.canonical = canonical;
const sha256Hex = (data) => (0, crypto_1.createHash)("sha256").update(data).digest("hex");
exports.sha256Hex = sha256Hex;
// ── Signing / verifying ────────────────────────────────────────────────────
const signWith = (pkcs8, message) => {
    const key = (0, crypto_1.createPrivateKey)({ key: pkcs8, format: "der", type: "pkcs8" });
    // Ed25519 takes a null algorithm — it hashes internally.
    return (0, crypto_1.sign)(null, Buffer.from(message, "utf8"), key).toString("base64");
};
const verifyWith = (publicKeyB64, message, signatureB64) => {
    try {
        const key = (0, crypto_1.createPublicKey)({
            key: Buffer.from(publicKeyB64, "base64"),
            format: "der",
            type: "spki",
        });
        return (0, crypto_1.verify)(null, Buffer.from(message, "utf8"), key, Buffer.from(signatureB64, "base64"));
    }
    catch (_a) {
        // A malformed key or signature is a failed verification, never a crash —
        // this runs on a public endpoint fed arbitrary uploads.
        return false;
    }
};
exports.verifyWith = verifyWith;
// ── Per-user keys ──────────────────────────────────────────────────────────
/** Returns the user's active key, minting one on first use. */
const getOrCreateUserKey = (userId) => __awaiter(void 0, void 0, void 0, function* () {
    const existing = yield prisma_1.prisma.signingKey.findFirst({
        where: { scope: "user", userId, active: true, revokedAt: null },
    });
    if (existing)
        return existing;
    const { publicKey, privateKey } = (0, crypto_1.generateKeyPairSync)("ed25519");
    const spki = publicKey.export({ format: "der", type: "spki" });
    const pkcs8 = privateKey.export({ format: "der", type: "pkcs8" });
    const w = wrap(pkcs8);
    return prisma_1.prisma.signingKey.create({
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
});
exports.getOrCreateUserKey = getOrCreateUserKey;
/** Signs a canonical payload as the given user. */
const signAsUser = (userId, payload) => __awaiter(void 0, void 0, void 0, function* () {
    const key = yield (0, exports.getOrCreateUserKey)(userId);
    const signature = signWith(unwrap(key), payload);
    return { signature, signingKeyId: key.id, publicKey: key.publicKey };
});
exports.signAsUser = signAsUser;
/**
 * Rotates a user's key. Old keys are kept and stay verifiable — revoking must
 * never retroactively invalidate documents someone already signed.
 */
const rotateUserKey = (userId, note) => __awaiter(void 0, void 0, void 0, function* () {
    yield prisma_1.prisma.signingKey.updateMany({
        where: { scope: "user", userId, active: true },
        data: { active: false, revokedAt: new Date(), revokeNote: note !== null && note !== void 0 ? note : null },
    });
    return (0, exports.getOrCreateUserKey)(userId);
});
exports.rotateUserKey = rotateUserKey;
// ── Organization key ───────────────────────────────────────────────────────
/**
 * The Municipality's seal, used to sign each issued document's hash.
 *
 * It belongs to no user, so it is stored with `scope: "org"` and a null
 * userId. (An earlier draft faked this with a sentinel userId string; the
 * foreign key to User rejected it, correctly.)
 */
const getOrgKey = () => __awaiter(void 0, void 0, void 0, function* () {
    const existing = yield prisma_1.prisma.signingKey.findFirst({
        where: { scope: "org", active: true, revokedAt: null },
    });
    if (existing)
        return existing;
    const { publicKey, privateKey } = (0, crypto_1.generateKeyPairSync)("ed25519");
    const spki = publicKey.export({ format: "der", type: "spki" });
    const pkcs8 = privateKey.export({ format: "der", type: "pkcs8" });
    const w = wrap(pkcs8);
    return prisma_1.prisma.signingKey.create({
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
});
exports.getOrgKey = getOrgKey;
const signAsOrg = (payload) => __awaiter(void 0, void 0, void 0, function* () {
    const key = yield (0, exports.getOrgKey)();
    return { signature: signWith(unwrap(key), payload), orgKeyId: key.id };
});
exports.signAsOrg = signAsOrg;
// ── Serials ────────────────────────────────────────────────────────────────
/**
 * Human-transcribable serial, e.g. GSN-7Q4K-2M8P-XR3T. Crockford-ish alphabet
 * with I/O/0/1/U removed so a serial read off paper can't be mistyped into a
 * different valid one.
 */
const ALPHABET = "23456789ABCDEFGHJKLMNPQRSTVWXYZ";
const newSerial = () => {
    const bytes = (0, crypto_1.randomBytes)(12);
    let out = "";
    for (let i = 0; i < 12; i++) {
        if (i > 0 && i % 4 === 0)
            out += "-";
        out += ALPHABET[bytes[i] % ALPHABET.length];
    }
    return `GSN-${out}`;
};
exports.newSerial = newSerial;
const attestationPayload = (i) => {
    var _a, _b;
    return (0, exports.canonical)({
        v: 1,
        kind: "gasan.document.attestation",
        documentId: i.documentId,
        userId: i.userId,
        slot: i.slot,
        signedAt: i.signedAt,
        geo: (_a = i.geo) !== null && _a !== void 0 ? _a : null,
        prevHash: (_b = i.prevHash) !== null && _b !== void 0 ? _b : null,
    });
};
exports.attestationPayload = attestationPayload;
const sealPayload = (i) => (0, exports.canonical)({
    v: 1,
    kind: "gasan.document.seal",
    serial: i.serial,
    documentId: i.documentId,
    sha256: i.sha256,
    issuedAt: i.issuedAt,
});
exports.sealPayload = sealPayload;
