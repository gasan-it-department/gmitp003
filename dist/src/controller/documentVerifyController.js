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
exports.verifyPublicKey = exports.verifySeal = exports.verifyFile = void 0;
const errors_1 = require("../errors/errors");
const documentSeal_1 = require("../service/documentSeal");
const docSigning_1 = require("../service/docSigning");
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
const verifyFile = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    const mp = yield req.file();
    if (!mp)
        throw new errors_1.ValidationError("Attach the PDF you want to verify.");
    const bytes = yield mp.toBuffer();
    if (!(bytes === null || bytes === void 0 ? void 0 : bytes.length))
        throw new errors_1.ValidationError("That file is empty.");
    // 40 MB ceiling — a signed municipal document is nowhere near this, and an
    // unauthenticated endpoint should not hash arbitrarily large uploads.
    if (bytes.length > 40 * 1024 * 1024) {
        throw new errors_1.ValidationError("File is too large to verify (max 40 MB).");
    }
    const report = yield (0, documentSeal_1.verifyBytes)(bytes);
    return res.code(200).send(Object.assign(Object.assign({}, report), { filename: (_a = mp.filename) !== null && _a !== void 0 ? _a : null }));
});
exports.verifyFile = verifyFile;
/**
 * GET /document/verify-seal/:serial
 *
 * The QR / typed-code path. Reports what WAS issued under that serial.
 *
 * Cannot and does not return AUTHENTIC: a serial says nothing about the bytes
 * in the reader's hand. Claiming otherwise would be the exact false assurance
 * this feature exists to remove — the old QR did precisely that.
 */
const verifySeal = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { serial } = req.params;
    if (!serial)
        throw new errors_1.ValidationError("Missing serial.");
    const found = yield (0, documentSeal_1.lookupSerial)(serial.trim().toUpperCase());
    if (!found) {
        return res.code(404).send({
            found: false,
            message: "No document has been issued under this serial.",
        });
    }
    return res.code(200).send(Object.assign(Object.assign({ found: true }, found), { notice: "This shows what was issued under this serial. To confirm the copy you " +
            "are holding has not been altered, upload the file itself." }));
});
exports.verifySeal = verifySeal;
/**
 * GET /document/verify-key
 *
 * Publishes the Municipality's public key so a third party can verify seals
 * independently, without trusting this API to answer honestly.
 */
const verifyPublicKey = (_req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const key = yield (0, docSigning_1.getOrgKey)();
    return res.code(200).send({
        algorithm: "ed25519",
        publicKey: key.publicKey,
        keyId: key.id,
        format: "spki-der-base64",
        note: "Seal payloads are canonical JSON: " +
            '{"documentId":…,"issuedAt":…,"kind":"gasan.document.seal","serial":…,"sha256":…,"v":1} ' +
            "with keys sorted, signed with this key.",
    });
});
exports.verifyPublicKey = verifyPublicKey;
