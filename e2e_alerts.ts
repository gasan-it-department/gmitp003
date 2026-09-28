/* PROOF: the red numbers mean what they say.
 *
 * A badge is a promise. "4" on the inbox has to mean four documents nobody
 * has opened — not four that exist, not four including the ones already
 * dealt with — or people learn to ignore it, and then the one that matters
 * is ignored too.
 *
 * So this checks the arithmetic against real rows: what happens to each
 * count when somebody opens a document, confirms receipt, signs a slot, or
 * is third in line on a routing that signs in order.
 *
 * Run: npx ts-node --transpile-only e2e_alerts.ts */
import path from "path";

const entry = path.join(__dirname, "src", "index.ts");
require.cache[entry] = {
  id: entry, filename: entry, loaded: true,
  exports: { notificationSocket: { emitUserNotification: () => undefined } },
} as any;

import { prisma } from "./src/barrel/prisma";
import { documentAlerts } from "./src/controller/disseminationController";

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
    users: [] as string[], accts: [] as string[], rooms: [] as string[],
    queues: [] as string[], recs: [] as string[],
  };

  try {
    const line = await prisma.line.findFirstOrThrow({ select: { id: true } });

    const mk = async (tag: string) => {
      const a = await prisma.account.create({
        data: { username: `qa_al_${tag}_${TS}`, password: "x", lineId: line.id },
        select: { id: true, username: true },
      });
      made.accts.push(a.id);
      const u = await prisma.user.create({
        data: {
          firstName: "Qa", lastName: `${tag.toUpperCase()}${TS}`,
          username: a.username, accountId: a.id, lineId: line.id,
          email: `qa-al-${tag}-${TS}@test.local`, active: 1,
        },
        select: { id: true },
      });
      made.users.push(u.id);
      return { accountId: a.id, userId: u.id };
    };

    const me = await mk("me");
    const other = await mk("other");

    const mkRoom = async (code: string, userId: string, type = 0) => {
      const r = await prisma.receivingRoom.create({
        data: { code: `${code}-${TS}`, lineId: line.id, status: 1 },
        select: { id: true },
      });
      made.rooms.push(r.id);
      await prisma.roomAuthorizedUser.create({
        data: { receivingRoomId: r.id, userId, type, status: 1 },
      });
      return r.id;
    };

    const myRoom = await mkRoom("MINE", me.userId);
    const theirRoom = await mkRoom("THEIRS", other.userId);

    const REQ = {
      user: { id: me.accountId },
      query: { lineId: line.id, roomId: myRoom },
    };

    // ══ 1. A brand new office has nothing to do ═══════════════════════
    console.log("\n-- an office with an empty desk --");
    const zero = await call(documentAlerts, REQ);
    ok("the endpoint answers", zero.ok, zero.message);
    ok("...with nothing unopened", zero.body?.inbox?.unopened === 0);
    ok("...nothing awaiting a signature", zero.body?.signatures?.awaitingMe === 0);
    ok("...and NOTHING IN RED, so the badge stays hidden",
      zero.body?.urgent === 0, String(zero.body?.urgent));

    // ══ 2. Mail arrives ═══════════════════════════════════════════════
    console.log("\n-- three memos arrive --");
    const mkQueue = async (title: string, status: number, fromRoom: string) => {
      const q = await prisma.signatureQueueRoom.create({
        // No lineId of its own: a routing takes its line from the room
        // it was sent FROM, which is what the alert query filters on.
        data: { title, status, receivingRoomId: fromRoom, userId: other.userId },
        select: { id: true },
      });
      made.queues.push(q.id);
      return q.id;
    };

    const q1 = await mkQueue("Memo one", 1, theirRoom);
    const q2 = await mkQueue("Memo two", 1, theirRoom);
    const q3 = await mkQueue("Memo three", 1, theirRoom);
    for (const q of [q1, q2, q3]) {
      await prisma.targetRoom.create({
        data: { signatureQueueRoomId: q, receivingRoomId: myRoom, status: 1 },
      });
    }

    const three = await call(documentAlerts, REQ);
    ok("all three count as unopened", three.body?.inbox?.unopened === 3,
      String(three.body?.inbox?.unopened));
    ok("...none as merely unconfirmed, since nobody has looked",
      three.body?.inbox?.unacknowledged === 0,
      String(three.body?.inbox?.unacknowledged));
    ok("...and the red number is three",
      three.body?.urgent === 3, String(three.body?.urgent));

    // Somebody opens one.
    await prisma.targetRoom.updateMany({
      where: { signatureQueueRoomId: q1, receivingRoomId: myRoom },
      data: { viewedAt: new Date(), viewedById: me.userId },
    });
    const opened = await call(documentAlerts, REQ);
    ok("opening one takes it OFF the red count",
      opened.body?.inbox?.unopened === 2, String(opened.body?.inbox?.unopened));
    ok("...and onto the amber one, because receipt is still unconfirmed",
      opened.body?.inbox?.unacknowledged === 1,
      String(opened.body?.inbox?.unacknowledged));

    // And confirms receipt.
    await prisma.targetRoom.updateMany({
      where: { signatureQueueRoomId: q1, receivingRoomId: myRoom },
      data: { acknowledgedAt: new Date(), acknowledgedById: me.userId },
    });
    const acked = await call(documentAlerts, REQ);
    ok("confirming receipt clears it from both",
      acked.body?.inbox?.unopened === 2 &&
        acked.body?.inbox?.unacknowledged === 0,
      JSON.stringify(acked.body?.inbox));

    // A copy-furnished row still being held is not mail yet.
    const q4 = await mkQueue("Held copy", 1, theirRoom);
    await prisma.targetRoom.create({
      data: {
        signatureQueueRoomId: q4, receivingRoomId: myRoom, status: 1,
        copyFurnished: true, releasedAt: null,
      },
    });
    const held = await call(documentAlerts, REQ);
    ok("a HELD copy-furnished row is not counted — the office cannot see it",
      held.body?.inbox?.unopened === 2, String(held.body?.inbox?.unopened));

    await prisma.targetRoom.updateMany({
      where: { signatureQueueRoomId: q4 },
      data: { releasedAt: new Date() },
    });
    const released = await call(documentAlerts, REQ);
    ok("...and IS counted the moment it is released",
      released.body?.inbox?.unopened === 3,
      String(released.body?.inbox?.unopened));

    // ══ 3. Somebody else's office is not mine ═════════════════════════
    console.log("\n-- counting somebody else's mail --");
    const spy = await call(documentAlerts, {
      user: { id: other.accountId },
      query: { lineId: line.id, roomId: myRoom },
    });
    ok("passing a room you do not belong to returns zeros, not their mail",
      spy.body?.inbox?.unopened === 0, JSON.stringify(spy.body?.inbox));
    ok("...and says which room it actually counted",
      spy.body?.roomId === null, String(spy.body?.roomId));

    // ══ 4. Signatures, and whose turn it is ═══════════════════════════
    console.log("\n-- what is waiting on me to sign --");
    const qs = await mkQueue("Needs signing", 1, myRoom);
    await prisma.signatoryArrangement.create({
      data: { signatureQueueRoomId: qs, userId: me.userId, index: 0, status: 0 },
    });
    const one = await call(documentAlerts, REQ);
    ok("an unsigned slot of mine is waiting on me",
      one.body?.signatures?.awaitingMe === 1,
      String(one.body?.signatures?.awaitingMe));

    // In-order routing: I am third, and the first two have not signed.
    const seq = await prisma.signatureQueueRoom.create({
      data: {
        title: "In order", status: 1,
        receivingRoomId: myRoom, userId: other.userId, sequential: true,
      },
      select: { id: true },
    });
    made.queues.push(seq.id);
    await prisma.signatoryArrangement.createMany({
      data: [
        { signatureQueueRoomId: seq.id, userId: other.userId, index: 0, status: 0 },
        { signatureQueueRoomId: seq.id, userId: other.userId, index: 1, status: 0 },
        { signatureQueueRoomId: seq.id, userId: me.userId, index: 2, status: 0 },
      ],
    });
    const blocked = await call(documentAlerts, REQ);
    ok("a slot BLOCKED behind two others is not counted as waiting on me",
      blocked.body?.signatures?.awaitingMe === 1,
      String(blocked.body?.signatures?.awaitingMe));
    ok("...it is queued instead, so the screen can still mention it",
      blocked.body?.signatures?.queued === 1,
      String(blocked.body?.signatures?.queued));

    // The two ahead of me sign. Now it is my turn.
    await prisma.signatoryArrangement.updateMany({
      where: { signatureQueueRoomId: seq.id, index: { lt: 2 } },
      data: { status: 1, signedAt: new Date() },
    });
    const myTurn = await call(documentAlerts, REQ);
    ok("once they sign, it MOVES to waiting on me",
      myTurn.body?.signatures?.awaitingMe === 2,
      String(myTurn.body?.signatures?.awaitingMe));
    ok("...and is no longer queued",
      myTurn.body?.signatures?.queued === 0,
      String(myTurn.body?.signatures?.queued));

    // A slot on a DRAFT is not waiting on anybody.
    const draftQ = await mkQueue("Still a draft", 0, myRoom);
    await prisma.signatoryArrangement.create({
      data: { signatureQueueRoomId: draftQ, userId: me.userId, index: 0, status: 0 },
    });
    const draftSlot = await call(documentAlerts, REQ);
    ok("a slot on an unsent draft is not waiting on me",
      draftSlot.body?.signatures?.awaitingMe === 2,
      String(draftSlot.body?.signatures?.awaitingMe));
    ok("...but the draft itself is counted, because it never went out",
      draftSlot.body?.outbox?.drafts === 1,
      String(draftSlot.body?.outbox?.drafts));

    // ══ 5. The desk registry ══════════════════════════════════════════
    console.log("\n-- logged at the desk, never sent on --");
    const rec = await prisma.documentReceiveRecord.create({
      data: {
        lineId: line.id, barcode: `QA-${TS}`, title: "Walk-in letter",
        direction: "in",
      },
      select: { id: true },
    });
    made.recs.push(rec.id);
    const withRec = await call(documentAlerts, REQ);
    ok("an unrouted received document is counted",
      (withRec.body?.receiving?.unrouted ?? 0) >= 1,
      String(withRec.body?.receiving?.unrouted));

    const before = withRec.body?.receiving?.unrouted ?? 0;
    await prisma.documentReceiveRecord.update({
      where: { id: rec.id },
      data: { routedQueueRoomId: qs, routedAt: new Date() },
    });
    const routed = await call(documentAlerts, REQ);
    ok("...and stops being counted once it is sent onward",
      routed.body?.receiving?.unrouted === before - 1,
      `${before} -> ${routed.body?.receiving?.unrouted}`);

    // ══ 6. What ends up in red ════════════════════════════════════════
    console.log("\n-- what the red number adds up --");
    const fin = await call(documentAlerts, REQ);
    ok("red = unopened mail + signatures it is my turn to give",
      fin.body?.urgent ===
        fin.body?.inbox?.unopened + fin.body?.signatures?.awaitingMe,
      JSON.stringify(fin.body));
    ok("...and excludes the amber chores, which are not urgent",
      fin.body?.urgent <
        fin.body?.urgent +
          fin.body?.inbox?.unacknowledged +
          fin.body?.outbox?.drafts,
      JSON.stringify({
        urgent: fin.body?.urgent,
        unack: fin.body?.inbox?.unacknowledged,
        drafts: fin.body?.outbox?.drafts,
      }));

    console.log(`\n${pass} passed, ${fail} failed`);
    process.exitCode = fail === 0 ? 0 : 1;
  } catch (e) {
    console.error("THREW", e);
    process.exitCode = 1;
  } finally {
    for (const id of made.recs) {
      await prisma.documentReceiveRecord.delete({ where: { id } }).catch(() => {});
    }
    for (const id of made.queues) {
      await prisma.signatoryArrangement.deleteMany({
        where: { signatureQueueRoomId: id },
      }).catch(() => {});
      await prisma.targetRoom.deleteMany({
        where: { signatureQueueRoomId: id },
      }).catch(() => {});
      await prisma.signatureQueueRoom.delete({ where: { id } }).catch(() => {});
    }
    for (const id of made.rooms) {
      await prisma.targetRoom.deleteMany({ where: { receivingRoomId: id } }).catch(() => {});
      await prisma.roomAuthorizedUser.deleteMany({
        where: { receivingRoomId: id },
      }).catch(() => {});
      await prisma.receivingRoom.delete({ where: { id } }).catch(() => {});
    }
    for (const id of made.users) {
      await prisma.user.delete({ where: { id } }).catch(() => {});
    }
    for (const id of made.accts) {
      await prisma.account.delete({ where: { id } }).catch(() => {});
    }
    await prisma.$disconnect();
  }
})();
