/* PROOF: the disposal dates an archivist types in can be read back.
 *
 * Safe Date is collected by the upload form, sent, and stored — on the
 * ArchivePreservation row, because there is no column for it on the
 * document. The detail screen read `archive.safeDate`, a field the API has
 * never sent, so the date was saved and then never shown to anyone again.
 *
 * Retention is written to BOTH places from the same input, which is its own
 * trap: read one source in the list and the other in the detail and they
 * drift the first time anything writes only one of them.
 *
 * This file pins the payload: whatever an archivist enters has to be
 * reachable from what the endpoints return, by one rule, for both screens.
 *
 * Run: npx ts-node --transpile-only e2e_archive_dates.ts */
import path from "path";

const entry = path.join(__dirname, "src", "index.ts");
require.cache[entry] = {
  id: entry,
  filename: entry,
  loaded: true,
  exports: { notificationSocket: { emitUserNotification: () => undefined } },
} as any;

import { prisma } from "./src/barrel/prisma";

const TS = Date.now();

/** The client-side rule, mirrored. Keep in step with
 *  gmitp003-v2/src/interface/data.ts → archiveDisposalDates. */
const disposalDates = (a: any) => {
  const retention = a?.preservation?.retentionDate ?? a?.retentionDate ?? null;
  const safe = a?.preservation?.safeDate ?? null;
  return { retention, safe, permanent: !retention && !safe };
};

/** What the list endpoint sends for one row. */
const listShape = (id: string) =>
  prisma.archiveDocument.findUnique({
    where: { id },
    include: {
      document: { select: { id: true, title: true, timestamp: true, size: true } },
      abstract: { select: { id: true, title: true, content: true, timestamp: true } },
      preservation: {
        select: { id: true, retentionDate: true, safeDate: true, detentionDate: true },
      },
    },
  });

/** What the detail endpoint sends. */
const detailShape = (id: string) =>
  prisma.archiveDocument.findUnique({
    where: { id },
    include: {
      abstract: { select: { id: true, title: true, content: true, timestamp: true } },
      preservation: {
        select: {
          id: true, type: true, retentionDate: true,
          safeDate: true, detentionDate: true, timestamp: true,
        },
      },
      line: { select: { id: true, name: true } },
      receivingRoom: { select: { id: true, code: true, address: true } },
    },
  });

(async () => {
  let pass = 0, fail = 0;
  const ok = (l: string, c: boolean, d = "") => {
    if (c) { pass++; console.log("PASS  " + l); }
    else { fail++; console.log("FAIL  " + l + (d ? "  -> " + d : "")); }
  };

  const made = { archiveIds: [] as string[], presIds: [] as string[] };

  try {
    const line = await prisma.line.findFirst({ select: { id: true } });
    if (!line) { console.log("NO FIXTURE (line)"); process.exit(2); }

    const RETENTION = new Date("2031-06-30T00:00:00.000Z");
    const SAFE = new Date("2036-06-30T00:00:00.000Z");

    /** Archive a document the way the upload handler does. */
    const mk = async (
      tag: string,
      retentionDate?: Date,
      safeDate?: Date,
    ) => {
      let presId: string | undefined;
      if (retentionDate || safeDate) {
        const p = await prisma.archivePreservation.create({
          data: { type: 1, retentionDate, safeDate },
          select: { id: true },
        });
        made.presIds.push(p.id);
        presId = p.id;
      }
      const a = await prisma.archiveDocument.create({
        data: {
          docType: 0,
          lineId: line.id,
          status: 1,
          // The handler writes retention to the row as well as the
          // preservation record. Safe date has nowhere to go but the latter.
          retentionDate,
          archivePreservationId: presId,
        },
        select: { id: true },
      });
      made.archiveIds.push(a.id);
      return a.id;
    };

    // ══ 1. Both dates set ══════════════════════════════════════════════
    console.log("\n-- retention and safe date --");
    const both = await mk("both", RETENTION, SAFE);

    const l1 = await listShape(both);
    const d1 = await detailShape(both);

    ok("the list payload carries a preservation record", !!l1?.preservation);
    ok("the detail payload carries one too", !!d1?.preservation);
    ok(
      "safe date is NOT a field on the document itself",
      !("safeDate" in (l1 as any)),
      "if this ever passes, the old client read was right after all",
    );
    ok(
      "...it is only reachable through preservation",
      l1?.preservation?.safeDate?.toISOString() === SAFE.toISOString(),
      String(l1?.preservation?.safeDate),
    );

    const dl = disposalDates(l1), dd = disposalDates(d1);
    ok(
      "the list resolves the retention date",
      dl.retention?.toISOString() === RETENTION.toISOString(),
      String(dl.retention),
    );
    ok(
      "the detail resolves the SAME retention date",
      dd.retention?.toISOString() === RETENTION.toISOString(),
      String(dd.retention),
    );
    ok(
      "the detail resolves the safe date",
      dd.safe?.toISOString() === SAFE.toISOString(),
      String(dd.safe),
    );
    ok("...and neither screen calls it permanent", !dl.permanent && !dd.permanent);

    // ══ 2. Retention only ══════════════════════════════════════════════
    console.log("\n-- retention only --");
    const rOnly = await mk("r", RETENTION, undefined);
    const dr = disposalDates(await detailShape(rOnly));
    ok("retention reads back", dr.retention?.toISOString() === RETENTION.toISOString());
    ok("no safe date", dr.safe === null);
    ok("not permanent", !dr.permanent);

    // ══ 3. Safe date only — the case the list used to mislabel ═════════
    console.log("\n-- safe date only --");
    const sOnly = await mk("s", undefined, SAFE);
    const ds = disposalDates(await listShape(sOnly));
    ok("safe date reads back", ds.safe?.toISOString() === SAFE.toISOString());
    ok("no retention date", ds.retention === null);
    ok(
      "NOT labelled permanent — a disposal date exists",
      !ds.permanent,
      "this is what the old single-field check got wrong",
    );

    // ══ 4. Neither — genuinely permanent ═══════════════════════════════
    console.log("\n-- no dates at all --");
    const none = await mk("none");
    const dn = disposalDates(await listShape(none));
    ok("no preservation record is created", dn.retention === null && dn.safe === null);
    ok("...and this one really is permanent", dn.permanent);

    console.log(`\n${pass} passed, ${fail} failed`);
    process.exitCode = fail === 0 ? 0 : 1;
  } catch (e) {
    console.error("THREW", e);
    process.exitCode = 1;
  } finally {
    for (const id of made.archiveIds) {
      await prisma.archiveDocument.delete({ where: { id } }).catch(() => {});
    }
    for (const id of made.presIds) {
      await prisma.archivePreservation.delete({ where: { id } }).catch(() => {});
    }
    await prisma.$disconnect();
  }
})();
