/* PROOF: signature placements — no box without a signatory, no log spam.
 *
 * Two rules live in saveSignaturePlacements, and both were broken.
 *
 * 1. A box has to belong to somebody. The handler used to CREATE a
 *    SignatoryArrangement for any slot number it did not recognise, so a
 *    routing with nobody signing could still collect boxes — each one
 *    minting an empty arrangement row attached to no person. Those boxes
 *    would be stamped by nobody, forever. Slots must now resolve to
 *    signatories that already exist, and clearing every box must still be
 *    allowed, because that is how a box is removed.
 *
 * 2. The editor auto-saves. Production showed 65 of 165 rows in the whole
 *    document activity log were this one action, written roughly every
 *    0.8 seconds by a save that re-triggered itself. The handler now
 *    rewrites the most recent entry for the same document while the person
 *    is still working instead of appending a new one each time.
 *
 * Run: npx ts-node --transpile-only e2e_placements.ts */
import path from "path";

/* Stub the app entrypoint before anything can pull it in: importing a
 * controller boots Fastify and grabs port 3000. Same knot as the others. */
const entry = path.join(__dirname, "src", "index.ts");
require.cache[entry] = {
  id: entry,
  filename: entry,
  loaded: true,
  exports: { notificationSocket: { emitUserNotification: () => undefined } },
} as any;

import { prisma } from "./src/barrel/prisma";
import { saveSignaturePlacements } from "./src/controller/disseminationController";

const TS = Date.now();

const mockRes = () => {
  const r: any = {
    _code: 0,
    _body: null as any,
    code(n: number) { this._code = n; return this; },
    send(b: unknown) { this._body = b; return this; },
    status(n: number) { return this.code(n); },
  };
  return r;
};

/** Run the handler and report what came back, error or not. */
const save = async (
  actorAccountId: string,
  body: Record<string, unknown>,
): Promise<{ ok: boolean; code: number; message: string }> => {
  const r = mockRes();
  try {
    await saveSignaturePlacements(
      { user: { id: actorAccountId }, body } as any,
      r,
    );
    return { ok: true, code: r._code, message: String(r._body?.message ?? "") };
  } catch (e: any) {
    return {
      ok: false,
      code: Number(e?.statusCode ?? e?.status ?? 0),
      message: String(e?.message ?? e),
    };
  }
};

const box = (slotIndex: number, page = 1) => ({
  page,
  slotIndex,
  xAxis: 1000 + slotIndex * 100,
  yAxis: 2000,
  width: 1500,
  height: 500,
});

