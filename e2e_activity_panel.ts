/* PROOF: the Document module's Activity panel reports the office's own
 * data, and only to the office.
 *
 * The panel it replaces was a mock — it said three alerts and 24 documents
 * processed no matter whose screen it was on. So the burden here is not
 * only "is it scoped" but "are the numbers the numbers": every pile is
 * asserted against a fixture whose true answer is known, and the piles are
 * asserted to MOVE when the underlying act happens (open it, sign for it)
 * rather than merely to exist.
 *
 * Two things are worth watching in particular:
 *
 *  - `viewedAt` is new, and it is stamped as a side effect of a read. A
 *    stamp that leaks across offices would be worse than no stamp: the
 *    sender would be told an office had seen a memo it had never opened.
 *    Asserted both ways.
 *  - A held copy-furnished row must appear in NOTHING. It is the one row
 *    that exists in the database and must not exist on anybody's screen.
 *
 * Run: npx ts-node --transpile-only e2e_activity_panel.ts */
import path from "path";

const entry = path.join(__dirname, "src", "index.ts");
require.cache[entry] = {
  id: entry, filename: entry, loaded: true,
  exports: { notificationSocket: { emitUserNotification: () => undefined } },
} as any;

import { prisma } from "./src/barrel/prisma";
import {
  documentActivityPanel,
  documentActivityLog,
} from "./src/controller/documentActivityController";
import {
  viewDissemination,
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
  };

  try {
    const loc = await prisma.line.findFirst({
      select: { barangayId: true, municipalId: true, provinceId: true, regionId: true },
    });
    if (!loc) { console.log("NO FIXTURE (line)"); process.exit(2); }
    const mkLine = async (t: string) => {
      const l = await prisma.line.create({
        data: { name: `QA ACT ${TS} ${t}`, ...loc }, select: { id: true } });
      made.lineIds.push(l.id); return l;
    };
    const LINE_A = await mkLine("A");
    const LINE_B = await mkLine("B");

    const mk = async (tag: string, lineId: string) => {
      const acct = await prisma.account.create({
        data: { username: `qa_act_${TS}_${tag}`, password: "x", lineId },
        select: { id: true, username: true } });
      made.accountIds.push(acct.id);
      const u = await prisma.user.create({
        data: { firstName: "Qa", lastName: `Act${tag.toUpperCase()}`,
                username: acct.username, accountId: acct.id, lineId,
                email: `qa-act-${TS}-${tag}@test.local`, active: 1 },
        select: { id: true } });
      made.userIds.push(u.id);
      return { accountId: acct.id, userId: u.id };
    };

    const SENDER  = await mk("sender", LINE_A.id);   // owns the sending room
    const RECV    = await mk("recv", LINE_A.id);     // receiver in the target
    const SIGNER  = await mk("signer", LINE_A.id);   // signatory-only member
    const FOREIGN = await mk("foreign", LINE_B.id);  // another municipality

    const mkRoom = async (code: string, lineId: string) => {
      const r = await prisma.receivingRoom.create({
        data: { code, lineId }, select: { id: true, code: true } });
      made.roomIds.push(r.id); return r;
    };
    const FROM_ROOM = await mkRoom(`QA-ACT-FROM-${TS}`, LINE_A.id);
    const TO_ROOM   = await mkRoom(`QA-ACT-TO-${TS}`, LINE_A.id);
    const CF_ROOM   = await mkRoom(`QA-ACT-CF-${TS}`, LINE_A.id);
    const OTHER_TO  = await mkRoom(`QA-ACT-OTH-${TS}`, LINE_A.id);

    const member = (roomId: string, userId: string, type: number) =>
      prisma.roomAuthorizedUser.create({
        data: { receivingRoomId: roomId, userId, type, status: 1 } });
    await member(FROM_ROOM.id, SENDER.userId, ROOM_MEMBER_TYPES.owner);
    await member(TO_ROOM.id, RECV.userId, ROOM_MEMBER_TYPES.receiver);
    await member(TO_ROOM.id, SIGNER.userId, ROOM_MEMBER_TYPES.signatory);
    await member(CF_ROOM.id, RECV.userId, ROOM_MEMBER_TYPES.receiver);
    await member(OTHER_TO.id, SENDER.userId, ROOM_MEMBER_TYPES.owner);

    // One live routing out of FROM_ROOM: two signatories (one already in),
    // two addressees, one copy-furnished office still held.
    const queue = await prisma.signatureQueueRoom.create({
      data: {
        userId: SENDER.userId, receivingRoomId: FROM_ROOM.id,
        title: `QA ACT ROUTING ${TS}`, status: 1, step: 1,
      },
      select: { id: true } });
    made.queueIds.push(queue.id);

    await prisma.signatoryArrangement.create({
      data: { signatureQueueRoomId: queue.id, userId: SIGNER.userId,
              index: 0, status: 0 } });
    await prisma.signatoryArrangement.create({
      data: { signatureQueueRoomId: queue.id, userId: SENDER.userId,
              index: 1, status: 1, signedAt: new Date() } });

    const tgt = await prisma.targetRoom.create({
      data: { signatureQueueRoomId: queue.id, receivingRoomId: TO_ROOM.id,
              status: 1, receivedAt: new Date() },
      select: { id: true } });
    const tgtOther = await prisma.targetRoom.create({
      data: { signatureQueueRoomId: queue.id, receivingRoomId: OTHER_TO.id,
              status: 1, receivedAt: new Date() },
      select: { id: true } });
    const held = await prisma.targetRoom.create({
      data: { signatureQueueRoomId: queue.id, receivingRoomId: CF_ROOM.id,
              status: 0, copyFurnished: true, releasedAt: null },
      select: { id: true } });

    const call = async (fn: any, accountId: string | null, payload: any,
                        key: "body" | "query" = "query") => {
      const r = mockRes();
      let threw: any = null;
      await fn({ user: accountId ? { id: accountId } : undefined,
                 [key]: payload } as any, r).catch((e: any) => { threw = e; });
      return { r, threw, body: r._body, okd: !threw && r._code === 200 };
    };
    const panel = (accountId: string | null, roomId: string) =>
      call(documentActivityPanel, accountId, { roomId });

    // ── Scope ───────────────────────────────────────────────────────────
    ok("another municipality cannot read your Activity panel",
      !!(await panel(FOREIGN.accountId, TO_ROOM.id)).threw);
    ok("nor its log", !!(await call(documentActivityLog, FOREIGN.accountId,
      { roomId: TO_ROOM.id })).threw);
    ok("an unauthenticated call is refused",
      !!(await panel(null, TO_ROOM.id)).threw);
    ok("a colleague who is not in THAT office is refused",
      !!(await panel(SENDER.accountId, TO_ROOM.id)).threw,
      "SENDER owns FROM_ROOM and OTHER_TO, not TO_ROOM");

    // ── What is waiting on the receiver ─────────────────────────────────
    let out = await panel(RECV.accountId, TO_ROOM.id);
    ok("the office's own receiver can read it", out.okd, out.threw?.message);
    const n1 = out.body?.needsYou;
    ok("they may mark things received", out.body?.canAcknowledge === true);
    ok("the routing is in their unopened pile",
      (n1?.toOpen ?? []).some((r: any) => r.targetId === tgt.id),
      JSON.stringify(n1?.toOpen?.map((r: any) => r.title)));
    ok("…and counted", n1?.toOpenTotal === 1, String(n1?.toOpenTotal));
    ok("it is also in their unreceipted pile",
      (n1?.toReceive ?? []).some((r: any) => r.targetId === tgt.id));
    ok("…with the sending office named on it",
      (n1?.toOpen ?? []).find((r: any) => r.targetId === tgt.id)?.from
        === FROM_ROOM.code);
    ok("nothing is waiting for their SIGNATURE",
      (n1?.toSignTotal ?? -1) === 0, String(n1?.toSignTotal));

    // The held copy-furnished row: in the database, on nobody's screen.
    const cf = await panel(RECV.accountId, CF_ROOM.id);
    ok("a held copy-furnished office sees nothing arrived",
      cf.okd && (cf.body?.needsYou?.toOpenTotal ?? -1) === 0
             && (cf.body?.needsYou?.toReceiveTotal ?? -1) === 0,
      JSON.stringify(cf.body?.needsYou));
    ok("…and it is not in its inbox count either",
      (cf.body?.inbox?.total ?? -1) === 0, String(cf.body?.inbox?.total));

    // ── What is waiting on the signatory ────────────────────────────────
    out = await panel(SIGNER.accountId, TO_ROOM.id);
    ok("the signatory sees their own unsigned slot", out.okd
      && (out.body?.needsYou?.toSign ?? []).some(
        (s: any) => s.queueId === queue.id), out.threw?.message);
    const slot = (out.body?.needsYou?.toSign ?? [])
      .find((s: any) => s.queueId === queue.id);
    ok("…at the right position on the sheet",
      slot?.position === 1 && slot?.totalSignatories === 2,
      JSON.stringify(slot));
    ok("…and told one signature is already in", slot?.signed === 1,
      String(slot?.signed));
    ok("a signatory is NOT handed the receipts pile",
      out.body?.canAcknowledge === false
        && (out.body?.needsYou?.toReceive ?? []).length === 0
        && out.body?.needsYou?.toReceiveTotal === 0,
      JSON.stringify({ can: out.body?.canAcknowledge,
                       n: out.body?.needsYou?.toReceiveTotal }));

    // ── The sender's view of their own routing ──────────────────────────
    out = await panel(SENDER.accountId, FROM_ROOM.id);
    const flight = (out.body?.outbox?.inFlight ?? [])
      .find((q: any) => q.queueId === queue.id);
    ok("the sender sees their routing in flight", !!flight,
      JSON.stringify(out.body?.outbox));
    ok("…with one of two signatures in",
      flight?.signed === 1 && flight?.totalSignatories === 2,
      JSON.stringify(flight));
    ok("…two recipients, neither having opened it",
      flight?.totalRecipients === 2 && flight?.opened === 0,
      "the held copy-furnished room must not be counted as a recipient");
    ok("…and both offices named as still owing a receipt",
      (flight?.waitingOn ?? []).includes(TO_ROOM.code)
        && (flight?.waitingOn ?? []).includes(OTHER_TO.code),
      JSON.stringify(flight?.waitingOn));

    // ── Opening it moves the row, and only the reader's row ─────────────
    const opened = await call(viewDissemination, RECV.accountId,
      { id: queue.id });
    ok("the recipient can open the routing", opened.okd, opened.threw?.message);
    const afterOpen = await prisma.targetRoom.findMany({
      where: { id: { in: [tgt.id, tgtOther.id, held.id] } },
      select: { id: true, viewedAt: true, viewedById: true } });
    const seen = (id: string) => afterOpen.find((r) => r.id === id);
    ok("their own office is stamped as having seen it",
      !!seen(tgt.id)?.viewedAt && seen(tgt.id)?.viewedById === RECV.userId,
      JSON.stringify(seen(tgt.id)));
    ok("the OTHER recipient office is not",
      seen(tgtOther.id)?.viewedAt === null,
      "one office opening a memo must not mark it seen for everybody");
    ok("nor the held copy-furnished row",
      seen(held.id)?.viewedAt === null);

    out = await panel(RECV.accountId, TO_ROOM.id);
    ok("it has left the unopened pile",
      (out.body?.needsYou?.toOpenTotal ?? -1) === 0,
      String(out.body?.needsYou?.toOpenTotal));
    ok("…and is still owed a receipt",
      (out.body?.needsYou?.toReceiveTotal ?? -1) === 1,
      "opened is not received; that is the whole point of keeping both");

    out = await panel(SENDER.accountId, FROM_ROOM.id);
    ok("the sender is told one office has now looked at it",
      (out.body?.outbox?.inFlight ?? []).find(
        (q: any) => q.queueId === queue.id)?.opened === 1);

    // ── Signing for it ──────────────────────────────────────────────────
    const ack = await call(acknowledgeReceipt, RECV.accountId,
      { targetRoomId: tgt.id, received: true }, "body");
    ok("the receiver can mark it received", ack.okd, ack.threw?.message);
    out = await panel(RECV.accountId, TO_ROOM.id);
    ok("…and the pile empties",
      (out.body?.needsYou?.toReceiveTotal ?? -1) === 0,
      String(out.body?.needsYou?.toReceiveTotal));
    ok("…while today's receipt is counted",
      (out.body?.today?.receipts ?? 0) >= 1,
      String(out.body?.today?.receipts));
    ok("…and today's open is counted",
      (out.body?.today?.opened ?? 0) >= 1, String(out.body?.today?.opened));

    out = await panel(SENDER.accountId, FROM_ROOM.id);
    const f2 = (out.body?.outbox?.inFlight ?? [])
      .find((q: any) => q.queueId === queue.id);
    ok("the sender sees the receipt land", f2?.received === 1,
      JSON.stringify(f2));
    ok("…and only the office still owing one is named",
      f2?.waitingOn?.length === 1 && f2.waitingOn[0] === OTHER_TO.code,
      JSON.stringify(f2?.waitingOn));

    // ── The log ─────────────────────────────────────────────────────────
    out = await call(documentActivityLog, RECV.accountId,
      { roomId: TO_ROOM.id, limit: "20" });
    ok("the log opens for the office", out.okd, out.threw?.message);
    ok("…and the receipt just made is in it",
      (out.body?.list ?? []).some((r: any) =>
        typeof r.desc === "string" && r.desc.includes(`QA ACT ROUTING ${TS}`)),
      JSON.stringify((out.body?.list ?? []).slice(0, 3)));
  } catch (e: any) {
    fail++;
    console.log("FAIL  threw: " + (e?.stack ?? e?.message ?? String(e)));
  } finally {
    try {
      if (made.queueIds.length) {
        const qs = { signatureQueueRoomId: { in: made.queueIds } };
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
