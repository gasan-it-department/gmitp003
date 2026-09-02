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
exports.adminBackupImport = exports.adminBackupExport = void 0;
const prisma_1 = require("../barrel/prisma");
const errors_1 = require("../errors/errors");
// Every model in the schema, via the generated ModelName enum. The Prisma
// client accessor is the camelCase of the model name.
const modelNames = () => Object.values(prisma_1.Prisma.ModelName);
const accessor = (name) => name[0].toLowerCase() + name.slice(1);
const client = (name) => prisma_1.prisma[accessor(name)];
// Binary (Bytes) columns are excluded from the backup — they hold large in-row
// blobs (evidence files, decoded docs, signatures) that would balloon the JSON
// and exhaust memory. We `omit` them on export.
const OMIT_BYTES = {
    ComplaintEvidence: { data: true },
    DecodedFile: { fileDecoded: true },
    Signature: { signature: true },
    Test: { test: true, encrypt: true },
};
// ...and these models have a REQUIRED Bytes column, so without the binary we
// can't recreate their rows — skip them on import.
const SKIP_IMPORT = new Set(["ComplaintEvidence", "Test"]);
// Make a Prisma row JSON-safe. Critically, binary (Bytes) columns come back as
// Buffers — JSON.stringify would expand each byte into an array element and
// blow up memory, so we base64-encode them into a tagged marker instead.
const BYTES_TAG = "__b64__";
const toSafe = (v) => {
    if (v === null || v === undefined)
        return v;
    if (typeof v === "bigint")
        return v.toString();
    if (v instanceof Date)
        return v.toISOString();
    if (Buffer.isBuffer(v))
        return { [BYTES_TAG]: v.toString("base64") };
    if (v instanceof Uint8Array)
        return { [BYTES_TAG]: Buffer.from(v).toString("base64") };
    if (v instanceof prisma_1.Prisma.Decimal)
        return v.toString();
    if (Array.isArray(v))
        return v.map(toSafe);
    if (typeof v === "object") {
        const o = {};
        for (const k of Object.keys(v))
            o[k] = toSafe(v[k]);
        return o;
    }
    return v;
};
// Reverse: turn tagged base64 markers back into Buffers for createMany.
const fromSafe = (v) => {
    if (v === null || v === undefined)
        return v;
    if (Array.isArray(v))
        return v.map(fromSafe);
    if (typeof v === "object") {
        if (typeof v[BYTES_TAG] === "string" && Object.keys(v).length === 1)
            return Buffer.from(v[BYTES_TAG], "base64");
        const o = {};
        for (const k of Object.keys(v))
            o[k] = fromSafe(v[k]);
        return o;
    }
    return v;
};
// GET /admin/backup/export
// Dumps every table to a single JSON file: { _meta, data: { Model: [rows] } }.
const adminBackupExport = (_req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const data = {};
    let totalRows = 0;
    for (const name of modelNames()) {
        const c = client(name);
        if (!(c === null || c === void 0 ? void 0 : c.findMany))
            continue;
        try {
            const omit = OMIT_BYTES[name];
            const rows = yield c.findMany(omit ? { omit } : undefined);
            if (rows.length) {
                data[name] = toSafe(rows);
                totalRows += rows.length;
            }
        }
        catch (e) {
            console.warn(`[backup] skipped ${name}:`, e === null || e === void 0 ? void 0 : e.message);
        }
    }
    const json = JSON.stringify({
        _meta: {
            exportedAt: new Date().toISOString(),
            version: 1,
            models: Object.keys(data).length,
            rows: totalRows,
        },
        data,
    });
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    res.header("Content-Type", "application/json");
    res.header("Content-Disposition", `attachment; filename=gmitp-backup-${stamp}.json`);
    res.header("Access-Control-Expose-Headers", "Content-Disposition");
    return res.send(json);
});
exports.adminBackupExport = adminBackupExport;
// POST /admin/backup/import   body: the exported file ({ data: {...} } or a raw
// { Model: [rows] } map).
// Restores every table with duplicate prevention: rows whose primary key (or a
// unique key) already exists are SKIPPED; only genuinely new rows are inserted.
// Runs in one transaction with FK checks deferred so insertion order is moot.
const adminBackupImport = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    const body = req.body;
    const data = ((_a = body === null || body === void 0 ? void 0 : body.data) !== null && _a !== void 0 ? _a : body);
    if (!data || typeof data !== "object" || Array.isArray(data)) {
        throw new errors_1.ValidationError("Invalid backup file: missing a data object.");
    }
    const summary = [];
    try {
        yield prisma_1.prisma.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            // Defer FK + triggers so rows can go in any order (parents/children).
            // Unique/PK constraints still apply, so skipDuplicates still dedupes.
            try {
                yield tx.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
            }
            catch (e) {
                console.warn("[backup] could not defer FK checks (needs elevated DB role):", e === null || e === void 0 ? void 0 : e.message);
            }
            for (const name of modelNames()) {
                if (SKIP_IMPORT.has(name))
                    continue; // required binary not in backup
                const raw = data[name];
                if (!Array.isArray(raw) || raw.length === 0)
                    continue;
                const c = tx[accessor(name)];
                if (!(c === null || c === void 0 ? void 0 : c.createMany))
                    continue;
                const rows = raw.map(fromSafe);
                const r = yield c.createMany({ data: rows, skipDuplicates: true });
                summary.push({
                    model: name,
                    rows: rows.length,
                    inserted: r.count,
                    skipped: rows.length - r.count,
                });
            }
        }), { timeout: 300000, maxWait: 30000 });
        const totals = summary.reduce((a, s) => ({
            inserted: a.inserted + s.inserted,
            skipped: a.skipped + s.skipped,
        }), { inserted: 0, skipped: 0 });
        return res.code(200).send({
            message: "OK",
            inserted: totals.inserted,
            skipped: totals.skipped,
            models: summary.length,
            summary: summary.filter((s) => s.inserted > 0),
        });
    }
    catch (error) {
        console.error("[backup import]", error);
        return res.code(500).send({
            message: (error === null || error === void 0 ? void 0 : error.message) ||
                "Import failed — nothing was changed (the transaction rolled back).",
        });
    }
});
exports.adminBackupImport = adminBackupImport;
