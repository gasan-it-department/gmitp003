/* PROOF: the dashboard tiles are the caller's own numbers.
 *
 * documentOverview took a userId in the query and believed it, so typing
 * somebody else's id returned their inbox count, their outbox count and
 * how many signatures they hold. It took a lineId the same way, which is
 * another municipality's totals.
 *
 * And the tile labelled "Pending my signature" had neither a user filter
 * nor a line filter. It counted every unsigned slot in the database and
 * showed the same number to everybody — a leak, and a plainly wrong
 * number on every dashboard in the system. That one is the reason this
 * file checks the ARITHMETIC as well as the boundary: an authorisation
 * fix that leaves a wrong number on screen has fixed half the problem.
 *
 * Run: npx ts-node --transpile-only e2e_overview_scope.ts */
import path from "path";

const entry = path.join(__dirname, "src", "index.ts");
require.cache[entry] = {
  id: entry, filename: entry, loaded: true,
  exports: { notificationSocket: { emitUserNotification: () => undefined } },
} as any;

import { prisma } from "./src/barrel/prisma";
import { documentOverview } from "./src/controller/disseminationController";
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
    roomIds: [] as string[], queueIds: [] as string[], lineIds: [] as string[],
  };

  try {
    const loc = await prisma.line.findFirst({
      select: { barangayId: true, municipalId: true, provinceId: true, regionId: true },
    });
    if (!loc) { console.log("NO FIXTURE (line)"); process.exit(2); }
    const mkLine = async (tag: string) => {
      const l = await prisma.line.create({
        data: { name: `QA Ovw ${TS} ${tag}`, ...loc }, select: { id: true },
      });
      made.lineIds.push(l.id);
      return l;
    };
    // Two municipalities, so "another line's totals" is a real thing here.
    const LINE_A = await mkLine("A");
    const LINE_B = await mkLine("B");

    const mk = async (tag: string, lineId: string) => {
      const acct = await prisma.account.create({
        data: { username: `qa_ovw_${TS}_${tag}`, password: "x", lineId },
        select: { id: true, username: true },
      });
      made.accountIds.push(acct.id);
      const u = await prisma.user.create({
        data: {
          firstName: "Qa", lastName: `OVW${tag.toUpperCase()}`,
          username: acct.username, accountId: acct.id, lineId,
          email: `qa-ovw-${TS}-${tag}@test.local`, active: 1,
        },
        select: { id: true },
      });
      made.userIds.push(u.id);
      return { accountId: acct.id, userId: u.id };
    };
    const mkRoom = async (code: string, lineId: string) => {
      const r = await prisma.receivingRoom.create({
        data: { code: `${code}-${TS}`, lineId }, select: { id: true },
      });
      made.roomIds.push(r.id);
      return r;
    };

    const ALICE = await mk("alice", LINE_A.id);   // has a room and a slot
    const BOB   = await mk("bob", LINE_A.id);     // same line, own room
    const CARLA = await mk("carla", LINE_B.id);   // another municipality

    const A_ROOM = await mkRoom("QA-A", LINE_A.id);
    const B_ROOM = await mkRoom("QA-B", LINE_A.id);
    await prisma.roomAuthorizedUser.create({
      data: { receivingRoomId: A_ROOM.id, userId: ALICE.userId,
              type: ROOM_MEMBER_TYPES.owner, status: 1 },
    });
    await prisma.roomAuthorizedUser.create({
      data: { receivingRoomId: B_ROOM.id, userId: BOB.userId,
              type: ROOM_MEMBER_TYPES.owner, status: 1 },
    });

    // Two dispatched routings on line A with pending slots: one ALICE's,
    // one BOB's. Neither should show up on the other's dashboard.
    const mkQueue = async (owner: any, signer: any, fromRoom: string) => {
      const q = await prisma.signatureQueueRoom.create({
        data: { title: `QA ovw ${TS}`, userId: owner.userId,
                receivingRoomId: fromRoom, status: 1, step: 1 },
        select: { id: true },
      });
      made.queueIds.push(q.id);
      await prisma.signatoryArrangement.create({
        data: { signatureQueueRoomId: q.id, userId: signer.userId,
                index: 0, status: 0 },
      });
      // …plus an UNASSIGNED slot, which belongs to nobody's tile.
      await prisma.signatoryArrangement.create({
        data: { signatureQueueRoomId: q.id, userId: null, index: 1, status: 0 },
      });
      return q;
    };
    await mkQueue(ALICE, ALICE, A_ROOM.id);
    await mkQueue(BOB, BOB, B_ROOM.id);
    await prisma.signature.create({
      data: { title: `qa-ovw-${TS}`, userId: ALICE.userId, active: true },
    });

    const ask = async (accountId: string | null, query: any) => {
      const r = mockRes();
      let threw: any = null;
      await documentOverview(
        { user: accountId ? { id: accountId } : undefined, query } as any, r,
      ).catch((e) => { threw = e; });
      return { r, threw, body: r._body };
    };

    // ── The numbers are right, which is the half that was broken ────────
    let out = await ask(ALICE.accountId, { lineId: LINE_A.id });
    ok("the dashboard loads", !out.threw && out.r._code === 200, out.threw?.message);
    ok("it finds the caller's own room", out.body?.myRoom?.id === A_ROOM.id,
      JSON.stringify(out.body?.myRoom));
    ok("pending counts ONLY the caller's own slot",
      out.body?.signatures?.pendingForMe === 1,
      `got ${out.body?.signatures?.pendingForMe} — it used to be everyone's`);
    ok("…so an unassigned slot is on nobody's tile",
      out.body?.signatures?.pendingForMe === 1);
    ok("signature count is the caller's", out.body?.signatures?.mine === 1);

    out = await ask(BOB.accountId, { lineId: LINE_A.id });
    ok("a colleague sees their OWN pending, not the same figure",
      out.body?.signatures?.pendingForMe === 1);
    ok("…and their own room", out.body?.myRoom?.id === B_ROOM.id);
    ok("…and their own signature count of zero",
      out.body?.signatures?.mine === 0, JSON.stringify(out.body?.signatures));

    // ── Naming somebody else buys nothing ───────────────────────────────
    out = await ask(BOB.accountId, { lineId: LINE_A.id, userId: ALICE.userId });
    ok("passing another person's id is ignored, not obeyed",
      out.body?.myRoom?.id === B_ROOM.id && out.body?.signatures?.mine === 0,
      JSON.stringify({ room: out.body?.myRoom?.id, mine: out.body?.signatures?.mine }));

    // ── Another municipality's totals ───────────────────────────────────
    out = await ask(CARLA.accountId, { lineId: LINE_A.id });
    ok("someone from another line cannot ask for line A", !!out.threw,
      JSON.stringify(out.body));
    ok("…and gets no totals at all", !out.body);
    out = await ask(CARLA.accountId, { lineId: LINE_B.id });
    ok("…but their own line still works", !out.threw && out.r._code === 200,
      out.threw?.message);
    ok("…and shows nothing of line A", out.body?.dissemination?.active === 0,
      JSON.stringify(out.body?.dissemination));

    out = await ask(null, { lineId: LINE_A.id });
    ok("an unauthenticated call is refused", !!out.threw);

    // ── A removed member's old room is not theirs ───────────────────────
    await prisma.roomAuthorizedUser.updateMany({
      where: { receivingRoomId: A_ROOM.id, userId: ALICE.userId },
      data: { status: 0 },
    });
    out = await ask(ALICE.accountId, { lineId: LINE_A.id });
    ok("a removed member no longer gets that room's counts",
      out.body?.myRoom?.id === null, JSON.stringify(out.body?.myRoom));
  } catch (e: any) {
    fail++;
    console.log("FAIL  threw: " + (e?.stack ?? e?.message ?? String(e)));
  } finally {
    try {
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
      for (const id of made.lineIds)
        await prisma.line.delete({ where: { id } }).catch(() => undefined);
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
