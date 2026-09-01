/* PROOF: a person belongs to ONE document room.
 *
 * You may add someone to your room only if they are not already in a room.
 * Their room is where their work arrives and where their signing authority
 * sits, so two rooms means an ambiguous "route it to them" and a queue split
 * in half without anyone noticing.
 *
 * The awkward case, and the reason this file exists: someone REMOVED from a
 * room still has a membership row (status 0). That must not read as "already
 * in a room", or you could never put back a person you took out.
 *
 * Run: npx ts-node --transpile-only e2e_room_one_per_user.ts */
import path from "path";

/**
 * Stub the app entrypoint BEFORE anything can pull it in.
 *
 * Adding a member notifies them, and notificationEvents does
 * `await import("..")` to reach the socket — which boots the whole Fastify
 * app and tries to listen on 3000. That is a pre-existing knot between a
 * service and the entrypoint, not this feature's business, and it makes the
 * test fail on a machine where anything else already holds the port.
 *
 * Seeding require.cache gives that import a no-op socket instead.
 */
const entry = path.join(__dirname, "src", "index.ts");
require.cache[entry] = {
  id: entry,
  filename: entry,
  loaded: true,
  exports: {
    notificationSocket: { emitUserNotification: () => undefined },
  },
} as any;

import { prisma } from "./src/barrel/prisma";
import {
  addRoomMembers,
  roomCandidates,
  removeRoomMember,
  ROOM_MEMBER_TYPES,
} from "./src/controller/roomConfigController";

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
  };

  try {
    const line = await prisma.line.findFirst({ select: { id: true } });
    if (!line) { console.log("NO FIXTURE (line)"); process.exit(2); }

    const mk = async (tag: string) => {
      const acct = await prisma.account.create({
        data: { username: `qa_room_${TS}_${tag}`, password: "x", lineId: line.id },
        select: { id: true, username: true },
      });
      made.accountIds.push(acct.id);
      const u = await prisma.user.create({
        data: {
          firstName: "Qa", lastName: `ROOM${TS}${tag.toUpperCase()}`,
          username: acct.username, accountId: acct.id, lineId: line.id,
          email: `qa-room-${TS}-${tag}@test.local`, active: 1,
        },
        select: { id: true },
      });
      made.userIds.push(u.id);
      return { accountId: acct.id, userId: u.id };
    };

    const OWNER_A = await mk("ownera");
    const OWNER_B = await mk("ownerb");
    const FREE = await mk("free");     // in no room
    const TAKEN = await mk("taken");   // will be in room B

    const mkRoom = async (owner: { userId: string }, code: string) => {
      const room = await prisma.receivingRoom.create({
        data: { code, lineId: line.id },
        select: { id: true, code: true },
      });
      made.roomIds.push(room.id);
      await prisma.roomAuthorizedUser.create({
        data: {
          receivingRoomId: room.id,
          userId: owner.userId,
          type: ROOM_MEMBER_TYPES.owner,
          status: 1,
        },
      });
      return room;
    };

    const ROOM_A = await mkRoom(OWNER_A, `QA-A-${TS}`);
    const ROOM_B = await mkRoom(OWNER_B, `QA-B-${TS}`);

    const asA = (body: any) => ({ user: { id: OWNER_A.accountId }, body }) as any;
    const memberCount = (roomId: string, userId: string) =>
      prisma.roomAuthorizedUser.count({
        where: { receivingRoomId: roomId, userId, status: 1 },
      });

    // Put TAKEN into room B so they are spoken for.
    let res = mockRes();
    await addRoomMembers(
      { user: { id: OWNER_B.accountId },
        body: { roomId: ROOM_B.id, userIds: [TAKEN.userId], type: 1 } } as any,
      res,
    );
    ok("someone with no room can be added", res._body?.added === 1,
      JSON.stringify(res._body));
    ok("…and nothing was skipped", (res._body?.skipped ?? []).length === 0);

    // ── The rule ────────────────────────────────────────────────────────
    res = mockRes();
    await addRoomMembers(
      asA({ roomId: ROOM_A.id, userIds: [FREE.userId, TAKEN.userId], type: 1 }),
      res,
    );
    ok("the free person IS added", res._body?.added === 1, JSON.stringify(res._body?.added));
    ok("the one already in a room is refused",
      (res._body?.skipped ?? []).some((s: any) => s.userId === TAKEN.userId),
      JSON.stringify(res._body?.skipped));
    ok("…and the refusal names the room holding them",
      (res._body?.skipped ?? [])[0]?.room === ROOM_B.code,
      JSON.stringify(res._body?.skipped));
    ok("nothing was written for them in room A",
      (await memberCount(ROOM_A.id, TAKEN.userId)) === 0);
    ok("their membership of room B is untouched",
      (await memberCount(ROOM_B.id, TAKEN.userId)) === 1);
    ok("the free person really is in room A",
      (await memberCount(ROOM_A.id, FREE.userId)) === 1);

    // An owner is a member too, so owning a room counts as having one.
    res = mockRes();
    await addRoomMembers(
      asA({ roomId: ROOM_A.id, userIds: [OWNER_B.userId], type: 1 }), res);
    ok("the OWNER of another room is refused as well",
      res._body?.added === 0 &&
        (res._body?.skipped ?? []).some((s: any) => s.userId === OWNER_B.userId),
      JSON.stringify(res._body));

    // ── The candidate list says so up front ─────────────────────────────
    res = mockRes();
    await roomCandidates(
      { user: { id: OWNER_A.accountId }, query: { roomId: ROOM_A.id } } as any,
      res,
    );
    const cands: any[] = res._body?.candidates ?? [];
    const cTaken = cands.find((c) => c.id === TAKEN.userId);
    const cFree = cands.find((c) => c.id === FREE.userId);
    ok("the list flags who is already in another room",
      cTaken?.inRoom?.code === ROOM_B.code, JSON.stringify(cTaken?.inRoom));
    ok("…and leaves everyone else free", cFree?.inRoom === null,
      JSON.stringify(cFree?.inRoom));
    ok("…while still marking who is in THIS room", cFree?.added === true,
      JSON.stringify(cFree?.added));

    // ── Removing then re-adding must still work ─────────────────────────
    // The removed row stays behind with status 0. If that counted as "has a
    // room" you could never put anyone back.
    const membership = await prisma.roomAuthorizedUser.findFirst({
      where: { receivingRoomId: ROOM_A.id, userId: FREE.userId },
      select: { id: true },
    });
    res = mockRes();
    await removeRoomMember(
      { user: { id: OWNER_A.accountId },
        query: { roomId: ROOM_A.id, memberId: membership!.id } } as any,
      res,
    );
    ok("a member can be removed", (await memberCount(ROOM_A.id, FREE.userId)) === 0);

    res = mockRes();
    await roomCandidates(
      { user: { id: OWNER_A.accountId }, query: { roomId: ROOM_A.id } } as any,
      res,
    );
    const back = (res._body?.candidates ?? []).find((c: any) => c.id === FREE.userId);
    ok("a removed person is not treated as taken",
      back?.inRoom === null, JSON.stringify(back?.inRoom));

    res = mockRes();
    await addRoomMembers(
      asA({ roomId: ROOM_A.id, userIds: [FREE.userId], type: 2 }), res);
    ok("…and can be added back", res._body?.added === 1, JSON.stringify(res._body));
    ok("…as one row, not two",
      (await prisma.roomAuthorizedUser.count({
        where: { receivingRoomId: ROOM_A.id, userId: FREE.userId },
      })) === 1);

    // Changing an existing member's role is not blocked by the rule.
    res = mockRes();
    await addRoomMembers(
      asA({ roomId: ROOM_A.id, userIds: [FREE.userId], type: 1 }), res);
    ok("an existing member's role can still be changed",
      res._body?.added === 1 && (res._body?.skipped ?? []).length === 0,
      JSON.stringify(res._body));
  } catch (e: any) {
    fail++;
    console.log("FAIL  threw: " + (e?.stack ?? e?.message ?? String(e)));
  } finally {
    try {
      if (made.roomIds.length) {
        await prisma.roomAuthorizedUser.deleteMany({
          where: { receivingRoomId: { in: made.roomIds } },
        });
        await prisma.receivingRoom.deleteMany({ where: { id: { in: made.roomIds } } });
      }
      if (made.userIds.length) {
        await prisma.notification.deleteMany({
          where: {
            OR: [
              { recipientId: { in: made.userIds } },
              { senderId: { in: made.userIds } },
            ],
          },
        }).catch(() => undefined);
        await prisma.humanResourcesLogs
          .deleteMany({ where: { userId: { in: made.userIds } } })
          .catch(() => undefined);
        await prisma.user.deleteMany({ where: { id: { in: made.userIds } } });
      }
      if (made.accountIds.length)
        await prisma.account.deleteMany({ where: { id: { in: made.accountIds } } });
      const left = await prisma.user.count({
        where: { username: { startsWith: `qa_room_${TS}_` } },
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
