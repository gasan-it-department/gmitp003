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
exports.newSerial = exports.lookupSerial = exports.verifyBytes = exports.verifyChain = exports.seal = exports.attestQueue = exports.attest = void 0;
const prisma_1 = require("../barrel/prisma");
const docSigning_1 = require("./docSigning");
Object.defineProperty(exports, "newSerial", { enumerable: true, get: function () { return docSigning_1.newSerial; } });
/**
 * Writes one signer's attestation for one document.
 *
 * Idempotent on (documentId, userId, slot): re-signing the same slot returns
 * the existing row rather than forking the hash chain.
 */
const attest = (a) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    const existing = yield prisma_1.prisma.signatureAttestation.findUnique({
        where: {
            documentId_userId_slot: {
                documentId: a.documentId,
                userId: a.userId,
                slot: a.slot,
            },
        },
    });
    if (existing)
        return existing;
    // Chain to whatever was signed last on THIS document.
    const prev = yield prisma_1.prisma.signatureAttestation.findFirst({
        where: { documentId: a.documentId },
        orderBy: [{ slot: "desc" }, { signedAt: "desc" }],
        select: { signature: true },
    });
    const prevHash = prev ? (0, docSigning_1.sha256Hex)(prev.signature) : null;
    const payload = (0, docSigning_1.attestationPayload)({
        documentId: a.documentId,
        userId: a.userId,
        slot: a.slot,
        signedAt: a.signedAt.toISOString(),
        geo: a.geo && a.geo.lat != null && a.geo.lng != null
            ? { lat: a.geo.lat, lng: a.geo.lng, accuracy: (_a = a.geo.accuracy) !== null && _a !== void 0 ? _a : null }
            : null,
        prevHash,
    });
    const { signature, signingKeyId } = yield (0, docSigning_1.signAsUser)(a.userId, payload);
    return prisma_1.prisma.signatureAttestation.create({
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
});
exports.attest = attest;
/**
 * Attests across every document in a signature queue.
 *
 * Best-effort by design: a signing action that already succeeded must not be
 * rolled back because sealing had a problem. A missing attestation degrades
 * verification to "unknown", which is honest; failing the signature would lose
 * the user's actual work.
 */
const attestQueue = (queueRoomId, userId, signedAt, geo) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const docs = yield prisma_1.prisma.document.findMany({
            where: { signatureQueueRoomId: queueRoomId },
            select: { id: true },
        });
        const arr = yield prisma_1.prisma.signatoryArrangement.findFirst({
            where: { signatureQueueRoomId: queueRoomId, userId },
            orderBy: { index: "asc" },
            select: { index: true },
        });
        const slot = (_a = arr === null || arr === void 0 ? void 0 : arr.index) !== null && _a !== void 0 ? _a : 0;
        for (const d of docs) {
            yield (0, exports.attest)({ documentId: d.id, userId, slot, signedAt, geo });
        }
        return docs.length;
    }
    catch (e) {
        console.error("[documentSeal] attestQueue failed (signature itself is unaffected):", e instanceof Error ? e.message : e);
        return 0;
    }
});
exports.attestQueue = attestQueue;
/**
 * Records a seal over the FINAL emitted PDF bytes.
 *
 * Must be called with exactly the bytes handed to the user — hash anything
 * else and every later verification reports a false TAMPERED, which would be
 * worse than having no verifier at all.
 */
