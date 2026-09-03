/* PROOF: a routing, and its files, are only for the people it involves.
 *
 * Detail, view, the document list, the PDF stream and the signed download
 * all took an id and handed the thing over. A signed-in account could read
 * any routing in the municipality — every page, every signature image —
 * by changing one uuid. Gating the metadata alone would have been theatre:
 * the files are the point, and they were the widest door.
 *
 * Three ways in, and all three are real: a signatory on it, the sending
 * office, and an office it actually reached. The awkward ones are what
 * this file is for. A HELD copy-furnished office has not been given the
 * document and must not learn it exists. An UNASSIGNED signatory slot —
 * a third of the slots in the wild have no user — must grant nothing, or
 * "nobody holds this" becomes "anybody may look".
 *
 * And the file endpoint is shared with Self Sign, whose documents belong
 * to no routing at all. Gating it on routing membership alone would have
 * broken Self Sign; gating it not at all left every private upload in the
 * municipality one id away from anybody. Both are checked here.
 *
 * Run: npx ts-node --transpile-only e2e_routing_access.ts */
import path from "path";

const entry = path.join(__dirname, "src", "index.ts");
require.cache[entry] = {
  id: entry, filename: entry, loaded: true,
  exports: { notificationSocket: { emitUserNotification: () => undefined } },
} as any;

import { prisma } from "./src/barrel/prisma";
import {
  setTargetRooms,
  finalizeDissemination,
  disseminationDetail,
  viewDissemination,
  disseminationDocuments,
  streamDocumentFile,
  removeDisseminationDocument,
} from "./src/controller/disseminationController";
import { ROOM_MEMBER_TYPES } from "./src/controller/roomConfigController";

const TS = Date.now();

const mockRes = () => {
  const r: any = {
    _code: 0, _body: null as any, _sent: false,
    code(n: number) { this._code = n; return this; },
    send(b: unknown) { this._body = b; this._sent = true; return this; },
    status(n: number) { return this.code(n); },
    header() { return this; },
    type() { return this; },
  };
  return r;
};

