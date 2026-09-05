/* PROOF: a received document can be sent onward only once it is scanned.
 *
 * A document arrives at the desk, gets a barcode sticker and a row in the
 * log. Sending it to other offices means handing it to Document Routing,
 * which needs an actual file — and the only file a received document has
 * is its scan.
 *
 * So the gate is not policy bolted on top: an unscanned record has nothing
 * to send. Routing it would give five offices a title and no document.
 * That refusal is what most of this file is about, along with the two
 * things that must not happen when it fires — no draft left half-made, and
 * no file written for a document that does not exist.
 *
 * Run: npx ts-node --transpile-only e2e_receive_disseminate.ts */
import path from "path";

const entry = path.join(__dirname, "src", "index.ts");
require.cache[entry] = {
  id: entry, filename: entry, loaded: true,
  exports: { notificationSocket: { emitUserNotification: () => undefined } },
} as any;

import { prisma } from "./src/barrel/prisma";
import { documentReceiveDisseminate } from "./src/controller/documentReceiveController";
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

/** A 1x1 PNG, so the PDF builder has something real to embed. */
const PNG_1PX = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

(async () => {
  let pass = 0, fail = 0;
  const ok = (l: string, c: boolean, d = "") => {
    if (c) { pass++; console.log("PASS  " + l); }
    else { fail++; console.log("FAIL  " + l + (d ? "  -> " + d : "")); }
  };
  const made = {
    userIds: [] as string[], accountIds: [] as string[],
    roomIds: [] as string[], lineIds: [] as string[],
    recordIds: [] as string[], queueIds: [] as string[], docIds: [] as string[],
  };

  try {
    const loc = await prisma.line.findFirst({
      select: { barangayId: true, municipalId: true, provinceId: true, regionId: true },
    });
    if (!loc) { console.log("NO FIXTURE (line)"); process.exit(2); }
    const mkLine = async (t: string) => {
      const l = await prisma.line.create({
        data: { name: `QA RD ${TS} ${t}`, ...loc }, select: { id: true } });
      made.lineIds.push(l.id); return l;
    };
    const LINE_A = await mkLine("A");
    const LINE_B = await mkLine("B");

    const mk = async (tag: string, lineId: string) => {
      const acct = await prisma.account.create({
        data: { username: `qa_rd_${TS}_${tag}`, password: "x", lineId },
        select: { id: true, username: true } });
      made.accountIds.push(acct.id);
      const u = await prisma.user.create({
        data: { firstName: "Qa", lastName: `RD${tag.toUpperCase()}`,
                username: acct.username, accountId: acct.id, lineId,
                email: `qa-rd-${TS}-${tag}@test.local`, active: 1 },
        select: { id: true } });
      made.userIds.push(u.id);
      return { accountId: acct.id, userId: u.id };
    };

    const CLERK   = await mk("clerk", LINE_A.id);   // works in the room
    const OUTSIDE = await mk("outside", LINE_A.id); // same line, no room
    const FOREIGN = await mk("foreign", LINE_B.id); // another municipality

    const ROOM = await prisma.receivingRoom.create({
      data: { code: `QA-RD-${TS}`, lineId: LINE_A.id }, select: { id: true } });
    made.roomIds.push(ROOM.id);
    await prisma.roomAuthorizedUser.create({
      data: { receivingRoomId: ROOM.id, userId: CLERK.userId,
              type: ROOM_MEMBER_TYPES.owner, status: 1 } });

    const mkRecord = async (tag: string, lineId: string, scanned: number) => {
      const rec = await prisma.documentReceiveRecord.create({
        data: { lineId, barcode: `QA${TS}${tag}`, title: `Memo ${tag} ${TS}`,
                senderName: "Walk-in", direction: "in" },
        select: { id: true } });
      made.recordIds.push(rec.id);
      for (let i = 1; i <= scanned; i++) {
        await prisma.documentReceivePage.create({
          data: { recordId: rec.id, page: i, mime: "image/png", bytes: PNG_1PX } });
      }
      return rec;
    };
    const UNSCANNED = await mkRecord("U", LINE_A.id, 0);
    const SCANNED   = await mkRecord("S", LINE_A.id, 3);
    const OTHERLINE = await mkRecord("F", LINE_B.id, 2);

    const call = async (accountId: string | null, recordId: string, roomId: string) => {
      const r = mockRes();
      let threw: any = null;
      await documentReceiveDisseminate(
        { user: accountId ? { id: accountId } : undefined,
          body: { recordId, roomId } } as any, r,
      ).catch((e) => { threw = e; });
      if (r._body?.queueRoomId) made.queueIds.push(r._body.queueRoomId);
      if (r._body?.documentId) made.docIds.push(r._body.documentId);
      return { r, threw, body: r._body, okd: !threw && r._code === 200 };
    };
    const draftsFor = (roomId: string) =>
      prisma.signatureQueueRoom.count({ where: { receivingRoomId: roomId } });

    // ── The rule ────────────────────────────────────────────────────────
    const before = await draftsFor(ROOM.id);
    let out = await call(CLERK.accountId, UNSCANNED.id, ROOM.id);
    ok("an UNSCANNED document cannot be sent onward", !!out.threw,
      out.threw?.message);
    ok("…and the refusal says what to do about it",
      /scan/i.test(out.threw?.message ?? ""), out.threw?.message);
    ok("…no draft routing was left behind",
      (await draftsFor(ROOM.id)) === before);
    ok("…and no file was written for a document that does not exist",
      (await prisma.document.count({
        where: { lineId: LINE_A.id, title: { contains: `Memo U ${TS}` } },
      })) === 0);

    out = await call(CLERK.accountId, SCANNED.id, ROOM.id);
    ok("a SCANNED document can be sent onward", out.okd, out.threw?.message);
    ok("…it reports the pages it carried", out.body?.pages === 3,
      JSON.stringify(out.body?.pages));
    ok("…and hands back a routing draft to configure",
      !!out.body?.queueRoomId && !!out.body?.documentId);

    const q = await prisma.signatureQueueRoom.findUnique({
      where: { id: out.body.queueRoomId },
      select: { status: true, receivingRoomId: true, userId: true, title: true } });
    ok("the draft starts as a draft, not dispatched", q?.status === 0);
    ok("…sent from the caller's own room", q?.receivingRoomId === ROOM.id);
    ok("…attributed to the caller", q?.userId === CLERK.userId);
    ok("…carrying the document's title", q?.title === `Memo S ${TS}`);

    const file = await prisma.decodedFile.findFirst({
      where: { documentId: out.body.documentId },
      select: { fileName: true, fileType: true, fileDecoded: true } });
    ok("a real PDF was built from the scans",
      file?.fileType === "application/pdf" && (file?.fileDecoded?.length ?? 0) > 0);
    ok("…and it is a PDF, not something merely labelled one",
      Buffer.from(file!.fileDecoded!).subarray(0, 5).toString() === "%PDF-",
      Buffer.from(file!.fileDecoded!).subarray(0, 8).toString());
    // Count pages by loading the PDF, not by grepping its bytes: pdf-lib
    // compresses object streams, so "/Type /Page" is not there to find and
    // a regex reports zero for a perfectly good three-page file.
    const { PDFDocument: PDFRead } = await import("pdf-lib");
    const parsed = await PDFRead.load(Buffer.from(file!.fileDecoded!));
    ok("…with one page per scan", parsed.getPageCount() === 3,
      String(parsed.getPageCount()));
    ok("…named after the barcode, so the paper can be found again",
      file?.fileName === `QA${TS}S.pdf`, file?.fileName);

    // ── Who may do it ───────────────────────────────────────────────────
    out = await call(OUTSIDE.accountId, SCANNED.id, ROOM.id);
    ok("somebody who does not work in that room cannot send from it",
      !!out.threw, out.threw?.message);
    out = await call(FOREIGN.accountId, SCANNED.id, ROOM.id);
    ok("nor can another municipality", !!out.threw);
    out = await call(CLERK.accountId, OTHERLINE.id, ROOM.id);
    ok("nor can you route another municipality's record through your room",
      !!out.threw, out.threw?.message);
    out = await call(null, SCANNED.id, ROOM.id);
    ok("an unauthenticated call is refused", !!out.threw);

    // ── A deleted record is not routable ────────────────────────────────
    await prisma.documentReceiveRecord.update({
      where: { id: SCANNED.id }, data: { deletedAt: new Date() } });
    out = await call(CLERK.accountId, SCANNED.id, ROOM.id);
    ok("a deleted record cannot be sent onward", !!out.threw);
    await prisma.documentReceiveRecord.update({
      where: { id: SCANNED.id }, data: { deletedAt: null } });
  } catch (e: any) {
    fail++;
    console.log("FAIL  threw: " + (e?.stack ?? e?.message ?? String(e)));
  } finally {
    try {
      await prisma.documentReceivePage.deleteMany({
        where: { recordId: { in: made.recordIds } } }).catch(() => undefined);
      await prisma.documentReceiveRecord.deleteMany({
        where: { id: { in: made.recordIds } } }).catch(() => undefined);
      const docs = await prisma.document.findMany({
        where: { lineId: { in: made.lineIds } }, select: { id: true } });
      const docIds = docs.map((d) => d.id);
      if (docIds.length) {
        await prisma.decodedFile.deleteMany({ where: { documentId: { in: docIds } } })
          .catch(() => undefined);
        await prisma.document.deleteMany({ where: { id: { in: docIds } } });
      }
      await prisma.signatureQueueRoom.deleteMany({
        where: { receivingRoomId: { in: made.roomIds } } }).catch(() => undefined);
      if (made.roomIds.length) {
        await prisma.roomAuthorizedUser.deleteMany({
          where: { receivingRoomId: { in: made.roomIds } } });
        await prisma.receivingRoom.deleteMany({ where: { id: { in: made.roomIds } } });
      }
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
      const left = await prisma.documentReceiveRecord.count({
        where: { barcode: { contains: String(TS) } } });
      console.log(`CLEANUP  leftover records=${left}`);
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
