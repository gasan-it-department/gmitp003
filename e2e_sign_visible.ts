/* PROOF: a signature that is recorded must be a signature you can see.
 *
 * A signature is only ever DRAWN where a SignatureCoor says to draw it —
 * the download stamps the PDF from those placements, and the on-screen
 * viewer overlays the same ones. A signatory with no box therefore signs
 * successfully, is recorded as having signed, and produces nothing visible
 * on the document. Green tick, blank page. That is the bug this pins.
 *
 * The opposite case — a box with nobody to fill it — is already refused
 * when placements are saved (e2e_placements.ts). This is the other half,
 * and it belongs at dispatch, because the boxes and the signatories are
 * chosen in different steps and either can be edited after the other.
 *
 * Run: npx ts-node --transpile-only e2e_sign_visible.ts */
import path from "path";

const entry = path.join(__dirname, "src", "index.ts");
require.cache[entry] = {
  id: entry,
  filename: entry,
  loaded: true,
  exports: { notificationSocket: { emitUserNotification: () => undefined } },
} as any;

import { prisma } from "./src/barrel/prisma";
import {
  finalizeDissemination,
  saveSignaturePlacements,
  signMine,
} from "./src/controller/disseminationController";

const TS = Date.now();

const mockRes = () => {
  const r: any = {
    _code: 0, _body: null as any,
    code(n: number) { this._code = n; return this; },
    send(b: unknown) { this._body = b; return this; },
    status(n: number) { return this.code(n); },
  };
  return r;
};

const call = async (fn: any, req: any) => {
  const r = mockRes();
  try {
    await fn(req, r);
    return { ok: true, body: r._body, message: "" };
  } catch (e: any) {
    return { ok: false, body: null, message: String(e?.message ?? e) };
  }
};

