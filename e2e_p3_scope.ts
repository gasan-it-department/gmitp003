/* PROOF: the last of the Document module — receiving, room requests,
 * candidate lists, and starting a routing.
 *
 * Mostly counts and metadata, which is why this was Priority 3. One of
 * them is not: createDocumentRoute took both the sending room and the
 * author's name out of the body, so anyone could open a draft routing in
 * another office and put a colleague's name on it.
 *
 * Not covered here: documentReceivePageUpload, which is multipart and
 * cannot be driven by a plain mock request. Its gate reads the line off
 * the record the page is being attached to, the same shape as the ones
 * below, but it is checked by inspection rather than by this file — worth
 * knowing rather than assuming it is covered.
 *
 * Run: npx ts-node --transpile-only e2e_p3_scope.ts */
import path from "path";

const entry = path.join(__dirname, "src", "index.ts");
require.cache[entry] = {
  id: entry, filename: entry, loaded: true,
  exports: { notificationSocket: { emitUserNotification: () => undefined } },
} as any;

import { prisma } from "./src/barrel/prisma";
import {
  createDocumentRoute,
  roomRequest,
  roomRequestDetails,
  routerInfo,
} from "./src/controller/documentController";
import {
  documentReceiveList,
  documentReceiveFind,
  documentReceiveSync,
  listDocMobileAccess,
} from "./src/controller/documentReceiveController";
import {
  targetRoomCandidates,
  signatoryCandidates,
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
    roomIds: [] as string[], queueIds: [] as string[], lineIds: [] as string[],
    regIds: [] as string[],
  };

  try {
    const loc = await prisma.line.findFirst({
      select: { barangayId: true, municipalId: true, provinceId: true, regionId: true },
    });
    if (!loc) { console.log("NO FIXTURE (line)"); process.exit(2); }
    const mkLine = async (t: string) => {
      const l = await prisma.line.create({
        data: { name: `QA P3 ${TS} ${t}`, ...loc }, select: { id: true } });
      made.lineIds.push(l.id); return l;
    };
    const LINE_A = await mkLine("A");
    const LINE_B = await mkLine("B");

    const mk = async (tag: string, lineId: string) => {
      const acct = await prisma.account.create({
        data: { username: `qa_p3_${TS}_${tag}`, password: "x", lineId },
        select: { id: true, username: true } });
      made.accountIds.push(acct.id);
      const u = await prisma.user.create({
        data: { firstName: "Qa", lastName: `P3${tag.toUpperCase()}`,
                username: acct.username, accountId: acct.id, lineId,
                email: `qa-p3-${TS}-${tag}@test.local`, active: 1 },
        select: { id: true } });
      made.userIds.push(u.id);
      return { accountId: acct.id, userId: u.id };
    };

    const MINE    = await mk("mine", LINE_A.id);     // owns a room on A
    const NEIGHB  = await mk("neighb", LINE_A.id);   // same line, other room
    const FOREIGN = await mk("foreign", LINE_B.id);  // another municipality

    const MY_ROOM = await prisma.receivingRoom.create({
      data: { code: `QA-P3-MINE-${TS}`, lineId: LINE_A.id }, select: { id: true } });
    const NB_ROOM = await prisma.receivingRoom.create({
      data: { code: `QA-P3-NB-${TS}`, lineId: LINE_A.id }, select: { id: true } });
    made.roomIds.push(MY_ROOM.id, NB_ROOM.id);
    await prisma.roomAuthorizedUser.create({
      data: { receivingRoomId: MY_ROOM.id, userId: MINE.userId,
              type: ROOM_MEMBER_TYPES.owner, status: 1 } });
    await prisma.roomAuthorizedUser.create({
      data: { receivingRoomId: NB_ROOM.id, userId: NEIGHB.userId,
              type: ROOM_MEMBER_TYPES.owner, status: 1 } });

    const call = async (fn: any, accountId: string | null, payload: any,
                        key: "body" | "query" = "query") => {
      const r = mockRes();
      let threw: any = null;
      await fn({ user: accountId ? { id: accountId } : undefined,
                 [key]: payload } as any, r).catch((e: any) => { threw = e; });
      return { r, threw, body: r._body, okd: !threw && r._code === 200 };
    };

    // ── Starting a routing: the one that is not just metadata ───────────
    let out = await call(createDocumentRoute, NEIGHB.accountId, {
      roomName: `QA hijack ${TS}`, lineId: LINE_A.id,
      userId: MINE.userId, roomId: MY_ROOM.id }, "body");
    ok("you cannot start a routing in another office's room", !!out.threw,
      out.threw?.message);
    ok("…and no draft appeared there",
      (await prisma.signatureQueueRoom.count({
        where: { receivingRoomId: MY_ROOM.id } })) === 0);

    out = await call(createDocumentRoute, MINE.accountId, {
      roomName: `QA mine ${TS}`, lineId: LINE_A.id,
      userId: NEIGHB.userId, roomId: MY_ROOM.id }, "body");
    ok("your own room still works", out.okd, out.threw?.message);
    const draft = await prisma.signatureQueueRoom.findFirst({
      where: { receivingRoomId: MY_ROOM.id }, select: { id: true, userId: true } });
    if (draft) made.queueIds.push(draft.id);
    ok("…and it is attributed to whoever actually made it",
      draft?.userId === MINE.userId,
      "the body named NEIGHB and must not have been believed");

    out = await call(createDocumentRoute, FOREIGN.accountId, {
      roomName: `QA foreign ${TS}`, lineId: LINE_A.id,
      userId: FOREIGN.userId, roomId: MY_ROOM.id }, "body");
    ok("another municipality certainly cannot", !!out.threw);

    // ── Candidate lists ─────────────────────────────────────────────────
    ok("another municipality cannot list your offices",
      !!(await call(targetRoomCandidates, FOREIGN.accountId,
        { lineId: LINE_A.id })).threw);
    out = await call(targetRoomCandidates, NEIGHB.accountId, { lineId: LINE_A.id });
    ok("…while your own staff can", out.okd, out.threw?.message);
    ok("another municipality cannot list your signatories",
      !!(await call(signatoryCandidates, FOREIGN.accountId,
        { lineId: LINE_A.id })).threw);

    // ── Receiving ───────────────────────────────────────────────────────
    ok("another municipality cannot read your receiving log",
      !!(await call(documentReceiveList, FOREIGN.accountId,
        { lineId: LINE_A.id })).threw);
    out = await call(documentReceiveList, NEIGHB.accountId, { lineId: LINE_A.id });
    ok("…and yours still opens it", out.okd, out.threw?.message);
    ok("nor look a barcode up on it",
      !!(await call(documentReceiveFind, FOREIGN.accountId,
        { lineId: LINE_A.id, barcode: "X" })).threw);
    ok("nor pull the offline sync feed",
      !!(await call(documentReceiveSync, FOREIGN.accountId,
        { lineId: LINE_A.id })).threw);
    ok("nor read who may scan on mobile",
      !!(await call(listDocMobileAccess, FOREIGN.accountId,
        { lineId: LINE_A.id })).threw);

    // ── Room registration requests ──────────────────────────────────────
    ok("another municipality cannot read your pending room requests",
      !!(await call(roomRequest, FOREIGN.accountId,
        { id: LINE_A.id, limit: "20" })).threw);
    out = await call(roomRequest, NEIGHB.accountId, { id: LINE_A.id, limit: "20" });
    ok("…and yours can", out.okd, out.threw?.message);

    const reg = await prisma.roomRegistration.create({
      data: { address: `QA P3 ${TS}`, userId: MINE.userId,
              lineId: LINE_A.id, status: 0 },
      select: { id: true } });
    made.regIds.push(reg.id);
    ok("nor open one by id",
      !!(await call(roomRequestDetails, FOREIGN.accountId, { id: reg.id })).threw);
    ok("…which your own staff can",
      (await call(roomRequestDetails, NEIGHB.accountId, { id: reg.id })).okd);

    if (draft) {
      ok("another municipality cannot read your routing's info",
        !!(await call(routerInfo, FOREIGN.accountId, { id: draft.id })).threw);
      out = await call(routerInfo, NEIGHB.accountId, { id: draft.id });
      ok("…while the line's own staff can", out.okd, out.threw?.message);
    }

    ok("an unauthenticated call is refused",
      !!(await call(documentReceiveList, null, { lineId: LINE_A.id })).threw);
  } catch (e: any) {
    fail++;
    console.log("FAIL  threw: " + (e?.stack ?? e?.message ?? String(e)));
  } finally {
    try {
      if (made.queueIds.length) {
        const qs = { signatureQueueRoomId: { in: made.queueIds } };
        await prisma.targetRoom.deleteMany({ where: qs });
        await prisma.signatoryArrangement.deleteMany({ where: qs });
        await prisma.documentActivityLogs.deleteMany({
          where: { userId: { in: made.userIds } } }).catch(() => undefined);
        await prisma.signatureQueueRoom.deleteMany({
          where: { id: { in: made.queueIds } } });
      }
      await prisma.signatureQueueRoom.deleteMany({
        where: { receivingRoomId: { in: made.roomIds } } }).catch(() => undefined);
      if (made.roomIds.length) {
        await prisma.roomAuthorizedUser.deleteMany({
          where: { receivingRoomId: { in: made.roomIds } } });
        await prisma.receivingRoom.deleteMany({ where: { id: { in: made.roomIds } } });
      }
      if (made.regIds.length)
        await prisma.roomRegistration.deleteMany({
          where: { id: { in: made.regIds } } }).catch(() => undefined);
      if (made.userIds.length) {
        const who = { in: made.userIds };
        await prisma.documentActivityLogs.deleteMany({ where: { userId: who } })
          .catch(() => undefined);
        await prisma.notification.deleteMany({
          where: { OR: [{ recipientId: who }, { senderId: who }] } }).catch(() => undefined);
        await prisma.user.deleteMany({ where: { id: who } });
      }
      if (made.accountIds.length)
        await prisma.account.deleteMany({ where: { id: { in: made.accountIds } } });
      for (const id of made.lineIds)
        await prisma.line.delete({ where: { id } }).catch(() => undefined);
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
