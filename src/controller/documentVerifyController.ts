import { FastifyRequest, FastifyReply } from "../barrel/fastify";
import { ValidationError } from "../errors/errors";
import { lookupSerial, verifyBytes } from "../service/documentSeal";
import { getOrgKey } from "../service/docSigning";

/**
 * Public document verification.
 *
 * Deliberately UNAUTHENTICATED. The whole point is that someone outside the
 * LGU — a supplier, an auditor, a citizen handed a permit — can check a
 * document without an account. Nothing here reveals document contents: you
 * only learn whether a file you already possess is the one that was issued.
 */

/**
 * POST /document/verify-file  (multipart, field name: "file")
 *
 * Hashes the uploaded bytes and looks for a matching seal.
 */
export const verifyFile = async (req: FastifyRequest, res: FastifyReply) => {
  const mp = await (req as unknown as {
    file: () => Promise<{ toBuffer: () => Promise<Buffer>; filename?: string } | undefined>;
  }).file();

  if (!mp) throw new ValidationError("Attach the PDF you want to verify.");

  const bytes = await mp.toBuffer();
  if (!bytes?.length) throw new ValidationError("That file is empty.");

  // 40 MB ceiling — a signed municipal document is nowhere near this, and an
  // unauthenticated endpoint should not hash arbitrarily large uploads.
  if (bytes.length > 40 * 1024 * 1024) {
    throw new ValidationError("File is too large to verify (max 40 MB).");
  }

  const report = await verifyBytes(bytes);
  return res.code(200).send({ ...report, filename: mp.filename ?? null });
};

/**
 * GET /document/verify-seal/:serial
 *
 * The QR / typed-code path. Reports what WAS issued under that serial.
 *
 * Cannot and does not return AUTHENTIC: a serial says nothing about the bytes
 * in the reader's hand. Claiming otherwise would be the exact false assurance
 * this feature exists to remove — the old QR did precisely that.
 */
export const verifySeal = async (req: FastifyRequest, res: FastifyReply) => {
  const { serial } = req.params as { serial: string };
  if (!serial) throw new ValidationError("Missing serial.");

  const found = await lookupSerial(serial.trim().toUpperCase());
  if (!found) {
    return res.code(404).send({
      found: false,
      message: "No document has been issued under this serial.",
    });
  }

  return res.code(200).send({
    found: true,
    ...found,
    notice:
      "This shows what was issued under this serial. To confirm the copy you " +
      "are holding has not been altered, upload the file itself.",
  });
};

/**
 * GET /document/verify-key
 *
 * Publishes the Municipality's public key so a third party can verify seals
 * independently, without trusting this API to answer honestly.
 */
export const verifyPublicKey = async (
  _req: FastifyRequest,
  res: FastifyReply,
) => {
  const key = await getOrgKey();
  return res.code(200).send({
    algorithm: "ed25519",
    publicKey: key.publicKey,
    keyId: key.id,
    format: "spki-der-base64",
    note:
      "Seal payloads are canonical JSON: " +
      '{"documentId":…,"issuedAt":…,"kind":"gasan.document.seal","serial":…,"sha256":…,"v":1} ' +
      "with keys sorted, signed with this key.",
  });
};
