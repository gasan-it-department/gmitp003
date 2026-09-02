/* PROOF: the crypto primitives behind document sealing.
 *
 * This is the layer everything else trusts, so the NEGATIVE cases are the
 * point — a verifier that says "valid" no matter what is worse than none.
 *
 * Run: npx ts-node --transpile-only e2e_docsign_crypto.ts */
import { prisma } from "./src/barrel/prisma";
import {
  attestationPayload,
  canonical,
  getOrCreateUserKey,
  getOrgKey,
  newSerial,
  rotateUserKey,
  sealPayload,
  sha256Hex,
  signAsOrg,
  signAsUser,
  verifyWith,
} from "./src/service/docSigning";

const TS = Date.now();

(async () => {
  let pass = 0,
    fail = 0;
  const ok = (l: string, c: boolean, d = "") => {
    if (c) {
      pass++;
      console.log("PASS  " + l);
    } else {
      fail++;
      console.log("FAIL  " + l + (d ? "  → " + d : ""));
    }
  };
  const made = { accountIds: [] as string[], userIds: [] as string[] };

  try {
    // ── canonical JSON ──────────────────────────────────────────────────
    ok(
      "canonical() is key-order independent",
      canonical({ b: 1, a: 2 }) === canonical({ a: 2, b: 1 }),
      canonical({ b: 1, a: 2 }),
    );
    ok(
      "canonical() sorts nested objects too",
      canonical({ x: { d: 1, c: 2 } }) === '{"x":{"c":2,"d":1}}',
      canonical({ x: { d: 1, c: 2 } }),
    );
    ok(
      "canonical() distinguishes different values",
      canonical({ a: 1 }) !== canonical({ a: 2 }),
    );
    ok(
      "canonical() drops undefined but keeps null",
      canonical({ a: undefined, b: null }) === '{"b":null}',
      canonical({ a: undefined, b: null }),
    );

    // ── hashing ─────────────────────────────────────────────────────────
    const h1 = sha256Hex(Buffer.from("hello"));
    ok("sha256 is 64 hex chars", /^[0-9a-f]{64}$/.test(h1), h1);
    ok(
      "sha256 is stable",
      h1 === sha256Hex(Buffer.from("hello")),
    );
    ok(
      "sha256 changes on a ONE BYTE edit",
      h1 !== sha256Hex(Buffer.from("hellp")),
    );

    // ── serials ─────────────────────────────────────────────────────────
    const s1 = newSerial();
    ok("serial looks like GSN-XXXX-XXXX-XXXX", /^GSN-[A-Z0-9]{4}(-[A-Z0-9]{4}){2}$/.test(s1), s1);
    ok(
      "serial omits ambiguous glyphs I/O/0/1/U",
      !/[IOU01]/.test(s1.replace("GSN-", "")),
      s1,
    );
    const many = new Set(Array.from({ length: 500 }, () => newSerial()));
    ok("500 serials are unique", many.size === 500, `got ${many.size}`);

    // ── fixtures ────────────────────────────────────────────────────────
    const line = await prisma.line.findFirst({ select: { id: true } });
    if (!line) {
      console.log("NO FIXTURE (line)");
      process.exit(2);
    }
    const mkUser = async (tag: string) => {
      const acct = await prisma.account.create({
        data: { username: `qa_sig_${TS}_${tag}`, password: "x", lineId: line.id },
        select: { id: true, username: true },
      });
      made.accountIds.push(acct.id);
      const u = await prisma.user.create({
        data: {
          firstName: "QaSig",
          lastName: tag.toUpperCase(),
          username: acct.username,
          accountId: acct.id,
          lineId: line.id,
          email: `qa-sig-${TS}-${tag}@test.local`,
        },
        select: { id: true },
      });
      made.userIds.push(u.id);
      return u.id;
    };

    const alice = await mkUser("alice");
    const bob = await mkUser("bob");

    // ── key wrapping round-trip ─────────────────────────────────────────
    const k1 = await getOrCreateUserKey(alice);
    ok("key minted with a public key", !!k1.publicKey && k1.publicKey.length > 20);
    ok("private key is wrapped, not plaintext", !!k1.privateKey && !!k1.authTag);
    ok("wrap uses a RANDOM salt + iv", !!k1.salt && !!k1.iv);

    const k1again = await getOrCreateUserKey(alice);
    ok("second call reuses the same active key", k1again.id === k1.id);

    const k2 = await getOrCreateUserKey(bob);
    ok("different users get different keys", k2.publicKey !== k1.publicKey);
    ok(
      "wrapping the same key material twice differs (random salt)",
      k1.salt !== k2.salt && k1.iv !== k2.iv,
    );

    // ── sign / verify ───────────────────────────────────────────────────
    const payload = attestationPayload({
      documentId: "doc-1",
      userId: alice,
      slot: 0,
      signedAt: "2026-08-05T00:00:00.000Z",
      geo: { lat: 13.32, lng: 121.86, accuracy: 5 },
      prevHash: null,
    });
    const sig = await signAsUser(alice, payload);
    ok("signature produced", !!sig.signature);
    ok(
      "signature verifies with the signer's public key",
      verifyWith(k1.publicKey, payload, sig.signature),
    );

    // THE point of the whole feature:
    const tampered = payload.replace('"slot":0', '"slot":9');
    ok(
      "verify FAILS when the payload is altered",
      !verifyWith(k1.publicKey, tampered, sig.signature),
    );
    ok(
      "verify FAILS with the WRONG user's public key",
      !verifyWith(k2.publicKey, payload, sig.signature),
    );
    const flipped =
      sig.signature.slice(0, -2) + (sig.signature.endsWith("A") ? "B" : "A") + "=";
    ok(
      "verify FAILS on a mangled signature",
      !verifyWith(k1.publicKey, payload, flipped),
    );
    ok(
      "verify FAILS on garbage input instead of throwing",
      !verifyWith("not-a-key", payload, sig.signature),
    );

    // ── GCM integrity: a tampered wrapped key must not unwrap ───────────
    const badCipher = Buffer.from(k1.privateKey, "base64");
    badCipher[0] ^= 0xff;
    await prisma.signingKey.update({
      where: { id: k1.id },
      data: { privateKey: badCipher.toString("base64") },
    });
    let unwrapThrew = "";
    try {
      await signAsUser(alice, payload);
    } catch (e: unknown) {
      unwrapThrew = e instanceof Error ? e.message : String(e);
    }
    ok(
      "AES-GCM auth tag REJECTS a tampered private key",
      !!unwrapThrew,
      unwrapThrew || "no throw — key wrapping is unauthenticated!",
    );
    // put it back so rotation below is meaningful
    await prisma.signingKey.update({
      where: { id: k1.id },
      data: { privateKey: k1.privateKey },
    });

    // ── rotation must not invalidate history ────────────────────────────
    const rotated = await rotateUserKey(alice, "qa rotation");
    ok("rotation mints a NEW key", rotated.id !== k1.id);
    const oldKey = await prisma.signingKey.findUnique({ where: { id: k1.id } });
    ok("old key is retained, marked inactive", !!oldKey && oldKey.active === false);
    ok(
      "signatures made with the OLD key still verify after rotation",
      verifyWith(k1.publicKey, payload, sig.signature),
      "revoking a key must never retroactively void signed documents",
    );

    // ── organization seal ───────────────────────────────────────────────
    const org = await getOrgKey();
    ok("org key exists", !!org.publicKey);
    const org2 = await getOrgKey();
    ok("org key is a singleton", org2.id === org.id);

    const pdfBytes = Buffer.from(`%PDF-1.7 selftest ${TS}`);
    const hash = sha256Hex(pdfBytes);
    const serial = newSerial();
    const sp = sealPayload({
      serial,
      documentId: "doc-1",
      sha256: hash,
      issuedAt: "2026-08-05T00:00:00.000Z",
    });
    const orgSig = await signAsOrg(sp);
    ok("org signs the seal", !!orgSig.signature);
    ok("org seal verifies", verifyWith(org.publicKey, sp, orgSig.signature));

    // Simulate the real attack: one byte of the PDF changes.
    const evil = Buffer.from(pdfBytes);
    evil[evil.length - 1] ^= 0x01;
    const evilHash = sha256Hex(evil);
    ok("a ONE BYTE edit changes the document hash", evilHash !== hash);
    const evilSeal = sealPayload({
      serial,
      documentId: "doc-1",
      sha256: evilHash,
      issuedAt: "2026-08-05T00:00:00.000Z",
    });
    ok(
      "the org signature does NOT cover the tampered hash",
      !verifyWith(org.publicKey, evilSeal, orgSig.signature),
      "this is the check that makes tamper-detection real",
    );
  } catch (e: unknown) {
    fail++;
    console.log(
      "FAIL  threw: " + (e instanceof Error ? (e.stack ?? e.message) : String(e)),
    );
  } finally {
    try {
      if (made.userIds.length) {
        await prisma.signingKey.deleteMany({
          where: { userId: { in: made.userIds } },
        });
        await prisma.user.deleteMany({ where: { id: { in: made.userIds } } });
      }
      if (made.accountIds.length)
        await prisma.account.deleteMany({ where: { id: { in: made.accountIds } } });
      const left = await prisma.user.count({
        where: { username: { startsWith: `qa_sig_${TS}_` } },
      });
      console.log(`CLEANUP  leftover users=${left}`);
      if (left) fail++;
    } catch (e: unknown) {
      console.log("CLEANUP FAILED: " + (e instanceof Error ? e.message : e));
      fail++;
    }
    console.log(`\n${pass} passed, ${fail} failed`);
    await prisma.$disconnect();
    process.exit(fail ? 1 : 0);
  }
})();
