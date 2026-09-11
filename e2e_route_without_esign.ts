/* PROOF: a document can be routed without asking anyone to sign it, and
 * the copy-furnished offices still get it.
 *
 * Not everything an office sends needs a signature. A memo, a transmittal,
 * an advisory — the recipient needs to HAVE it, not sign it. The API always
 * allowed this (finalize requires a recipient and a document, never a
 * signatory) but the wizard refused to let you past the Signatories step
 * with an empty list, so it could not be reached.
 *
 * Three things have to be true for it to actually work, and each is easy
 * to get wrong:
 *
 *  1. Copy furnished must still arrive. Those rows are normally HELD until
 *     the last signature lands; with no signatures coming, holding them
 *     forever is the obvious bug. They are released at dispatch instead.
 *
 *  2. The routing must not sit at "active" forever. Active means signatures
 *     are outstanding. With none required it would park in the Outbox and
 *     in the Activity panel's "Out for signature" pile permanently, reading
 *     0 of 0 signed — so it is Completed at dispatch.
 *
 *  3. Boxes with nobody to fill them must be refused. The placement editor
 *     offers a free-form slot picker when no signatories are chosen, so it
 *     is possible to draw signature boxes and then skip the step. That
 *     would dispatch a document with empty rectangles on it forever.
 *
 * Run: npx ts-node --transpile-only e2e_route_without_esign.ts */
import path from "path";

const entry = path.join(__dirname, "src", "index.ts");
require.cache[entry] = {
  id: entry, filename: entry, loaded: true,
  exports: { notificationSocket: { emitUserNotification: () => undefined } },
} as any;

import { prisma } from "./src/barrel/prisma";
import {
  finalizeDissemination,
  setSignatoryArrangement,
  acknowledgeReceipt,
  disseminationInbox,
  disseminationOutbox,
} from "./src/controller/disseminationController";
import { documentActivityPanel } from "./src/controller/documentActivityController";
import { ROOM_MEMBER_TYPES } from "./src/controller/roomConfigController";

const TS = Date.now();