(async () => {
  let pass = 0, fail = 0;
  const ok = (l: string, c: boolean, d = "") => {
    if (c) { pass++; console.log("PASS  " + l); }
    else { fail++; console.log("FAIL  " + l + (d ? "  -> " + d : "")); }
  };

  const made = {
    userIds: [] as string[],
    accountIds: [] as string[],
    roomIds: [] as string[],
    queueIds: [] as string[],
    docIds: [] as string[],
  };

  try {
    const line = await prisma.line.findFirst({ select: { id: true } });
    if (!line) { console.log("NO FIXTURE (line)"); process.exit(2); }

    const mk = async (tag: string) => {
      const acct = await prisma.account.create({
        data: { username: `qa_pl_${TS}_${tag}`, password: "x", lineId: line.id },
        select: { id: true, username: true },
      });
      made.accountIds.push(acct.id);
      const u = await prisma.user.create({
        data: {
          firstName: "Qa", lastName: `PL${TS}${tag.toUpperCase()}`,
          username: acct.username, accountId: acct.id, lineId: line.id,
          email: `qa-pl-${TS}-${tag}@test.local`, active: 1,
        },
        select: { id: true },
      });
      made.userIds.push(u.id);
      return { accountId: acct.id, userId: u.id };
    };

    const SENDER = await mk("sender");
    const SIGNER = await mk("signer");
    const OUTSIDER = await mk("outsider");

    const FROM = await prisma.receivingRoom.create({
      data: { code: `QA-PL-FROM-${TS}`, lineId: line.id },
      select: { id: true },
    });
    made.roomIds.push(FROM.id);
    await prisma.roomAuthorizedUser.create({
      data: { receivingRoomId: FROM.id, userId: SENDER.userId, type: 0, status: 1 },
    });

    /** A draft routing plus one document, with N signatories attached. */
    const mkQueue = async (tag: string, signatories: number) => {
      const q = await prisma.signatureQueueRoom.create({
        data: {
          title: `qa-pl-${tag}-${TS}`,
          userId: SENDER.userId,
          receivingRoomId: FROM.id,
          status: 0,
          step: 0,
        },
        select: { id: true },
      });
      made.queueIds.push(q.id);
      for (let i = 0; i < signatories; i++) {
        await prisma.signatoryArrangement.create({
          data: {
            signatureQueueRoomId: q.id,
            userId: SIGNER.userId,
            index: i,
            status: 0,
          },
        });
      }
      const doc = await prisma.document.create({
        data: {
          title: `qa-pl-doc-${tag}-${TS}`,
          lineId: line.id,
          userId: SENDER.userId,
          signatureQueueRoomId: q.id,
        },
        select: { id: true },
      });
      made.docIds.push(doc.id);
      return { queueId: q.id, documentId: doc.id };
    };

    /** How many SignatureCoor rows this document currently carries. */
    const coorCount = (documentId: string) =>
      prisma.signatureCoor.count({
        where: { documentPage: { documentId } },
      });

    /** How many arrangements the routing has — the on-the-fly create bug
     *  showed up here as rows nobody asked for. */
    const arrCount = (queueId: string) =>
      prisma.signatoryArrangement.count({
        where: { signatureQueueRoomId: queueId },
      });

    const logCount = (documentId: string) =>
      prisma.documentActivityLogs.count({
        where: {
          title: "Updated signature placements",
          desc: { endsWith: `for document ${documentId}` },
        },
      });

    // ══ 1. A routing with NO signatories refuses every box ═════════════
    console.log("\n-- no signatories --");
    const bare = await mkQueue("bare", 0);

    const r1 = await save(SENDER.accountId, {
      queueRoomId: bare.queueId,
      documentId: bare.documentId,
      userId: SENDER.userId,
      lineId: line.id,
      placements: [box(1)],
    });
    ok("a box is refused when nobody signs", !r1.ok, r1.message);
    ok(
      "the refusal says what to do about it",
      /no signatories/i.test(r1.message) && /choose who signs/i.test(r1.message),
      r1.message,
    );
    ok("...and wrote no coordinates", (await coorCount(bare.documentId)) === 0);
    ok(
      "...and did NOT invent a signatory to hang it on",
      (await arrCount(bare.queueId)) === 0,
      `arrangements=${await arrCount(bare.queueId)}`,
    );

    // The empty save is the one that must still work: it is how the last
    // box is removed from a routing whose signatories were taken away.
    const r2 = await save(SENDER.accountId, {
      queueRoomId: bare.queueId,
      documentId: bare.documentId,
      userId: SENDER.userId,
      lineId: line.id,
      placements: [],
    });
    ok("clearing every box is still allowed", r2.ok, r2.message);

    // ══ 2. Slots beyond the signatory list are refused ═════════════════
    console.log("\n-- slot out of range --");
    const two = await mkQueue("two", 2);

    const r3 = await save(SENDER.accountId, {
      queueRoomId: two.queueId,
      documentId: two.documentId,
      userId: SENDER.userId,
      lineId: line.id,
      placements: [box(1), box(2), box(3)],
    });
    ok("slot #3 on a two-signatory routing is refused", !r3.ok, r3.message);
    ok(
      "the refusal names the slot and the real range",
      /#3/.test(r3.message) && /#1/.test(r3.message) && /#2/.test(r3.message),
      r3.message,
    );
    ok(
      "...and the whole save rolled back, boxes 1 and 2 included",
      (await coorCount(two.documentId)) === 0,
      `coor=${await coorCount(two.documentId)}`,
    );
    ok(
      "...and no third arrangement appeared",
      (await arrCount(two.queueId)) === 2,
      `arrangements=${await arrCount(two.queueId)}`,
    );

    // ══ 3. The legitimate save still works ═════════════════════════════
    console.log("\n-- the normal path --");
    const r4 = await save(SENDER.accountId, {
      queueRoomId: two.queueId,
      documentId: two.documentId,
      userId: SENDER.userId,
      lineId: line.id,
      placements: [box(1), box(2, 1), box(2, 2)],
    });
    ok("three boxes across two slots and two pages save", r4.ok, r4.message);
    ok(
      "...and all three landed",
      (await coorCount(two.documentId)) === 3,
      `coor=${await coorCount(two.documentId)}`,
    );

    const bound = await prisma.signatureCoor.findMany({
      where: { documentPage: { documentId: two.documentId } },
      select: { signatoryArrangementId: true },
    });
    const arrs = await prisma.signatoryArrangement.findMany({
      where: { signatureQueueRoomId: two.queueId },
      select: { id: true, index: true },
    });
    const byIdx = new Map(arrs.map((a) => [a.id, a.index]));
    ok(
      "...each bound to a signatory that actually exists",
      bound.every((b) => b.signatoryArrangementId && byIdx.has(b.signatoryArrangementId)),
    );

    // Replacing the set leaves the set, not the union of both.
    const r5 = await save(SENDER.accountId, {
      queueRoomId: two.queueId,
      documentId: two.documentId,
      userId: SENDER.userId,
      lineId: line.id,
      placements: [box(1)],
    });
    ok("a smaller save replaces rather than merges", r5.ok, r5.message);
    ok(
      "...one box left, not four",
      (await coorCount(two.documentId)) === 1,
      `coor=${await coorCount(two.documentId)}`,
    );

    // ══ 4. The activity log collapses instead of piling up ═════════════
    console.log("\n-- activity log --");
    const noisy = await mkQueue("noisy", 1);
    const before = await logCount(noisy.documentId);

    // Ten saves in a row, the way the auto-save used to fire.
    for (let i = 1; i <= 10; i++) {
      const r = await save(SENDER.accountId, {
        queueRoomId: noisy.queueId,
        documentId: noisy.documentId,
        userId: SENDER.userId,
        lineId: line.id,
        placements: Array.from({ length: i }, (_, k) => box(1, (k % 2) + 1)),
      });
      if (!r.ok) { ok(`save ${i} of 10 succeeded`, false, r.message); break; }
    }
    const after = await logCount(noisy.documentId);
    ok(
      "ten consecutive saves leave ONE log entry, not ten",
      after - before === 1,
      `added ${after - before}`,
    );

    const entry1 = await prisma.documentActivityLogs.findFirst({
      where: {
        title: "Updated signature placements",
        desc: { endsWith: `for document ${noisy.documentId}` },
      },
      select: { desc: true },
    });
    ok(
      "...and that entry reports the LATEST count, not the first",
      /Saved 10 placements/.test(entry1?.desc ?? ""),
      entry1?.desc ?? "(none)",
    );

    // A different document gets its own entry — the collapse is per
    // document, not a global mute.
    const other = await mkQueue("other", 1);
    await save(SENDER.accountId, {
      queueRoomId: other.queueId,
      documentId: other.documentId,
      userId: SENDER.userId,
      lineId: line.id,
      placements: [box(1)],
    });
    ok(
      "a different document still gets its own entry",
      (await logCount(other.documentId)) === 1,
    );

    // ══ 5. The ownership gate is untouched ═════════════════════════════
    console.log("\n-- ownership --");
    const r6 = await save(OUTSIDER.accountId, {
      queueRoomId: two.queueId,
      documentId: two.documentId,
      userId: OUTSIDER.userId,
      lineId: line.id,
      placements: [box(1)],
    });
    ok("somebody outside the sending office is still refused", !r6.ok, r6.message);
    ok(
      "...and the refusal is about permission, not slots",
      /sending office/i.test(r6.message),
      r6.message,
    );

    console.log(`\n${pass} passed, ${fail} failed`);
    process.exitCode = fail === 0 ? 0 : 1;
  } catch (e) {
    console.error("THREW", e);
    process.exitCode = 1;
  } finally {
    // Tear down, deepest first.
    for (const id of made.docIds) {
      await prisma.signatureCoor.deleteMany({
        where: { documentPage: { documentId: id } },
      }).catch(() => {});
      await prisma.documentPage.deleteMany({ where: { documentId: id } }).catch(() => {});
      await prisma.documentActivityLogs.deleteMany({
        where: { desc: { endsWith: `for document ${id}` } },
      }).catch(() => {});
      await prisma.document.delete({ where: { id } }).catch(() => {});
    }
    for (const id of made.queueIds) {
      await prisma.signatoryArrangement.deleteMany({
        where: { signatureQueueRoomId: id },
      }).catch(() => {});
      await prisma.signatureQueueRoom.delete({ where: { id } }).catch(() => {});
    }
    for (const id of made.roomIds) {
      await prisma.roomAuthorizedUser.deleteMany({
        where: { receivingRoomId: id },
      }).catch(() => {});
      await prisma.receivingRoom.delete({ where: { id } }).catch(() => {});
    }
    for (const id of made.userIds) {
      await prisma.documentActivityLogs.deleteMany({ where: { userId: id } }).catch(() => {});
      await prisma.user.delete({ where: { id } }).catch(() => {});
    }
    for (const id of made.accountIds) {
      await prisma.account.delete({ where: { id } }).catch(() => {});
    }
    await prisma.$disconnect();
  }
})();
