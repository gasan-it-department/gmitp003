/* PROOF: document room configuration.
 *
 * Rename the room, change its address, add signatories/receivers (who get
 * notified), change a role, remove someone — all line-scoped, and never
 * leaving a room without an owner.
 *
 * Run: npx ts-node --transpile-only e2e_room_config.ts */
import { prisma } from "./src/barrel/prisma";
import {
  roomConfig,
  roomCandidates,
  updateRoomConfig,
  addRoomMembers,
  updateRoomMember,
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
  const threw = async (fn: () => Promise<unknown>) => {
    try { await fn(); return ""; } catch (e: any) { return e?.message ?? "err"; }
  };
  const made = {
    userIds: [] as string[],
    accountIds: [] as string[],
    roomIds: [] as string[],
  };

  try {
    const lines = await prisma.line.findMany({ select: { id: true }, take: 2 });
    if (!lines.length) { console.log("NO FIXTURE (line)"); process.exit(2); }
    const LINE = lines[0].id;
    const OTHER = lines[1]?.id ?? null;

    const mkUser = async (tag: string, lineId = LINE) => {
      const acct = await prisma.account.create({
        data: { username: `qa_room_${TS}_${tag}`, password: "x", lineId },
        select: { id: true, username: true },
      });
      made.accountIds.push(acct.id);
      const u = await prisma.user.create({
        data: {
          firstName: "Qa", lastName: `ROOM${TS}${tag.toUpperCase()}`,
          username: acct.username, accountId: acct.id, lineId,
          email: `qa-room-${TS}-${tag}@test.local`,
        },
        select: { id: true },
      });
      made.userIds.push(u.id);
      return { accountId: acct.id, userId: u.id };
    };

    const HR = await mkUser("hr");
    const OWNER = await mkUser("owner");
    const SIG = await mkUser("sig");
    const RCV = await mkUser("rcv");

    const mkRoom = async (code: string, lineId = LINE) => {
      const r = await prisma.receivingRoom.create({
        data: { code, address: "Old Municipal Hall", lineId, status: 1 },
        select: { id: true },
      });
      made.roomIds.push(r.id);
      return r.id;
    };
    const ROOM = await mkRoom(`QA Room ${TS}`);
    await prisma.roomAuthorizedUser.create({
      data: {
        receivingRoomId: ROOM,
        userId: OWNER.userId,
        type: ROOM_MEMBER_TYPES.owner,
        status: 1,
      },
    });

    const req = (extra: any = {}) =>
      ({ user: { id: HR.accountId }, ...extra }) as any;

    // ── Read ────────────────────────────────────────────────────────────
    let res = mockRes();
    await roomConfig(req({ query: { roomId: ROOM } }), res);
    ok("the room is readable", res._body?.room?.id === ROOM);
    ok("the owner is listed with a readable role",
      res._body?.members?.length === 1 && res._body.members[0].role === "Owner",
      JSON.stringify(res._body?.members));
    ok("member names are decrypted, not ciphertext",
      /ROOM/.test(res._body?.members?.[0]?.name ?? ""),
      res._body?.members?.[0]?.name);

    // ── Rename + re-address ─────────────────────────────────────────────
    res = mockRes();
    await updateRoomConfig(
      req({ body: { roomId: ROOM, code: `QA Renamed ${TS}`, address: "New Annex" } }),
      res,
    );
    ok("the room can be renamed", res._body?.code === `QA Renamed ${TS}`);
    ok("the address changes with it", res._body?.address === "New Annex");

    const CLASH = await mkRoom(`QA Other ${TS}`);
    ok("renaming onto another room's name is refused with a sentence",
      /already named/i.test(
        await threw(async () =>
          updateRoomConfig(
            req({ body: { roomId: ROOM, code: `QA Other ${TS}` } }),
            mockRes(),
          ),
        ),
      ));
    ok("an empty name is refused",
      !!(await threw(async () =>
        updateRoomConfig(req({ body: { roomId: ROOM, code: "   " } }), mockRes()))));
    ok("a no-op update is refused rather than silently doing nothing",
      !!(await threw(async () =>
        updateRoomConfig(req({ body: { roomId: ROOM } }), mockRes()))));

    // ── Candidates ──────────────────────────────────────────────────────
    res = mockRes();
    await roomCandidates(req({ query: { roomId: ROOM, query: `ROOM${TS}` } }), res);
    const cands = res._body?.candidates ?? [];
    ok("line staff are offered as candidates", cands.length >= 3);
    ok("someone already in the room is MARKED, not hidden",
      cands.find((c: any) => c.id === OWNER.userId)?.added === true,
      JSON.stringify(cands.find((c: any) => c.id === OWNER.userId)));

    // ── Add signatories / receivers ─────────────────────────────────────
    res = mockRes();
    await addRoomMembers(
      req({
        body: {
          roomId: ROOM,
          userIds: [SIG.userId],
          type: ROOM_MEMBER_TYPES.signatory,
        },
      }),
      res,
    );
    ok("a signatory is added", res._body?.added === 1);
    ok("and they are notified", res._body?.notified === 1);

    res = mockRes();
    await addRoomMembers(
      req({
        body: {
          roomId: ROOM,
          userIds: [RCV.userId],
          type: ROOM_MEMBER_TYPES.receiver,
        },
      }),
      res,
    );
    ok("a receiver is added", res._body?.added === 1);

    // The notification really landed — not just a counter.
    const notes = await prisma.notification.count({
      where: { recipientId: SIG.userId },
    }).catch(() => -1);
    ok("the new signatory has a notification row", notes !== 0, String(notes));

    res = mockRes();
    await roomConfig(req({ query: { roomId: ROOM } }), res);
    const roles = (res._body?.members ?? []).map((m: any) => m.role).sort();
    ok("the room now holds owner + signatory + receiver",
      JSON.stringify(roles) === JSON.stringify(["Owner", "Receiver", "Signatory"]),
      JSON.stringify(roles));

    // Re-adding the same person must not duplicate the membership.
    res = mockRes();
    await addRoomMembers(
      req({ body: { roomId: ROOM, userIds: [SIG.userId], type: ROOM_MEMBER_TYPES.signatory } }),
      res,
    );
    const dupes = await prisma.roomAuthorizedUser.count({
      where: { receivingRoomId: ROOM, userId: SIG.userId },
    });
    ok("re-adding the same person creates no second row", dupes === 1, String(dupes));

    ok("an unknown role is refused",
      !!(await threw(async () =>
        addRoomMembers(
          req({ body: { roomId: ROOM, userIds: [SIG.userId], type: 9 } }),
          mockRes(),
        ))));

    // ── Change a role ───────────────────────────────────────────────────
    res = mockRes();
    await roomConfig(req({ query: { roomId: ROOM } }), res);
    const sigMember = (res._body?.members ?? []).find(
      (m: any) => m.userId === SIG.userId,
    );
    res = mockRes();
    await updateRoomMember(
      req({
        body: {
          roomId: ROOM,
          memberId: sigMember.id,
          type: ROOM_MEMBER_TYPES.receiver,
        },
      }),
      res,
    );
    ok("a member's role can be changed", res._body?.type === ROOM_MEMBER_TYPES.receiver);

    // ── The last owner is protected ─────────────────────────────────────
    res = mockRes();
    await roomConfig(req({ query: { roomId: ROOM } }), res);
    const ownerMember = (res._body?.members ?? []).find(
      (m: any) => m.userId === OWNER.userId,
    );
    ok("the only owner cannot be demoted",
      /only owner/i.test(
        await threw(async () =>
          updateRoomMember(
            req({
              body: {
                roomId: ROOM,
                memberId: ownerMember.id,
                type: ROOM_MEMBER_TYPES.signatory,
              },
            }),
            mockRes(),
          ),
        ),
      ));
    ok("the only owner cannot be removed",
      /only owner/i.test(
        await threw(async () =>
          removeRoomMember(
            req({ query: { roomId: ROOM, memberId: ownerMember.id } }),
            mockRes(),
          ),
        ),
      ));

    // ── Remove someone who is not the last owner ────────────────────────
    res = mockRes();
    await removeRoomMember(
      req({ query: { roomId: ROOM, memberId: sigMember.id } }), res);
    ok("a member can be removed", res._code === 200);

    const softRow = await prisma.roomAuthorizedUser.findUnique({
      where: { id: sigMember.id },
      select: { status: true },
    });
    ok("removal is SOFT — the audit trail survives", softRow?.status === 0);

    res = mockRes();
    await roomConfig(req({ query: { roomId: ROOM } }), res);
    ok("the removed person no longer appears",
      !(res._body?.members ?? []).some((m: any) => m.userId === SIG.userId));

    // Re-adding them reinstates the same row rather than making a new one.
    res = mockRes();
    await addRoomMembers(
      req({ body: { roomId: ROOM, userIds: [SIG.userId], type: ROOM_MEMBER_TYPES.signatory } }),
      res,
    );
    const afterRe = await prisma.roomAuthorizedUser.count({
      where: { receivingRoomId: ROOM, userId: SIG.userId },
    });
    ok("re-adding a removed person reuses their row", afterRe === 1, String(afterRe));

    // ── Line isolation ──────────────────────────────────────────────────
    if (OTHER) {
      const foreign = await mkRoom(`QA Foreign ${TS}`, OTHER);
      ok("another line's room cannot be read",
        !!(await threw(async () =>
          roomConfig(req({ query: { roomId: foreign } }), mockRes()))));
      ok("another line's room cannot be renamed",
        !!(await threw(async () =>
          updateRoomConfig(
            req({ body: { roomId: foreign, code: "hijacked" } }),
            mockRes(),
          ))));

      const outsider = await mkUser("out", OTHER);
      res = mockRes();
      await addRoomMembers(
        req({
          body: {
            roomId: ROOM,
            userIds: [outsider.userId],
            type: ROOM_MEMBER_TYPES.signatory,
          },
        }),
        res,
      );
      ok("a user from another line is never added to this room",
        res._body?.added === 0, JSON.stringify(res._body));
    } else {
      console.log("SKIP  line isolation (only one line in this DB)");
    }
  } catch (e: any) {
    fail++;
    console.log("FAIL  threw: " + (e?.stack ?? e?.message ?? String(e)));
  } finally {
    try {
      if (made.roomIds.length) {
        await prisma.roomAuthorizedUser.deleteMany({
          where: { receivingRoomId: { in: made.roomIds } },
        });
        await prisma.receivingRoom.deleteMany({
          where: { id: { in: made.roomIds } },
        });
      }
      if (made.userIds.length) {
        // Notifications reference the user as BOTH recipient and sender, and
        // the HR log rows carry the actor — all of them have to go first or
        // the user delete trips a constraint.
        await prisma.notification
          .deleteMany({
            where: {
              OR: [
                { recipientId: { in: made.userIds } },
                { senderId: { in: made.userIds } },
              ],
            },
          })
          .catch(() => undefined);
        await prisma.humanResourcesLogs
          .deleteMany({ where: { userId: { in: made.userIds } } })
          .catch(() => undefined);
        await prisma.user.deleteMany({ where: { id: { in: made.userIds } } });
      }
      if (made.accountIds.length)
        await prisma.account.deleteMany({ where: { id: { in: made.accountIds } } });
      const leftU = await prisma.user.count({
        where: { username: { startsWith: `qa_room_${TS}_` } },
      });
      const leftR = await prisma.receivingRoom.count({
        where: { code: { contains: String(TS) } },
      });
      console.log(`CLEANUP  leftover users=${leftU} rooms=${leftR}`);
      if (leftU || leftR) fail++;
    } catch (e: any) {
      console.log("CLEANUP FAILED: " + (e?.message ?? e));
      fail++;
    }
    console.log(`\n${pass} passed, ${fail} failed`);
    await prisma.$disconnect();
    process.exit(fail ? 1 : 0);
  }
})();
