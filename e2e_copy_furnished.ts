/* PROOF: Copy Furnished — the offices that get it only once it is SIGNED.
 *
 * An addressee gets the document the moment it is dispatched, draft
 * signatures and all, because they are the ones who have to act on it. A
 * copy-furnished office is different: it gets the finished thing for its
 * records, and must see NOTHING until the last signature lands.
 *
 * "Nothing" is the whole feature, and it is easy to get wrong, because a
 * copy-furnished row is an ordinary TargetRoom row written at configuration
 * time. Every query that answers "what has my room received" will happily
 * return it. So this file checks the silence as hard as it checks the
 * delivery: no inbox row, no badge count, no cancellation notice for a
 * document the office was never given.
 *
 * Run: npx ts-node --transpile-only e2e_copy_furnished.ts */
import path from "path";

/* Stub the app entrypoint before anything can pull it in: notifying a user
 * makes notificationEvents `await import("..")`, which boots Fastify and
 * grabs port 3000. Same knot as e2e_room_one_per_user.ts. */
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
  documentOverview,
  signMine,
  cancelDispatchedDissemination,
} from "./src/controller/disseminationController";

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
        data: { username: `qa_cf_${TS}_${tag}`, password: "x", lineId: line.id },
        select: { id: true, username: true },
      });
      made.accountIds.push(acct.id);
      const u = await prisma.user.create({
        data: {
          firstName: "Qa", lastName: `CF${TS}${tag.toUpperCase()}`,
          username: acct.username, accountId: acct.id, lineId: line.id,
          email: `qa-cf-${TS}-${tag}@test.local`, active: 1,
        },
        select: { id: true },
      });
      made.userIds.push(u.id);
      return { accountId: acct.id, userId: u.id };
    };

    const mkRoom = async (owner: { userId: string }, code: string) => {
      const room = await prisma.receivingRoom.create({
        data: { code, lineId: line.id },
        select: { id: true, code: true },
      });
      made.roomIds.push(room.id);
      await prisma.roomAuthorizedUser.create({
        data: { receivingRoomId: room.id, userId: owner.userId, type: 0, status: 1 },
      });
      return room;
    };

    const SENDER = await mk("sender");
    const SIGNER = await mk("signer");
    const ADDRESSEE = await mk("addressee");
    const CF = await mk("cf");

    const FROM = await mkRoom(SENDER, `QA-CF-FROM-${TS}`);
    const TO = await mkRoom(ADDRESSEE, `QA-CF-TO-${TS}`);
    const CC = await mkRoom(CF, `QA-CF-CC-${TS}`);

    // The signer needs an active signature on file or signMine refuses.
    await prisma.signature.create({
      data: { title: `qa-cf-${TS}`, userId: SIGNER.userId, active: true },
    });

    const mkQueue = async (title: string, withSignatory = true) => {
      const q = await prisma.signatureQueueRoom.create({
        data: {
          title,
          userId: SENDER.userId,
          receivingRoomId: FROM.id,
          status: 0,
          step: 0,
        },
        select: { id: true },
      });
      made.queueIds.push(q.id);
      if (withSignatory) {
        await prisma.signatoryArrangement.create({
          data: {
            signatureQueueRoomId: q.id,
            userId: SIGNER.userId,
            index: 0,
            status: 0,
          },
        });
      }
      // finalize() refuses a dissemination with nothing attached.
      const doc = await prisma.document.create({
        data: {
          title: `qa-cf-doc-${TS}`,
          lineId: line.id,
          userId: SENDER.userId,
          signatureQueueRoomId: q.id,
        },
        select: { id: true },
      });
      made.docIds.push(doc.id);
      return q;
    };

    const inboxOf = async (roomId: string) => {
      const r = mockRes();
      await disseminationInbox({ query: { toRoomId: roomId } } as any, r);
      return (r._body?.list ?? []) as any[];
    };
    const badgeOf = async (roomId: string, userId: string) => {
      const r = mockRes();
      await documentOverview(
        { query: { lineId: line.id, roomId, userId } } as any, r);
      return r._body;
    };
    const holds = (queueId: string, roomId: string) =>
      prisma.targetRoom.findFirst({
        where: { signatureQueueRoomId: queueId, receivingRoomId: roomId },
        select: { copyFurnished: true, releasedAt: true, status: true },
      });
    const noticesFor = (userId: string, like: string) =>
      prisma.notification.count({
        where: { recipientId: userId, title: { contains: like } },
      });

    // ── Configure: one addressee, one copy furnished ────────────────────
    const Q = await mkQueue(`QA CF ${TS}`);
    let res = mockRes();
    await setTargetRooms({
      user: { id: SENDER.accountId },
      body: {
        queueRoomId: Q.id,
        targetRoomIds: [TO.id],
        copyFurnishedRoomIds: [CC.id],
        userId: SENDER.userId,
        lineId: line.id,
      },
    } as any, res);
    ok("configuring accepts copy-furnished rooms", res._code === 200,
      JSON.stringify(res._body));

    const cfRow = await holds(Q.id, CC.id);
    ok("the copy-furnished row exists from the start (auditable)", !!cfRow);
    ok("…flagged as copy furnished", cfRow?.copyFurnished === true);
    ok("…and held: nothing released yet", cfRow?.releasedAt === null);
    ok("the addressee row is an ordinary target",
      (await holds(Q.id, TO.id))?.copyFurnished === false);

    // Asking for someone as BOTH is not two rows. Being an addressee wins.
    const Q2 = await mkQueue(`QA CF dup ${TS}`);
    res = mockRes();
    await setTargetRooms({
      user: { id: SENDER.accountId },
      body: {
        queueRoomId: Q2.id,
        targetRoomIds: [TO.id],
        copyFurnishedRoomIds: [TO.id, CC.id, CC.id],
        userId: SENDER.userId, lineId: line.id,
      },
    } as any, res);
    ok("a room named as both addressee and CC gets ONE row",
      (await prisma.targetRoom.count({
        where: { signatureQueueRoomId: Q2.id, receivingRoomId: TO.id },
      })) === 1);
    ok("…and it is the addressee row, not the held one",
      (await holds(Q2.id, TO.id))?.copyFurnished === false);
    ok("a CC named twice gets one row",
      (await prisma.targetRoom.count({
        where: { signatureQueueRoomId: Q2.id, receivingRoomId: CC.id },
      })) === 1);

    // ── Dispatch: the addressee gets it, the CC office does not ─────────
    res = mockRes();
    await finalizeDissemination({
      user: { id: SENDER.accountId },
      body: { queueRoomId: Q.id, userId: SENDER.userId, lineId: line.id },
    } as any, res);
    ok("dispatched", res._code === 200, JSON.stringify(res._body));

    ok("the addressee sees it in their inbox",
      (await inboxOf(TO.id)).some((r) => r.signatureQueueRoomId === Q.id));
    ok("the copy-furnished office's inbox is EMPTY",
      !(await inboxOf(CC.id)).some((r) => r.signatureQueueRoomId === Q.id));
    ok("…the debug sample does not leak it either",
      !(await (async () => {
        const r = mockRes();
        await disseminationInbox({ query: { toRoomId: CC.id } } as any, r);
        return (r._body?.debug?.sample ?? []) as any[];
      })()).some((t: any) => t.signatureQueueRoomId === Q.id));

    const cfBadgeBefore = (await badgeOf(CC.id, CF.userId))?.inbox ?? 0;
    ok("…and their inbox badge does not count it", cfBadgeBefore === 0,
      String(cfBadgeBefore));
    ok("dispatch left the held row undelivered",
      (await holds(Q.id, CC.id))?.status === 0);
    ok("nobody in that office has been notified yet",
      (await noticesFor(CF.userId, "Copy furnished")) === 0);

    // ── Sign: the last signature releases it ────────────────────────────
    res = mockRes();
    await signMine({
      user: { id: SIGNER.accountId },
      body: { queueRoomId: Q.id, userId: SIGNER.userId },
    } as any, res);
    ok("signing completed the dissemination", res._body?.completed === true,
      JSON.stringify(res._body));
    ok("…and released exactly one copy-furnished office",
      res._body?.copyFurnished === 1, JSON.stringify(res._body?.copyFurnished));

    const after = await holds(Q.id, CC.id);
    ok("the held row is now released", after?.releasedAt !== null);
    ok("…and marked delivered", after?.status === 1);
    ok("it is still flagged copy furnished (it is how it arrived)",
      after?.copyFurnished === true);
    ok("the office NOW sees it in their inbox",
      (await inboxOf(CC.id)).some((r) => r.signatureQueueRoomId === Q.id));
    ok("…and was told", (await noticesFor(CF.userId, "Copy furnished")) >= 1);

    // ── Exactly once ────────────────────────────────────────────────────
    const noticesAfterFirst = await noticesFor(CF.userId, "Copy furnished");
    res = mockRes();
    await signMine({
      user: { id: SIGNER.accountId },
      body: { queueRoomId: Q.id, userId: SIGNER.userId },
    } as any, res).catch(() => undefined);
    ok("signing again releases nothing a second time",
      (res._body?.copyFurnished ?? 0) === 0, JSON.stringify(res._body));
    ok("…and sends no second notification",
      (await noticesFor(CF.userId, "Copy furnished")) === noticesAfterFirst);
    ok("…one inbox row, not two",
      (await inboxOf(CC.id)).filter((r) => r.signatureQueueRoomId === Q.id)
        .length === 1);

    // ── Cancelled before signing: they never learn it existed ───────────
    res = mockRes();
    await finalizeDissemination({
      user: { id: SENDER.accountId },
      body: { queueRoomId: Q2.id, userId: SENDER.userId, lineId: line.id },
    } as any, res);
    const cancelNoticesBefore = await noticesFor(CF.userId, "cancelled");
    res = mockRes();
    await cancelDispatchedDissemination({
      user: { id: SENDER.accountId },
      body: { queueRoomId: Q2.id, userId: SENDER.userId, reason: "qa" },
    } as any, res);
    ok("a dispatched dissemination can be cancelled", res._code === 200,
      JSON.stringify(res._body));
    ok("the held office is NOT told a document was cancelled",
      (await noticesFor(CF.userId, "cancelled")) === cancelNoticesBefore,
      "they were never given it in the first place");
    ok("…and it never reaches their inbox",
      !(await inboxOf(CC.id)).some((r) => r.signatureQueueRoomId === Q2.id));
    ok("…while it never released", (await holds(Q2.id, CC.id))?.releasedAt === null);
    ok("the addressee, who did have it, IS told",
      (await prisma.notification.count({
        where: { recipientId: ADDRESSEE.userId, title: { contains: "cancelled" } },
      })) >= 1);
    // ── No signatories: nothing to wait for, so it lands at dispatch ────
    // Without this the held rooms would wait on a signature that is never
    // coming and the document would sit undelivered forever.
    const Q3 = await mkQueue(`QA CF nosig ${TS}`, false);
    res = mockRes();
    await setTargetRooms({
      user: { id: SENDER.accountId },
      body: {
        queueRoomId: Q3.id,
        targetRoomIds: [TO.id],
        copyFurnishedRoomIds: [CC.id],
        userId: SENDER.userId, lineId: line.id,
      },
    } as any, res);
    ok("held before dispatch, even with no signatories",
      (await holds(Q3.id, CC.id))?.releasedAt === null);
    res = mockRes();
    await finalizeDissemination({
      user: { id: SENDER.accountId },
      body: { queueRoomId: Q3.id, userId: SENDER.userId, lineId: line.id },
    } as any, res);
    ok("a dissemination with nothing to sign dispatches", res._code === 200,
      JSON.stringify(res._body));
    const nosig = await holds(Q3.id, CC.id);
    ok("…and releases the copy-furnished office right away",
      nosig?.releasedAt !== null, JSON.stringify(nosig));
    ok("…delivered", nosig?.status === 1);
    ok("…and it is in their inbox",
      (await inboxOf(CC.id)).some((r) => r.signatureQueueRoomId === Q3.id));
  } catch (e: any) {
    fail++;
    console.log("FAIL  threw: " + (e?.stack ?? e?.message ?? String(e)));
  } finally {
    try {
      if (made.docIds.length) {
        const d = { documentId: { in: made.docIds } };
        await prisma.documentActivityLogs.deleteMany({ where: d })
          .catch(() => undefined);
        await prisma.documentPage.deleteMany({ where: d }).catch(() => undefined);
        await prisma.decodedFile.deleteMany({ where: d }).catch(() => undefined);
        await prisma.document.deleteMany({ where: { id: { in: made.docIds } } });
      }
      if (made.queueIds.length) {
        const qs = { signatureQueueRoomId: { in: made.queueIds } };
        await prisma.targetRoom.deleteMany({ where: qs });
        await prisma.signatoryArrangement.deleteMany({ where: qs });
        await prisma.signatureQueueRoom.deleteMany({
          where: { id: { in: made.queueIds } },
        });
      }
      if (made.roomIds.length) {
        await prisma.roomAuthorizedUser.deleteMany({
          where: { receivingRoomId: { in: made.roomIds } },
        });
        await prisma.receivingRoom.deleteMany({
          where: { id: { in: made.roomIds } },
        });
      }
      if (made.userIds.length) {
        const who = { in: made.userIds };
        await prisma.signature.deleteMany({ where: { userId: who } })
          .catch(() => undefined);
        await prisma.notification.deleteMany({
          where: { OR: [{ recipientId: who }, { senderId: who }] },
        }).catch(() => undefined);
        await prisma.documentActivityLogs.deleteMany({ where: { userId: who } })
          .catch(() => undefined);
        await prisma.humanResourcesLogs.deleteMany({ where: { userId: who } })
          .catch(() => undefined);
        await prisma.user.deleteMany({ where: { id: who } });
      }
      if (made.accountIds.length)
        await prisma.account.deleteMany({ where: { id: { in: made.accountIds } } });
      const left = await prisma.user.count({
        where: { username: { startsWith: `qa_cf_${TS}_` } },
      });
      console.log(`CLEANUP  leftover users=${left}`);
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
