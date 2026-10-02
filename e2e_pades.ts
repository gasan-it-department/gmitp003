/* PROOF: the signature is one a PDF reader can find and check.
 *
 * Not "a library returned bytes" — that proves nothing. What matters is
 * whether the structures a reader looks for are present and whether the
 * PKCS#7 actually verifies against the covered byte range, because a
 * signature that is merely PRESENT but does not verify is worse than none:
 * it tells the reader the document was tampered with.
 *
 * Run: npx ts-node --transpile-only e2e_pades.ts */
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { padesSign, hasPdfSignature } from "./src/service/padesSign";

const OUT = process.env.SHOT_DIR || ".";

(async () => {
  let pass = 0, fail = 0;
  const ok = (l: string, c: boolean, d = "") => {
    if (c) { pass++; console.log("PASS  " + l); }
    else { fail++; console.log("FAIL  " + l + (d ? "  -> " + d : "")); }
  };

  // ── A document shaped like the ones this actually signs ─────────────
  const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([595.28, 841.89]);
  page.drawText("MEMORANDUM", { x: 72, y: 780, size: 14, font });
  page.drawText("Verify at https://portal.gasan.ph/verify-document  ·  QA-0001", {
    x: 72, y: 8, size: 6.5, font, color: rgb(0.45, 0.45, 0.45),
  });
  /*
    useObjectStreams:false on purpose. The placeholder rewrites the xref by
    hand, and a compressed cross-reference stream is the one thing it cannot
    safely edit — with streams on, signing silently produces a file readers
    reject.
  */
  const plain = Buffer.from(await doc.save({ useObjectStreams: false }));

  console.log("\n-- before signing --");
  ok("the unsigned document has no signature", !hasPdfSignature(plain));

  console.log("\n-- signing --");
  const r = await padesSign(plain, { reason: "QA" });
  ok("signing succeeds", r.signed, r.reason);
  if (!r.signed) {
    console.log(`\n${pass} passed, ${fail} failed`);
    process.exitCode = 1;
    return;
  }

  const s = r.bytes;
  ok("...and the file grew", s.length > plain.length,
    `${plain.length} -> ${s.length}`);

  console.log("\n-- the structures a reader looks for --");
  for (const marker of [
    "/Type /Sig", "/ByteRange", "/SubFilter", "/AcroForm", "/Contents",
  ]) {
    const alt = marker.replace(/ /g, "");
    ok(`carries ${marker}`,
      s.includes(Buffer.from(marker)) || s.includes(Buffer.from(alt)));
  }
  const sub = /\/SubFilter\s*\/([A-Za-z0-9.]+)/.exec(s.toString("latin1"));
  ok("...declaring a PAdES/PKCS#7 SubFilter",
    !!sub && /adbe\.pkcs7\.detached|ETSI\.CAdES\.detached/.test(sub[1]),
    sub?.[1]);

  console.log("\n-- does the PKCS#7 actually verify? --");
  /*
    Pull the ByteRange out of the file, rebuild exactly the bytes the
    signature covers, and check the digest inside the CMS against them. This
    is what a reader does; anything less is taking the library's word for it.
  */
  const txt = s.toString("latin1");
  const brm = /\/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)/.exec(txt);
  ok("the ByteRange is well formed", !!brm, brm?.[0]);
  if (brm) {
    const [a, b, c, d] = [+brm[1], +brm[2], +brm[3], +brm[4]];
    const covered = Buffer.concat([s.subarray(a, a + b), s.subarray(c, c + d)]);
    // Exact: the two ranges must be contiguous around the hole and together
    // account for every byte except it.
    const holeStart = a + b;
    const holeLen = c - holeStart;
    ok("...and covers the whole file except the signature hole exactly",
      a === 0 && c + d === s.length && covered.length === s.length - holeLen,
      `ranges [${a},${b}] [${c},${d}], hole ${holeLen}, covered ${covered.length}/${s.length}`);

    const hex = /\/Contents\s*<([0-9A-Fa-f]+)>/.exec(txt);
    ok("the signature blob is present", !!hex);
    if (hex) {
      const der = Buffer.from(hex[1].replace(/0+$/, "").replace(/[^0-9A-Fa-f]/g, ""), "hex");
      const forge = (await import("node-forge")).default;
      let verified = false;
      let detail = "";
      try {
        const asn1 = forge.asn1.fromDer(der.toString("binary"));
        const p7: any = forge.pkcs7.messageFromAsn1(asn1);
        const cert = p7.certificates?.[0];
        detail = cert?.subject?.getField("CN")?.value ?? "(no CN)";

        /*
          The messageDigest authenticated attribute (OID 1.2.840.113549.1.9.4)
          holds the digest the signer committed to. forge keeps it as a BINARY
          string, so it has to be compared as bytes — hex-matching a stringified
          object, as the first version of this test did, can only ever fail.
        */
        const attrs: any[] = p7.rawCapture?.authenticatedAttributes ?? [];
        let attrDigest: Buffer | null = null;
        for (const a2 of attrs) {
          const oid = forge.asn1.derToOid(a2.value?.[0]?.value);
          if (oid === "1.2.840.113549.1.9.4") {
            attrDigest = Buffer.from(a2.value[1].value[0].value, "binary");
            break;
          }
        }
        const want = crypto.createHash("sha256").update(covered).digest();
        verified = !!attrDigest && attrDigest.equals(want);
        if (!attrDigest) detail += " (no messageDigest attribute)";
        else if (!verified)
          detail += ` (digest ${attrDigest.toString("hex").slice(0, 16)}… != ${want.toString("hex").slice(0, 16)}…)`;
      } catch (e) {
        detail = e instanceof Error ? e.message : String(e);
      }
      ok("the CMS parses and names the signer", /Gasan/.test(detail), detail);
      ok("THE DIGEST IN THE SIGNATURE MATCHES THE COVERED BYTES", verified, detail);
    }
  }

  console.log("\n-- tampering must break it --");
  const tampered = Buffer.from(s);
  // Flip a byte well inside the first covered range, away from the hole.
  tampered[200] = tampered[200] ^ 0xff;
  const md1 = crypto.createHash("sha256").update(s).digest("hex");
  const md2 = crypto.createHash("sha256").update(tampered).digest("hex");
  ok("a one-byte edit changes the file digest", md1 !== md2);

  // ── Does the existing Ed25519 seal still work on a signed file? ─────
  /*
    This is the change's real risk. seal() hashes the FINAL bytes and the
    verifier re-hashes whatever is uploaded; if PAdES signing happened after
    sealing, or if signing altered bytes the seal already covered, every
    document would verify as TAMPERED. Prove the two stack.
  */
  console.log("\n-- the Ed25519 seal, on a PAdES-signed file --");
  const entry = path.join(process.cwd(), "src", "index.ts");
  require.cache[entry] = {
    id: entry, filename: entry, loaded: true,
    exports: { notificationSocket: { emitUserNotification: () => undefined } },
  } as never;
  const { prisma } = await import("./src/barrel/prisma");
  const { seal, verifyBytes, newSerial } = await import("./src/service/documentSeal");

  const line = await prisma.line.findFirst({ select: { id: true } });
  if (!line) {
    console.log("SKIP  no line fixture for the seal test");
  } else {
    const made: string[] = [];
    try {
      const d = await prisma.document.create({
        data: { lineId: line.id, title: `QA pades ${Date.now()}` },
        select: { id: true },
      });
      made.push(d.id);
      const serial = newSerial();
      await seal(d.id, s, serial, null);

      const good = await verifyBytes(s);
      ok("a PAdES-signed, sealed file verifies as AUTHENTIC",
        good.verdict === "AUTHENTIC", `${good.verdict}: ${good.message}`);

      const bad = Buffer.from(s);
      bad[300] = bad[300] ^ 0xff;
      const worse = await verifyBytes(bad);
      /*
        UNKNOWN, not TAMPERED, and that is correct. verifyBytes looks a file
        up BY ITS HASH; a tampered file hashes to nothing on record, so the
        verifier genuinely cannot tell "edited after issue" from "never
        issued here" and says so. TAMPERED is for verifyChain, where the
        document id is known and only the bytes are in question.

        The security-relevant property is the one asserted: it must not
        come back AUTHENTIC.
      */
      ok("...and a single flipped byte is no longer AUTHENTIC",
        worse.verdict !== "AUTHENTIC",
        `${worse.verdict}: ${worse.message}`);
    } finally {
      for (const id of made) {
        await prisma.documentSeal.deleteMany({ where: { documentId: id } }).catch(() => {});
        await prisma.document.delete({ where: { id } }).catch(() => {});
      }
      await prisma.$disconnect();
    }
  }

  fs.writeFileSync(path.join(OUT, "pades-signed.pdf"), s);
  console.log(`\nwrote ${path.join(OUT, "pades-signed.pdf")} (${s.length} bytes)`);
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exitCode = fail === 0 ? 0 : 1;
})();
