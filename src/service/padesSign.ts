/**
 * PAdES signing — the signature a PDF reader can actually see.
 *
 * The existing seal (documentSeal.ts) is sound: SHA-256 over the emitted
 * bytes, signed with the organisation's Ed25519 key, with the signer roster
 * frozen at issue time. But it lives in OUR database and is checkable only
 * through OUR verifier. To Foxit, Acrobat or Edge a sealed document is an
 * ordinary PDF with a picture of a signature on it — there is no /AcroForm,
 * no /ByteRange, no PKCS#7, so there is nothing for a reader to find.
 *
 * This adds the thing readers look for: an ISO 32000 signature dictionary
 * holding a detached PKCS#7 over a byte range of the file. The two
 * mechanisms are complementary and both are kept —
 *
 *   PAdES  : any reader, anywhere, with no access to us. Proves the bytes
 *            have not changed since signing, and names the signer.
 *   Ed25519: our verifier only, but carries the full signatory roster,
 *            positions and timestamps, which a PKCS#7 has no room for.
 *
 * ORDER MATTERS. The PAdES signature is applied BEFORE seal() runs, because
 * signing rewrites the file; sealing first would hash bytes that are then
 * thrown away and every later verification would report a false TAMPERED.
 *
 * ── On trust ──────────────────────────────────────────────────────────────
 * The certificate here is SELF-SIGNED. Readers will therefore report the
 * signature as cryptographically valid but the signer as unverified — a
 * warning triangle, not a green tick. That is the honest state of affairs:
 * a green tick requires a certificate chaining to a root the reader already
 * trusts (Adobe's AATL, or one pushed to machines by Group Policy), which is
 * a procurement decision, not a code change. Nothing here needs to change
 * when such a certificate arrives: drop a real .p12 in and set the env vars.
 */
import fs from "fs";
import path from "path";
import crypto from "crypto";

/**
 * Where the signing identity lives.
 *
 * PDF_SIGN_P12_BASE64 comes first and is what production must use, because
 * Railway's container filesystem is EPHEMERAL. A key generated on first use
 * and written to disk does not survive a restart, so every deploy would mint
 * a new signing identity: documents signed last month would name a different
 * signer from this month's, and there would be nothing stable for anyone to
 * ever decide to trust. An environment variable survives restarts; a file in
 * the container does not.
 *
 * The file path and on-demand generation remain, for local development.
 */
const P12_BASE64 = process.env.PDF_SIGN_P12_BASE64 || "";
const P12_PATH =
  process.env.PDF_SIGN_P12_PATH ||
  path.join(process.cwd(), ".secrets", "doc-signing.p12");
const P12_PASSPHRASE = process.env.PDF_SIGN_P12_PASSPHRASE || "";

/** What the certificate claims about who signed. */
const SUBJECT = {
  commonName: process.env.PDF_SIGN_CN || "Municipality of Gasan",
  organizationName: process.env.PDF_SIGN_O || "Municipality of Gasan, Marinduque",
  organizationalUnitName: process.env.PDF_SIGN_OU || "Document Management",
  countryName: process.env.PDF_SIGN_C || "PH",
  stateOrProvinceName: process.env.PDF_SIGN_ST || "Marinduque",
  localityName: process.env.PDF_SIGN_L || "Gasan",
};

export interface SignOutcome {
  bytes: Buffer;
  signed: boolean;
  /** Why it was not signed, when it was not. Surfaced in logs, never thrown. */
  reason?: string;
}

/**
 * Create a self-signed document-signing certificate, once.
 *
 * Generated on first use rather than shipped, so the private key never sits
 * in the repository or in an image. It is written to .secrets/ with
 * owner-only permissions, and that directory is gitignored.
 */
