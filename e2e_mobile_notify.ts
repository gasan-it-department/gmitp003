/* PROOF: the phone gets told, and the phone can answer.
 *
 * Two halves.
 *
 * First, dispatch. It notified signatories and nobody else, so an office
 * a memo was ADDRESSED to learned about it by somebody opening the Inbox
 * and looking — the habit the module exists to replace, and the half that
 * ends in "we never received that". Now the addressed offices are told
 * too, while a held copy-furnished office is still told NOTHING, because
 * it has not been given the document and must not learn it exists.
 *
 * Second, /document/my-pending. The panel endpoint is office-shaped and
 * needs a room id; a phone has no room picker. This one walks the
 * caller's memberships itself. The assertion that matters is the role
 * split: a signatory-only member is shown their signatures and NOT a
 * receipts pile they are not allowed to act on.
 *
 * Run: npx ts-node --transpile-only e2e_mobile_notify.ts */
import path from "path";

const entry = path.join(__dirname, "src", "index.ts");
require.cache[entry] = {
  id: entry, filename: entry, loaded: true,
  exports: { notificationSocket: { emitUserNotification: () => undefined } },
} as any;

import { prisma } from "./src/barrel/prisma";
import { documentMyPending } from "./src/controller/documentActivityController";
import {
  finalizeDissemination,
  signMine,
  acknowledgeReceipt,
} from "./src/controller/disseminationController";
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
    sigIds: [] as string[], docIds: [] as string[],
  };

  try {
    const loc = await prisma.line.findFirst({
      select: { barangayId: true, municipalId: true, provinceId: true, regionId: true },
    });
    if (!loc) { console.log("NO FIXTURE (line)"); process.exit(2); }
    const LINE = await prisma.line.create({
      data: { name: `QA MOB ${TS}`, ...loc }, select: { id: true } });
    made.lineIds.push(LINE.id);

    const mk = async (tag: string) => {
      const acct = await prisma.account.create({
        data: { username: `qa_mob_${TS}_${tag}`, password: "x", lineId: LINE.id },
        select: { id: true, username: true } });
      made.accountIds.push(acct.id);
      const u = await prisma.user.create({
        data: { firstName: "Qa", lastName: `Mob${tag.toUpperCase()}`,
                username: acct.username, accountId: acct.id, lineId: LINE.id,
                email: `qa-mob-${TS}-${tag}@test.local`, active: 1 },
        select: { id: true } });
      made.userIds.push(u.id);
      return { accountId: acct.id, userId: u.id };
    };

    const SENDER   = await mk("sender");   // owns the sending room
    const RECV     = await mk("recv");     // receiver in the addressed office
    const SIGNER   = await mk("signer");   // signatory on the routing
    const SIGONLY  = await mk("sigonly");  // signatory-only member of the office
    const CFSTAFF  = await mk("cfstaff");  // works in the copy-furnished office

    const mkRoom = async (code: string) => {
      const r = await prisma.receivingRoom.create({
        data: { code, lineId: LINE.id }, select: { id: true, code: true } });
      made.roomIds.push(r.id); return r;
    };
    const FROM_ROOM = await mkRoom(`QA-MOB-FROM-${TS}`);
    const TO_ROOM   = await mkRoom(`QA-MOB-TO-${TS}`);
    const CF_ROOM   = await mkRoom(`QA-MOB-CF-${TS}`);

    const member = (roomId: string, userId: string, type: number) =>
      prisma.roomAuthorizedUser.create({
        data: { receivingRoomId: roomId, userId, type, status: 1 } });
    await member(FROM_ROOM.id, SENDER.userId, ROOM_MEMBER_TYPES.owner);
    await member(TO_ROOM.id, RECV.userId, ROOM_MEMBER_TYPES.receiver);
    await member(TO_ROOM.id, SIGONLY.userId, ROOM_MEMBER_TYPES.signatory);
    await member(CF_ROOM.id, CFSTAFF.userId, ROOM_MEMBER_TYPES.receiver);

    // A draft routing: one signatory, one addressee, one copy furnished.
    const queue = await prisma.signatureQueueRoom.create({
      data: {
        userId: SENDER.userId, receivingRoomId: FROM_ROOM.id,
        title: `QA MOB MEMO ${TS}`, status: 0, step: 0,
      },
      select: { id: true } });
    made.queueIds.push(queue.id);
    await prisma.signatoryArrangement.create({
      data: { signatureQueueRoomId: queue.id, userId: SIGNER.userId,
              index: 0, status: 0 } });
    // Dispatch refuses an empty routing, and rightly so — there would be
    // nothing to sign or receive.
    const doc = await prisma.document.create({
      data: {
        title: `QA MOB FILE ${TS}`, lineId: LINE.id, userId: SENDER.userId,
        signatureQueueRoomId: queue.id,
      },
      select: { id: true } });
    made.docIds.push(doc.id);

    const tgt = await prisma.targetRoom.create({
      data: { signatureQueueRoomId: queue.id, receivingRoomId: TO_ROOM.id,
              status: 0 },
      select: { id: true } });
    await prisma.targetRoom.create({
      data: { signatureQueueRoomId: queue.id, receivingRoomId: CF_ROOM.id,
              status: 0, copyFurnished: true, releasedAt: null } });

    const call = async (fn: any, accountId: string | null, payload: any,
                        key: "body" | "query" = "query") => {
      const r = mockRes();
      let threw: any = null;
      await fn({ user: accountId ? { id: accountId } : undefined,
                 [key]: payload } as any, r).catch((e: any) => { threw = e; });
      return { r, threw, body: r._body, okd: !threw && r._code === 200 };
    };
    const notifsFor = (userId: string) =>
      prisma.notification.findMany({
        where: { recipientId: userId },
        select: { title: true, content: true },
      });

    // ── Dispatch ────────────────────────────────────────────────────────
    const dispatched = await call(finalizeDissemination, SENDER.accountId, {
      queueRoomId: queue.id, userId: SENDER.userId, lineId: LINE.id }, "body");
    ok("the routing dispatches", dispatched.okd, dispatched.threw?.message);

    const sigNotifs = await notifsFor(SIGNER.userId);
    ok("the signatory is asked to sign",
      sigNotifs.some((n) => n.title === "Signature requested"),
      JSON.stringify(sigNotifs));

    const recvNotifs = await notifsFor(RECV.userId);
    ok("the addressed office is told a document arrived",
      recvNotifs.some((n) => n.title === "Document received"),
      "this is the notification that did not exist before");
    ok("…and it names the document",
      recvNotifs.some((n) => n.content.includes(`QA MOB MEMO ${TS}`)),
      JSON.stringify(recvNotifs));
    ok("every member of that office is told, not just the receiver",
      (await notifsFor(SIGONLY.userId)).some(
        (n) => n.title === "Document received"));

    ok("the copy-furnished office is told NOTHING yet",
      (await notifsFor(CFSTAFF.userId)).length === 0,
      "it has not been given the document and must not learn it exists");
    ok("the person who pressed Dispatch is not notified",
      (await notifsFor(SENDER.userId)).length === 0);

    // ── The phone's view: what do I owe? ────────────────────────────────
    ok("an unauthenticated call is refused",
      !!(await call(documentMyPending, null, {})).threw);

    let out = await call(documentMyPending, SIGNER.accountId, {});
    ok("the signatory's phone lists their signature", out.okd
      && (out.body?.toSign ?? []).some((s: any) => s.queueId === queue.id),
      out.threw?.message);
    ok("…with the sending office on it",
      (out.body?.toSign ?? [])[0]?.from === FROM_ROOM.code,
      JSON.stringify((out.body?.toSign ?? [])[0]));
    ok("…and no receipts, since they work in no receiving office",
      (out.body?.counts?.toReceive ?? -1) === 0);

    out = await call(documentMyPending, RECV.accountId, {});
    ok("the receiver's phone lists the receipt owed",
      (out.body?.toReceive ?? []).some((r: any) => r.targetId === tgt.id),
      JSON.stringify(out.body?.toReceive));
    ok("…naming which of their offices owes it",
      (out.body?.toReceive ?? [])[0]?.office === TO_ROOM.code);
    ok("…and nothing to sign", (out.body?.counts?.toSign ?? -1) === 0);
    ok("…with a total that adds up",
      out.body?.counts?.total ===
        (out.body?.counts?.toSign ?? 0) + (out.body?.counts?.toReceive ?? 0));

    out = await call(documentMyPending, SIGONLY.accountId, {});
    ok("a signatory-only member is shown NO receipts pile",
      (out.body?.counts?.toReceive ?? -1) === 0
        && (out.body?.toReceive ?? []).length === 0,
      "they are not allowed to sign for it, so offering it would be a lie");

    out = await call(documentMyPending, CFSTAFF.accountId, {});
    ok("the held copy-furnished office owes nothing",
      (out.body?.counts?.total ?? -1) === 0,
      JSON.stringify(out.body?.counts));

    // ── Acting on it from the phone ─────────────────────────────────────
    const ack = await call(acknowledgeReceipt, RECV.accountId,
      { targetRoomId: tgt.id, received: true }, "body");
    ok("the receipt can be made", ack.okd, ack.threw?.message);
    out = await call(documentMyPending, RECV.accountId, {});
    ok("…and the phone's pile empties",
      (out.body?.counts?.total ?? -1) === 0,
      JSON.stringify(out.body?.counts));

    // Signing needs a signature on file — the phone cannot make one, and
    // the server says so in words the screen passes straight through.
    const noSig = await call(signMine, SIGNER.accountId,
      { queueRoomId: queue.id, userId: SIGNER.userId }, "body");
    ok("signing without a signature on file is refused", !!noSig.threw);
    ok("…in words worth showing the user",
      /signature/i.test(noSig.threw?.message ?? ""),
      noSig.threw?.message);

    const sig = await prisma.signature.create({
      data: { userId: SIGNER.userId, title: `QA MOB SIG ${TS}`,
              signature: Buffer.from("x"), active: true },
      select: { id: true } });
    made.sigIds.push(sig.id);
    const signed = await call(signMine, SIGNER.accountId,
      { queueRoomId: queue.id, userId: SIGNER.userId }, "body");
    ok("with one on file the phone can sign", signed.okd, signed.threw?.message);
    out = await call(documentMyPending, SIGNER.accountId, {});
    ok("…and their pile empties too",
      (out.body?.counts?.toSign ?? -1) === 0,
      JSON.stringify(out.body?.counts));

    ok("signing released the copy-furnished office",
      (await notifsFor(CFSTAFF.userId)).some(
        (n) => n.title === "Copy furnished"),
      "held until the last signature, then delivered automatically");
    out = await call(documentMyPending, CFSTAFF.accountId, {});
    ok("…so now it owes a receipt",
      (out.body?.counts?.toReceive ?? 0) === 1,
      JSON.stringify(out.body?.counts));
  } catch (e: any) {
    fail++;
    console.log("FAIL  threw: " + (e?.stack ?? e?.message ?? String(e)));
  } finally {
    try {
      if (made.docIds.length) {
        const d = { documentId: { in: made.docIds } };
        await prisma.documentActivityLogs.deleteMany({ where: d });
        await prisma.signatureCoor.deleteMany({
          where: { documentPage: { is: d } } }).catch(() => undefined);
        await prisma.documentPage.deleteMany({ where: d });
        await prisma.decodedFile.deleteMany({ where: d });
        await prisma.documentSeal.deleteMany({ where: d }).catch(() => undefined);
        await prisma.signatureAttestation.deleteMany({ where: d })
          .catch(() => undefined);
        await prisma.document.deleteMany({ where: { id: { in: made.docIds } } });
      }
      if (made.queueIds.length) {
        const qs = { signatureQueueRoomId: { in: made.queueIds } };
        await prisma.signatureCoor.deleteMany({
          where: { signatoryArrangement: { is: qs } } }).catch(() => undefined);
        await prisma.targetRoom.deleteMany({ where: qs });
        await prisma.signatoryArrangement.deleteMany({ where: qs });
        await prisma.signatureQueueRoom.deleteMany({
          where: { id: { in: made.queueIds } } });
      }
      await prisma.signatureQueueRoom.deleteMany({
        where: { receivingRoomId: { in: made.roomIds } } });
      if (made.roomIds.length) {
        await prisma.roomAuthorizedUser.deleteMany({
          where: { receivingRoomId: { in: made.roomIds } } });
        await prisma.receivingRoom.deleteMany({
          where: { id: { in: made.roomIds } } });
      }
      if (made.userIds.length) {
        const who = { in: made.userIds };
        await prisma.signature.deleteMany({ where: { userId: who } });
        await prisma.documentActivityLogs.deleteMany({ where: { userId: who } });
        await prisma.notification.deleteMany({
          where: { OR: [{ recipientId: who }, { senderId: who }] } });
        await prisma.signatoryArrangement.deleteMany({ where: { userId: who } });
        await prisma.user.deleteMany({ where: { id: who } });
      }
      if (made.accountIds.length)
        await prisma.account.deleteMany({
          where: { id: { in: made.accountIds } } });
      for (const id of made.lineIds)
        await prisma.line.delete({ where: { id } });
      const left = await prisma.receivingRoom.count({
        where: { code: { contains: `-${TS}` } } });
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
