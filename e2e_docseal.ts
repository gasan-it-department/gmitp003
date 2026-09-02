/* PROOF: tamper detection actually detects tampering.
 *
 * The happy path is easy and nearly worthless on its own — a verifier that
 * always answers "valid" would pass it. The assertions that matter here are
 * the ones where the verdict must FLIP.
 *
 * Run: npx ts-node --transpile-only e2e_docseal.ts */
import { prisma } from "./src/barrel/prisma";
import {
  attest,
  lookupSerial,
  newSerial,
  seal,
  verifyBytes,
  verifyChain,
} from "./src/service/documentSeal";

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
  const made = {
    accountIds: [] as string[],
    userIds: [] as string[],
    docIds: [] as string[],
  };

  try {
    const line = await prisma.line.findFirst({ select: { id: true } });
    if (!line) {
      console.log("NO FIXTURE (line)");
      process.exit(2);
    }

    const mkUser = async (tag: string) => {
      const acct = await prisma.account.create({
        data: { username: `qa_seal_${TS}_${tag}`, password: "x", lineId: line.id },
        select: { id: true, username: true },
      });
      made.accountIds.push(acct.id);
      const u = await prisma.user.create({
        data: {
          firstName: tag === "a" ? "Ana" : "Ben",
          lastName: tag === "a" ? "Alvarez" : "Bonifacio",
          username: acct.username,
          accountId: acct.id,
          lineId: line.id,
          email: `qa-seal-${TS}-${tag}@test.local`,
        },
        select: { id: true },
      });
      made.userIds.push(u.id);
      return u.id;
    };

    const alice = await mkUser("a");
    const bob = await mkUser("b");

    const doc = await prisma.document.create({
      data: { title: `QA Sealed Doc ${TS}`, lineId: line.id },
      select: { id: true },
    });
    made.docIds.push(doc.id);

    // ── Two signers attest, in order ────────────────────────────────────
    const t0 = new Date(Date.now() - 60_000);
    const t1 = new Date(Date.now() - 30_000);
    const a1 = await attest({
      documentId: doc.id,
      userId: alice,
      slot: 0,
      signedAt: t0,
      geo: { lat: 13.32, lng: 121.86, accuracy: 5 },
    });
    const a2 = await attest({
      documentId: doc.id,
      userId: bob,
      slot: 1,
      signedAt: t1,
    });
    ok("two attestations written", !!a1 && !!a2);
    ok("first attestation has no prevHash", a1.prevHash === null);
    ok("second chains to the first", !!a2.prevHash && a2.prevHash !== a1.prevHash);

    const again = await attest({
      documentId: doc.id,
      userId: alice,
      slot: 0,
      signedAt: new Date(),
    });
    ok("re-attesting the same slot is idempotent", again.id === a1.id);

    let chain = await verifyChain(doc.id);
    ok("chain verifies clean", chain.intact && chain.valid === 2,
      JSON.stringify(chain));

    // ── Seal a document ─────────────────────────────────────────────────
    const pdf = Buffer.from(
      `%PDF-1.7\n1 0 obj<</Type/Catalog>>endobj\nAMOUNT: PHP 50,000.00\nserial ${TS}\n%%EOF`,
    );
    const serial = newSerial();
    const sealed = await seal(doc.id, pdf, serial, alice);
    ok("seal created", !!sealed.serial && !!sealed.sha256);

    // ── THE happy path ──────────────────────────────────────────────────
    let rep = await verifyBytes(pdf);
    ok("unmodified file → AUTHENTIC", rep.verdict === "AUTHENTIC", rep.verdict);
    ok("report names the serial", rep.serial === serial);
    ok("report carries the frozen signer roster",
      Array.isArray(rep.signers) && (rep.signers as unknown[]).length === 2,
      JSON.stringify(rep.signers));

    // ── THE POINT: one byte changes → TAMPERED ──────────────────────────
    const evil = Buffer.from(pdf);
    evil[evil.length - 10] ^= 0x01;
    rep = await verifyBytes(evil);
    ok("ONE flipped byte → not AUTHENTIC", rep.verdict !== "AUTHENTIC", rep.verdict);
    ok("flipped byte reports UNKNOWN (hash no longer matches any seal)",
      rep.verdict === "UNKNOWN", rep.verdict);

    // A realistic attack: edit the payable amount.
    const forged = Buffer.from(
      pdf.toString("utf8").replace("PHP 50,000.00", "PHP 500,000.00"),
    );
    rep = await verifyBytes(forged);
    ok("altered PESO AMOUNT is rejected", rep.verdict !== "AUTHENTIC", rep.verdict);

    // A file we never issued.
    rep = await verifyBytes(Buffer.from("%PDF-1.7 not ours at all"));
    ok("foreign file → UNKNOWN", rep.verdict === "UNKNOWN", rep.verdict);

    // Original still good — verification must not be destructive.
    rep = await verifyBytes(pdf);
    ok("original still AUTHENTIC after the failed checks",
      rep.verdict === "AUTHENTIC", rep.verdict);

    // ── Chain tampering: remove a signature ─────────────────────────────
    // Byte-identical file, but someone deleted an attestation row.
    await prisma.signatureAttestation.delete({ where: { id: a1.id } });
    chain = await verifyChain(doc.id);
    ok("deleting a signature breaks the chain", !chain.intact,
      JSON.stringify(chain.problems));
    rep = await verifyBytes(pdf);
    ok("byte-identical file with a BROKEN CHAIN → TAMPERED",
      rep.verdict === "TAMPERED", `${rep.verdict} ${JSON.stringify(rep.chain)}`);

    // restore so the serial lookup below sees a sane state
    await prisma.signatureAttestation.create({
      data: {
        id: a1.id,
        documentId: a1.documentId,
        userId: a1.userId,
        signingKeyId: a1.signingKeyId,
        slot: a1.slot,
        payload: a1.payload,
        signature: a1.signature,
        prevHash: a1.prevHash,
        signedAt: a1.signedAt,
      },
    });
    chain = await verifyChain(doc.id);
    ok("chain intact again after restore", chain.intact, JSON.stringify(chain.problems));

    // ── Forged attestation payload ──────────────────────────────────────
    const orig = a2.payload;
    await prisma.signatureAttestation.update({
      where: { id: a2.id },
      data: { payload: orig.replace('"slot":1', '"slot":7') },
    });
    chain = await verifyChain(doc.id);
    ok("editing a stored payload makes its signature fail",
      chain.valid < 2, JSON.stringify(chain.problems));
    await prisma.signatureAttestation.update({
      where: { id: a2.id },
      data: { payload: orig },
    });

    // ── Serial lookup ───────────────────────────────────────────────────
    const bySerial = await lookupSerial(serial);
    ok("serial lookup finds the issuance", !!bySerial && bySerial.serial === serial);
    ok("serial lookup exposes the hash for manual comparison",
      bySerial?.sha256 === sealed.sha256);
    const missing = await lookupSerial("GSN-ZZZZ-ZZZZ-ZZZZ");
    ok("unknown serial returns nothing", missing === null);

    // ── Re-issuing the same document ────────────────────────────────────
    const pdf2 = Buffer.concat([pdf, Buffer.from("\n% reissued")]);
    const serial2 = newSerial();
    await seal(doc.id, pdf2, serial2, bob);
    ok("second issuance gets its own serial", serial2 !== serial);
    ok("BOTH issued copies verify AUTHENTIC",
      (await verifyBytes(pdf)).verdict === "AUTHENTIC" &&
        (await verifyBytes(pdf2)).verdict === "AUTHENTIC");
    ok("the two copies are distinguishable by serial",
      (await verifyBytes(pdf)).serial !== (await verifyBytes(pdf2)).serial);
  } catch (e: unknown) {
    fail++;
    console.log(
      "FAIL  threw: " + (e instanceof Error ? (e.stack ?? e.message) : String(e)),
    );
  } finally {
    try {
      if (made.docIds.length) {
        await prisma.documentSeal.deleteMany({
          where: { documentId: { in: made.docIds } },
        });
        await prisma.signatureAttestation.deleteMany({
          where: { documentId: { in: made.docIds } },
        });
        await prisma.document.deleteMany({ where: { id: { in: made.docIds } } });
      }
      if (made.userIds.length) {
        await prisma.signingKey.deleteMany({
          where: { userId: { in: made.userIds } },
        });
        await prisma.user.deleteMany({ where: { id: { in: made.userIds } } });
      }
      if (made.accountIds.length)
        await prisma.account.deleteMany({ where: { id: { in: made.accountIds } } });

      const leftDocs = await prisma.document.count({
        where: { title: { startsWith: `QA Sealed Doc ${TS}` } },
      });
      const leftUsers = await prisma.user.count({
        where: { username: { startsWith: `qa_seal_${TS}_` } },
      });
      console.log(`CLEANUP  leftover docs=${leftDocs} users=${leftUsers}`);
      if (leftDocs || leftUsers) fail++;
    } catch (e: unknown) {
      console.log("CLEANUP FAILED: " + (e instanceof Error ? e.message : e));
      fail++;
    }
    console.log(`\n${pass} passed, ${fail} failed`);
    await prisma.$disconnect();
    process.exit(fail ? 1 : 0);
  }
})();
