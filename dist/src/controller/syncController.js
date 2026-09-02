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
exports.pollNotifications = exports.syncPull = exports.syncPush = exports.desktopUpdate = exports.syncPing = exports.syncHealth = void 0;
const prisma_1 = require("../barrel/prisma");
const realSync_1 = require("./realSync");
const notifyWaiters_1 = require("../service/notifyWaiters");
const desktopRelease_1 = require("../config/desktopRelease");
/**
 * Offline-first sync endpoints for the Gasan Pharmacy desktop app.
 *
 * The desktop keeps its own local SQLite copy of the pharmacy tables
 * (medicine, stock_event, patient, diagnosis, prescription,
 * prescription_item). Every local row carries a client-generated UUID, a
 * domain `updated_at`, an optional `deleted_at` tombstone and a `dirty`
 * flag. These handlers reconcile that against Postgres via a single generic
 * `SyncRecord` store keyed on (tableName, recordId):
 *
 *   - push: upsert each row by (tableName, recordId). Re-pushing the same
 *           record is idempotent, so duplicates can never accumulate.
 *   - pull: return every record for the caller's line changed after the
 *           client's per-table cursor (`serverAt`), newest cursor returned
 *           so the next pull is incremental.
 *
 * Data is scoped to the account's `lineId` so each LGU only ever syncs its
 * own pharmacy records.
 */
// only these tables may be synced from the desktop client
const ALLOWED_TABLES = new Set([
    "medicine",
    "medicine_storage",
    "medicine_stock",
    "patient",
    "diagnosis",
    "prescription",
    "prescription_item",
    "storage_access", // pull-only: per-user dispense/restock grants
]);
const PULL_LIMIT = 500;
function callerLineId(req) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b;
        const accountId = (_a = req.user) === null || _a === void 0 ? void 0 : _a.id;
        if (!accountId)
            return null;
        const account = yield prisma_1.prisma.account.findUnique({
            where: { id: accountId },
            select: { lineId: true },
        });
        return (_b = account === null || account === void 0 ? void 0 : account.lineId) !== null && _b !== void 0 ? _b : null;
    });
}
// the User id behind the account (Prescription.userId references User)
function callerUserId(req) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c;
        const accountId = (_a = req.user) === null || _a === void 0 ? void 0 : _a.id;
        if (!accountId)
            return null;
        const account = yield prisma_1.prisma.account.findUnique({
            where: { id: accountId },
            select: { User: { select: { id: true } } },
        });
        return (_c = (_b = account === null || account === void 0 ? void 0 : account.User) === null || _b === void 0 ? void 0 : _b.id) !== null && _c !== void 0 ? _c : null;
    });
}
function toDate(value) {
    if (!value)
        return null;
    const d = new Date(String(value));
    return isNaN(d.getTime()) ? null : d;
}
/**
 * GET /sync/health — UNAUTHENTICATED reachability probe. The desktop polls
 * this to decide Online vs Offline. It must not require a token, otherwise a
 * machine with a perfectly good internet connection but no/expired token would
 * wrongly report "Offline".
 */
const syncHealth = (_req, reply) => __awaiter(void 0, void 0, void 0, function* () {
    return reply.code(200).send({ ok: true, at: new Date().toISOString() });
});
exports.syncHealth = syncHealth;
/** GET /sync/ping — authenticated check (confirms the token is still valid). */
const syncPing = (_req, reply) => __awaiter(void 0, void 0, void 0, function* () {
    return reply.code(200).send({ ok: true, at: new Date().toISOString() });
});
exports.syncPing = syncPing;
/**
 * GET /desktop/update — UNAUTHENTICATED release manifest for the desktop
 * auto-updater (version metadata only; edit src/config/desktopRelease.ts to
 * publish a release).
 */
const desktopUpdate = (_req, reply) => __awaiter(void 0, void 0, void 0, function* () {
    return reply.code(200).send(desktopRelease_1.DESKTOP_RELEASE);
});
exports.desktopUpdate = desktopUpdate;
/**
 * POST /sync/push
 * body: { table: string, rows: Array<Record<string, unknown>> }
 * Each row is a full local row including `id`, `updated_at`, `deleted_at`.
 */