(async () => {
  let pass = 0, fail = 0;
  const ok = (l: string, c: boolean, d = "") => {
    if (c) { pass++; console.log("PASS  " + l); }
    else { fail++; console.log("FAIL  " + l + (d ? "  -> " + d : "")); }
  };

  const made = {
    userIds: [] as string[], accountIds: [] as string[],
    roomIds: [] as string[], queueIds: [] as string[],
    docIds: [] as string[], sigIds: [] as string[],
  };

  try {
    const line = await prisma.line.findFirst({ select: { id: true } });
    if (!line) { console.log("NO FIXTURE (line)"); process.exit(2); }

    const mk = async (tag: string) => {
      const acct = await prisma.account.create({
        data: { username: `qa_sv_${TS}_${tag}`, password: "x", lineId: line.id },
        select: { id: true, username: true },
      });
      made.accountIds.push(acct.id);
      const u = await prisma.user.create({
        data: {
          firstName: `Qa${tag}`, lastName: `SV${TS}`, username: acct.username,
          accountId: acct.id, lineId: line.id,
          email: `qa-sv-${TS}-${tag}@test.local`, active: 1,
        },
        select: { id: true },
      });
      made.userIds.push(u.id);
      return { accountId: acct.id, userId: u.id };
    };

    const SENDER = await mk("sender");
    const A = await mk("a");
    const B = await mk("b");

    // Signing refuses outright without an active signature on file.
    for (const who of [A, B]) {
      const sg = await prisma.signature.create({
        data: { title: `qa-sv-${TS}`, userId: who.userId, active: true },
        select: { id: true },
      });
      made.sigIds.push(sg.id);
    }

    const FROM = await prisma.receivingRoom.create({
      data: { code: `QA-SV-FROM-${TS}`, lineId: line.id }, select: { id: true },
    });
    const TO = await prisma.receivingRoom.create({
      data: { code: `QA-SV-TO-${TS}`, lineId: line.id }, select: { id: true },
    });
    made.roomIds.push(FROM.id, TO.id);
    await prisma.roomAuthorizedUser.create({
      data: { receivingRoomId: FROM.id, userId: SENDER.userId, type: 0, status: 1 },
    });
    await prisma.roomAuthorizedUser.create({
      data: { receivingRoomId: TO.id, userId: A.userId, type: 0, status: 1 },
    });

    /** A draft with one document, one recipient, and N signatories. */
    const mkQueue = async (tag: string, signers: { userId: string }[]) => {
      const q = await prisma.signatureQueueRoom.create({
        data: {
          title: `qa-sv-${tag}-${TS}`, userId: SENDER.userId,
          receivingRoomId: FROM.id, status: 0, step: 0,
        },
        select: { id: true },
      });
      made.queueIds.push(q.id);
      await prisma.targetRoom.create({
        data: { signatureQueueRoomId: q.id, receivingRoomId: TO.id },
      });
      const doc = await prisma.document.create({
        data: {
          title: `qa-sv-doc-${tag}-${TS}`, lineId: line.id,
          userId: SENDER.userId, signatureQueueRoomId: q.id,
        },
        select: { id: true },
      });
      made.docIds.push(doc.id);
      for (let i = 0; i < signers.length; i++) {
        await prisma.signatoryArrangement.create({
          data: {
            signatureQueueRoomId: q.id, index: i, status: 0,
            userId: signers[i].userId,
          },
        });
      }
      return { queueId: q.id, documentId: doc.id };
    };

    const placeBoxes = (q: { queueId: string; documentId: string }, slots: number[]) =>
      call(saveSignaturePlacements, {
        user: { id: SENDER.accountId },
        body: {
          queueRoomId: q.queueId, documentId: q.documentId,
          userId: SENDER.userId, lineId: line.id,
          placements: slots.map((s) => ({
            page: 1, slotIndex: s,
            xAxis: 1000 * s, yAxis: 2000, width: 1500, height: 500,
          })),
        },
      });

    const dispatch = (queueId: string) =>
      call(finalizeDissemination, {
        user: { id: SENDER.accountId },
        body: { queueRoomId: queueId, userId: SENDER.userId, lineId: line.id },
      });

    // ══ 1. Two signatories, a box for only one ═════════════════════════
    console.log("\n-- a signatory with no box --");
    const half = await mkQueue("half", [A, B]);
    const p1 = await placeBoxes(half, [1]);
    ok("a box for slot 1 saves", p1.ok, p1.message);

    const d1 = await dispatch(half.queueId);
    ok("dispatch is REFUSED — slot 2 has nowhere to sign", !d1.ok, d1.message);
    ok(
      "...and the refusal names the slot",
      /#2/.test(d1.message) && /no signature box/i.test(d1.message),
      d1.message,
    );
    ok(
      "...and says what to do about it",
      /Add a box/i.test(d1.message) && /remove/i.test(d1.message),
      d1.message,
    );
    const stillDraft = await prisma.signatureQueueRoom.findUnique({
      where: { id: half.queueId }, select: { status: true },
    });
    ok("...and the routing is still a draft", stillDraft?.status === 0);

    // Give slot 2 a box and it goes out.
    const p2 = await placeBoxes(half, [1, 2]);
    ok("adding a box for slot 2 saves", p2.ok, p2.message);
    const d2 = await dispatch(half.queueId);
    ok("now it dispatches", d2.ok, d2.message);

    // ══ 2. Signing lands somewhere, and says so ════════════════════════
    console.log("\n-- signing a slot that HAS a box --");
    const s1 = await call(signMine, {
      user: { id: A.accountId },
      body: { queueRoomId: half.queueId, userId: A.userId },
    });
    ok("A signs", s1.ok, s1.message);
    ok("...one slot signed", s1.body?.signed === 1, JSON.stringify(s1.body));
    ok(
      "...and nothing is reported as invisible",
      Array.isArray(s1.body?.unstamped) && s1.body.unstamped.length === 0,
      JSON.stringify(s1.body?.unstamped),
    );

    // The download stamps from exactly these rows — confirm one is ready.
    const stampable = await prisma.signatureCoor.count({
      where: {
        documentPage: { documentId: half.documentId },
        signatoryArrangement: { status: 1, userId: { not: null } },
      },
    });
    ok(
      "...and the document now has a box the stamper will fill",
      stampable === 1,
      `stampable=${stampable}`,
    );

    // ══ 3. An older routing, already in the bad state ══════════════════
    // Dispatch cannot produce this any more, so build it the way one that
    // went out before the check would look, and prove the signer is told.
    console.log("\n-- an already-dispatched routing with a bare slot --");
    const old = await mkQueue("old", [A, B]);
    await placeBoxes(old, [1, 2]);
    await dispatch(old.queueId);
    // Slot 2's box is removed after dispatch, the way editing a document
    // out from under a live routing would do.
    const slot2 = await prisma.signatoryArrangement.findFirst({
      where: { signatureQueueRoomId: old.queueId, index: 1 },
      select: { id: true },
    });
    await prisma.signatureCoor.deleteMany({
      where: { signatoryArrangementId: slot2!.id },
    });

    const s2 = await call(signMine, {
      user: { id: B.accountId },
      body: { queueRoomId: old.queueId, userId: B.userId },
    });
    ok("B still signs — the record is not refused", s2.ok, s2.message);
    ok("...the slot is recorded as signed", s2.body?.signed === 1, JSON.stringify(s2.body));
    ok(
      "...but the response says slot #2 will not appear",
      Array.isArray(s2.body?.unstamped) &&
        s2.body.unstamped.length === 1 &&
        s2.body.unstamped[0] === 2,
      JSON.stringify(s2.body?.unstamped),
    );
    const arrB = await prisma.signatoryArrangement.findFirst({
      where: { signatureQueueRoomId: old.queueId, index: 1 },
      select: { status: true, signedAt: true },
    });
    ok(
      "...and the signature really is on the record, not discarded",
      arrB?.status === 1 && !!arrB?.signedAt,
    );

    // ══ 4. A routing nobody signs is unaffected ════════════════════════
    console.log("\n-- no signatories at all --");
    const bare = await mkQueue("bare", []);
    const d3 = await dispatch(bare.queueId);
    ok("a no-signature routing still dispatches", d3.ok, d3.message);

    console.log(`\n${pass} passed, ${fail} failed`);
    process.exitCode = fail === 0 ? 0 : 1;
  } catch (e) {
    console.error("THREW", e);
    process.exitCode = 1;
  } finally {
    for (const id of made.queueIds) {
      await prisma.targetRoom.deleteMany({ where: { signatureQueueRoomId: id } }).catch(() => {});
    }
    for (const id of made.docIds) {
      await prisma.signatureCoor.deleteMany({ where: { documentPage: { documentId: id } } }).catch(() => {});
      await prisma.documentPage.deleteMany({ where: { documentId: id } }).catch(() => {});
      await prisma.documentActivityLogs.deleteMany({ where: { desc: { contains: id } } }).catch(() => {});
      await prisma.document.delete({ where: { id } }).catch(() => {});
    }
    for (const id of made.queueIds) {
      await prisma.documentActivityLogs.deleteMany({ where: { desc: { contains: id } } }).catch(() => {});
      await prisma.signatoryArrangement.deleteMany({ where: { signatureQueueRoomId: id } }).catch(() => {});
      await prisma.signatureQueueRoom.delete({ where: { id } }).catch(() => {});
    }
    for (const id of made.sigIds) {
      await prisma.signature.delete({ where: { id } }).catch(() => {});
    }
    for (const id of made.roomIds) {
      await prisma.roomAuthorizedUser.deleteMany({ where: { receivingRoomId: id } }).catch(() => {});
      await prisma.receivingRoom.delete({ where: { id } }).catch(() => {});
    }
    for (const id of made.userIds) {
      await prisma.notification.deleteMany({ where: { userId: id } }).catch(() => {});
      await prisma.documentActivityLogs.deleteMany({ where: { userId: id } }).catch(() => {});
      await prisma.user.delete({ where: { id } }).catch(() => {});
    }
    for (const id of made.accountIds) {
      await prisma.account.delete({ where: { id } }).catch(() => {});
    }
    await prisma.$disconnect();
  }
})();
