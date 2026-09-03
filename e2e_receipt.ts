/* PROOF: an office confirms, in its own name, that it has the document.
 *
 * Delivery and receipt are two different facts. The system stamps
 * `receivedAt` the instant it drops a document into a room, which proves
 * only that the system did its part — and that is the stamp everyone was
 * relying on. Whether anyone in the office actually has the thing is a
 * question only a person there can answer.
 *
 * So the two must not be confused, and this file checks that first: a
 * freshly dispatched document is delivered and NOT acknowledged.
 *
 * The rest is the boundary. A signatory is in the room but this is not
 * their job. Somebody from another office is not in the room at all. A
 * copy-furnished office that is still held has been given nothing yet and
 * must not be able to acknowledge a document it cannot even see.
 *
 * Run: npx ts-node --transpile-only e2e_receipt.ts */
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
  setTargetRooms,
  finalizeDissemination,
  disseminationInbox,
  acknowledgeReceipt,
} from "./src/controller/disseminationController";
import { ROOM_MEMBER_TYPES } from "./src/controller/roomConfigController";

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
      data: { name: `QA Receipt ${TS}`, ...loc }, select: { id: true },
    });
    made.lineId = line.id;

    const mk = async (tag: string) => {
      const acct = await prisma.account.create({
        data: { username: `qa_rcpt_${TS}_${tag}`, password: "x", lineId: line.id },
        select: { id: true, username: true },
      });
      made.accountIds.push(acct.id);
      const u = await prisma.user.create({
        data: {
          firstName: "Qa", lastName: `RCPT${tag.toUpperCase()}`,
          username: acct.username, accountId: acct.id, lineId: line.id,
          email: `qa-rcpt-${TS}-${tag}@test.local`, active: 1,
        },
        select: { id: true },
      });
      made.userIds.push(u.id);
      return { accountId: acct.id, userId: u.id };
    };
    const mkRoom = async (code: string) => {
      const r = await prisma.receivingRoom.create({
        data: { code: `${code}-${TS}`, lineId: line.id },
        select: { id: true, code: true },
      });
      made.roomIds.push(r.id);
      return r;
    };
    const join = (roomId: string, userId: string, type: number) =>
      prisma.roomAuthorizedUser.create({
        data: { receivingRoomId: roomId, userId, type, status: 1 },
      });

    const SENDER    = await mk("sender");
    const SIGNER    = await mk("signer");
    const RECEIVER  = await mk("receiver");   // type 2 in the TO room
    const CLERK     = await mk("clerk");      // type 1 (signatory) in the TO room
    const OWNER     = await mk("owner");      // type 0 in the TO room
    const OUTSIDER  = await mk("outsider");   // in a different room entirely
    const CFPERSON  = await mk("cf");         // receiver of the copy-furnished room

    const FROM = await mkRoom("QA-FROM");
    const TO   = await mkRoom("QA-TO");
    const CC   = await mkRoom("QA-CC");
    const ELSE = await mkRoom("QA-ELSE");

    await join(FROM.id, SENDER.userId,   ROOM_MEMBER_TYPES.owner);
    await join(TO.id,   OWNER.userId,    ROOM_MEMBER_TYPES.owner);
    await join(TO.id,   RECEIVER.userId, ROOM_MEMBER_TYPES.receiver);
    await join(TO.id,   CLERK.userId,    ROOM_MEMBER_TYPES.signatory);
    await join(CC.id,   CFPERSON.userId, ROOM_MEMBER_TYPES.receiver);
    await join(ELSE.id, OUTSIDER.userId, ROOM_MEMBER_TYPES.receiver);

    await prisma.signature.create({
      data: { title: `qa-rcpt-${TS}`, userId: SIGNER.userId, active: true },
    });

    const q = await prisma.signatureQueueRoom.create({
      data: { title: `QA memo ${TS}`, userId: SENDER.userId,
              receivingRoomId: FROM.id, status: 0, step: 0 },
      select: { id: true },
    });
    made.queueIds.push(q.id);
    await prisma.signatoryArrangement.create({
      data: { signatureQueueRoomId: q.id, userId: SIGNER.userId, index: 0, status: 0 },
    });
    const doc = await prisma.document.create({
      data: { title: `qa-rcpt-doc-${TS}`, lineId: line.id,
              userId: SENDER.userId, signatureQueueRoomId: q.id },
      select: { id: true },
    });
    made.docIds.push(doc.id);

    let res = mockRes();
    await setTargetRooms({
      user: { id: SENDER.accountId },
      body: { queueRoomId: q.id, targetRoomIds: [TO.id],
              copyFurnishedRoomIds: [CC.id],
              userId: SENDER.userId, lineId: line.id },
    } as any, res);
    ok("configured", res._code === 200, JSON.stringify(res._body));

    res = mockRes();
    await finalizeDissemination({
      user: { id: SENDER.accountId },
      body: { queueRoomId: q.id, userId: SENDER.userId, lineId: line.id },
    } as any, res);
    ok("dispatched", res._code === 200, JSON.stringify(res._body));

    const rowOf = (roomId: string) =>
      prisma.targetRoom.findFirst({
        where: { signatureQueueRoomId: q.id, receivingRoomId: roomId },
        select: { id: true, receivedAt: true, acknowledgedAt: true,
                  acknowledgedById: true, acknowledgedNote: true },
      });
    const call = async (accountId: string, body: any) => {
      const r = mockRes();
      let threw: any = null;
      await acknowledgeReceipt({ user: { id: accountId }, body } as any, r)
        .catch((e) => { threw = e; });
      return { r, threw };
    };
    const inboxAs = async (accountId: string, roomId: string) => {
      const r = mockRes();
      await disseminationInbox(
        { user: { id: accountId }, query: { toRoomId: roomId } } as any, r);
      return r._body;
    };

    const TO_ROW = (await rowOf(TO.id))!;

    // ── Delivered is not received ───────────────────────────────────────
    ok("dispatch marks it DELIVERED", TO_ROW.receivedAt !== null);
    ok("…but NOT acknowledged by anyone", TO_ROW.acknowledgedAt === null,
      "the system's word is not the office's word");

    // ── Who may say so ──────────────────────────────────────────────────
    let out = await call(OUTSIDER.accountId, { targetRoomId: TO_ROW.id });
    ok("someone from another office is refused", !!out.threw, out.r._code);
    ok("…and nothing was written",
      (await rowOf(TO.id))?.acknowledgedAt === null);

    out = await call(CLERK.accountId, { targetRoomId: TO_ROW.id });
    ok("a SIGNATORY in the room is refused — not their job", !!out.threw,
      out.threw?.message);

    out = await call(RECEIVER.accountId, { targetRoomId: TO_ROW.id, note: "2 copies" });
    ok("the RECEIVER can mark it received", out.r._code === 200, out.threw?.message);
    let row = await rowOf(TO.id);
    ok("…it is stamped", row?.acknowledgedAt !== null);
    ok("…with their name on it", row?.acknowledgedById === RECEIVER.userId);
    ok("…and their note", row?.acknowledgedNote === "2 copies");
    ok("…while the delivery stamp is untouched", row?.receivedAt !== null);

    // ── Correcting it ───────────────────────────────────────────────────
    const firstAt = row!.acknowledgedAt!;
    out = await call(OWNER.accountId, { targetRoomId: TO_ROW.id, note: "front desk" });
    ok("the room OWNER can update it too", out.r._code === 200, out.threw?.message);
    row = await rowOf(TO.id);
    ok("…the note changes", row?.acknowledgedNote === "front desk");
    ok("…the original time is kept, not reset",
      row?.acknowledgedAt?.getTime() === firstAt.getTime(),
      "when it arrived is the fact; who edited the note is not");

    out = await call(RECEIVER.accountId, { targetRoomId: TO_ROW.id, received: false });
    ok("a mistaken receipt can be withdrawn", out.r._code === 200, out.threw?.message);
    row = await rowOf(TO.id);
    ok("…and it is properly cleared",
      row?.acknowledgedAt === null && row?.acknowledgedById === null
        && row?.acknowledgedNote === null, JSON.stringify(row));

    // Re-marking after a withdrawal starts a fresh timestamp.
    out = await call(RECEIVER.accountId, { targetRoomId: TO_ROW.id });
    row = await rowOf(TO.id);
    ok("it can be marked again afterwards", row?.acknowledgedAt !== null);
    ok("…with a new time, since the first one was withdrawn",
      row!.acknowledgedAt!.getTime() >= firstAt.getTime());

    // ── A held copy-furnished office cannot acknowledge a ghost ─────────
    const CC_ROW = (await rowOf(CC.id))!;
    out = await call(CFPERSON.accountId, { targetRoomId: CC_ROW.id });
    ok("a HELD copy-furnished office cannot mark it received", !!out.threw,
      "it has not been given the document yet");
    ok("…and the refusal does not admit the document exists",
      /not found/i.test(out.threw?.message ?? ""), out.threw?.message);

    // ── The inbox tells the reader whether the button belongs to them ──
    const asReceiver = await inboxAs(RECEIVER.accountId, TO.id);
    const asClerk    = await inboxAs(CLERK.accountId, TO.id);
    ok("the inbox says a receiver may mark", asReceiver?.canAcknowledge === true);
    ok("…and that a signatory may not", asClerk?.canAcknowledge === false);
    const listed = (asReceiver?.list ?? []).find((x: any) => x.id === TO_ROW.id);
    ok("the inbox row carries the receipt", !!listed?.acknowledgedAt);
    ok("…and who made it", !!listed?.acknowledgedBy?.id);

    // ── The sender is told ──────────────────────────────────────────────
    ok("the sender is notified of the receipt",
      (await prisma.notification.count({
        where: { recipientId: SENDER.userId, title: "Document received" },
      })) >= 1);
    ok("…and of a withdrawal, since they rely on the record",
      (await prisma.notification.count({
        where: { recipientId: SENDER.userId, title: "Receipt withdrawn" },
      })) === 1);
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
        await prisma.signature.deleteMany({ where: { userId: who } }).catch(() => undefined);
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
