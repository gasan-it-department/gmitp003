/* PROOF: a room's mail belongs to the people who work in that room.
 *
 * The inbox and outbox both take the room id from the request and both
 * used to hand it over on trust. Any signed-in account could read any
 * office's correspondence by editing one id — what the Mayor's office was
 * sent, what Accounting dispatched, every subject line and every sender.
 * A uuid is a speed bump, not a lock.
 *
 * Shutting a door has two halves and the second is the one that gets
 * skipped: nobody who belongs must be locked out. So this checks all
 * three roles can still read their own mail, as hard as it checks that
 * outsiders cannot read it — a fix that quietly breaks the Mayor's inbox
 * is not a fix.
 *
 * Run: npx ts-node --transpile-only e2e_room_mail_privacy.ts */
import path from "path";

const entry = path.join(__dirname, "src", "index.ts");
require.cache[entry] = {
  id: entry, filename: entry, loaded: true,
  exports: { notificationSocket: { emitUserNotification: () => undefined } },
} as any;

import { prisma } from "./src/barrel/prisma";
import {
  disseminationInbox,
  disseminationOutbox,
  setTargetRooms,
  finalizeDissemination,
} from "./src/controller/disseminationController";
import { ROOM_MEMBER_TYPES } from "./src/controller/roomConfigController";

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
      data: { name: `QA Privacy ${TS}`, ...loc }, select: { id: true },
    });
    made.lineId = line.id;

    const mk = async (tag: string) => {
      const acct = await prisma.account.create({
        data: { username: `qa_priv_${TS}_${tag}`, password: "x", lineId: line.id },
        select: { id: true, username: true },
      });
      made.accountIds.push(acct.id);
      const u = await prisma.user.create({
        data: {
          firstName: "Qa", lastName: `PRIV${tag.toUpperCase()}`,
          username: acct.username, accountId: acct.id, lineId: line.id,
          email: `qa-priv-${TS}-${tag}@test.local`, active: 1,
        },
        select: { id: true },
      });
      made.userIds.push(u.id);
      return { accountId: acct.id, userId: u.id };
    };
    const mkRoom = async (code: string) => {
      const r = await prisma.receivingRoom.create({
        data: { code: `${code}-${TS}`, lineId: line.id }, select: { id: true, code: true },
      });
      made.roomIds.push(r.id);
      return r;
    };
    const join = (roomId: string, userId: string, type: number, status = 1) =>
      prisma.roomAuthorizedUser.create({
        data: { receivingRoomId: roomId, userId, type, status },
      });

    const SENDER   = await mk("sender");
    const OWNER    = await mk("owner");
    const SIGNER   = await mk("signer");
    const RECEIVER = await mk("receiver");
    const REMOVED  = await mk("removed");   // was in the room, taken out
    const NOSY     = await mk("nosy");      // another office entirely
    const STRANGER = await mk("stranger");  // no room at all

    const FROM = await mkRoom("QA-FROM");
    const TO   = await mkRoom("QA-TO");
    const ELSE = await mkRoom("QA-ELSE");

    await join(FROM.id, SENDER.userId,   ROOM_MEMBER_TYPES.owner);
    await join(TO.id,   OWNER.userId,    ROOM_MEMBER_TYPES.owner);
    await join(TO.id,   SIGNER.userId,   ROOM_MEMBER_TYPES.signatory);
    await join(TO.id,   RECEIVER.userId, ROOM_MEMBER_TYPES.receiver);
    await join(TO.id,   REMOVED.userId,  ROOM_MEMBER_TYPES.receiver, 0);
    await join(ELSE.id, NOSY.userId,     ROOM_MEMBER_TYPES.owner);

    // Something real to read, so a leak would actually leak something.
    const q = await prisma.signatureQueueRoom.create({
      data: { title: `CONFIDENTIAL ${TS}`, userId: SENDER.userId,
              receivingRoomId: FROM.id, status: 0, step: 0 },
      select: { id: true },
    });
    made.queueIds.push(q.id);
    await prisma.signatoryArrangement.create({
      data: { signatureQueueRoomId: q.id, userId: SIGNER.userId, index: 0, status: 0 },
    });
    const doc = await prisma.document.create({
      data: { title: `qa-priv-doc-${TS}`, lineId: line.id,
              userId: SENDER.userId, signatureQueueRoomId: q.id },
      select: { id: true },
    });
    made.docIds.push(doc.id);

    let res = mockRes();
    await setTargetRooms({
      user: { id: SENDER.accountId },
      body: { queueRoomId: q.id, targetRoomIds: [TO.id],
              userId: SENDER.userId, lineId: line.id },
    } as any, res);
    res = mockRes();
    await finalizeDissemination({
      user: { id: SENDER.accountId },
      body: { queueRoomId: q.id, userId: SENDER.userId, lineId: line.id },
    } as any, res);
    ok("a document was dispatched to the office", res._code === 200,
      JSON.stringify(res._body));

    const readInbox = async (accountId: string | null, roomId: string) => {
      const r = mockRes();
      let threw: any = null;
      await disseminationInbox(
        { user: accountId ? { id: accountId } : undefined,
          query: { toRoomId: roomId } } as any, r,
      ).catch((e) => { threw = e; });
      return { r, threw, list: (r._body?.list ?? []) as any[] };
    };
    const readOutbox = async (accountId: string | null, roomId: string) => {
      const r = mockRes();
      let threw: any = null;
      await disseminationOutbox(
        { user: accountId ? { id: accountId } : undefined,
          query: { fromRoomId: roomId } } as any, r,
      ).catch((e) => { threw = e; });
      return { r, threw, list: (r._body?.list ?? []) as any[] };
    };

    // ── Nobody who belongs is locked out ────────────────────────────────
    for (const [who, acct] of [
      ["the owner", OWNER.accountId],
      ["a signatory", SIGNER.accountId],
      ["a receiver", RECEIVER.accountId],
    ] as const) {
      const got = await readInbox(acct, TO.id);
      ok(`${who} still reads their own inbox`, !got.threw && got.r._code === 200,
        got.threw?.message);
      ok(`…and the document is in it`,
        got.list.some((x) => x.signatureQueueRoomId === q.id));
    }
    const senderOut = await readOutbox(SENDER.accountId, FROM.id);
    ok("the sender still reads their own outbox",
      !senderOut.threw && senderOut.list.some((x: any) => x.id === q.id),
      senderOut.threw?.message);

    // ── And the role that came back is still right ──────────────────────
    ok("a receiver may mark received",
      (await readInbox(RECEIVER.accountId, TO.id)).r._body?.canAcknowledge === true);
    ok("the owner may too",
      (await readInbox(OWNER.accountId, TO.id)).r._body?.canAcknowledge === true);
    ok("a signatory may not",
      (await readInbox(SIGNER.accountId, TO.id)).r._body?.canAcknowledge === false);

    // ── The door ────────────────────────────────────────────────────────
    let bad = await readInbox(NOSY.accountId, TO.id);
    ok("another office cannot read this inbox", !!bad.threw, JSON.stringify(bad.r._body));
    ok("…and gets no rows at all", bad.list.length === 0);
    ok("…and no subject line leaks in the refusal",
      !JSON.stringify(bad.threw?.message ?? "").includes("CONFIDENTIAL"),
      bad.threw?.message);

    bad = await readInbox(STRANGER.accountId, TO.id);
    ok("somebody with no room at all cannot read it", !!bad.threw);

    bad = await readInbox(REMOVED.accountId, TO.id);
    ok("a REMOVED member cannot read it either", !!bad.threw,
      "their row survives at status 0, which is the point of removing them");

    bad = await readInbox(null, TO.id);
    ok("an unauthenticated call is refused", !!bad.threw, bad.threw?.message);

    bad = await readOutbox(NOSY.accountId, FROM.id);
    ok("another office cannot read this outbox", !!bad.threw);
    ok("…and gets no rows", bad.list.length === 0);
    bad = await readOutbox(RECEIVER.accountId, FROM.id);
    ok("being in the RECIPIENT office does not open the sender's outbox",
      !!bad.threw, "they were sent one document, not given the drawer");

    // ── The nosy user's own mail is untouched by any of this ────────────
    const own = await readOutbox(NOSY.accountId, ELSE.id);
    ok("the same account still reads its OWN room fine",
      !own.threw && own.r._code === 200, own.threw?.message);
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
