import { FastifyReply, FastifyRequest } from "../barrel/fastify";
import { prisma } from "../barrel/prisma";
import { REAL_PUSH, REAL_PULL, isRealTable } from "./realSync";
import { waitForLine } from "../service/notifyWaiters";
import { DESKTOP_RELEASE } from "../config/desktopRelease";

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

async function callerLineId(req: FastifyRequest): Promise<string | null> {
  const accountId = (req.user as { id?: string } | undefined)?.id;
  if (!accountId) return null;
  const account = await prisma.account.findUnique({
    where: { id: accountId },
    select: { lineId: true },
  });
  return account?.lineId ?? null;
}

// the User id behind the account (Prescription.userId references User)
async function callerUserId(req: FastifyRequest): Promise<string | null> {
  const accountId = (req.user as { id?: string } | undefined)?.id;
  if (!accountId) return null;
  const account = await prisma.account.findUnique({
    where: { id: accountId },
    select: { User: { select: { id: true } } },
  });
  return account?.User?.id ?? null;
}

function toDate(value: unknown): Date | null {
  if (!value) return null;
  const d = new Date(String(value));
  return isNaN(d.getTime()) ? null : d;
}

/**
 * GET /sync/health — UNAUTHENTICATED reachability probe. The desktop polls
 * this to decide Online vs Offline. It must not require a token, otherwise a
 * machine with a perfectly good internet connection but no/expired token would
 * wrongly report "Offline".
 */
export const syncHealth = async (_req: FastifyRequest, reply: FastifyReply) => {
  return reply.code(200).send({ ok: true, at: new Date().toISOString() });
};

/** GET /sync/ping — authenticated check (confirms the token is still valid). */
export const syncPing = async (_req: FastifyRequest, reply: FastifyReply) => {
  return reply.code(200).send({ ok: true, at: new Date().toISOString() });
};

/**
 * GET /desktop/update — UNAUTHENTICATED release manifest for the desktop
 * auto-updater (version metadata only; edit src/config/desktopRelease.ts to
 * publish a release).
 */
export const desktopUpdate = async (
  _req: FastifyRequest,
  reply: FastifyReply,
) => {
  return reply.code(200).send(DESKTOP_RELEASE);
};

/**
 * POST /sync/push
 * body: { table: string, rows: Array<Record<string, unknown>> }
 * Each row is a full local row including `id`, `updated_at`, `deleted_at`.
 */
export const syncPush = async (req: FastifyRequest, reply: FastifyReply) => {
  const body = req.body as
    | { table?: string; rows?: Array<Record<string, unknown>> }
    | undefined;
  const table = body?.table;
  const rows = Array.isArray(body?.rows) ? body!.rows! : [];

  if (!table || !ALLOWED_TABLES.has(table)) {
    return reply.code(400).send({ error: "Unknown or missing table" });
  }

  const lineId = await callerLineId(req);

  // Real tables (patient, medicine, …) are written straight into the web's own
  // Postgres tables so the data shows up in the web app. Per-row errors are
  // collected and returned so failures are visible, not silent.
  if (isRealTable(table)) {
    const ctx = { lineId, userId: await callerUserId(req) };
    let ok = 0;
    const errors: Array<{ id: string; error: string }> = [];
    for (const row of rows) {
      const id = row?.id != null ? String(row.id) : null;
      if (!id) continue;
      try {
        await REAL_PUSH[table](row, ctx);
        ok++;
      } catch (e) {
        errors.push({ id, error: e instanceof Error ? e.message : String(e) });
      }
    }
    return reply.code(200).send({ ok: true, count: ok, errors });
  }

  let count = 0;
  for (const row of rows) {
    const recordId = row?.id != null ? String(row.id) : null;
    if (!recordId) continue;

    const updatedAt = toDate(row.updated_at) ?? new Date();
    const deletedAt = toDate(row.deleted_at);

    // idempotent upsert keyed on (tableName, recordId) — the dedup guarantee.
    // Last-write-wins: only overwrite when the incoming row is newer.
    const existing = await prisma.syncRecord.findUnique({
      where: { tableName_recordId: { tableName: table, recordId } },
      select: { updatedAt: true },
    });

    if (existing && existing.updatedAt > updatedAt) {
      // server already has a newer version — skip (client will pull it)
      continue;
    }

    await prisma.syncRecord.upsert({
      where: { tableName_recordId: { tableName: table, recordId } },
      create: {
        tableName: table,
        recordId,
        lineId,
        payload: row as object,
        updatedAt,
        deletedAt,
      },
      update: {
        lineId,
        payload: row as object,
        updatedAt,
        deletedAt,
      },
    });
    count++;
  }

  return reply.code(200).send({ ok: true, count });
};

/**
 * GET /sync/pull?table=<t>&since=<ISO serverAt>
 * Returns rows for the caller's line changed after `since`, plus the new
 * cursor (max serverAt in this page). Client merges with last-write-wins.
 */
export const syncPull = async (req: FastifyRequest, reply: FastifyReply) => {
  const q = req.query as { table?: string; since?: string } | undefined;
  const table = q?.table;
  if (!table || !ALLOWED_TABLES.has(table)) {
    return reply.code(400).send({ error: "Unknown or missing table" });
  }

  const lineId = await callerLineId(req);
  const since = toDate(q?.since);

  // Real tables read straight from the web's own Postgres tables.
  if (isRealTable(table)) {
    const { rows, cursor } = await REAL_PULL[table](lineId, since);
    return reply.code(200).send({ rows, cursor, count: rows.length });
  }

  const records = await prisma.syncRecord.findMany({
    where: {
      tableName: table,
      lineId,
      ...(since ? { serverAt: { gt: since } } : {}),
    },
    orderBy: { serverAt: "asc" },
    take: PULL_LIMIT,
    select: { payload: true, serverAt: true },
  });

  const rows = records.map((r) => r.payload);
  const cursor =
    records.length > 0
      ? records[records.length - 1].serverAt.toISOString()
      : q?.since ?? null;

  return reply.code(200).send({ rows, cursor, count: rows.length });
};

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
export const pollNotifications = async (
  req: FastifyRequest,
  reply: FastifyReply,
) => {
  const q = req.query as { since?: string; wait?: string } | undefined;
  const lineId = await callerLineId(req);
  const meId = await callerUserId(req);
  const now = new Date();
  if (!lineId) {
    return reply
      .code(200)
      .send({ notifications: [], serverTime: now.toISOString() });
  }

  // cursor: only notifications strictly after this instant. Default to "now" so
  // a fresh client never replays history.
  const parsed = q?.since ? new Date(q.since) : now;
  const since = isNaN(parsed.getTime()) ? now : parsed;

  // hold the request up to ~20s (safely under the desktop's 30s client timeout
  // and any proxy idle limit), re-checking on every wake
  const waitMs = Math.min(
    25_000,
    Math.max(0, (Number(q?.wait) || 20) * 1000),
  );
  const deadline = Date.now() + waitMs;

  const fetchNew = () =>
    prisma.medicineNotification.findMany({
      where: {
        lineId,
        timestamp: { gt: since },
        ...(meId ? { NOT: { userId: meId } } : {}),
      },
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

  let rows = await fetchNew();
  while (rows.length === 0 && Date.now() < deadline) {
    await waitForLine(lineId, Math.min(2_000, deadline - Date.now()));
    rows = await fetchNew();
  }

  return reply.code(200).send({
    notifications: rows.map((r) => ({
      ...r,
      timestamp:
        r.timestamp instanceof Date ? r.timestamp.toISOString() : r.timestamp,
    })),
    serverTime: new Date().toISOString(),
  });
};