const syncPush = (req, reply) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    const body = req.body;
    const table = body === null || body === void 0 ? void 0 : body.table;
    const rows = Array.isArray(body === null || body === void 0 ? void 0 : body.rows) ? body.rows : [];
    if (!table || !ALLOWED_TABLES.has(table)) {
        return reply.code(400).send({ error: "Unknown or missing table" });
    }
    const lineId = yield callerLineId(req);
    // Real tables (patient, medicine, …) are written straight into the web's own
    // Postgres tables so the data shows up in the web app. Per-row errors are
    // collected and returned so failures are visible, not silent.
    if ((0, realSync_1.isRealTable)(table)) {
        const ctx = { lineId, userId: yield callerUserId(req) };
        let ok = 0;
        const errors = [];
        for (const row of rows) {
            const id = (row === null || row === void 0 ? void 0 : row.id) != null ? String(row.id) : null;
            if (!id)
                continue;
            try {
                yield realSync_1.REAL_PUSH[table](row, ctx);
                ok++;
            }
            catch (e) {
                errors.push({ id, error: e instanceof Error ? e.message : String(e) });
            }
        }
        return reply.code(200).send({ ok: true, count: ok, errors });
    }
    let count = 0;
    for (const row of rows) {
        const recordId = (row === null || row === void 0 ? void 0 : row.id) != null ? String(row.id) : null;
        if (!recordId)
            continue;
        const updatedAt = (_a = toDate(row.updated_at)) !== null && _a !== void 0 ? _a : new Date();
        const deletedAt = toDate(row.deleted_at);
        // idempotent upsert keyed on (tableName, recordId) — the dedup guarantee.
        // Last-write-wins: only overwrite when the incoming row is newer.
        const existing = yield prisma_1.prisma.syncRecord.findUnique({
            where: { tableName_recordId: { tableName: table, recordId } },
            select: { updatedAt: true },
        });
        if (existing && existing.updatedAt > updatedAt) {
            // server already has a newer version — skip (client will pull it)
            continue;
        }
        yield prisma_1.prisma.syncRecord.upsert({
            where: { tableName_recordId: { tableName: table, recordId } },
            create: {
                tableName: table,
                recordId,
                lineId,
                payload: row,
                updatedAt,
                deletedAt,
            },
            update: {
                lineId,
                payload: row,
                updatedAt,
                deletedAt,
            },
        });
        count++;
    }
    return reply.code(200).send({ ok: true, count });
});
exports.syncPush = syncPush;
/**
 * GET /sync/pull?table=<t>&since=<ISO serverAt>
 * Returns rows for the caller's line changed after `since`, plus the new
 * cursor (max serverAt in this page). Client merges with last-write-wins.
 */
const syncPull = (req, reply) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    const q = req.query;
    const table = q === null || q === void 0 ? void 0 : q.table;
    if (!table || !ALLOWED_TABLES.has(table)) {
        return reply.code(400).send({ error: "Unknown or missing table" });
    }
    const lineId = yield callerLineId(req);
    const since = toDate(q === null || q === void 0 ? void 0 : q.since);
    // Real tables read straight from the web's own Postgres tables.
    if ((0, realSync_1.isRealTable)(table)) {
        const { rows, cursor } = yield realSync_1.REAL_PULL[table](lineId, since);
        return reply.code(200).send({ rows, cursor, count: rows.length });
    }
    const records = yield prisma_1.prisma.syncRecord.findMany({
        where: Object.assign({ tableName: table, lineId }, (since ? { serverAt: { gt: since } } : {})),
        orderBy: { serverAt: "asc" },
        take: PULL_LIMIT,
        select: { payload: true, serverAt: true },
    });
    const rows = records.map((r) => r.payload);
    const cursor = records.length > 0
        ? records[records.length - 1].serverAt.toISOString()
        : (_a = q === null || q === void 0 ? void 0 : q.since) !== null && _a !== void 0 ? _a : null;
    return reply.code(200).send({ rows, cursor, count: rows.length });
});
exports.syncPull = syncPull;
/**
 * Realtime notification long-poll for the Pharmacy Desktop.
 *
 * The desktop holds this request open; the handler returns as soon as a
 * medicine notification newer than `since` exists for the caller's line, or
 * after ~20s of no activity (empty list, so the client immediately re-polls).
 * emitMedicineNotification() signals waiters the instant a notification is
 * created, so delivery is effectively realtime — matching the web's socket —
 * over plain HTTPS that works on Windows 7 / .NET 4.8 where a live WebSocket
 * doesn't. The caller's own actions are excluded so you never toast yourself.
 */
const pollNotifications = (req, reply) => __awaiter(void 0, void 0, void 0, function* () {
    const q = req.query;
    const lineId = yield callerLineId(req);
    const meId = yield callerUserId(req);
    const now = new Date();
    if (!lineId) {
        return reply
            .code(200)
            .send({ notifications: [], serverTime: now.toISOString() });
    }
    // cursor: only notifications strictly after this instant. Default to "now" so
    // a fresh client never replays history.
    const parsed = (q === null || q === void 0 ? void 0 : q.since) ? new Date(q.since) : now;
    const since = isNaN(parsed.getTime()) ? now : parsed;
    // hold the request up to ~20s (safely under the desktop's 30s client timeout
    // and any proxy idle limit), re-checking on every wake
    const waitMs = Math.min(25000, Math.max(0, (Number(q === null || q === void 0 ? void 0 : q.wait) || 20) * 1000));
    const deadline = Date.now() + waitMs;
    const fetchNew = () => prisma_1.prisma.medicineNotification.findMany({
        where: Object.assign({ lineId, timestamp: { gt: since } }, (meId ? { NOT: { userId: meId } } : {})),
        orderBy: { timestamp: "asc" },
        take: 50,
        select: {
            id: true,
            userId: true,
            lineId: true,
            title: true,
            message: true,
            path: true,
            type: true,
            view: true,
            timestamp: true,
        },
    });
    let rows = yield fetchNew();
    while (rows.length === 0 && Date.now() < deadline) {
        yield (0, notifyWaiters_1.waitForLine)(lineId, Math.min(2000, deadline - Date.now()));
        rows = yield fetchNew();
    }
    return reply.code(200).send({
        notifications: rows.map((r) => (Object.assign(Object.assign({}, r), { timestamp: r.timestamp instanceof Date ? r.timestamp.toISOString() : r.timestamp }))),
        serverTime: new Date().toISOString(),
    });
});
exports.pollNotifications = pollNotifications;