const ensureP12 = async (): Promise<Buffer> => {
  /*
    Supplied identity wins. This is the only branch production should take.

    Whitespace is stripped first: a 3,400-character single line pasted into
    a dashboard textarea very often comes back with newlines in it, and
    Buffer.from silently ignores the invalid characters — producing a
    SHORTER, corrupt key rather than an error, which then fails somewhere
    far less obvious.
  */
  if (P12_BASE64) {
    const cleaned = P12_BASE64.replace(/\s+/g, "");
    const buf = Buffer.from(cleaned, "base64");
    if (buf.length < 500) {
      throw new Error(
        `PDF_SIGN_P12_BASE64 decoded to only ${buf.length} bytes from ` +
          `${cleaned.length} base64 chars — it looks truncated or mangled.`,
      );
    }
    return buf;
  }
  if (fs.existsSync(P12_PATH)) return fs.readFileSync(P12_PATH);

  const forge = await import("node-forge");
  const pki = forge.default.pki;

  // 2048 is the floor most readers accept without complaint; 3072+ costs
  // seconds to generate here and buys nothing a reader checks.
  const keys = pki.rsa.generateKeyPair(2048);
  const cert = pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = "01" + crypto.randomBytes(8).toString("hex");
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date();
  // Ten years: re-issuing is a manual act nobody will remember to do, and a
  // lapsed certificate makes every previously signed document look broken.
  cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 10);

  const attrs = [
    { name: "commonName", value: SUBJECT.commonName },
    { name: "countryName", value: SUBJECT.countryName },
    { shortName: "ST", value: SUBJECT.stateOrProvinceName },
    { name: "localityName", value: SUBJECT.localityName },
    { name: "organizationName", value: SUBJECT.organizationName },
    { shortName: "OU", value: SUBJECT.organizationalUnitName },
  ];
  cert.setSubject(attrs);
  cert.setIssuer(attrs); // self-signed: subject is its own issuer
  cert.setExtensions([
    { name: "basicConstraints", cA: false },
    {
      name: "keyUsage",
      digitalSignature: true,
      nonRepudiation: true,
      keyEncipherment: false,
      dataEncipherment: false,
    },
    // Without this a reader may accept the maths and still refuse to treat
    // the certificate as a DOCUMENT signing identity.
    { name: "extKeyUsage", emailProtection: true, codeSigning: false },
  ]);
  cert.sign(keys.privateKey, forge.default.md.sha256.create());

  const p12Asn1 = forge.default.pkcs12.toPkcs12Asn1(
    keys.privateKey,
    [cert],
    P12_PASSPHRASE,
    { algorithm: "3des" },
  );
  const der = forge.default.asn1.toDer(p12Asn1).getBytes();
  const buf = Buffer.from(der, "binary");

  fs.mkdirSync(path.dirname(P12_PATH), { recursive: true });
  fs.writeFileSync(P12_PATH, buf, { mode: 0o600 });
  console.log(
    `[pades] generated a self-signed signing certificate at ${P12_PATH} ` +
      `(CN=${SUBJECT.commonName}, valid 10 years)`,
  );
  return buf;
};

/**
 * Sign a finished PDF.
 *
 * Never throws. A document that cannot be PAdES-signed is still a document
 * the office needs, and it still carries the Ed25519 seal — refusing to hand
 * it over would be a worse failure than handing over one reader-unverifiable
 * file. The reason is logged and returned.
 */
