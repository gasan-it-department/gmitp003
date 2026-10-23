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
Object.defineProperty(exports, "__esModule", { value: true });
exports.encryptionPosture = exports.EncryptionService = exports.usingV2 = void 0;
// utils/encryption.ts
/**
 * Field-level encryption for personal data.
 *
 * ── What was wrong ────────────────────────────────────────────────────────
 *
 * The original scheme had four faults in nine lines:
 *
 *   1. it used JWT_SECRET as the encryption password, so the key that signs
 *      sessions and the key that protects every name, email and phone
 *      number in the database were THE SAME SECRET. Rotating it — the
 *      ordinary response to a suspected token leak — silently made every
 *      encrypted field undecryptable, with no error until somebody opened
 *      a record;
 *   2. it fell back to the literal string "your-secure-password" when that
 *      variable was missing, which is a published key;
 *   3. it derived the key with scrypt over the literal salt "salt", so the
 *      derivation was identical in every deployment that shared a password;
 *   4. it used aes-192-CBC with no MAC. CBC without authentication is
 *      malleable: anyone who can write to the database can flip bits in a
 *      ciphertext and change the plaintext that comes back out. The
 *      signing code in docSigning.ts already used aes-256-GCM, so the
 *      codebase knew better.
 *
 * ── How this fixes it without losing the existing data ────────────────────
 *
 * Every encrypted value already in the database was written by the old
 * scheme, so the old scheme cannot simply be deleted. Ciphertexts are
 * versioned instead:
 *
 *   v2       "v2:<ciphertext hex>:<tag hex>"   aes-256-GCM, PII_ENCRYPTION_KEY
 *   legacy   "<ciphertext hex>"                aes-192-CBC, scrypt(JWT_SECRET)
 *
 * `decrypt` reads both, for ever. `encrypt` writes v2 as soon as
 * PII_ENCRYPTION_KEY is set, and until then keeps writing legacy so that
 * deploying this change on its own breaks nothing.
 *
 * The version marker lives inside the existing `encryptedData` column and
 * the GCM tag travels with it, so no table needs a new column — which
 * matters when 48 column pairs across a dozen models are involved.
 *
 * Old rows stay readable but still depend on JWT_SECRET, so the coupling
 * is only truly gone once they have been rewritten:
 * `npx ts-node --transpile-only reencrypt_pii.ts`.
 */
const node_crypto_1 = require("node:crypto");
const node_util_1 = require("node:util");
const scryptAsync = (0, node_util_1.promisify)(node_crypto_1.scrypt);
const randomFillAsync = (0, node_util_1.promisify)(node_crypto_1.randomFill);
/** The scheme every value in the database was written with before v2. */
const LEGACY_ALGORITHM = "aes-192-cbc";
const V2_ALGORITHM = "aes-256-gcm";
const V2_PREFIX = "v2:";
/**
 * The v2 key: 32 bytes, as 64 hex characters, in PII_ENCRYPTION_KEY.
 *
 * Raw key material rather than a passphrase run through a KDF, because a
 * KDF here would need a salt, and a salt that has to be identical on every
 * boot is a constant — which is exactly the mistake this replaces. Generate
 * one with:
 *
 *     node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
 */
const readV2Key = () => {
    const raw = (process.env.PII_ENCRYPTION_KEY || "").trim();
    if (!raw)
        return null;
    if (!/^[0-9a-fA-F]{64}$/.test(raw)) {
        /*
          Refused loudly rather than ignored. Falling back to the legacy
          scheme on a malformed key would leave the operator believing the
          data had been re-keyed when it had not.
        */
        throw new Error("PII_ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes). " +
            `Got ${raw.length} characters. Generate one with: ` +
            `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`);
    }
    return Buffer.from(raw, "hex");
};
let v2KeyCache;
const v2Key = () => {
    if (v2KeyCache === undefined)
        v2KeyCache = readV2Key();
    return v2KeyCache;
};
/** Whether new values are written with the authenticated scheme. */
const usingV2 = () => {
    try {
        return v2Key() !== null;
    }
    catch (_a) {
        return false;
    }
};
exports.usingV2 = usingV2;
/**
 * The legacy key, still needed to read everything written before v2.
 *
 * No more "your-secure-password". If JWT_SECRET is absent the legacy key
 * cannot be reconstructed, and pretending otherwise would encrypt real
 * personal data under a key published in this file.
 */
