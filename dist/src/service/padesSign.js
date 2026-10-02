"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.hasPdfSignature = exports.signingIdentity = exports.padesSign = void 0;
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
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const crypto_1 = __importDefault(require("crypto"));
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
const P12_PATH = process.env.PDF_SIGN_P12_PATH ||
    path_1.default.join(process.cwd(), ".secrets", "doc-signing.p12");
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
/**
 * Create a self-signed document-signing certificate, once.
 *
 * Generated on first use rather than shipped, so the private key never sits
 * in the repository or in an image. It is written to .secrets/ with
 * owner-only permissions, and that directory is gitignored.
 */
const ensureP12 = () => __awaiter(void 0, void 0, void 0, function* () {
    // Supplied identity wins. This is the only branch production should take.
    if (P12_BASE64)
        return Buffer.from(P12_BASE64, "base64");
    if (fs_1.default.existsSync(P12_PATH))
        return fs_1.default.readFileSync(P12_PATH);
    const forge = yield Promise.resolve().then(() => __importStar(require("node-forge")));
    const pki = forge.default.pki;
    // 2048 is the floor most readers accept without complaint; 3072+ costs
    // seconds to generate here and buys nothing a reader checks.
    const keys = pki.rsa.generateKeyPair(2048);
    const cert = pki.createCertificate();
    cert.publicKey = keys.publicKey;
    cert.serialNumber = "01" + crypto_1.default.randomBytes(8).toString("hex");
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
    const p12Asn1 = forge.default.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], P12_PASSPHRASE, { algorithm: "3des" });
    const der = forge.default.asn1.toDer(p12Asn1).getBytes();
    const buf = Buffer.from(der, "binary");
    fs_1.default.mkdirSync(path_1.default.dirname(P12_PATH), { recursive: true });
    fs_1.default.writeFileSync(P12_PATH, buf, { mode: 0o600 });
    console.log(`[pades] generated a self-signed signing certificate at ${P12_PATH} ` +
        `(CN=${SUBJECT.commonName}, valid 10 years)`);
    return buf;
});
/**
 * Sign a finished PDF.
 *
 * Never throws. A document that cannot be PAdES-signed is still a document
 * the office needs, and it still carries the Ed25519 seal — refusing to hand
 * it over would be a worse failure than handing over one reader-unverifiable
 * file. The reason is logged and returned.
 */
const padesSign = (input_1, ...args_1) => __awaiter(void 0, [input_1, ...args_1], void 0, function* (input, opts = {}) {
    if (process.env.PDF_SIGN_DISABLED === "1") {
        return { bytes: input, signed: false, reason: "disabled by env" };
    }
    try {
        const p12 = yield ensureP12();
        const { default: signpdf } = yield Promise.resolve().then(() => __importStar(require("@signpdf/signpdf")));
        const { P12Signer } = yield Promise.resolve().then(() => __importStar(require("@signpdf/signer-p12")));
        const { plainAddPlaceholder } = yield Promise.resolve().then(() => __importStar(require("@signpdf/placeholder-plain")));
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
        });
        const signer = new P12Signer(p12, { passphrase: P12_PASSPHRASE });
        const signed = yield signpdf.sign(withPlaceholder, signer);
        return { bytes: Buffer.from(signed), signed: true };
    }
    catch (e) {
        const reason = e instanceof Error ? e.message : String(e);
        console.warn("[pades] signing skipped:", reason);
        return { bytes: input, signed: false, reason };
    }
});
exports.padesSign = padesSign;
/**
 * A short fingerprint of the signing identity, and where it came from.
 *
 * Exposed on /health/build so a deploy can be checked for the failure this
 * module is most exposed to: an identity that silently changes. If the
 * fingerprint moves between deploys, the key is not being supplied and
 * every batch of documents is being signed by a different stranger.
 */
const signingIdentity = () => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c;
    try {
        const source = P12_BASE64
            ? "env"
            : fs_1.default.existsSync(P12_PATH)
                ? "file"
                : "generated";
        const p12 = yield ensureP12();
        const forge = yield Promise.resolve().then(() => __importStar(require("node-forge")));
        const f = forge.default;
        const asn1 = f.asn1.fromDer(p12.toString("binary"));
        const store = f.pkcs12.pkcs12FromAsn1(asn1, P12_PASSPHRASE);
        const bag = (_a = store.getBags({ bagType: f.pki.oids.certBag })[f.pki.oids.certBag]) === null || _a === void 0 ? void 0 : _a[0];
        const cert = bag === null || bag === void 0 ? void 0 : bag.cert;
        if (!cert)
            return { source, fingerprint: null, subject: null, notAfter: null };
        const der = f.asn1.toDer(f.pki.certificateToAsn1(cert)).getBytes();
        const sha = crypto_1.default
            .createHash("sha256")
            .update(Buffer.from(der, "binary"))
            .digest("hex");
        return {
            source,
            fingerprint: sha.slice(0, 16),
            subject: (_c = (_b = cert.subject.getField("CN")) === null || _b === void 0 ? void 0 : _b.value) !== null && _c !== void 0 ? _c : null,
            notAfter: cert.validity.notAfter.toISOString(),
        };
    }
    catch (_d) {
        return { source: "unavailable", fingerprint: null, subject: null, notAfter: null };
    }
});
exports.signingIdentity = signingIdentity;
/** For diagnostics: does this PDF carry a reader-visible signature? */
const hasPdfSignature = (bytes) => bytes.includes(Buffer.from("/ByteRange")) &&
    bytes.includes(Buffer.from("/Sig"));
exports.hasPdfSignature = hasPdfSignature;
