/* PROOF: only the office's owner, or HR, may change who signs for it.
 *
 * The room-config endpoints were gated by `ownedRoom`, which checks one
 * thing: that the room belongs to YOUR MUNICIPALITY. Any colleague on the
 * line could rename an office, add themselves as a signatory, or strip
 * somebody else's authority — the whole point of the membership list.
 *
 * That was survivable only because the single door to it was an HR screen
 * behind a module guard. It stops being survivable the moment the same
 * controls appear in the Document module, which every line user can open
 * (`documents` is an ALWAYS-OPEN module — no Module row required). So the
 * check moved to the server, where it should always have been.
 *
 * Two authorities, and they are different people: the room's OWNER, who
 * belongs to it, and HR, who administer every room and belong to none.
 * A signatory is neither — being trusted to sign documents is not being
 * trusted to decide who else may sign them.
 *
 * Run: npx ts-node --transpile-only e2e_room_admin.ts */
import path from "path";

const entry = path.join(__dirname, "src", "index.ts");
require.cache[entry] = {
  id: entry, filename: entry, loaded: true,
  exports: { notificationSocket: { emitUserNotification: () => undefined } },
} as any;

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
    roomIds: [] as string[], lineIds: [] as string[],
  };

  try {
    const loc = await prisma.line.findFirst({
      select: { barangayId: true, municipalId: true, provinceId: true, regionId: true },
    });
    if (!loc) { console.log("NO FIXTURE (line)"); process.exit(2); }
    const mkLine = async (t: string) => {
      const l = await prisma.line.create({
        data: { name: `QA RA ${TS} ${t}`, ...loc }, select: { id: true } });
      made.lineIds.push(l.id); return l;
    };
    const LINE_A = await mkLine("A");
    const LINE_B = await mkLine("B");

    const mk = async (tag: string, lineId: string) => {
      const acct = await prisma.account.create({
        data: { username: `qa_ra_${TS}_${tag}`, password: "x", lineId },
        select: { id: true, username: true } });
      made.accountIds.push(acct.id);
      const u = await prisma.user.create({
        data: { firstName: "Qa", lastName: `Ra${tag.toUpperCase()}`,
                username: acct.username, accountId: acct.id, lineId,
                email: `qa-ra-${TS}-${tag}@test.local`, active: 1 },
        select: { id: true } });
      made.userIds.push(u.id);
      return { accountId: acct.id, userId: u.id };
    };

    const OWNER   = await mk("owner", LINE_A.id);   // owns the room
    const SIGNER  = await mk("signer", LINE_A.id);  // signatory in it
    const RECV    = await mk("recv", LINE_A.id);    // receiver in it
    const COLLEAG = await mk("colleag", LINE_A.id); // same line, not in it
    const HR      = await mk("hr", LINE_A.id);      // HR, not in it
    const FOREIGN = await mk("foreign", LINE_B.id); // other municipality
    const SPARE   = await mk("spare", LINE_A.id);   // somebody to add

    // HR authority is a Module row — the same one the app checks to decide
    // whether to open the HR module at all.
    await prisma.module.create({
      data: { moduleName: "human-resources", moduleIndex: "0",
              userId: HR.userId, lineId: LINE_A.id, privilege: 1, status: 1 } });

    const room = await prisma.receivingRoom.create({
      data: { code: `QA-RA-${TS}`, lineId: LINE_A.id },
      select: { id: true } });
    made.roomIds.push(room.id);

    const member = async (userId: string, type: number) =>
      (await prisma.roomAuthorizedUser.create({
        data: { receivingRoomId: room.id, userId, type, status: 1 },
        select: { id: true } })).id;
    await member(OWNER.userId, ROOM_MEMBER_TYPES.owner);
    const signerMemberId = await member(SIGNER.userId, ROOM_MEMBER_TYPES.signatory);
    await member(RECV.userId, ROOM_MEMBER_TYPES.receiver);

    const call = async (fn: any, accountId: string | null, payload: any,
                        key: "body" | "query" = "query") => {
      const r = mockRes();
      let threw: any = null;
      await fn({ user: accountId ? { id: accountId } : undefined,
                 [key]: payload, headers: {} } as any, r)
        .catch((e: any) => { threw = e; });
      return { r, threw, body: r._body, okd: !threw && r._code === 200 };
    };

    const who: Record<string, any> = {
      owner: OWNER, signer: SIGNER, recv: RECV,
      colleague: COLLEAG, hr: HR, foreign: FOREIGN,
    };

    // ── Reading the membership list ─────────────────────────────────────
    for (const name of Object.keys(who)) {
      const out = await call(roomConfig, who[name].accountId, { roomId: room.id });
      const allowed = ["owner", "signer", "recv", "hr"].includes(name);
      ok(`${allowed ? "" : "no "}read for ${name}`, out.okd === allowed,
        out.threw?.message ?? `code ${out.r._code}`);
    }
    ok("an unauthenticated read is refused",
      !!(await call(roomConfig, null, { roomId: room.id })).threw);

    // ── Renaming the office ─────────────────────────────────────────────
    const rename = (u: any, code: string) =>
      call(updateRoomConfig, u.accountId, { roomId: room.id, code }, "body");

    ok("a colleague on the line CANNOT rename the office",
      !!(await rename(COLLEAG, `QA-RA-HIJACK-${TS}`)).threw,
      "this is the hole: ownedRoom only checked the municipality");
    ok("…and the name is untouched",
      (await prisma.receivingRoom.findUnique({
        where: { id: room.id }, select: { code: true } }))?.code
        === `QA-RA-${TS}`);

    ok("a signatory cannot either", !!(await rename(SIGNER, "x")).threw,
      "signing documents is not deciding who signs them");
    ok("nor a receiver", !!(await rename(RECV, "x")).threw);
    ok("another municipality certainly cannot",
      !!(await rename(FOREIGN, "x")).threw);

    let out = await rename(OWNER, `QA-RA-${TS}-OWNED`);
    ok("the owner can", out.okd, out.threw?.message);
    out = await rename(HR, `QA-RA-${TS}`);
    ok("…and so can HR, who belong to no room at all", out.okd,
      out.threw?.message);

    // ── Adding a member ─────────────────────────────────────────────────
    const add = (u: any, userId: string) =>
      call(addRoomMembers, u.accountId,
        { roomId: room.id, userIds: [userId], type: ROOM_MEMBER_TYPES.signatory },
        "body");

    ok("a colleague cannot add themselves as a signatory",
      !!(await add(COLLEAG, COLLEAG.userId)).threw);
    ok("…and did not get in",
      (await prisma.roomAuthorizedUser.count({
        where: { receivingRoomId: room.id, userId: COLLEAG.userId } })) === 0,
      "the refusal has to be a refusal, not a message over a completed write");
    ok("a signatory cannot add anybody",
      !!(await add(SIGNER, SPARE.userId)).threw);

    out = await add(OWNER, SPARE.userId);
    ok("the owner can add a signatory", out.okd, out.threw?.message);
    ok("…and they are really in",
      (await prisma.roomAuthorizedUser.count({
        where: { receivingRoomId: room.id, userId: SPARE.userId, status: 1 } })) === 1);

    // ── Changing a role ─────────────────────────────────────────────────
    const setRole = (u: any, memberId: string, type: number) =>
      call(updateRoomMember, u.accountId,
        { roomId: room.id, memberId, type }, "body");

    ok("a signatory cannot promote themselves to owner",
      !!(await setRole(SIGNER, signerMemberId, ROOM_MEMBER_TYPES.owner)).threw,
      "the most valuable thing an attacker could do here");
    ok("…and they are still a signatory",
      (await prisma.roomAuthorizedUser.findUnique({
        where: { id: signerMemberId }, select: { type: true } }))?.type
        === ROOM_MEMBER_TYPES.signatory);
    ok("the owner can change a role",
      (await setRole(OWNER, signerMemberId, ROOM_MEMBER_TYPES.receiver)).okd);

    // ── Removing a member ───────────────────────────────────────────────
    const remove = (u: any, memberId: string) =>
      call(removeRoomMember, u.accountId, { roomId: room.id, memberId });

    ok("a colleague cannot remove a member",
      !!(await remove(COLLEAG, signerMemberId)).threw);
    ok("…who is still there",
      (await prisma.roomAuthorizedUser.count({
        where: { id: signerMemberId, status: 1 } })) === 1);
    ok("the owner can", (await remove(OWNER, signerMemberId)).okd);

    // ── The candidate list feeds an add, so it is admin-only ────────────
    ok("a colleague cannot list who could be added",
      !!(await call(roomCandidates, COLLEAG.accountId,
        { roomId: room.id })).threw);
    ok("the owner can",
      (await call(roomCandidates, OWNER.accountId, { roomId: room.id })).okd);
    ok("and HR can",
      (await call(roomCandidates, HR.accountId, { roomId: room.id })).okd);
  } catch (e: any) {
    fail++;
    console.log("FAIL  threw: " + (e?.stack ?? e?.message ?? String(e)));
  } finally {
    try {
      if (made.roomIds.length) {
        await prisma.roomAuthorizedUser.deleteMany({
          where: { receivingRoomId: { in: made.roomIds } } });
        await prisma.receivingRoom.deleteMany({
          where: { id: { in: made.roomIds } } });
      }
      if (made.userIds.length) {
        const w = { in: made.userIds };
        await prisma.module.deleteMany({ where: { userId: w } });
        // HumanResourcesLogs.userId is non-nullable with onDelete:SetDefault,
        // so deleting the user without clearing these is a null-constraint
        // violation, not a cascade. Every membership change writes one.
        await prisma.humanResourcesLogs.deleteMany({ where: { userId: w } });
        await prisma.activityLogs.deleteMany({ where: { userId: w } })
          .catch(() => undefined);
        await prisma.notification.deleteMany({
          where: { OR: [{ recipientId: w }, { senderId: w }] } });
        await prisma.user.deleteMany({ where: { id: w } });
      }
      if (made.accountIds.length)
        await prisma.account.deleteMany({
          where: { id: { in: made.accountIds } } });
      for (const id of made.lineIds)
        await prisma.line.delete({ where: { id } });
      const left = await prisma.receivingRoom.count({
        where: { code: { contains: `${TS}` } } });
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