(async () => {
  let pass = 0, fail = 0;
  const ok = (l: string, c: boolean, d = "") => {
    if (c) { pass++; console.log("PASS  " + l); }
    else { fail++; console.log("FAIL  " + l + (d ? "  -> " + d : "")); }
  };
  const made = {
    userIds: [] as string[], accountIds: [] as string[],
    roomIds: [] as string[], queueIds: [] as string[], docIds: [] as string[],
    lineId: "",
  };

  try {
    const loc = await prisma.line.findFirst({
      select: { barangayId: true, municipalId: true, provinceId: true, regionId: true },
    });
    if (!loc) { console.log("NO FIXTURE (line)"); process.exit(2); }
    const line = await prisma.line.create({
      data: { name: `QA Access ${TS}`, ...loc }, select: { id: true },
    });
    made.lineId = line.id;

    const mk = async (tag: string) => {
      const acct = await prisma.account.create({
        data: { username: `qa_acc_${TS}_${tag}`, password: "x", lineId: line.id },
        select: { id: true, username: true },
      });
      made.accountIds.push(acct.id);
      const u = await prisma.user.create({
        data: {
          firstName: "Qa", lastName: `ACC${tag.toUpperCase()}`,
          username: acct.username, accountId: acct.id, lineId: line.id,
          email: `qa-acc-${TS}-${tag}@test.local`, active: 1,
        },
        select: { id: true },
      });
      made.userIds.push(u.id);
      return { accountId: acct.id, userId: u.id };
    };
    const mkRoom = async (code: string) => {
      const r = await prisma.receivingRoom.create({
        data: { code: `${code}-${TS}`, lineId: line.id }, select: { id: true },
      });
      made.roomIds.push(r.id);
      return r;
    };
    const join = (roomId: string, userId: string, type: number) =>
      prisma.roomAuthorizedUser.create({
        data: { receivingRoomId: roomId, userId, type, status: 1 },
      });

    const SENDER    = await mk("sender");    // sending room
    const LONESIGN  = await mk("lonesign");  // signatory, in NEITHER room
    const RECIPIENT = await mk("recipient"); // addressed office
    const CFPERSON  = await mk("cf");        // copy-furnished, still held
    const NOSY      = await mk("nosy");      // unrelated office
    const SELFOWNER = await mk("selfowner"); // owns a Self Sign upload

    const FROM = await mkRoom("QA-FROM");
    const TO   = await mkRoom("QA-TO");
    const CC   = await mkRoom("QA-CC");
    const ELSE = await mkRoom("QA-ELSE");
    await join(FROM.id, SENDER.userId,    ROOM_MEMBER_TYPES.owner);
    await join(TO.id,   RECIPIENT.userId, ROOM_MEMBER_TYPES.receiver);
    await join(CC.id,   CFPERSON.userId,  ROOM_MEMBER_TYPES.receiver);
    await join(ELSE.id, NOSY.userId,      ROOM_MEMBER_TYPES.owner);

    const q = await prisma.signatureQueueRoom.create({
      data: { title: `SECRET ${TS}`, userId: SENDER.userId,
              receivingRoomId: FROM.id, status: 0, step: 0 },
      select: { id: true },
    });
    made.queueIds.push(q.id);
    // One assigned slot for a signatory who belongs to neither room, and
    // one UNASSIGNED slot, which must open nothing for anybody.
    await prisma.signatoryArrangement.create({
      data: { signatureQueueRoomId: q.id, userId: LONESIGN.userId, index: 0, status: 0 },
    });
    await prisma.signatoryArrangement.create({
      data: { signatureQueueRoomId: q.id, userId: null, index: 1, status: 0 },
    });
    const doc = await prisma.document.create({
      data: { title: `qa-acc-doc-${TS}`, lineId: line.id,
              userId: SENDER.userId, signatureQueueRoomId: q.id },
      select: { id: true },
    });
    made.docIds.push(doc.id);
    await prisma.decodedFile.create({
      data: { documentId: doc.id, fileName: "x.pdf", fileSize: "11",
              fileType: "application/pdf",
              fileDecoded: Buffer.from("%PDF-1.4 qa") },
    });

    // A Self Sign upload: no routing at all, one owner.
    const selfDoc = await prisma.document.create({
      data: { title: `qa-self-${TS}`, lineId: line.id, userId: SELFOWNER.userId },
      select: { id: true },
    });
    made.docIds.push(selfDoc.id);
    await prisma.decodedFile.create({
      data: { documentId: selfDoc.id, fileName: "s.pdf", fileSize: "13",
              fileType: "application/pdf",
              fileDecoded: Buffer.from("%PDF-1.4 self") },
    });

    let res = mockRes();
    await setTargetRooms({
      user: { id: SENDER.accountId },
      body: { queueRoomId: q.id, targetRoomIds: [TO.id],
              copyFurnishedRoomIds: [CC.id],
              userId: SENDER.userId, lineId: line.id },
    } as any, res);
    res = mockRes();
    await finalizeDissemination({
      user: { id: SENDER.accountId },
      body: { queueRoomId: q.id, userId: SENDER.userId, lineId: line.id },
    } as any, res);
    ok("dispatched", res._code === 200, JSON.stringify(res._body));

    const tryIt = async (fn: any, accountId: string | null, query: any) => {
      const r = mockRes();
      let threw: any = null;
      await fn({ user: accountId ? { id: accountId } : undefined, query } as any, r)
        .catch((e: any) => { threw = e; });
      return { r, threw, okd: !threw && r._code === 200 };
    };

    // ── The three doors are open ────────────────────────────────────────
    for (const [who, acct] of [
      ["the sending office", SENDER.accountId],
      ["the addressed office", RECIPIENT.accountId],
      ["a signatory in neither room", LONESIGN.accountId],
    ] as const) {
      ok(`${who} can view the routing`,
        (await tryIt(viewDissemination, acct, { id: q.id })).okd);
      ok(`${who} can list its documents`,
        (await tryIt(disseminationDocuments, acct, { queueRoomId: q.id })).okd);
      ok(`${who} can fetch the file`,
        (await tryIt(streamDocumentFile, acct, { id: doc.id })).okd);
    }
    ok("the sending office can open the setup detail",
      (await tryIt(disseminationDetail, SENDER.accountId, { id: q.id })).okd);

    // ── And shut to everyone else ───────────────────────────────────────
    let bad = await tryIt(viewDissemination, NOSY.accountId, { id: q.id });
    ok("an unrelated office cannot view it", !!bad.threw);
    ok("…and the refusal does not leak the subject",
      !String(bad.threw?.message ?? "").includes("SECRET"), bad.threw?.message);
    ok("…nor list its documents",
      !!(await tryIt(disseminationDocuments, NOSY.accountId, { queueRoomId: q.id })).threw);
    ok("…nor pull the PDF, which was the real door",
      !!(await tryIt(streamDocumentFile, NOSY.accountId, { id: doc.id })).threw);
    ok("…nor open the setup detail",
      !!(await tryIt(disseminationDetail, NOSY.accountId, { id: q.id })).threw);
    ok("an unauthenticated call gets nothing",
      !!(await tryIt(viewDissemination, null, { id: q.id })).threw);

    // ── A held copy-furnished office is not a recipient yet ─────────────
    bad = await tryIt(viewDissemination, CFPERSON.accountId, { id: q.id });
    ok("a HELD copy-furnished office cannot view it", !!bad.threw,
      "it has not been given the document");
    ok("…nor fetch its file",
      !!(await tryIt(streamDocumentFile, CFPERSON.accountId, { id: doc.id })).threw);

    // …until it is released, at which point it is a recipient like any other.
    await prisma.targetRoom.updateMany({
      where: { signatureQueueRoomId: q.id, receivingRoomId: CC.id },
      data: { releasedAt: new Date(), status: 1 },
    });
    ok("once released, that same office CAN view it",
      (await tryIt(viewDissemination, CFPERSON.accountId, { id: q.id })).okd);

    // ── Self Sign: shared endpoint, different rule ──────────────────────
    ok("the owner of a Self Sign file can fetch it",
      (await tryIt(streamDocumentFile, SELFOWNER.accountId, { id: selfDoc.id })).okd);
    ok("nobody else can — it belongs to no routing, so only its owner",
      !!(await tryIt(streamDocumentFile, NOSY.accountId, { id: selfDoc.id })).threw);
    ok("…not even the sender of the other routing",
      !!(await tryIt(streamDocumentFile, SENDER.accountId, { id: selfDoc.id })).threw);

    // ── Writes are narrower than reads ──────────────────────────────────
    const del = async (accountId: string) => {
      const r = mockRes();
      let threw: any = null;
      await removeDisseminationDocument(
        { user: { id: accountId },
          query: { id: doc.id, queueRoomId: q.id } } as any, r,
      ).catch((e) => { threw = e; });
      return { r, threw };
    };
    let w = await del(RECIPIENT.accountId);
    ok("a RECIPIENT cannot delete the sender's attachment", !!w.threw,
      "they can read it; that is not the same as changing it");
    ok("…and it is still attached",
      (await prisma.document.count({
        where: { id: doc.id, signatureQueueRoomId: q.id },
      })) === 1);
    w = await del(LONESIGN.accountId);
    ok("nor can a signatory", !!w.threw, w.threw?.message);
    w = await del(NOSY.accountId);
    ok("nor an outsider", !!w.threw);
  } catch (e: any) {
    fail++;
    console.log("FAIL  threw: " + (e?.stack ?? e?.message ?? String(e)));
  } finally {
    try {
      if (made.docIds.length) {
        const d = { documentId: { in: made.docIds } };
        await prisma.documentActivityLogs.deleteMany({ where: d }).catch(() => undefined);
        await prisma.documentPage.deleteMany({ where: d }).catch(() => undefined);
        await prisma.decodedFile.deleteMany({ where: d }).catch(() => undefined);
        await prisma.document.deleteMany({ where: { id: { in: made.docIds } } });
      }
      if (made.queueIds.length) {
        const qs = { signatureQueueRoomId: { in: made.queueIds } };
        await prisma.targetRoom.deleteMany({ where: qs });
        await prisma.signatoryArrangement.deleteMany({ where: qs });
        await prisma.signatureQueueRoom.deleteMany({ where: { id: { in: made.queueIds } } });
      }
      if (made.roomIds.length) {
        await prisma.roomAuthorizedUser.deleteMany({
          where: { receivingRoomId: { in: made.roomIds } },
        });
        await prisma.receivingRoom.deleteMany({ where: { id: { in: made.roomIds } } });
      }
      if (made.userIds.length) {
        const who = { in: made.userIds };
        await prisma.notification.deleteMany({
          where: { OR: [{ recipientId: who }, { senderId: who }] },
        }).catch(() => undefined);
        await prisma.documentActivityLogs.deleteMany({ where: { userId: who } })
          .catch(() => undefined);
        await prisma.user.deleteMany({ where: { id: who } });
      }
      if (made.accountIds.length)
        await prisma.account.deleteMany({ where: { id: { in: made.accountIds } } });
      if (made.lineId)
        await prisma.line.delete({ where: { id: made.lineId } }).catch(() => undefined);
      const left = await prisma.receivingRoom.count({
        where: { code: { endsWith: `-${TS}` } },
      });
      console.log(`CLEANUP  leftover rooms=${left}`);
      if (left) fail++;
    } catch (e: any) {
      console.log("CLEANUP FAILED: " + (e?.message ?? e));
      fail++;
    }
    console.log(`\n${pass} passed, ${fail} failed`);
    await prisma.$disconnect();
    process.exit(fail ? 1 : 0);
  }
})();
