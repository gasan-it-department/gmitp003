/* PROOF: being ADDED to a document room is enough to use the module.
 *
 * There are two roads into a document room. You ask for one and HR approves
 * it, which writes a RoomRegistration. Or somebody with room admin simply
 * adds you as a signatory or receiver, which writes a RoomAuthorizedUser and
 * NO registration at all.
 *
 * The module's provider gated on the registration. So everyone who arrived by
 * the second road — signatories, receivers, and owners created that way — was
 * met by the "register for a room" form instead of their inbox, while the
 * server happily reported their room and their membership. On the database
 * this session can reach, 10 of 14 active members were in that state.
 *
 * Membership is the authoritative fact. This file pins the payload the
 * provider reads: an added member must come back with a membership AND a
 * room, with no registration, and a removed one must come back with neither.
 *
 * Run: npx ts-node --transpile-only e2e_room_member_access.ts */
import path from "path";

const entry = path.join(__dirname, "src", "index.ts");
require.cache[entry] = {
  id: entry, filename: entry, loaded: true,
  exports: { notificationSocket: { emitUserNotification: () => undefined } },
} as any;

import { prisma } from "./src/barrel/prisma";
import { signatoryRegistry } from "./src/controller/documentController";
import { addRoomMembers, removeRoomMember, ROOM_MEMBER_TYPES } from "./src/controller/roomConfigController";

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
    userIds: [] as string[], accountIds: [] as string[], roomIds: [] as string[],
  };

  try {
    const line = await prisma.line.findFirst({ select: { id: true } });
    if (!line) { console.log("NO FIXTURE (line)"); process.exit(2); }

    const mk = async (tag: string) => {
      const acct = await prisma.account.create({
        data: { username: `qa_rm_${TS}_${tag}`, password: "x", lineId: line.id },
        select: { id: true, username: true },
      });
      made.accountIds.push(acct.id);
      const u = await prisma.user.create({
        data: {
          firstName: `Qa${tag}`, lastName: `RM${TS}`, username: acct.username,
          accountId: acct.id, lineId: line.id,
          email: `qa-rm-${TS}-${tag}@test.local`, active: 1,
        },
        select: { id: true },
      });
      made.userIds.push(u.id);
      return { accountId: acct.id, userId: u.id };
    };

    const OWNER = await mk("owner");
    const SIG = await mk("sig");
    const RCV = await mk("rcv");
    const NOBODY = await mk("nobody");

    const room = await prisma.receivingRoom.create({
      data: { code: `QA-RM-${TS}`, lineId: line.id },
      select: { id: true, code: true },
    });
    made.roomIds.push(room.id);
    // The owner is the room admin; no registration for them either.
    await prisma.roomAuthorizedUser.create({
      data: {
        receivingRoomId: room.id, userId: OWNER.userId,
        type: ROOM_MEMBER_TYPES.owner, status: 1,
      },
    });

    /** Exactly what the module's provider fetches on load. */
    const registry = async (who: { accountId: string; userId: string }) => {
      const r = mockRes();
      await signatoryRegistry(
        { user: { id: who.accountId }, query: { userId: who.userId } } as any,
        r,
      );
      return r._body as {
        roomRegistration: unknown | null;
        signatory: unknown | null;
        authorizedUser: unknown | null;
        room: { id: string; code: string } | null;
      };
    };

    /** The provider's own rule, mirrored: membership + a room lets you in. */
    const belongs = (p: Awaited<ReturnType<typeof registry>>) =>
      !!p.authorizedUser && !!p.room;

    // ══ 1. Somebody with nothing ══════════════════════════════════════
    console.log("\n-- a user in no room at all --");
    const none = await registry(NOBODY);
    ok("no membership", none.authorizedUser === null);
    ok("no room", none.room === null);
    ok("no registration", none.roomRegistration === null);
    ok("...so the module correctly asks them to register", !belongs(none));

    // ══ 2. Added as a signatory — the reported case ═══════════════════
    console.log("\n-- added as a signatory, never registered --");
    const add = mockRes();
    await addRoomMembers(
      {
        user: { id: OWNER.accountId },
        body: { roomId: room.id, userIds: [SIG.userId], type: ROOM_MEMBER_TYPES.signatory },
      } as any,
      add,
    );
    ok("the add succeeds", add._body?.added === 1, JSON.stringify(add._body));

    const sig = await registry(SIG);
    ok("they have NO room registration — this is the whole point",
      sig.roomRegistration === null);
    ok("...but the payload carries their membership", sig.authorizedUser !== null);
    ok("...under the name the client actually reads", "authorizedUser" in sig);
    ok("...and their room", sig.room?.id === room.id, JSON.stringify(sig.room));
    ok("...so the module OPENS for them", belongs(sig));

    // ══ 3. Added as a receiver ════════════════════════════════════════
    console.log("\n-- added as a receiver --");
    const add2 = mockRes();
    await addRoomMembers(
      {
        user: { id: OWNER.accountId },
        body: { roomId: room.id, userIds: [RCV.userId], type: ROOM_MEMBER_TYPES.receiver },
      } as any,
      add2,
    );
    const rcv = await registry(RCV);
    ok("a receiver gets in too", belongs(rcv));
    ok("...with no registration", rcv.roomRegistration === null);

    // ══ 4. The owner, who also never registered ═══════════════════════
    console.log("\n-- the room's own owner --");
    const own = await registry(OWNER);
    ok("an owner created by being added gets in", belongs(own));
    ok("...also with no registration", own.roomRegistration === null);

    // ══ 5. Removed means removed ══════════════════════════════════════
    console.log("\n-- after removal --");
    const memberRow = await prisma.roomAuthorizedUser.findFirst({
      where: { receivingRoomId: room.id, userId: SIG.userId },
      select: { id: true },
    });
    const rm = mockRes();
    await removeRoomMember(
      {
        user: { id: OWNER.accountId },
        // This handler takes its input from the query string, not the body.
        query: { roomId: room.id, memberId: memberRow!.id },
      } as any,
      rm,
    );
    const after = await registry(SIG);
    ok("a removed member no longer resolves a membership",
      after.authorizedUser === null, JSON.stringify(after.authorizedUser));
    ok("...nor the room", after.room === null, JSON.stringify(after.room));
    ok("...so the module closes again", !belongs(after));

    console.log(`\n${pass} passed, ${fail} failed`);
    process.exitCode = fail === 0 ? 0 : 1;
  } catch (e) {
    console.error("THREW", e);
    process.exitCode = 1;
  } finally {
    for (const id of made.roomIds) {
      await prisma.roomAuthorizedUser.deleteMany({ where: { receivingRoomId: id } }).catch(() => {});
      await prisma.receivingRoom.delete({ where: { id } }).catch(() => {});
    }
    for (const id of made.userIds) {
      await prisma.notification.deleteMany({ where: { userId: id } }).catch(() => {});
      await prisma.humanResourcesLogs.deleteMany({ where: { userId: id } }).catch(() => {});
      await prisma.roomRegistration.deleteMany({ where: { userId: id } }).catch(() => {});
      await prisma.user.delete({ where: { id } }).catch(() => {});
    }
    for (const id of made.accountIds) {
      await prisma.account.delete({ where: { id } }).catch(() => {});
    }
    await prisma.$disconnect();
  }
})();
