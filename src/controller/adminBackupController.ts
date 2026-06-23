import { FastifyRequest, FastifyReply } from "../barrel/fastify";
import { Prisma, prisma } from "../barrel/prisma";
import { ValidationError } from "../errors/errors";

// Every model in the schema, via the generated ModelName enum. The Prisma
// client accessor is the camelCase of the model name.
const modelNames = (): string[] =>
  Object.values(
    (Prisma as unknown as { ModelName: Record<string, string> }).ModelName,
  );
const accessor = (name: string) => name[0].toLowerCase() + name.slice(1);
const client = (name: string) =>
  (prisma as unknown as Record<string, any>)[accessor(name)];

// Binary (Bytes) columns are excluded from the backup — they hold large in-row
// blobs (evidence files, decoded docs, signatures) that would balloon the JSON
// and exhaust memory. We `omit` them on export.
const OMIT_BYTES: Record<string, Record<string, true>> = {
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
const toSafe = (v: any): any => {
  if (v === null || v === undefined) return v;
  if (typeof v === "bigint") return v.toString();
  if (v instanceof Date) return v.toISOString();
  if (Buffer.isBuffer(v)) return { [BYTES_TAG]: v.toString("base64") };
  if (v instanceof Uint8Array)
    return { [BYTES_TAG]: Buffer.from(v).toString("base64") };
  if (v instanceof Prisma.Decimal) return v.toString();
  if (Array.isArray(v)) return v.map(toSafe);
  if (typeof v === "object") {
    const o: Record<string, any> = {};
    for (const k of Object.keys(v)) o[k] = toSafe(v[k]);
    return o;
  }
  return v;
};

// Reverse: turn tagged base64 markers back into Buffers for createMany.
const fromSafe = (v: any): any => {
  if (v === null || v === undefined) return v;
  if (Array.isArray(v)) return v.map(fromSafe);
  if (typeof v === "object") {
    if (typeof v[BYTES_TAG] === "string" && Object.keys(v).length === 1)
      return Buffer.from(v[BYTES_TAG], "base64");
    const o: Record<string, any> = {};
    for (const k of Object.keys(v)) o[k] = fromSafe(v[k]);
    return o;
  }
  return v;
};

// GET /admin/backup/export
// Dumps every table to a single JSON file: { _meta, data: { Model: [rows] } }.
export const adminBackupExport = async (
  _req: FastifyRequest,
  res: FastifyReply,
) => {
  const data: Record<string, unknown[]> = {};
  let totalRows = 0;

  for (const name of modelNames()) {
    const c = client(name);
    if (!c?.findMany) continue;
    try {
      const omit = OMIT_BYTES[name];
      const rows = await c.findMany(omit ? { omit } : undefined);
      if (rows.length) {
        data[name] = toSafe(rows);
        totalRows += rows.length;
      }
    } catch (e) {
      console.warn(`[backup] skipped ${name}:`, (e as Error)?.message);
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
  res.header(
    "Content-Disposition",
    `attachment; filename=gmitp-backup-${stamp}.json`,
  );
  res.header("Access-Control-Expose-Headers", "Content-Disposition");
  return res.send(json);
};

// POST /admin/backup/import   body: the exported file ({ data: {...} } or a raw
// { Model: [rows] } map).
// Restores every table with duplicate prevention: rows whose primary key (or a
// unique key) already exists are SKIPPED; only genuinely new rows are inserted.
// Runs in one transaction with FK checks deferred so insertion order is moot.
export const adminBackupImport = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const body = req.body as Record<string, unknown> | undefined;
  const data = (body?.data ?? body) as Record<string, unknown[]> | undefined;
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new ValidationError("Invalid backup file: missing a data object.");
  }

  const summary: {
    model: string;
    rows: number;
    inserted: number;
    skipped: number;
  }[] = [];

  try {
    await prisma.$transaction(
      async (tx) => {
        // Defer FK + triggers so rows can go in any order (parents/children).
        // Unique/PK constraints still apply, so skipDuplicates still dedupes.
        try {
          await tx.$executeRawUnsafe(
            "SET LOCAL session_replication_role = 'replica'",
          );
        } catch (e) {
          console.warn(
            "[backup] could not defer FK checks (needs elevated DB role):",
            (e as Error)?.message,
          );
        }

        for (const name of modelNames()) {
          if (SKIP_IMPORT.has(name)) continue; // required binary not in backup
          const raw = data[name];
          if (!Array.isArray(raw) || raw.length === 0) continue;
          const c = (tx as unknown as Record<string, any>)[accessor(name)];
          if (!c?.createMany) continue;

          const rows = raw.map(fromSafe);
          const r = await c.createMany({ data: rows, skipDuplicates: true });
          summary.push({
            model: name,
            rows: rows.length,
            inserted: r.count,
            skipped: rows.length - r.count,
          });
        }
      },
      { timeout: 300_000, maxWait: 30_000 },
    );

    const totals = summary.reduce(
      (a, s) => ({
        inserted: a.inserted + s.inserted,
        skipped: a.skipped + s.skipped,
      }),
      { inserted: 0, skipped: 0 },
    );
    return res.code(200).send({
      message: "OK",
      inserted: totals.inserted,
      skipped: totals.skipped,
      models: summary.length,
      summary: summary.filter((s) => s.inserted > 0),
    });
  } catch (error) {
    console.error("[backup import]", error);
    return res.code(500).send({
      message:
        (error as Error)?.message ||
        "Import failed — nothing was changed (the transaction rolled back).",
    });
  }
};
