/* PROOF: you cannot act as somebody else, and you cannot dispatch,
 * reconfigure or delete another office's routing.
 *
 * These handlers took the acting identity out of the request — body.userId,
 * query.lineId — and believed it. That is not a check with a bug in it; it
 * is the absence of one. Any signed-in account could set another office's
 * recipients, dispatch their draft, delete it, bind themselves as a
 * signatory on anybody's document, reset a colleague's room out from under
 * them, or grant mobile access in somebody else's name.
 *
 * The claim is the interesting one. Claiming a slot MAKES you a signatory,
 * and being a signatory is one of the three things that grants sight of a
 * routing. So a check placed after the claim would let anyone bootstrap
 * into any document by claiming a slot on it first. That ordering is what
 * the last block here is really testing.
 *
 * Run: npx ts-node --transpile-only e2e_priority_one_writes.ts */
import path from "path";

const entry = path.join(__dirname, "src", "index.ts");
require.cache[entry] = {
  id: entry, filename: entry, loaded: true,
  exports: { notificationSocket: { emitUserNotification: () => undefined } },
} as any;

import { prisma } from "./src/barrel/prisma";
import {
  setTargetRooms,
  setSignatoryArrangement,
  finalizeDissemination,
  removeDissemination,
  claimSignatorySlot,
  resetRoomMembership,
  repairRoomMembership,
} from "./src/controller/disseminationController";
import { removeRoom } from "./src/controller/documentController";
import {
  grantDocMobileAccess,
  revokeDocMobileAccess,
} from "./src/controller/documentReceiveController";
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
    roomIds: [] as string[], queueIds: [] as string[],
    docIds: [] as string[], lineIds: [] as string[],
  };

  try {
    const loc = await prisma.line.findFirst({
      select: { barangayId: true, municipalId: true, provinceId: true, regionId: true },
    });
    if (!loc) { console.log("NO FIXTURE (line)"); process.exit(2); }
    const mkLine = async (t: string) => {
      const l = await prisma.line.create({
        data: { name: `QA P1 ${TS} ${t}`, ...loc }, select: { id: true } });
      made.lineIds.push(l.id); return l;
    };
    const LINE_A = await mkLine("A");
    const LINE_B = await mkLine("B");

    const mk = async (tag: string, lineId: string) => {
      const acct = await prisma.account.create({
        data: { username: `qa_p1_${TS}_${tag}`, password: "x", lineId },
        select: { id: true, username: true } });
      made.accountIds.push(acct.id);
      const u = await prisma.user.create({
        data: { firstName: "Qa", lastName: `P1${tag.toUpperCase()}`,
                username: acct.username, accountId: acct.id, lineId,
                email: `qa-p1-${TS}-${tag}@test.local`, active: 1 },
        select: { id: true } });
      made.userIds.push(u.id);
      return { accountId: acct.id, userId: u.id };
    };
    const mkRoom = async (code: string, lineId: string) => {
      const r = await prisma.receivingRoom.create({
        data: { code: `${code}-${TS}`, lineId }, select: { id: true } });
      made.roomIds.push(r.id); return r;
    };

    const SENDER  = await mk("sender", LINE_A.id);
    const OUTSIDE = await mk("outside", LINE_A.id);  // same line, other room
    const FOREIGN = await mk("foreign", LINE_B.id);  // another municipality
    const VICTIM  = await mk("victim", LINE_A.id);

    const FROM  = await mkRoom("QA-FROM", LINE_A.id);
    const TO    = await mkRoom("QA-TO", LINE_A.id);
    const OTHER = await mkRoom("QA-OTHER", LINE_A.id);
    await prisma.roomAuthorizedUser.create({
      data: { receivingRoomId: FROM.id, userId: SENDER.userId,
              type: ROOM_MEMBER_TYPES.owner, status: 1 } });
    await prisma.roomAuthorizedUser.create({
      data: { receivingRoomId: TO.id, userId: VICTIM.userId,
              type: ROOM_MEMBER_TYPES.receiver, status: 1 } });
    await prisma.roomAuthorizedUser.create({
      data: { receivingRoomId: OTHER.id, userId: OUTSIDE.userId,
              type: ROOM_MEMBER_TYPES.owner, status: 1 } });

    const mkDraft = async () => {
      const q = await prisma.signatureQueueRoom.create({
        data: { title: `QA p1 ${TS}`, userId: SENDER.userId,
                receivingRoomId: FROM.id, status: 0, step: 0 },
        select: { id: true } });
      made.queueIds.push(q.id);
      const d = await prisma.document.create({
        data: { title: `qa-p1-doc-${TS}`, lineId: LINE_A.id,
                userId: SENDER.userId, signatureQueueRoomId: q.id },
        select: { id: true } });
      made.docIds.push(d.id);
      return q;
    };

    const call = async (fn: any, accountId: string | null, payload: any,
                        key: "body" | "query" = "body") => {
      const r = mockRes();
      let threw: any = null;
      await fn({ user: accountId ? { id: accountId } : undefined,
                 [key]: payload } as any, r).catch((e: any) => { threw = e; });
      return { r, threw, okd: !threw && r._code === 200 };
    };

    // ── Setting recipients ──────────────────────────────────────────────
    const Q1 = await mkDraft();
    let out = await call(setTargetRooms, OUTSIDE.accountId, {
      queueRoomId: Q1.id, targetRoomIds: [OTHER.id],
      userId: SENDER.userId, lineId: LINE_A.id });
    ok("another office cannot set your recipients", !!out.threw, out.threw?.message);
    ok("…and none were written",
      (await prisma.targetRoom.count({ where: { signatureQueueRoomId: Q1.id } })) === 0);
    out = await call(setTargetRooms, SENDER.accountId, {
      queueRoomId: Q1.id, targetRoomIds: [TO.id],
      userId: SENDER.userId, lineId: LINE_A.id });
    ok("the sending office still can", out.okd, out.threw?.message);

    // ── Signatories and dispatch ────────────────────────────────────────
    out = await call(setSignatoryArrangement, OUTSIDE.accountId, {
      queueRoomId: Q1.id, signatories: [], userId: SENDER.userId, lineId: LINE_A.id });
    ok("another office cannot choose who signs", !!out.threw);

    await prisma.signatoryArrangement.create({
      data: { signatureQueueRoomId: Q1.id, userId: null, index: 0, status: 0 } });

    out = await call(finalizeDissemination, OUTSIDE.accountId, {
      queueRoomId: Q1.id, userId: SENDER.userId, lineId: LINE_A.id });
    ok("another office cannot dispatch your draft", !!out.threw);
    ok("…and it is still a draft",
      (await prisma.signatureQueueRoom.findUnique({
        where: { id: Q1.id }, select: { status: true } }))?.status === 0);
    out = await call(finalizeDissemination, SENDER.accountId, {
      queueRoomId: Q1.id, userId: SENDER.userId, lineId: LINE_A.id });
    ok("the sending office still can", out.okd, out.threw?.message);

    // ── Deleting a draft ────────────────────────────────────────────────
    const Q2 = await mkDraft();
    out = await call(removeDissemination, OUTSIDE.accountId,
      { id: Q2.id, userId: SENDER.userId, lineId: LINE_A.id }, "query");
    ok("another office cannot delete your draft", !!out.threw);
    ok("…and it survives",
      (await prisma.signatureQueueRoom.count({ where: { id: Q2.id } })) === 1);

    // ── Claiming a signature slot ───────────────────────────────────────
    const slot = await prisma.signatoryArrangement.findFirst({
      where: { signatureQueueRoomId: Q1.id, userId: null },
      select: { id: true } });
    out = await call(claimSignatorySlot, OUTSIDE.accountId,
      { arrangementId: slot!.id, userId: OUTSIDE.userId });
    ok("somebody who cannot see the routing cannot claim a slot on it",
      !!out.threw, "claiming would have MADE them a signatory, and so granted sight");
    ok("…and the slot is still unclaimed",
      (await prisma.signatoryArrangement.findUnique({
        where: { id: slot!.id }, select: { userId: true } }))?.userId === null);

    // Naming somebody else is REFUSED, not quietly rewritten. On a write a
    // mismatch is a client bug or an attempt, and silently substituting the
    // right id would hide both. (A read like the dashboard can afford to
    // ignore a stray id; a write should not.)
    out = await call(claimSignatorySlot, VICTIM.accountId,
      { arrangementId: slot!.id, userId: SENDER.userId });
    ok("claiming a slot FOR somebody else is refused outright", !!out.threw,
      out.threw?.message);
    ok("…and nothing was bound",
      (await prisma.signatoryArrangement.findUnique({
        where: { id: slot!.id }, select: { userId: true } }))?.userId === null);

    out = await call(claimSignatorySlot, VICTIM.accountId,
      { arrangementId: slot!.id });
    ok("a recipient can claim it for themselves", out.okd, out.threw?.message);
    ok("…and it is bound to them",
      (await prisma.signatoryArrangement.findUnique({
        where: { id: slot!.id }, select: { userId: true } }))?.userId === VICTIM.userId);

    // ── Somebody else's room ────────────────────────────────────────────
    out = await call(resetRoomMembership, OUTSIDE.accountId, { userId: VICTIM.userId });
    ok("you cannot reset a colleague's room", !!out.threw, out.threw?.message);
    ok("…theirs is untouched",
      (await prisma.roomAuthorizedUser.count({
        where: { receivingRoomId: TO.id, userId: VICTIM.userId, status: 1 } })) === 1);
    out = await call(repairRoomMembership, OUTSIDE.accountId, { userId: VICTIM.userId });
    ok("nor repair it for them", !!out.threw);

    // ── Deleting a room, and from another municipality ──────────────────
    out = await call(removeRoom, FOREIGN.accountId,
      { id: OTHER.id, userId: FOREIGN.userId, lineId: LINE_A.id }, "query");
    ok("another municipality cannot delete your room", !!out.threw, out.threw?.message);
    ok("…and it is still active",
      (await prisma.receivingRoom.findUnique({
        where: { id: OTHER.id }, select: { status: true } }))?.status === 1);

    // ── Privilege grants ────────────────────────────────────────────────
    out = await call(grantDocMobileAccess, FOREIGN.accountId,
      { lineId: LINE_A.id, userId: VICTIM.userId, grantedById: SENDER.userId });
    ok("another municipality cannot grant access on your line", !!out.threw);
    out = await call(grantDocMobileAccess, OUTSIDE.accountId,
      { lineId: LINE_A.id, userId: VICTIM.userId, grantedById: SENDER.userId });
    ok("a colleague on the line can grant it", out.okd, out.threw?.message);
    ok("…and the grant records who REALLY did it, not the claimed name",
      (await prisma.documentMobileAccess.findFirst({
        where: { lineId: LINE_A.id, userId: VICTIM.userId },
        select: { grantedById: true } }))?.grantedById === OUTSIDE.userId,
      "the body said SENDER");
    out = await call(revokeDocMobileAccess, FOREIGN.accountId,
      { lineId: LINE_A.id, userId: VICTIM.userId });
    ok("another municipality cannot revoke it either", !!out.threw);
    ok("…so the grant stands",
      (await prisma.documentMobileAccess.count({
        where: { lineId: LINE_A.id, userId: VICTIM.userId } })) === 1);
  } catch (e: any) {
    fail++;
    console.log("FAIL  threw: " + (e?.stack ?? e?.message ?? String(e)));
  } finally {
    try {
      await prisma.documentMobileAccess.deleteMany({
        where: { lineId: { in: made.lineIds } } }).catch(() => undefined);
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
      const allRooms = await prisma.receivingRoom.findMany({
        where: { lineId: { in: made.lineIds } }, select: { id: true } });
      const roomIds = allRooms.map((r) => r.id);
      if (roomIds.length) {
        await prisma.roomAuthorizedUser.deleteMany({
          where: { receivingRoomId: { in: roomIds } } });
        await prisma.roomRegistration.deleteMany({
          where: { receivingRoomId: { in: roomIds } } }).catch(() => undefined);
        await prisma.receivingRoom.deleteMany({ where: { id: { in: roomIds } } });
      }
      if (made.userIds.length) {
        const who = { in: made.userIds };
        await prisma.notification.deleteMany({
          where: { OR: [{ recipientId: who }, { senderId: who }] } }).catch(() => undefined);
        await prisma.documentActivityLogs.deleteMany({ where: { userId: who } })
          .catch(() => undefined);
        await prisma.humanResourcesLogs.deleteMany({ where: { userId: who } })
          .catch(() => undefined);
        await prisma.user.deleteMany({ where: { id: who } });
      }
      if (made.accountIds.length)
        await prisma.account.deleteMany({ where: { id: { in: made.accountIds } } });
      for (const id of made.lineIds)
        await prisma.line.delete({ where: { id } }).catch(() => undefined);
      const left = await prisma.receivingRoom.count({
        where: { code: { endsWith: `-${TS}` } } });
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
