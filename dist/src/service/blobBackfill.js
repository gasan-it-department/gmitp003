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
exports.runBlobBackfill = exports.TARGETS = void 0;
/**
 * Move file bytes out of Postgres and into the bucket.
 *
 * 91 of the database's 123 MB is file bytes in one column. This walks every
 * blob-bearing model, uploads what is still only in Postgres, and records
 * the key on the row. Reads already prefer the bucket and fall back to the
 * column, so running this does not require a deploy, a window, or anybody
 * watching.
 *
 * ── The rules it works by ─────────────────────────────────────────────────
 *
 * NOTHING IS DELETED. A row only gains a `storageKey`; its `Bytes` column
 * is left exactly as it was. Dropping those columns is a separate decision
 * for a later day, once the bucket has proven itself in use — and because
 * reads prefer the bucket, that day arrives with no behaviour left to
 * change.
 *
 * EVERY UPLOAD IS CONFIRMED BEFORE IT IS TRUSTED. The object is read back
 * and compared byte for byte against the source before the key is written.
 * A storageKey pointing at a corrupt object is worse than no key at all,
 * because reads would then prefer the corruption over the good copy still
 * sitting in the column.
 *
 * MEMORY STAYS FLAT. Ids are listed first and the bytes fetched one row at
 * a time. Selecting every document at once would pull all 91 MB into the
 * heap — on a container that is already sized for a single large PDF, that
 * is how a migration takes the API down with it.
 *
 * IT IS RE-RUNNABLE. Rows already migrated are skipped, so an interrupted
 * run is resumed by starting it again.
 */
const prisma_1 = require("../barrel/prisma");
const blobStore_1 = require("./blobStore");
exports.TARGETS = [
    { model: "DecodedFile", column: "fileDecoded", kind: "document", ext: "pdf" },
    { model: "Signature", column: "signature", kind: "signature", ext: "png" },
    {
        model: "UserProfilePicture",
        column: "bytes",
        kind: "profile",
        ext: "jpg",
        keyBy: "userId",
    },
    {
        model: "ComplaintEvidence",
        column: "data",
        kind: "evidence",
        ext: "bin",
    },
    { model: "ChatImage", column: "bytes", kind: "chat", ext: "img" },
    { model: "ChatFile", column: "bytes", kind: "chat", ext: "bin" },
    {
        model: "DocumentReceivePage",
        column: "bytes",
        kind: "receive-page",
        ext: "img",
    },
    {
        model: "ReceiveStamp",
        column: "image",
        kind: "stamp",
        ext: "png",
        keyBy: "roomId",
    },
];
const delegate = (model) => prisma_1.prisma[model[0].toLowerCase() + model.slice(1)];
/**
 * Check what has already been moved.
 *
 * A migration nobody verified is a migration nobody can trust. Each
 * migrated row's object is fetched and hashed against the digest recorded
 * at upload time.
 */
const verifyMigrated = (t, report, limit) => __awaiter(void 0, void 0, void 0, function* () {
    const rows = yield delegate(t.model).findMany({
        where: { storageKey: { not: null } },
        select: { id: true, storageKey: true, storageSha256: true },
        take: limit,
    });
    for (const r of rows) {
        try {
            const obj = yield (0, blobStore_1.getBlob)(r.storageKey);
            const ok = !!obj && (!r.storageSha256 || (0, blobStore_1.sha256)(obj) === r.storageSha256);
            if (ok)
                report.verifiedOk++;
            else {
                report.verifiedBad++;
                report.notes.push(`MISMATCH ${r.id} -> ${r.storageKey} (${obj ? "digest differs" : "object missing"})`);
            }
        }
        catch (e) {
            report.verifiedBad++;
            report.notes.push(`ERROR ${r.id} -> ${r.storageKey}: ${e instanceof Error ? e.message : e}`);
        }
    }
});
const runBlobBackfill = (opts) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d, _e;
    const log = (_a = opts.log) !== null && _a !== void 0 ? _a : (() => undefined);
    const limit = (_b = opts.limit) !== null && _b !== void 0 ? _b : 10000;
    const status = yield (0, blobStore_1.blobStoreStatus)();
    const report = {
        objectStorage: status,
        dryRun: opts.dryRun,
        models: [],
        totals: { moved: 0, failed: 0, bytes: 0 },
    };
    if (!(0, blobStore_1.blobStoreConfigured)() || !status.reachable) {
        log("The bucket is not usable, so nothing was moved. Set BUCKET_ENDPOINT, " +
            "BUCKET_ACCESS_KEY, BUCKET_SECRET_KEY and BUCKET_NAME.");
        return report;
    }
    for (const t of exports.TARGETS) {
        const mr = {
            model: t.model,
            pending: 0,
            moved: 0,
            failed: 0,
            bytes: 0,
            verifiedOk: 0,
            verifiedBad: 0,
            notes: [],
        };
        report.models.push(mr);
        yield verifyMigrated(t, mr, (_c = opts.verifyLimit) !== null && _c !== void 0 ? _c : 2000);
        /*
          Ids only. Selecting the bytes for every row at once is the one thing
          this script must never do.
        */
        const select = { id: true };
        if (t.keyBy)
            select[t.keyBy] = true;
        const ids = yield delegate(t.model).findMany({
            where: { [t.column]: { not: null }, storageKey: null },
            select,
            take: limit,
        });
        mr.pending = ids.length;
        log(`${t.model}: ${ids.length} pending`);
        if (opts.dryRun || ids.length === 0)
            continue;
        for (const row of ids) {
            const id = row.id;
            try {
                const full = yield delegate(t.model).findUnique({
                    where: { id },
                    select: { [t.column]: true },
                });
                const raw = (_d = full === null || full === void 0 ? void 0 : full[t.column]) !== null && _d !== void 0 ? _d : null;
                if (!raw || raw.length === 0)
                    continue;
                const bytes = Buffer.from(raw);
                // Key by the stable subject where the live write does the same.
                const keySubject = (t.keyBy && row[t.keyBy]) || id;
                const key = (0, blobStore_1.keyFor)(t.kind, keySubject, t.ext);
                const put = yield (0, blobStore_1.putBlob)(key, bytes);
                const back = yield (0, blobStore_1.getBlob)(key);
                if (!back || !back.equals(bytes)) {
                    mr.failed++;
                    mr.notes.push(`FAIL ${id}: read-back ${(_e = back === null || back === void 0 ? void 0 : back.length) !== null && _e !== void 0 ? _e : 0} of ${bytes.length} bytes`);
                    continue;
                }
                yield delegate(t.model).update({
                    where: { id },
                    data: { storageKey: key, storageSha256: put.sha256 },
                });
                mr.moved++;
                mr.bytes += bytes.length;
                log(`  ok ${t.model} ${id} -> ${key} (${bytes.length} bytes)`);
            }
            catch (e) {
                mr.failed++;
                mr.notes.push(`FAIL ${id}: ${e instanceof Error ? e.message : e}`);
            }
        }
        report.totals.moved += mr.moved;
        report.totals.failed += mr.failed;
        report.totals.bytes += mr.bytes;
    }
    return report;
});
exports.runBlobBackfill = runBlobBackfill;
