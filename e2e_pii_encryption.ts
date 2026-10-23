/* Personal data: new scheme, old data, and the trap in between.
 *
 *   npx ts-node --transpile-only e2e_pii_encryption.ts
 *
 * The failure that matters here is not "encryption is weak", it is "every
 * name and email in the database just became unreadable". So the first and
 * most important thing proved below is that values written by the OLD
 * scheme still decrypt under the new code — and the legacy ciphertext is
 * produced the honest way, with aes-192-cbc and scrypt over JWT_SECRET,
 * exactly as the previous implementation did, rather than by asking the
 * new code to make something it will obviously be able to read.
 *
 * Nothing here touches the database.
 */
import path from "path";
import { scryptSync, createCipheriv, randomBytes } from "node:crypto";

const entry = path.join(process.cwd(), "src", "index.ts");
require.cache[entry] = {
  id: entry, filename: entry, loaded: true,
  exports: { notificationSocket: { emitUserNotification: () => undefined } },
} as never;

let pass = 0;
const fails: string[] = [];
const ok = (name: string, cond: boolean, detail = "") => {
  if (cond) { pass++; console.log(`  ok    ${name}`); }
  else { fails.push(name); console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`); }
};

const MODULE = path.join(process.cwd(), "src", "service", "encryption.ts");

/** Re-import with a clean module cache, so the key is re-read from env. */
const load = () => {
  delete require.cache[MODULE];
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require(MODULE) as typeof import("./src/service/encryption");
};

/** A ciphertext exactly as the old implementation would have written it. */
const legacyEncrypt = (text: string, secret: string) => {
  const key = scryptSync(secret, "salt", 24);
  const iv = randomBytes(16);
  const c = createCipheriv("aes-192-cbc", key, iv);
  return {
    encryptedData: c.update(text, "utf8", "hex") + c.final("hex"),
    iv: iv.toString("hex"),
  };
};

const SECRET = "a-test-jwt-secret";
const KEY = "a".repeat(64); // 32 bytes of hex
const SAMPLE = "Maria Elena Sanchez-O'Brien ñ 09171234567";

(async () => {
  const envBefore = {
    JWT_SECRET: process.env.JWT_SECRET,
    PII: process.env.PII_ENCRYPTION_KEY,
  };
  try {
    process.env.JWT_SECRET = SECRET;

    // ── the migration risk, first ──────────────────────────────────────
    console.log("");
    console.log("-- data already in the database must still read --");
    const old = legacyEncrypt(SAMPLE, SECRET);

    delete process.env.PII_ENCRYPTION_KEY;
    let E = load();
    const readNoKey = await E.EncryptionService.decrypt(old.encryptedData, old.iv);
    ok("legacy value decrypts with no PII key set", readNoKey === SAMPLE,
      JSON.stringify(readNoKey));

    process.env.PII_ENCRYPTION_KEY = KEY;
    E = load();
    const readWithKey = await E.EncryptionService.decrypt(old.encryptedData, old.iv);
    ok("legacy value STILL decrypts once the new key is configured",
      readWithKey === SAMPLE, JSON.stringify(readWithKey));
    ok("and it is recognised as needing a rewrite",
      E.EncryptionService.isLegacy(old.encryptedData) === true);

    // ── the new scheme ─────────────────────────────────────────────────
    console.log("");
    console.log("-- the new scheme --");
    const v2 = await E.EncryptionService.encrypt(SAMPLE);
    ok("new values are marked v2", v2.encryptedData.startsWith("v2:"),
      v2.encryptedData.slice(0, 12));
    ok("and round-trip exactly, accents and apostrophes included",
      (await E.EncryptionService.decrypt(v2.encryptedData, v2.iv)) === SAMPLE);
    ok("a v2 value is not flagged for rewriting",
      E.EncryptionService.isLegacy(v2.encryptedData) === false);
    ok("the nonce is 12 bytes, as GCM expects", v2.iv.length === 24, v2.iv);
    const again = await E.EncryptionService.encrypt(SAMPLE);
    ok("the same text encrypts differently each time",
      again.encryptedData !== v2.encryptedData);

    /*
      An empty field is ordinary — plenty of optional columns hold "". It
      encrypts to no ciphertext at all under GCM, only a tag, which the
      first version of this code mistook for a malformed value and refused.
      The re-encryption dry run is what caught it.
    */
    const empty = await E.EncryptionService.encrypt("");
    ok("an EMPTY value round-trips",
      (await E.EncryptionService.decrypt(empty.encryptedData, empty.iv)) === "",
      JSON.stringify(empty.encryptedData));

    // ── authentication: the whole reason for moving off CBC ────────────
    console.log("");
    console.log("-- tampering --");
    const [, ct, tag] = v2.encryptedData.split(":");
    const flipped = ct.slice(0, -2) + (ct.slice(-2) === "00" ? "01" : "00");
    let threw = false;
    try {
      await E.EncryptionService.decrypt(`v2:${flipped}:${tag}`, v2.iv);
    } catch { threw = true; }
    ok("an altered v2 ciphertext is REFUSED, not silently mangled", threw);

    let tagThrew = false;
    try {
      await E.EncryptionService.decrypt(`v2:${ct}:${"0".repeat(32)}`, v2.iv);
    } catch { tagThrew = true; }
    ok("a forged tag is refused", tagThrew);

    /*
      The same edit under the old scheme does NOT throw — that is exactly
      the weakness being replaced, and worth demonstrating rather than
      asserting in a comment.
    */
    const oldCt = old.encryptedData;
    let legacyThrew = false;
    let legacyGave = "";
    try {
      legacyGave = await E.EncryptionService.decrypt(
        oldCt.slice(0, -2) + (oldCt.slice(-2) === "00" ? "01" : "00"), old.iv,
      );
    } catch { legacyThrew = true; }
    ok("(for contrast) the legacy scheme cannot detect the same edit",
      legacyThrew || legacyGave !== SAMPLE,
      legacyThrew ? "padding happened to break" : "returned altered text");

    // ── re-keying: the v2 key must itself be rotatable ─────────────────
    console.log("");
    console.log("-- rotating the PII key --");
    const KEY_B = "b".repeat(64);
    process.env.PII_ENCRYPTION_KEY = KEY;
    E = load();
    const underA = await E.EncryptionService.encrypt(SAMPLE);

    const viaOldKey = await E.EncryptionService.decryptV2With(
      underA.encryptedData, underA.iv, KEY,
    );
    ok("a v2 value can be read with an explicitly supplied key",
      viaOldKey === SAMPLE);

    let wrongKeyThrew = false;
    try {
      await E.EncryptionService.decryptV2With(
        underA.encryptedData, underA.iv, KEY_B,
      );
    } catch { wrongKeyThrew = true; }
    ok("the WRONG key throws instead of returning rubbish — which is what " +
      "lets the script tell 'already done' from 'needs converting'",
      wrongKeyThrew);

    // now the rotation itself: read with A, write under B
    process.env.PII_ENCRYPTION_KEY = KEY_B;
    E = load();
    const plain = await E.EncryptionService.decryptV2With(
      underA.encryptedData, underA.iv, KEY,
    );
    const underB = await E.EncryptionService.encrypt(plain);
    ok("re-keyed value reads back identical under the NEW key",
      (await E.EncryptionService.decrypt(underB.encryptedData, underB.iv)) === SAMPLE);
    let oldUnreadable = false;
    try { await E.EncryptionService.decrypt(underA.encryptedData, underA.iv); }
    catch { oldUnreadable = true; }
    ok("and the old ciphertext is no longer readable under the new key, " +
      "so a half-finished rotation is detectable", oldUnreadable);

    // ── the configuration traps ────────────────────────────────────────
    console.log("");
    console.log("-- configuration --");
    delete process.env.PII_ENCRYPTION_KEY;
    E = load();
    const fallback = await E.EncryptionService.encrypt(SAMPLE);
    ok("with no PII key it keeps writing the legacy format, so a deploy " +
      "on its own breaks nothing",
      !fallback.encryptedData.startsWith("v2:"));
    ok("posture says it is still tied to JWT_SECRET",
      E.encryptionPosture().coupledToJwtSecret === true &&
      E.encryptionPosture().piiKeyConfigured === false,
      JSON.stringify(E.encryptionPosture()));

    process.env.PII_ENCRYPTION_KEY = "too-short";
    E = load();
    const posture = E.encryptionPosture();
    ok("a malformed key is reported, not silently ignored",
      !!posture.keyError && /64 hex/.test(posture.keyError), JSON.stringify(posture));
    let malformedThrew = false;
    try { await E.EncryptionService.encrypt(SAMPLE); } catch { malformedThrew = true; }
    ok("and encrypting with it refuses rather than quietly using the old key",
      malformedThrew);

    process.env.PII_ENCRYPTION_KEY = KEY;
    E = load();
    const fpA = E.encryptionPosture().keyFingerprint;
    process.env.PII_ENCRYPTION_KEY = "c".repeat(64);
    E = load();
    const fpC = E.encryptionPosture().keyFingerprint;
    ok("the key fingerprint CHANGES when the key does, so a rotation is " +
      "verifiable from outside", !!fpA && !!fpC && fpA !== fpC, fpA + " vs " + fpC);
    ok("and it is a fingerprint, not the key",
      (fpA||"").length === 16 && !KEY.includes(fpA||"zzz"), String(fpA));
    process.env.PII_ENCRYPTION_KEY = KEY;
    E = load();

    ok("with a good key, posture reports aes-256-gcm",
      E.encryptionPosture().writesWith === "aes-256-gcm" &&
      E.encryptionPosture().coupledToJwtSecret === false,
      JSON.stringify(E.encryptionPosture()));

    // The published fallback password is gone.
    delete process.env.JWT_SECRET;
    delete process.env.PII_ENCRYPTION_KEY;
    E = load();
    let noSecretThrew = false;
    try { await E.EncryptionService.encrypt(SAMPLE); } catch { noSecretThrew = true; }
    ok('no JWT_SECRET now fails instead of using "your-secure-password"',
      noSecretThrew);

    // A v2 value is unreadable without the key — state it plainly.
    process.env.JWT_SECRET = SECRET;
    delete process.env.PII_ENCRYPTION_KEY;
    E = load();
    let lostThrew = false;
    try { await E.EncryptionService.decrypt(v2.encryptedData, v2.iv); }
    catch { lostThrew = true; }
    ok("a v2 value cannot be read if PII_ENCRYPTION_KEY is lost", lostThrew);
  } finally {
    if (envBefore.JWT_SECRET === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = envBefore.JWT_SECRET;
    if (envBefore.PII === undefined) delete process.env.PII_ENCRYPTION_KEY;
    else process.env.PII_ENCRYPTION_KEY = envBefore.PII;
  }

  /*
    The boot hook can rewrite every encrypted column in the database, so
    what it does when NOT asked matters more than what it does when asked.
    Both paths below return before touching prisma, so no database
    connection is made here.
  */
  console.log("");
  console.log("-- the boot hook only runs when explicitly told to --");
  const boot = require(
    path.join(process.cwd(), "src", "service", "reencryptPii.ts"),
  ) as typeof import("./src/service/reencryptPii");
  delete process.env.PII_BACKFILL;
  await boot.maybeRunReencryptionAtBoot();
  ok("unset: does not run", boot.lastReencryption() === null);
  process.env.PII_BACKFILL = "yes";
  await boot.maybeRunReencryptionAtBoot();
  ok("an unrecognised value is ignored rather than guessed at",
    boot.lastReencryption() === null);
  delete process.env.PII_BACKFILL;

  console.log(`\n${pass} passed, ${fails.length} failed`);
  process.exit(fails.length ? 1 : 0);
})();