const seal = (documentId, bytes, serial, issuedById) => __awaiter(void 0, void 0, void 0, function* () {
    const issuedAt = new Date();
    const hash = (0, docSigning_1.sha256Hex)(bytes);
    const payload = (0, docSigning_1.sealPayload)({
        serial,
        documentId,
        sha256: hash,
        issuedAt: issuedAt.toISOString(),
    });
    const { signature, orgKeyId } = yield (0, docSigning_1.signAsOrg)(payload);
    // Frozen roster: the verifier shows who had signed at issue time even if a
    // user is later renamed, archived or deleted.
    const atts = yield prisma_1.prisma.signatureAttestation.findMany({
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
    const signers = atts.map((x) => {
        var _a, _b, _c, _d, _e, _f, _g;
        return ({
            slot: x.slot,
            userId: x.userId,
            name: `${(_b = (_a = x.user) === null || _a === void 0 ? void 0 : _a.firstName) !== null && _b !== void 0 ? _b : ""} ${(_d = (_c = x.user) === null || _c === void 0 ? void 0 : _c.lastName) !== null && _d !== void 0 ? _d : ""}`.trim() || "—",
            position: (_g = (_f = (_e = x.user) === null || _e === void 0 ? void 0 : _e.Position) === null || _f === void 0 ? void 0 : _f.name) !== null && _g !== void 0 ? _g : null,
            signedAt: x.signedAt.toISOString(),
        });
    });
    yield prisma_1.prisma.documentSeal.create({
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
});
exports.seal = seal;
/** Re-runs every attestation signature and re-walks the hash chain. */
const verifyChain = (documentId) => __awaiter(void 0, void 0, void 0, function* () {
    const atts = yield prisma_1.prisma.signatureAttestation.findMany({
        where: { documentId },
        orderBy: [{ slot: "asc" }, { signedAt: "asc" }],
        include: { signingKey: { select: { publicKey: true } } },
    });
    const problems = [];
    let valid = 0;
    let expectedPrev = null;
    for (const a of atts) {
        if (!(0, docSigning_1.verifyWith)(a.signingKey.publicKey, a.payload, a.signature)) {
            problems.push(`Signature for slot ${a.slot + 1} does not verify.`);
        }
        else {
            valid++;
        }
        if (a.prevHash !== expectedPrev) {
            problems.push(`Signature chain breaks at slot ${a.slot + 1} — a signature may have been removed or reordered.`);
        }
        expectedPrev = (0, docSigning_1.sha256Hex)(a.signature);
    }
    return {
        total: atts.length,
        valid,
        intact: problems.length === 0,
        problems,
    };
});
exports.verifyChain = verifyChain;
/**
 * The core question: is this file the one we issued?
 *
 * Matching is by hash, so it needs no metadata from the file itself and works
 * even if the PDF was renamed or re-saved with different metadata.
 */
const verifyBytes = (bytes) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    const hash = (0, docSigning_1.sha256Hex)(bytes);
    const hit = yield prisma_1.prisma.documentSeal.findFirst({
        where: { sha256: hash },
        orderBy: { issuedAt: "desc" },
        include: { document: { select: { title: true } } },
    });
    if (hit) {
        const chain = yield (0, exports.verifyChain)(hit.documentId);
        // Byte-identical but a broken chain still is NOT clean.
        const verdict = chain.intact ? "AUTHENTIC" : "TAMPERED";
        return {
            verdict,
            message: chain.intact
                ? "This document is authentic and has not been altered since it was issued."
                : "The file matches an issued document, but its signature chain is broken.",
            sha256: hash,
            serial: hit.serial,
            documentTitle: (_b = (_a = hit.document) === null || _a === void 0 ? void 0 : _a.title) !== null && _b !== void 0 ? _b : null,
            issuedAt: hit.issuedAt.toISOString(),
            byteSize: hit.byteSize,
            signers: hit.signers,
            chain,
        };
    }
    return {
        verdict: "UNKNOWN",
        message: "No issued document matches this file. It was not produced by this system, " +
            "or it has been modified since it was issued.",
        sha256: hash,
    };
});
exports.verifyBytes = verifyBytes;
/**
 * Verification by serial, for the QR / typed-code path.
 *
 * Deliberately cannot return AUTHENTIC: knowing a serial says nothing about
 * the bytes in front of you. It reports what WAS issued so a human can compare,
 * and tells them to upload the file for a real answer.
 */
const lookupSerial = (serial) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    const s = yield prisma_1.prisma.documentSeal.findUnique({
        where: { serial },
        include: { document: { select: { title: true } } },
    });
    if (!s)
        return null;
    const chain = yield (0, exports.verifyChain)(s.documentId);
    return {
        serial: s.serial,
        documentTitle: (_b = (_a = s.document) === null || _a === void 0 ? void 0 : _a.title) !== null && _b !== void 0 ? _b : null,
        issuedAt: s.issuedAt.toISOString(),
        sha256: s.sha256,
        byteSize: s.byteSize,
        signers: s.signers,
        chain,
    };
});
exports.lookupSerial = lookupSerial;
