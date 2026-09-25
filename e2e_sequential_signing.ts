/* PROOF: in-order signing, and an inbox that shows all your rooms.
 *
 * SEQUENTIAL. A sender can now require that signatures are collected in
 * order: slot 3 waits for 1 and 2. Enforced on the server, because the UI is
 * one of two clients and neither is the authority on whether a signature is
 * valid. Off by default, so every existing routing behaves exactly as before.
 * Fixed at dispatch — flipping it under a half-signed routing would either
 * strand somebody who was told to wait or retroactively invalidate an order
 * that had already been followed.
 *
 * ROOMS. A person can belong to more than one document room. The registry
 * resolved their room with findFirst and no ordering, so it returned an
 * arbitrary one and the other room's mail was simply unreachable — on the
 * database this session can see, one user had 11 documents in the room the
 * app was not showing. The payload now carries every room, with a stable
 * default.
 *
 * Run: npx ts-node --transpile-only e2e_sequential_signing.ts */
import path from "path";

const entry = path.join(__dirname, "src", "index.ts");
require.cache[entry] = {
  id: entry, filename: entry, loaded: true,
  exports: { notificationSocket: { emitUserNotification: () => undefined } },
} as any;

import { prisma } from "./src/barrel/prisma";
import {
  finalizeDissemination,
  saveSignaturePlacements,
  setRoutingSequential,
  signMine,
} from "./src/controller/disseminationController";
import { signatoryRegistry } from "./src/controller/documentController";
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
    roomIds: [] as string[], queueIds: [] as string[], docIds: [] as string[],
    sigIds: [] as string[],
  };

  try {
    const line = await prisma.line.findFirst({ select: { id: true } });
    if (!line) { console.log("NO FIXTURE (line)"); process.exit(2); }

    const mk = async (tag: string) => {
      const acct = await prisma.account.create({
        data: { username: `qa_sq_${TS}_${tag}`, password: "x", lineId: line.id },
        select: { id: true, username: true },
      });
      made.accountIds.push(acct.id);
      const u = await prisma.user.create({
        data: {
          firstName: `Qa${tag}`, lastName: `SQ${TS}`, username: acct.username,
          accountId: acct.id, lineId: line.id,
          email: `qa-sq-${TS}-${tag}@test.local`, active: 1,
        },
        select: { id: true },
      });
      made.userIds.push(u.id);
      const sg = await prisma.signature.create({
        data: { title: `qa-sq-${TS}-${tag}`, userId: u.id, active: true },
        select: { id: true },
      });
      made.sigIds.push(sg.id);
      return { accountId: acct.id, userId: u.id };
    };

    const SENDER = await mk("sender");
    const A = await mk("a");
    const B = await mk("b");
    const C = await mk("c");

    const FROM = await prisma.receivingRoom.create({
      data: { code: `QA-SQ-FROM-${TS}`, lineId: line.id }, select: { id: true },
    });
    const TO = await prisma.receivingRoom.create({
      data: { code: `QA-SQ-TO-${TS}`, lineId: line.id }, select: { id: true },
    });
    made.roomIds.push(FROM.id, TO.id);
    await prisma.roomAuthorizedUser.create({
      data: { receivingRoomId: FROM.id, userId: SENDER.userId, type: ROOM_MEMBER_TYPES.owner, status: 1 },
    });

    /** A dispatched routing with three ordered signatories and a box each. */
    const mkRouting = async (tag: string, sequential: boolean) => {
      const q = await prisma.signatureQueueRoom.create({
        data: {
          title: `qa-sq-${tag}-${TS}`, userId: SENDER.userId,
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
          title: `qa-sq-doc-${tag}-${TS}`, lineId: line.id,
          userId: SENDER.userId, signatureQueueRoomId: q.id,
        },
        select: { id: true },
      });
      made.docIds.push(doc.id);
      const order = [A, B, C];
      for (let i = 0; i < order.length; i++) {
        await prisma.signatoryArrangement.create({
          data: {
            signatureQueueRoomId: q.id, index: i, status: 0,
            userId: order[i].userId,
          },
        });
      }
      await call(saveSignaturePlacements, {
        user: { id: SENDER.accountId },
        body: {
          queueRoomId: q.id, documentId: doc.id,
          userId: SENDER.userId, lineId: line.id,
          placements: [1, 2, 3].map((s) => ({
            page: 1, slotIndex: s,
            xAxis: 1000 * s, yAxis: 2000, width: 1500, height: 500,
          })),
        },
      });
      if (sequential) {
        await call(setRoutingSequential, {
          user: { id: SENDER.accountId },
          body: { queueRoomId: q.id, sequential: true },
        });
      }
      await call(finalizeDissemination, {
        user: { id: SENDER.accountId },
        body: { queueRoomId: q.id, userId: SENDER.userId, lineId: line.id },
      });
      return q.id;
    };

    const sign = (who: { accountId: string; userId: string }, queueId: string) =>
      call(signMine, {
        user: { id: who.accountId },
        body: { queueRoomId: queueId, userId: who.userId },
      });

    const slots = (queueId: string) =>
      prisma.signatoryArrangement.findMany({
        where: { signatureQueueRoomId: queueId },
        orderBy: { index: "asc" },
        select: { index: true, status: true, signedAt: true },
      });

    // ══ 1. Default is unchanged: anybody, any order ════════════════════
    console.log("\n-- the default, which must not change --");
    const free = await mkRouting("free", false);
    const q0 = await prisma.signatureQueueRoom.findUnique({
      where: { id: free }, select: { sequential: true },
    });
    ok("a new routing is NOT sequential by default", q0?.sequential === false);

    const cFirst = await sign(C, free);
    ok("the LAST signatory can sign first when order is off", cFirst.ok, cFirst.message);
    const s0 = await slots(free);
    ok("...and only their slot moved",
      s0[2].status === 1 && s0[0].status === 0 && s0[1].status === 0,
      JSON.stringify(s0.map((s) => s.status)));

    // ══ 2. With the rule on, the chain is a chain ══════════════════════
    console.log("\n-- in order --");
    const seq = await mkRouting("seq", true);
    const q1 = await prisma.signatureQueueRoom.findUnique({
      where: { id: seq }, select: { sequential: true },
    });
    ok("the flag is set on the routing", q1?.sequential === true);

    const cEarly = await sign(C, seq);
    ok("signatory 3 is REFUSED while 1 and 2 are unsigned", !cEarly.ok, cEarly.message);
    ok("...and the refusal names who it is waiting for",
      /#1/.test(cEarly.message) && /#2/.test(cEarly.message), cEarly.message);
    ok("...nothing was recorded",
      (await slots(seq)).every((s) => s.status === 0));

    const bEarly = await sign(B, seq);
    ok("signatory 2 is refused too, while 1 is unsigned", !bEarly.ok, bEarly.message);
    ok("...naming only slot 1", /#1/.test(bEarly.message) && !/#2/.test(bEarly.message),
      bEarly.message);

    const a1 = await sign(A, seq);
    ok("signatory 1 can sign", a1.ok, a1.message);
    const cStill = await sign(C, seq);
    ok("...3 is still refused, because 2 has not signed", !cStill.ok, cStill.message);
    const b1 = await sign(B, seq);
    ok("2 can sign now", b1.ok, b1.message);
    const c1 = await sign(C, seq);
    ok("...and only then can 3", c1.ok, c1.message);

    const sFinal = await slots(seq);
    ok("all three signed", sFinal.every((s) => s.status === 1));
    ok("...each with a timestamp, which the sidebar needs",
      sFinal.every((s) => !!s.signedAt),
      JSON.stringify(sFinal.map((s) => s.signedAt)));
    ok("...and the timestamps are in signing order",
      sFinal[0].signedAt! <= sFinal[1].signedAt! &&
        sFinal[1].signedAt! <= sFinal[2].signedAt!);

    // ══ 3. The flag is fixed once dispatched ═══════════════════════════
    console.log("\n-- the rule cannot move under people --");
    const late = await call(setRoutingSequential, {
      user: { id: SENDER.accountId },
      body: { queueRoomId: seq, sequential: false },
    });
    ok("turning it off after dispatch is refused", !late.ok, late.message);
    ok("...and says why", /before the routing is dispatched/i.test(late.message),
      late.message);

    // ══ 4. A person in two rooms sees both ═════════════════════════════
    console.log("\n-- more than one room --");
    const SECOND = await prisma.receivingRoom.create({
      data: { code: `QA-SQ-2ND-${TS}`, lineId: line.id }, select: { id: true },
    });
    made.roomIds.push(SECOND.id);
    await prisma.roomAuthorizedUser.create({
      data: { receivingRoomId: TO.id, userId: A.userId, type: ROOM_MEMBER_TYPES.signatory, status: 1 },
    });
    await prisma.roomAuthorizedUser.create({
      data: { receivingRoomId: SECOND.id, userId: A.userId, type: ROOM_MEMBER_TYPES.owner, status: 1 },
    });

    const reg = mockRes();
    await signatoryRegistry(
      { user: { id: A.accountId }, query: { userId: A.userId } } as any, reg,
    );
    const body = reg._body as { room: any; rooms: any[] };
    ok("the payload lists BOTH rooms", body.rooms?.length === 2,
      JSON.stringify(body.rooms?.map((r: any) => r.code)));
    ok("...each tagged with the caller's role in it",
      body.rooms?.every((r: any) => r.myType !== null && r.myType !== undefined),
      JSON.stringify(body.rooms?.map((r: any) => r.myType)));
    ok("...the default is the one they OWN, not an arbitrary pick",
      body.room?.id === SECOND.id, `picked ${body.room?.code}`);

    const reg2 = mockRes();
    await signatoryRegistry(
      { user: { id: A.accountId }, query: { userId: A.userId } } as any, reg2,
    );
    ok("...and the same room every time it is asked",
      (reg2._body as any).room?.id === body.room?.id);

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