const mockRes = () => {
  const r: any = {
    _code: 0, _body: null as any,
    code(n: number) { this._code = n; return this; },
    send(b: unknown) { this._body = b; return this; },
    status(n: number) { return this.code(n); },
    header() { return this; },
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
    roomIds: [] as string[], queueIds: [] as string[], lineIds: [] as string[],
    docIds: [] as string[],
  };

  try {
    const loc = await prisma.line.findFirst({
      select: { barangayId: true, municipalId: true, provinceId: true, regionId: true },
    });
    if (!loc) { console.log("NO FIXTURE (line)"); process.exit(2); }
    const LINE = await prisma.line.create({
      data: { name: `QA NS ${TS}`, ...loc }, select: { id: true } });
    made.lineIds.push(LINE.id);

    const mk = async (tag: string) => {
      const acct = await prisma.account.create({
        data: { username: `qa_ns_${TS}_${tag}`, password: "x", lineId: LINE.id },
        select: { id: true, username: true } });
      made.accountIds.push(acct.id);
      const u = await prisma.user.create({
        data: { firstName: "Qa", lastName: `Ns${tag.toUpperCase()}`,
                username: acct.username, accountId: acct.id, lineId: LINE.id,
                email: `qa-ns-${TS}-${tag}@test.local`, active: 1 },
        select: { id: true } });
      made.userIds.push(u.id);
      return { accountId: acct.id, userId: u.id };
    };
    const SENDER  = await mk("sender");
    const RECV    = await mk("recv");
    const CFSTAFF = await mk("cfstaff");

    const mkRoom = async (code: string) => {
      const r = await prisma.receivingRoom.create({
        data: { code, lineId: LINE.id }, select: { id: true, code: true } });
      made.roomIds.push(r.id); return r;
    };
    const FROM_ROOM = await mkRoom(`QA-NS-FROM-${TS}`);
    const TO_ROOM   = await mkRoom(`QA-NS-TO-${TS}`);
    const CF_ROOM   = await mkRoom(`QA-NS-CF-${TS}`);
    const member = (roomId: string, userId: string, type: number) =>
      prisma.roomAuthorizedUser.create({
        data: { receivingRoomId: roomId, userId, type, status: 1 } });
    await member(FROM_ROOM.id, SENDER.userId, ROOM_MEMBER_TYPES.owner);
    await member(TO_ROOM.id, RECV.userId, ROOM_MEMBER_TYPES.receiver);
    await member(CF_ROOM.id, CFSTAFF.userId, ROOM_MEMBER_TYPES.receiver);

    const call = async (fn: any, accountId: string | null, payload: any,
                        key: "body" | "query" = "query") => {
      const r = mockRes();
      let threw: any = null;
      await fn({ user: accountId ? { id: accountId } : undefined,
                 [key]: payload, headers: {} } as any, r)
        .catch((e: any) => { threw = e; });
      return { r, threw, body: r._body, okd: !threw && r._code === 200 };
    };

    /** A draft memo: one addressee, one copy furnished, one attachment. */
    const draft = async (title: string) => {
      const q = await prisma.signatureQueueRoom.create({
        data: { userId: SENDER.userId, receivingRoomId: FROM_ROOM.id,
                title, status: 0, step: 0 },
        select: { id: true } });
      made.queueIds.push(q.id);
      const d = await prisma.document.create({
        data: { title: `${title} FILE`, lineId: LINE.id,
                userId: SENDER.userId, signatureQueueRoomId: q.id },
        select: { id: true } });
      made.docIds.push(d.id);
      const addressed = await prisma.targetRoom.create({
        data: { signatureQueueRoomId: q.id, receivingRoomId: TO_ROOM.id,
                status: 0 }, select: { id: true } });
      const furnished = await prisma.targetRoom.create({
        data: { signatureQueueRoomId: q.id, receivingRoomId: CF_ROOM.id,
                status: 0, copyFurnished: true, releasedAt: null },
        select: { id: true } });
      return { queueId: q.id, docId: d.id,
               addressedId: addressed.id, furnishedId: furnished.id };
    };

    // ── Choosing nobody is a real choice ────────────────────────────────
    const memo = await draft(`QA NS MEMO ${TS}`);
    let out = await call(setSignatoryArrangement, SENDER.accountId,
      { queueRoomId: memo.queueId, signatories: [], userId: SENDER.userId,
        lineId: LINE.id }, "body");
    ok("an empty signatory list is accepted", out.okd, out.threw?.message);
    ok("…and no arrangement rows are created",
      (await prisma.signatoryArrangement.count({
        where: { signatureQueueRoomId: memo.queueId } })) === 0);

    // ── Dispatch ────────────────────────────────────────────────────────
    out = await call(finalizeDissemination, SENDER.accountId,
      { queueRoomId: memo.queueId, userId: SENDER.userId, lineId: LINE.id },
      "body");
    ok("it dispatches with no signatories at all", out.okd, out.threw?.message);

    const q = await prisma.signatureQueueRoom.findUnique({
      where: { id: memo.queueId }, select: { status: true, step: true } });
    ok("…and is Completed, not left Active forever",
      q?.status === 2,
      `status ${q?.status} — Active would park it in the Outbox with 0 of 0 signed`);

    const rows = await prisma.targetRoom.findMany({
      where: { signatureQueueRoomId: memo.queueId },
      select: { id: true, copyFurnished: true, releasedAt: true,
                receivedAt: true, status: true } });
    const addressed = rows.find((r) => r.id === memo.addressedId);
    const furnished = rows.find((r) => r.id === memo.furnishedId);
    ok("the addressee has it", addressed?.status === 1 && !!addressed?.receivedAt);
    ok("the copy-furnished office has it TOO, immediately",
      !!furnished?.releasedAt,
      "held rows would wait on a signature that is never coming");
    ok("…delivered at the same moment as the addressee",
      !!furnished?.receivedAt && !!addressed?.receivedAt &&
      Math.abs(furnished!.receivedAt!.getTime() -
               addressed!.receivedAt!.getTime()) < 5000,
      JSON.stringify({ cf: furnished?.receivedAt, ad: addressed?.receivedAt }));

    // ── Everyone was told, and can act ──────────────────────────────────
    const notifs = async (userId: string) =>
      prisma.notification.findMany({
        where: { recipientId: userId }, select: { title: true } });
    ok("the addressed office is notified",
      (await notifs(RECV.userId)).some((n) => n.title === "Document received"));
    ok("the copy-furnished office is notified",
      (await notifs(CFSTAFF.userId)).some((n) => n.title === "Copy furnished"),
      "released at dispatch, so told at dispatch");

    out = await call(disseminationInbox, RECV.accountId, { toRoomId: TO_ROOM.id });
    ok("it shows in the addressee's inbox", out.okd &&
      (out.body?.list ?? []).some((r: any) => r.id === memo.addressedId),
      out.threw?.message);
    out = await call(disseminationInbox, CFSTAFF.accountId,
      { toRoomId: CF_ROOM.id });
    ok("…and in the copy-furnished office's inbox",
      (out.body?.list ?? []).some((r: any) => r.id === memo.furnishedId),
      "a released row is visible; a held one is not");

    out = await call(acknowledgeReceipt, RECV.accountId,
      { targetRoomId: memo.addressedId, received: true }, "body");
    ok("a completed routing can still be marked received", out.okd,
      out.threw?.message);
    out = await call(acknowledgeReceipt, CFSTAFF.accountId,
      { targetRoomId: memo.furnishedId, received: true }, "body");
    ok("…including by the copy-furnished office", out.okd, out.threw?.message);

    // ── Where the sender sees it ────────────────────────────────────────
    out = await call(disseminationOutbox, SENDER.accountId,
      { fromRoomId: FROM_ROOM.id, status: "completed", limit: "20" });
    ok("the sender finds it under Completed",
      (out.body?.list ?? []).some((r: any) => r.id === memo.queueId),
      out.threw?.message);
    out = await call(disseminationOutbox, SENDER.accountId,
      { fromRoomId: FROM_ROOM.id, status: "active", limit: "20" });
    ok("…and NOT stuck under Active",
      !(out.body?.list ?? []).some((r: any) => r.id === memo.queueId));

    out = await call(documentActivityPanel, SENDER.accountId,
      { roomId: FROM_ROOM.id });
    ok("the Activity panel does not list it as out for signature",
      !(out.body?.outbox?.inFlight ?? []).some(
        (r: any) => r.queueId === memo.queueId),
      "nothing is out for signature — there are no signatures");
    ok("…and counts it as completed",
      (out.body?.outbox?.completed ?? 0) >= 1,
      JSON.stringify(out.body?.outbox));

    // ── Boxes with nobody to fill them ──────────────────────────────────
    const orphan = await draft(`QA NS ORPHAN ${TS}`);
    const page = await prisma.documentPage.create({
      data: { documentId: orphan.docId, page: 1, content: "" },
      select: { id: true } });
    await prisma.signatureCoor.create({
      data: { xAxis: 1000, yAxis: 8000, width: 3000, height: 800,
              documentPageId: page.id, signatoryArrangementId: null } });

    out = await call(finalizeDissemination, SENDER.accountId,
      { queueRoomId: orphan.queueId, userId: SENDER.userId, lineId: LINE.id },
      "body");
    ok("a document with signature boxes and no signatories is refused",
      !!out.threw, "it would dispatch with empty rectangles forever");
    ok("…in words that say what to do about it",
      /signator/i.test(out.threw?.message ?? "") &&
      /box/i.test(out.threw?.message ?? ""),
      out.threw?.message);
    ok("…and it stays a draft",
      (await prisma.signatureQueueRoom.findUnique({
        where: { id: orphan.queueId }, select: { status: true } }))?.status === 0);
    ok("…with its copy-furnished office still held",
      (await prisma.targetRoom.findUnique({
        where: { id: orphan.furnishedId },
        select: { releasedAt: true } }))?.releasedAt === null);

    // Remove the boxes and the same routing goes out fine.
    await prisma.signatureCoor.deleteMany({ where: { documentPageId: page.id } });
    out = await call(finalizeDissemination, SENDER.accountId,
      { queueRoomId: orphan.queueId, userId: SENDER.userId, lineId: LINE.id },
      "body");
    ok("remove the boxes and it dispatches", out.okd, out.threw?.message);

    // ── The ordinary path is untouched ──────────────────────────────────
    const signed = await draft(`QA NS SIGNED ${TS}`);
    await prisma.signatoryArrangement.create({
      data: { signatureQueueRoomId: signed.queueId, userId: SENDER.userId,
              index: 0, status: 0 } });
    out = await call(finalizeDissemination, SENDER.accountId,
      { queueRoomId: signed.queueId, userId: SENDER.userId, lineId: LINE.id },
      "body");
    ok("a routing WITH a signatory still dispatches", out.okd,
      out.threw?.message);
    ok("…as Active, because a signature is outstanding",
      (await prisma.signatureQueueRoom.findUnique({
        where: { id: signed.queueId }, select: { status: true } }))?.status === 1);
    ok("…and ITS copy-furnished office is still held back",
      (await prisma.targetRoom.findUnique({
        where: { id: signed.furnishedId },
        select: { releasedAt: true } }))?.releasedAt === null,
      "the whole point of copy furnished when something IS being signed");
  } catch (e: any) {
    fail++;
    console.log("FAIL  threw: " + (e?.stack ?? e?.message ?? String(e)));
  } finally {
    try {
      if (made.docIds.length) {
        const d = { documentId: { in: made.docIds } };
        await prisma.signatureCoor.deleteMany({
          where: { documentPage: { is: d } } });
        await prisma.documentActivityLogs.deleteMany({ where: d });
        await prisma.documentPage.deleteMany({ where: d });
        await prisma.decodedFile.deleteMany({ where: d });
        await prisma.document.deleteMany({ where: { id: { in: made.docIds } } });
      }
      if (made.queueIds.length) {
        const qs = { signatureQueueRoomId: { in: made.queueIds } };
        await prisma.targetRoom.deleteMany({ where: qs });
        await prisma.signatoryArrangement.deleteMany({ where: qs });
        await prisma.signatureQueueRoom.deleteMany({
          where: { id: { in: made.queueIds } } });
      }
      if (made.roomIds.length) {
        await prisma.roomAuthorizedUser.deleteMany({
          where: { receivingRoomId: { in: made.roomIds } } });
        await prisma.receivingRoom.deleteMany({
          where: { id: { in: made.roomIds } } });
      }
      if (made.userIds.length) {
        const w = { in: made.userIds };
        await prisma.documentActivityLogs.deleteMany({ where: { userId: w } });
        await prisma.humanResourcesLogs.deleteMany({ where: { userId: w } })
          .catch(() => undefined);
        await prisma.notification.deleteMany({
          where: { OR: [{ recipientId: w }, { senderId: w }] } });
        await prisma.signatoryArrangement.deleteMany({ where: { userId: w } });
        await prisma.user.deleteMany({ where: { id: w } });
      }
      if (made.accountIds.length)
        await prisma.account.deleteMany({
          where: { id: { in: made.accountIds } } });
      for (const id of made.lineIds)
        await prisma.line.delete({ where: { id } });
      const left = await prisma.receivingRoom.count({
        where: { code: { contains: `${TS}` } } });
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
