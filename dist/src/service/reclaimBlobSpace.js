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
exports.reclaimBlobTableSpace = void 0;
/**
 * Give the disk back after the Bytes columns were dropped.
 *
 * DROP COLUMN only marks a column dead. The bytes stay in the table's
 * pages until the table is rewritten, which is why these eight tables
 * still held about 30 MB between them for 44 rows of metadata. Only
 * VACUUM FULL rewrites a table and returns the space to the filesystem;
 * ordinary autovacuum just makes it reusable by that same table, which
 * for a table that will never hold bytes again means it is never reused.
 *
 * ── Why this is safe to run unattended, on these tables ─────────────────
 *
 * VACUUM FULL takes an ACCESS EXCLUSIVE lock, so it does block the table
 * while it runs. That is the cost, and it is bounded here: these tables
 * are a few megabytes each and hold tens of rows, so the rewrite is a
 * fraction of a second. The same operation on a large, busy table would be
 * a genuinely bad idea and this does not attempt one.
 *
 * It is self-limiting. A table is only rewritten when it is holding far
 * more space than its live rows could account for, so the first run
 * reclaims everything and every run after it finds nothing to do and
 * touches nothing.
 */
const prisma_1 = require("../barrel/prisma");
/** The tables the dropped columns belonged to. Nothing else is touched. */
const TABLES = [
    "DecodedFile",
    "Signature",
    "UserProfilePicture",
    "ComplaintEvidence",
    "ChatImage",
    "ChatFile",
    "DocumentReceivePage",
    "ReceiveStamp",
];
/** Below this there is nothing worth an exclusive lock. */
const MIN_BYTES = 1024 * 1024;
/** Bytes per live row above which a table is clearly holding dead space. */
const BYTES_PER_ROW_LIMIT = 20 * 1024;
const dbSize = () => __awaiter(void 0, void 0, void 0, function* () {
    const r = yield prisma_1.prisma.$queryRawUnsafe("SELECT pg_database_size(current_database()) AS bytes");
    return Number(r[0].bytes);
});
const tableSize = (t) => __awaiter(void 0, void 0, void 0, function* () {
    const r = yield prisma_1.prisma.$queryRawUnsafe(`SELECT pg_total_relation_size($1::regclass) AS bytes`, `"public"."${t}"`);
    return Number(r[0].bytes);
});
const rowCount = (t) => __awaiter(void 0, void 0, void 0, function* () {
    const r = yield prisma_1.prisma.$queryRawUnsafe(`SELECT count(*) AS n FROM "public"."${t}"`);
    return Number(r[0].n);
});
const mb = (b) => Number((b / 1024 / 1024).toFixed(1));
const reclaimBlobTableSpace = (...args_1) => __awaiter(void 0, [...args_1], void 0, function* (log = () => undefined) {
    const report = {
        rewritten: [],
        skipped: [],
        freedMB: 0,
        databaseBeforeMB: 0,
        databaseAfterMB: 0,
    };
    const before = yield dbSize();
    report.databaseBeforeMB = mb(before);
    for (const t of TABLES) {
        try {
            const size = yield tableSize(t);
            if (size < MIN_BYTES) {
                report.skipped.push({ table: t, reason: `only ${mb(size)} MB` });
                continue;
            }
            const rows = yield rowCount(t);
            const perRow = rows > 0 ? size / rows : size;
            if (perRow < BYTES_PER_ROW_LIMIT) {
                report.skipped.push({
                    table: t,
                    reason: `${mb(size)} MB for ${rows} rows looks live, not bloat`,
                });
                continue;
            }
            log(`rewriting ${t}: ${mb(size)} MB for ${rows} row(s) — ` +
                `${Math.round(perRow / 1024)} KB per row`);
            // Identifier is from the fixed list above, never from a request.
            yield prisma_1.prisma.$executeRawUnsafe(`VACUUM (FULL, ANALYZE) "public"."${t}"`);
            const after = yield tableSize(t);
            report.rewritten.push({
                table: t,
                beforeMB: mb(size),
                afterMB: mb(after),
            });
            log(`  ${t}: ${mb(size)} MB -> ${mb(after)} MB`);
        }
        catch (e) {
            report.skipped.push({
                table: t,
                reason: e instanceof Error ? e.message : String(e),
            });
            log(`  ${t}: FAILED — ${e instanceof Error ? e.message : e}`);
        }
    }
    const after = yield dbSize();
    report.databaseAfterMB = mb(after);
    report.freedMB = Number(((before - after) / 1024 / 1024).toFixed(1));
    if (report.rewritten.length) {
        log(`database ${report.databaseBeforeMB} MB -> ${report.databaseAfterMB} MB ` +
            `(${report.freedMB} MB returned)`);
    }
    return report;
});
exports.reclaimBlobTableSpace = reclaimBlobTableSpace;