export const padesSign = async (
  input: Buffer,
  opts: {
    reason?: string;
    location?: string;
    contactInfo?: string;
    /**
     * Where the clickable signature sits on page 1, in PDF points with the
     * origin bottom-left: [x1, y1, x2, y2].
     *
     * Without this the library writes /Rect [0 0 0 0] and no appearance
     * stream, which is a perfectly valid INVISIBLE signature — it validates,
     * it appears in the Signature Panel, and there is nothing on the page to
     * click. That is indistinguishable, to anyone opening the file, from the
     * signature having failed.
     */
    widgetRect?: [number, number, number, number];
  } = {},
): Promise<SignOutcome> => {
  if (process.env.PDF_SIGN_DISABLED === "1") {
    return { bytes: input, signed: false, reason: "disabled by env" };
  }
  try {
    const p12 = await ensureP12();

    const { default: signpdf } = await import("@signpdf/signpdf");
    const { P12Signer } = await import("@signpdf/signer-p12");
    const { plainAddPlaceholder } = await import("@signpdf/placeholder-plain");

    /*
      The placeholder reserves the bytes the signature will occupy and
      declares the /ByteRange around them. It has to go in BEFORE hashing —
      that is the whole mechanism: the digest covers the file either side of
      the hole the signature then fills.
    */
    const withPlaceholder = plainAddPlaceholder({
      pdfBuffer: input,
      reason: opts.reason || "Signed in the Gasan Document Management System",
      location: opts.location || "Gasan, Marinduque, Philippines",
      contactInfo: opts.contactInfo || "",
      name: SUBJECT.organizationName,
      signatureLength: 8192,
      // A modest strip at the foot of page 1. Deliberately NOT placed over
      // an individual's drawn signature: this is the organisation attesting
      // to the whole file, not a second copy of one person's mark.
      widgetRect: opts.widgetRect ?? [28, 22, 250, 48],
      appName: "Gasan Document Management System",
    });

    const signer = new P12Signer(p12, { passphrase: P12_PASSPHRASE });
    const signed = await signpdf.sign(withPlaceholder, signer);
    return { bytes: Buffer.from(signed), signed: true };
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    console.warn("[pades] signing skipped:", reason);
    return { bytes: input, signed: false, reason };
  }
};

/**
 * A short fingerprint of the signing identity, and where it came from.
 *
 * Exposed on /health/build so a deploy can be checked for the failure this
 * module is most exposed to: an identity that silently changes. If the
 * fingerprint moves between deploys, the key is not being supplied and
 * every batch of documents is being signed by a different stranger.
 */
export const signingIdentity = async (): Promise<{
  source: "env" | "file" | "generated" | "unavailable";
  fingerprint: string | null;
  subject: string | null;
  notAfter: string | null;
  error?: string;
  base64Chars?: number;
  hasPassphrase?: boolean;
}> => {
  try {
    const source: "env" | "file" | "generated" = P12_BASE64
      ? "env"
      : fs.existsSync(P12_PATH)
        ? "file"
        : "generated";
    const p12 = await ensureP12();
    const forge = await import("node-forge");
    const f = forge.default;
    const asn1 = f.asn1.fromDer(p12.toString("binary"));
    const store = f.pkcs12.pkcs12FromAsn1(asn1, P12_PASSPHRASE);
    const bag = store.getBags({ bagType: f.pki.oids.certBag })[
      f.pki.oids.certBag as unknown as string
    ]?.[0];
    const cert = bag?.cert;
    if (!cert) return { source, fingerprint: null, subject: null, notAfter: null };
    const der = f.asn1.toDer(f.pki.certificateToAsn1(cert)).getBytes();
    const sha = crypto
      .createHash("sha256")
      .update(Buffer.from(der, "binary"))
      .digest("hex");
    return {
      source,
      fingerprint: sha.slice(0, 16),
      subject: cert.subject.getField("CN")?.value ?? null,
      notAfter: cert.validity.notAfter.toISOString(),
    };
  } catch (e) {
    /*
      "unavailable" on its own is a shrug. The whole point of putting this on
      the health endpoint is to make a silent failure diagnosable without a
      shell on the box, so it has to carry the reason and enough shape to
      tell a mangled paste from a wrong passphrase.
    */
    return {
      source: "unavailable",
      fingerprint: null,
      subject: null,
      notAfter: null,
      error: e instanceof Error ? e.message : String(e),
      base64Chars: P12_BASE64 ? P12_BASE64.replace(/\s+/g, "").length : 0,
      hasPassphrase: P12_PASSPHRASE.length > 0,
    } as never;
  }
};

/** For diagnostics: does this PDF carry a reader-visible signature? */
export const hasPdfSignature = (bytes: Buffer): boolean =>
  bytes.includes(Buffer.from("/ByteRange")) &&
  bytes.includes(Buffer.from("/Sig"));
