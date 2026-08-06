import { prisma } from "../barrel/prisma";
import {
  attestationPayload,
  newSerial,
  sealPayload,
  sha256Hex,
  signAsOrg,
  signAsUser,
  verifyWith,
} from "./docSigning";

/**
 * Binds signatures to document CONTENT.
 *
 * Two distinct operations:
 *   - `attest`  — at the moment a person signs, record a signature over
 *                 {document, signer, slot, time, geo, prevHash}. Chained, so
 *                 removing or reordering signatures is detectable.
 *   - `seal`    — when the signed PDF is generated for download, hash the
 *                 exact emitted bytes and sign that hash with the org key.
 *                 This is what makes "has this file been altered?" answerable.
 */

// ── Attestation ────────────────────────────────────────────────────────────
export interface AttestArgs {
  documentId: string;
  userId: string;
  slot: number;
  signedAt: Date;
  geo?: { lat: number; lng: number; accuracy?: number | null } | null;
}

/**
 * Writes one signer's attestation for one document.
 *
 * Idempotent on (documentId, userId, slot): re-signing the same slot returns
 * the existing row rather than forking the hash chain.
 */
export const attest = async (a: AttestArgs) => {
  const existing = await prisma.signatureAttestation.findUnique({
    where: {
      documentId_userId_slot: {
        documentId: a.documentId,
        userId: a.userId,
        slot: a.slot,
      },
    },
  });
  if (existing) return existing;

  // Chain to whatever was signed last on THIS document.
  const prev = await prisma.signatureAttestation.findFirst({
    where: { documentId: a.documentId },
    orderBy: [{ slot: "desc" }, { signedAt: "desc" }],
    select: { signature: true },
  });
  const prevHash = prev ? sha256Hex(prev.signature) : null;

  const payload = attestationPayload({
    documentId: a.documentId,
    userId: a.userId,
    slot: a.slot,
    signedAt: a.signedAt.toISOString(),
    geo:
      a.geo && a.geo.lat != null && a.geo.lng != null
        ? { lat: a.geo.lat, lng: a.geo.lng, accuracy: a.geo.accuracy ?? null }
        : null,
    prevHash,
  });

  const { signature, signingKeyId } = await signAsUser(a.userId, payload);

  return prisma.signatureAttestation.create({
    data: {
      documentId: a.documentId,
      userId: a.userId,
      signingKeyId,
      slot: a.slot,
      payload,
      signature,
      prevHash,
      signedAt: a.signedAt,
    },
  });
};

/**
 * Attests across every document in a signature queue.
 *
 * Best-effort by design: a signing action that already succeeded must not be
 * rolled back because sealing had a problem. A missing attestation degrades
 * verification to "unknown", which is honest; failing the signature would lose
 * the user's actual work.
 */
export const attestQueue = async (
  queueRoomId: string,
  userId: string,
  signedAt: Date,
  geo?: { lat: number; lng: number; accuracy?: number | null } | null,
) => {
  try {
    const docs = await prisma.document.findMany({
      where: { signatureQueueRoomId: queueRoomId },
      select: { id: true },
    });
    const arr = await prisma.signatoryArrangement.findFirst({
      where: { signatureQueueRoomId: queueRoomId, userId },
      orderBy: { index: "asc" },
      select: { index: true },
    });
    const slot = arr?.index ?? 0;
    for (const d of docs) {
      await attest({ documentId: d.id, userId, slot, signedAt, geo });
    }
    return docs.length;
  } catch (e) {
    console.error(
      "[documentSeal] attestQueue failed (signature itself is unaffected):",
      e instanceof Error ? e.message : e,
    );
    return 0;
  }
};

// ── Sealing ────────────────────────────────────────────────────────────────
export interface SealResult {
  serial: string;
  sha256: string;
  issuedAt: Date;
}

/**
 * Records a seal over the FINAL emitted PDF bytes.
 *
 * Must be called with exactly the bytes handed to the user — hash anything
 * else and every later verification reports a false TAMPERED, which would be
 * worse than having no verifier at all.
 */
