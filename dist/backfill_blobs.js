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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
/* Move file bytes out of Postgres and into the bucket.
 *
 *   npx ts-node --transpile-only backfill_blobs.ts            # report only
 *   npx ts-node --transpile-only backfill_blobs.ts --run      # do it
 *   npx ts-node --transpile-only backfill_blobs.ts --verify   # re-check
 *
 * Deliberately conservative, because this moves municipal records:
 *
 *   - NOTHING is deleted. The Bytes column is left exactly as it was; the
 *     row only gains a storageKey. Dropping the columns is a later,
 *     separate decision made once the bucket has proven itself in use.
 *   - Every upload is read back and compared BYTE FOR BYTE before the row
 *     is marked as migrated. A storageKey that points at a corrupt object
 *     is worse than no storageKey, because reads would prefer it.
 *   - Re-runnable. Rows already migrated and verified are skipped, so an
 *     interrupted run is resumed by running it again.
 */
const path_1 = __importDefault(require("path"));
const entry = path_1.default.join(process.cwd(), "src", "index.ts");
require.cache[entry] = {
    id: entry, filename: entry, loaded: true,
    exports: { notificationSocket: { emitUserNotification: () => undefined } },
};
const prisma_1 = require("./src/barrel/prisma");
const blobStore_1 = require("./src/service/blobStore");
const RUN = process.argv.includes("--run");
const VERIFY_ONLY = process.argv.includes("--verify");
const mb = (n) => `${(n / 1024 / 1024).toFixed(1)} MB`;
const targets = [
    {
        model: "DecodedFile", column: "fileDecoded", kind: "document", ext: "pdf",
        pending: () => __awaiter(void 0, void 0, void 0, function* () {
            return (yield prisma_1.prisma.decodedFile.findMany({
                where: { fileDecoded: { not: null }, storageKey: null },
                select: { id: true, fileDecoded: true },
            })).map((r) => ({ id: r.id, bytes: r.fileDecoded ? Buffer.from(r.fileDecoded) : null }));
        }),
        mark: (id, key, digest) => __awaiter(void 0, void 0, void 0, function* () {
            yield prisma_1.prisma.decodedFile.update({
                where: { id }, data: { storageKey: key, storageSha256: digest },
            });
        }),
        migrated: () => __awaiter(void 0, void 0, void 0, function* () {
            return prisma_1.prisma.decodedFile.findMany({
                where: { storageKey: { not: null } },
                select: { id: true, storageKey: true, storageSha256: true },
            });
        }),
    },
    {
        model: "Signature", column: "signature", kind: "signature", ext: "png",
        pending: () => __awaiter(void 0, void 0, void 0, function* () {
            return (yield prisma_1.prisma.signature.findMany({
                where: { signature: { not: null }, storageKey: null },
                select: { id: true, signature: true },
            })).map((r) => ({ id: r.id, bytes: r.signature ? Buffer.from(r.signature) : null }));
        }),
        mark: (id, key, digest) => __awaiter(void 0, void 0, void 0, function* () {
            yield prisma_1.prisma.signature.update({
                where: { id }, data: { storageKey: key, storageSha256: digest },
            });
        }),
        migrated: () => __awaiter(void 0, void 0, void 0, function* () {
            return prisma_1.prisma.signature.findMany({
                where: { storageKey: { not: null } },
                select: { id: true, storageKey: true, storageSha256: true },
            });
        }),
    },
    {
        model: "UserProfilePicture", column: "bytes", kind: "profile", ext: "jpg",
        pending: () => __awaiter(void 0, void 0, void 0, function* () {
            return (yield prisma_1.prisma.userProfilePicture.findMany({
                where: { bytes: { not: null }, storageKey: null },
                select: { id: true, bytes: true },
            })).map((r) => ({ id: r.id, bytes: r.bytes ? Buffer.from(r.bytes) : null }));
        }),
        mark: (id, key, digest) => __awaiter(void 0, void 0, void 0, function* () {
            yield prisma_1.prisma.userProfilePicture.update({
                where: { id }, data: { storageKey: key, storageSha256: digest },
            });
        }),
        migrated: () => __awaiter(void 0, void 0, void 0, function* () {
            return prisma_1.prisma.userProfilePicture.findMany({
                where: { storageKey: { not: null } },
                select: { id: true, storageKey: true, storageSha256: true },
            });
        }),
    },
];
(() => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c;
    const status = yield (0, blobStore_1.blobStoreStatus)();
    console.log("\n── object storage ──");
    console.log("  configured :", status.configured);
    console.log("  reachable  :", status.reachable, status.error ? `(${status.error})` : "");
    console.log("  bucket     :", (_a = status.bucket) !== null && _a !== void 0 ? _a : "—");
    if (!(0, blobStore_1.blobStoreConfigured)() || !status.reachable) {
        console.log("\nThe bucket is not usable yet, so nothing was moved. Set " +
            "BUCKET_ENDPOINT / BUCKET_ACCESS_KEY / BUCKET_SECRET_KEY / BUCKET_NAME.");
        yield prisma_1.prisma.$disconnect();
        process.exitCode = 1;
        return;
    }
    // ── Verify what has already been moved ─────────────────────────────
    console.log("\n── already migrated ──");
    let verifiedOk = 0, verifiedBad = 0;
    for (const t of targets) {
        const rows = yield t.migrated();
        for (const r of rows) {
            const obj = yield (0, blobStore_1.getBlob)(r.storageKey);
            const ok = !!obj && (!r.storageSha256 || (0, blobStore_1.sha256)(obj) === r.storageSha256);
            if (ok)
                verifiedOk++;
            else {
                verifiedBad++;
                console.log(`  MISMATCH  ${t.model} ${r.id} -> ${r.storageKey}`);
            }
        }
        if (rows.length)
            console.log(`  ${t.model}: ${rows.length} checked`);
    }
    console.log(`  verified ok: ${verifiedOk}   FAILED: ${verifiedBad}`);
    if (VERIFY_ONLY) {
        yield prisma_1.prisma.$disconnect();
        process.exitCode = verifiedBad === 0 ? 0 : 1;
        return;
    }
    // ── Move what is left ──────────────────────────────────────────────
    console.log(`\n── to move ──${RUN ? "" : "   (dry run — pass --run to do it)"}`);
    let moved = 0, failed = 0, bytes = 0;
    for (const t of targets) {
        const rows = yield t.pending();
        const size = rows.reduce((a, r) => { var _a, _b; return a + ((_b = (_a = r.bytes) === null || _a === void 0 ? void 0 : _a.length) !== null && _b !== void 0 ? _b : 0); }, 0);
        if (!rows.length) {
            console.log(`  ${t.model}: nothing pending`);
            continue;
        }
        console.log(`  ${t.model}: ${rows.length} rows, ${mb(size)}`);
        if (!RUN)
            continue;
        for (const r of rows) {
            if (!((_b = r.bytes) === null || _b === void 0 ? void 0 : _b.length))
                continue;
            const key = (0, blobStore_1.keyFor)(t.kind, r.id, t.ext);
            try {
                const put = yield (0, blobStore_1.putBlob)(key, r.bytes);
                // Read it back before trusting it. An upload that reports success
                // and stores something else is exactly the failure this guards.
                const back = yield (0, blobStore_1.getBlob)(key);
                if (!back || !back.equals(r.bytes)) {
                    failed++;
                    console.log(`    FAIL  ${r.id} — read-back did not match (${(_c = back === null || back === void 0 ? void 0 : back.length) !== null && _c !== void 0 ? _c : 0}/${r.bytes.length} bytes)`);
                    continue;
                }
                yield t.mark(r.id, key, put.sha256);
                moved++;
                bytes += r.bytes.length;
                console.log(`    ok    ${r.id} -> ${key} (${mb(r.bytes.length)})`);
            }
            catch (e) {
                failed++;
                console.log(`    FAIL  ${r.id} — ${e instanceof Error ? e.message : e}`);
            }
        }
    }
    if (RUN) {
        console.log(`\nmoved ${moved} objects (${mb(bytes)}), ${failed} failed`);
        console.log("The Bytes columns are untouched. Reads prefer the bucket and fall " +
            "back to them, so nothing has to be done in a hurry.");
    }
    yield prisma_1.prisma.$disconnect();
    process.exitCode = failed === 0 ? 0 : 1;
}))();
