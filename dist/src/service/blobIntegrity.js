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
exports.blobStatus = exports.runBlobIntegrityCheck = exports.lastRun = exports.TARGETS = void 0;
/**
 * Is every file the database points at still in the bucket?
 *
 * This was the backfill that moved file bytes out of Postgres. That job is
 * done — 44 objects moved and verified — and the `Bytes` columns it copied
 * from have been dropped, so there is nothing left to move. What remains
 * worth doing is the half that was never really about migrating: checking
 * that the objects are still there and still correct.
 *
 * That matters more now, not less. The bucket used to be one of two copies
 * and is now the only one, so a row whose object has gone missing is a
 * document that no longer exists. Each row records the SHA-256 of what was
 * uploaded, which is what makes this a real check rather than a guess: the
 * object is fetched and re-hashed, so silent corruption is caught and not
 * merely assumed away.
 *
 * Runs on boot and is exposed to the admin panel. Reads only — it never
 * writes, uploads or deletes anything.
 */
const prisma_1 = require("../barrel/prisma");
const blobStore_1 = require("./blobStore");
exports.TARGETS = [
    { model: "DecodedFile", kind: "document" },
    { model: "Signature", kind: "signature" },
    { model: "UserProfilePicture", kind: "profile" },
    { model: "ComplaintEvidence", kind: "evidence" },
    { model: "ChatImage", kind: "chat" },
    { model: "ChatFile", kind: "chat" },
    { model: "DocumentReceivePage", kind: "receive-page" },
    { model: "ReceiveStamp", kind: "stamp" },
];
const delegate = (model) => prisma_1.prisma[model[0].toLowerCase() + model.slice(1)];
/**
 * The last check's outcome, for /health/build.
 *
 * A fresh statement that the bucket still holds what the database thinks
 * it does — not a record of what was true when a row was written.
 */
exports.lastRun = null;
let running = false;
const runBlobIntegrityCheck = (opts) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    const log = (_a = opts.log) !== null && _a !== void 0 ? _a : (() => undefined);
    const limit = (_b = opts.limit) !== null && _b !== void 0 ? _b : 5000;
    const status = yield (0, blobStore_1.blobStoreStatus)();
    const report = {
        objectStorage: status,
        checked: false,
        models: [],
        totals: { withKey: 0, verifiedOk: 0, verifiedBad: 0 },
    };
    if (running) {
        log("a check is already running — leaving it to finish");
        return report;
    }
    running = true;
    try {
        for (const t of exports.TARGETS) {
            const mr = {
                model: t.model,
                withKey: 0,
                withoutKey: 0,
                verifiedOk: 0,
                verifiedBad: 0,
                notes: [],
            };
            report.models.push(mr);
            try {
                const [withKey, withoutKey] = yield Promise.all([
                    delegate(t.model).count({ where: { storageKey: { not: null } } }),
                    delegate(t.model).count({ where: { storageKey: null } }),
                ]);
                mr.withKey = withKey;
                mr.withoutKey = withoutKey;
                report.totals.withKey += withKey;
            }
            catch (e) {
                mr.notes.push(`could not count: ${e instanceof Error ? e.message : e}`);
                continue;
            }
            if (opts.countOnly || !(0, blobStore_1.blobStoreConfigured)() || !status.reachable) {
                continue;
            }
            const rows = yield delegate(t.model).findMany({
                where: { storageKey: { not: null } },
                select: { id: true, storageKey: true, storageSha256: true },
                take: limit,
            });
            for (const r of rows) {
                try {
                    const obj = yield (0, blobStore_1.getBlob)(r.storageKey);
                    if (!obj) {
                        mr.verifiedBad++;
                        mr.notes.push(`MISSING ${r.id} -> ${r.storageKey}`);
                        continue;
                    }
                    if (r.storageSha256 && (0, blobStore_1.sha256)(obj) !== r.storageSha256) {
                        mr.verifiedBad++;
                        mr.notes.push(`CORRUPT ${r.id} -> ${r.storageKey}`);
                        continue;
                    }
                    mr.verifiedOk++;
                }
                catch (e) {
                    mr.verifiedBad++;
                    mr.notes.push(`ERROR ${r.id} -> ${r.storageKey}: ${e instanceof Error ? e.message : e}`);
                }
            }
            report.totals.verifiedOk += mr.verifiedOk;
            report.totals.verifiedBad += mr.verifiedBad;
            if (rows.length) {
                log(`${t.model}: ${mr.verifiedOk} ok, ${mr.verifiedBad} bad ` +
                    `of ${rows.length} checked`);
            }
        }
        report.checked = (0, blobStore_1.blobStoreConfigured)() && status.reachable && !opts.countOnly;
    }
    finally {
        running = false;
    }
    if (report.checked) {
        exports.lastRun = {
            at: new Date().toISOString(),
            verifiedOk: report.totals.verifiedOk,
            verifiedBad: report.totals.verifiedBad,
            problems: report.models
                .flatMap((m) => m.notes.map((x) => `${m.model}: ${x}`))
                .slice(0, 40),
        };
    }
    return report;
});
exports.runBlobIntegrityCheck = runBlobIntegrityCheck;
/** Row counts only, cheap enough for a health endpoint. */
const blobStatus = () => __awaiter(void 0, void 0, void 0, function* () {
    const byModel = {};
    let withKey = 0;
    let withoutKey = 0;
    for (const t of exports.TARGETS) {
        try {
            const [a, b] = yield Promise.all([
                delegate(t.model).count({ where: { storageKey: { not: null } } }),
                delegate(t.model).count({ where: { storageKey: null } }),
            ]);
            byModel[t.model] = { withKey: a, withoutKey: b };
            withKey += a;
            withoutKey += b;
        }
        catch (_a) {
            // A model that cannot be counted should not take the health check down.
        }
    }
    return { withKey, withoutKey, byModel };
});
exports.blobStatus = blobStatus;