export const seal = async (
  documentId: string,
  bytes: Buffer,
  serial: string,
  issuedById: string | null,
): Promise<SealResult> => {
  const issuedAt = new Date();
  const hash = sha256Hex(bytes);
  const payload = sealPayload({
    serial,
    documentId,
    sha256: hash,
    issuedAt: issuedAt.toISOString(),
  });
  const { signature, orgKeyId } = await signAsOrg(payload);

  // Frozen roster: the verifier shows who had signed at issue time even if a
  // user is later renamed, archived or deleted.
  const atts = await prisma.signatureAttestation.findMany({
    where: { documentId },
    orderBy: { slot: "asc" },
    include: {
      user: {
        select: {
          firstName: true,
          lastName: true,
          Position: { select: { name: true } },
        },
      },
    },
  });
  const signers = atts.map((x) => ({
    slot: x.slot,
    userId: x.userId,
    name: `${x.user?.firstName ?? ""} ${x.user?.lastName ?? ""}`.trim() || "—",
    position: x.user?.Position?.name ?? null,
    signedAt: x.signedAt.toISOString(),
  }));

  await prisma.documentSeal.create({
    data: {
      serial,
      documentId,
      sha256: hash,
      orgSignature: signature,
      orgKeyId,
      signers,
      issuedById,
      issuedAt,
      byteSize: bytes.length,
    },
  });

  return { serial, sha256: hash, issuedAt };
};

// ── Verification ───────────────────────────────────────────────────────────
export type Verdict = "AUTHENTIC" | "TAMPERED" | "UNKNOWN";

export interface VerifyReport {
  verdict: Verdict;
  message: string;
  sha256: string;
  serial?: string;
  documentTitle?: string | null;
  issuedAt?: string;
  byteSize?: number;
  signers?: unknown;
  /** Per-signature checks — a document can be byte-identical yet have a
   *  broken signature chain, so these are reported separately. */
  chain?: {
    total: number;
    valid: number;
    intact: boolean;
    problems: string[];
  };
}

/** Re-runs every attestation signature and re-walks the hash chain. */
export const verifyChain = async (documentId: string) => {
  const atts = await prisma.signatureAttestation.findMany({
    where: { documentId },
    orderBy: [{ slot: "asc" }, { signedAt: "asc" }],
    include: { signingKey: { select: { publicKey: true } } },
  });

  const problems: string[] = [];
  let valid = 0;
  let expectedPrev: string | null = null;

  for (const a of atts) {
    if (!verifyWith(a.signingKey.publicKey, a.payload, a.signature)) {
      problems.push(`Signature for slot ${a.slot + 1} does not verify.`);
    } else {
      valid++;
    }
    if (a.prevHash !== expectedPrev) {
      problems.push(
        `Signature chain breaks at slot ${a.slot + 1} — a signature may have been removed or reordered.`,
      );
    }
    expectedPrev = sha256Hex(a.signature);
  }

  return {
    total: atts.length,
    valid,
    intact: problems.length === 0,
    problems,
  };
};

/**
 * The core question: is this file the one we issued?
 *
 * Matching is by hash, so it needs no metadata from the file itself and works
 * even if the PDF was renamed or re-saved with different metadata.
 */
export const verifyBytes = async (bytes: Buffer): Promise<VerifyReport> => {
  const hash = sha256Hex(bytes);

  const hit = await prisma.documentSeal.findFirst({
    where: { sha256: hash },
    orderBy: { issuedAt: "desc" },
    include: { document: { select: { title: true } } },
  });

  if (hit) {
    const chain = await verifyChain(hit.documentId);
    // Byte-identical but a broken chain still is NOT clean.
    const verdict: Verdict = chain.intact ? "AUTHENTIC" : "TAMPERED";
    return {
      verdict,
      message: chain.intact
        ? "This document is authentic and has not been altered since it was issued."
        : "The file matches an issued document, but its signature chain is broken.",
      sha256: hash,
      serial: hit.serial,
      documentTitle: hit.document?.title ?? null,
      issuedAt: hit.issuedAt.toISOString(),
      byteSize: hit.byteSize,
      signers: hit.signers,
      chain,
    };
  }

  return {
    verdict: "UNKNOWN",
    message:
      "No issued document matches this file. It was not produced by this system, " +
      "or it has been modified since it was issued.",
    sha256: hash,
  };
};

/**
 * Verification by serial, for the QR / typed-code path.
 *
 * Deliberately cannot return AUTHENTIC: knowing a serial says nothing about
 * the bytes in front of you. It reports what WAS issued so a human can compare,
 * and tells them to upload the file for a real answer.
 */
export const lookupSerial = async (serial: string) => {
  const s = await prisma.documentSeal.findUnique({
    where: { serial },
    include: { document: { select: { title: true } } },
  });
  if (!s) return null;
  const chain = await verifyChain(s.documentId);
  return {
    serial: s.serial,
    documentTitle: s.document?.title ?? null,
    issuedAt: s.issuedAt.toISOString(),
    sha256: s.sha256,
    byteSize: s.byteSize,
    signers: s.signers,
    chain,
  };
};

export { newSerial };