const legacyKey = () => __awaiter(void 0, void 0, void 0, function* () {
    const password = process.env.JWT_SECRET;
    if (!password) {
        throw new Error("JWT_SECRET is not set, so legacy-encrypted fields cannot be read. " +
            "It is also the key for them until reencrypt_pii.ts has run.");
    }
    return (yield scryptAsync(password, "salt", 24));
});
class EncryptionService {
    static encrypt(text) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                const key = v2Key();
                if (key) {
                    // 12 bytes is the nonce size GCM is defined for and the only one
                    // that avoids an extra internal derivation step.
                    const iv = (0, node_crypto_1.randomBytes)(12);
                    const cipher = (0, node_crypto_1.createCipheriv)(V2_ALGORITHM, key, iv);
                    const ciphertext = Buffer.concat([
                        cipher.update(text, "utf8"),
                        cipher.final(),
                    ]);
                    const tag = cipher.getAuthTag();
                    return {
                        encryptedData: `${V2_PREFIX}${ciphertext.toString("hex")}:${tag.toString("hex")}`,
                        iv: iv.toString("hex"),
                    };
                }
                // No v2 key configured yet — keep writing what the rest of the
                // database holds, so deploying this alone changes nothing.
                const lk = yield legacyKey();
                const iv = (yield randomFillAsync(new Uint8Array(16)));
                const cipher = (0, node_crypto_1.createCipheriv)(LEGACY_ALGORITHM, lk, iv);
                let encrypted = cipher.update(text, "utf8", "hex");
                encrypted += cipher.final("hex");
                return {
                    encryptedData: encrypted,
                    iv: Buffer.from(iv).toString("hex"),
                };
            }
            catch (error) {
                throw new Error(`Encryption failed: ${error}`);
            }
        });
    }
    static decrypt(encryptedData, ivHex) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                if (encryptedData === null || encryptedData === void 0 ? void 0 : encryptedData.startsWith(V2_PREFIX)) {
                    const key = v2Key();
                    if (!key) {
                        throw new Error("This value was encrypted with PII_ENCRYPTION_KEY, which is " +
                            "not set. Restore it — the data cannot be read without it.");
                    }
                    const [, ctHex, tagHex] = encryptedData.split(":");
                    /*
                      `ctHex` may legitimately be EMPTY: an empty string encrypts to no
                      ciphertext at all under GCM, just a tag. Testing it for
                      truthiness rejected every empty field in the database — which is
                      how the re-encryption dry run found this.
                    */
                    if (ctHex === undefined || !tagHex) {
                        throw new Error("malformed v2 ciphertext");
                    }
                    const decipher = (0, node_crypto_1.createDecipheriv)(V2_ALGORITHM, key, Buffer.from(ivHex, "hex"));
                    /*
                      The tag is what makes this authenticated: final() throws if the
                      ciphertext was altered, instead of returning plausible rubbish
                      the way the old CBC scheme did.
                    */
                    decipher.setAuthTag(Buffer.from(tagHex, "hex"));
                    return (decipher.update(Buffer.from(ctHex, "hex")).toString("utf8") +
                        decipher.final("utf8"));
                }
                const lk = yield legacyKey();
                const decipher = (0, node_crypto_1.createDecipheriv)(LEGACY_ALGORITHM, lk, Buffer.from(ivHex, "hex"));
                let decrypted = decipher.update(encryptedData, "hex", "utf8");
                decrypted += decipher.final("utf8");
                return decrypted;
            }
            catch (error) {
                throw new Error(`Decryption failed: ${error}`);
            }
        });
    }
    /**
     * Decrypt a v2 value with a key OTHER than the configured one.
     *
     * Only for re-keying. Without this the v2 key could never be ROTATED:
     * every value would be readable solely by the key currently in the
     * environment, so replacing a compromised PII_ENCRYPTION_KEY would mean
     * losing the data it protected — swapping one unrotatable secret for
     * another, which was the whole complaint about JWT_SECRET.
     *
     * A wrong key fails cleanly here rather than returning rubbish, because
     * GCM authenticates: that is what lets the re-keying script tell "this
     * row is already done" from "this row needs converting".
     */
    static decryptV2With(encryptedData, ivHex, keyHex) {
        return __awaiter(this, void 0, void 0, function* () {
            if (!/^[0-9a-fA-F]{64}$/.test(keyHex)) {
                throw new Error("key must be 64 hex characters (32 bytes)");
            }
            if (!encryptedData.startsWith(V2_PREFIX)) {
                throw new Error("not a v2 value");
            }
            const [, ctHex, tagHex] = encryptedData.split(":");
            if (ctHex === undefined || !tagHex) {
                throw new Error("malformed v2 ciphertext");
            }
            const decipher = (0, node_crypto_1.createDecipheriv)(V2_ALGORITHM, Buffer.from(keyHex, "hex"), Buffer.from(ivHex, "hex"));
            decipher.setAuthTag(Buffer.from(tagHex, "hex"));
            return (decipher.update(Buffer.from(ctHex, "hex")).toString("utf8") +
                decipher.final("utf8"));
        });
    }
    /** True when this value still needs rewriting under the v2 key. */
    static isLegacy(encryptedData) {
        return !!encryptedData && !encryptedData.startsWith(V2_PREFIX);
    }
}
exports.EncryptionService = EncryptionService;
/** For /health/build: which scheme new writes use, and why. */
const encryptionPosture = () => {
    let keyError = null;
    let configured = false;
    try {
        configured = v2Key() !== null;
    }
    catch (e) {
        keyError = e instanceof Error ? e.message : String(e);
    }
    /*
      A fingerprint, not the key: 16 hex characters of SHA-256 over the key
      material. It reveals nothing and it CHANGES when the key changes,
      which is the only way to confirm from outside that a rotation actually
      took effect — `piiKeyConfigured: true` looks identical before and
      after. The signing certificate is reported the same way.
    */
    let fingerprint = null;
    if (configured) {
        const k = process.env.PII_ENCRYPTION_KEY.trim().toLowerCase();
        fingerprint = (0, node_crypto_1.createHash)("sha256")
            .update(Buffer.from(k, "hex"))
            .digest("hex")
            .slice(0, 16);
    }
    return Object.assign(Object.assign({ writesWith: configured ? "aes-256-gcm" : "aes-192-cbc (legacy)", keyFingerprint: fingerprint, piiKeyConfigured: configured, 
        /*
          The headline. While this is true the session secret and the key to
          every name, email and phone number are the same string, and rotating
          it destroys the data.
          */
        coupledToJwtSecret: !configured }, (keyError ? { keyError } : {})), { note: configured
            ? "New values use PII_ENCRYPTION_KEY. Rows written before it was set " +
                "still need reencrypt_pii.ts before JWT_SECRET can be rotated."
            : "PII_ENCRYPTION_KEY is not set, so personal data is still encrypted " +
                "with JWT_SECRET. Rotating JWT_SECRET would make it unreadable." });
};
exports.encryptionPosture = encryptionPosture;
