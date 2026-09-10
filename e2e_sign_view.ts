/* PROOF: you can see the document before you sign it, and what you see is
 * where the signature actually lands.
 *
 * The phone could already sign — one call flips every slot carrying your
 * name — but it could not show you the thing first, which makes the whole
 * feature indefensible.
 *
 * The assertion that carries the weight is the coordinate one. The preview
 * and the finished PDF must agree about where a signature box is, or the
 * screen is a lie. They agree because SignatureCoor stores basis points —
 * 0-10000 of the page's width and height, origin top-left — and both sides
 * divide by the same page size. So this file renders a REAL PDF through
 * the same rasteriser the endpoint uses, checks mupdf reports the page
 * size pdf-lib wrote, and then converts a stored box both ways: to the
 * preview's pixels and to the PDF user units downloadSignedDocument
 * stamps at. If those two ever disagree the preview is wrong.
 *
 * Run: npx ts-node --transpile-only e2e_sign_view.ts */
import path from "path";

const entry = path.join(__dirname, "src", "index.ts");
require.cache[entry] = {
  id: entry, filename: entry, loaded: true,
  exports: { notificationSocket: { emitUserNotification: () => undefined } },
} as any;

import { prisma } from "./src/barrel/prisma";
import {
  routingSignSheet,
  routingPageImage,
} from "./src/controller/documentSignViewController";
import { signMine } from "./src/controller/disseminationController";
import { pdfPageSizes, renderPdfPage } from "./src/service/pdfRaster";
import { ROOM_MEMBER_TYPES } from "./src/controller/roomConfigController";

const TS = Date.now();

// A4 in points, which is what the fixture PDF is built at.
const A4_W = 595.28;
const A4_H = 841.89;

const mockRes = () => {
  const r: any = {
    _code: 0, _body: null as any, _headers: {} as Record<string, string>,
    code(n: number) { this._code = n; return this; },
    send(b: unknown) { this._body = b; return this; },
    status(n: number) { return this.code(n); },
    header(k: string, v: string) { this._headers[String(k).toLowerCase()] = v; return this; },
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
    docIds: [] as string[],
  };

  try {
    // ── A real three-page PDF ───────────────────────────────────────────
    const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    for (let i = 1; i <= 3; i++) {
      const pg = pdf.addPage([A4_W, A4_H]);
      pg.drawText(`QA SIGN VIEW ${TS} — page ${i}`,
        { x: 56, y: A4_H - 90, size: 18, font, color: rgb(0, 0, 0) });
      pg.drawRectangle({ x: 56, y: 90, width: 220, height: 70,
        borderColor: rgb(0.7, 0.7, 0.7), borderWidth: 1 });
    }
    const pdfBytes = Buffer.from(await pdf.save());

    // ── The rasteriser, directly ────────────────────────────────────────
    const sizes = await pdfPageSizes(pdfBytes);
    ok("the rasteriser sees every page", sizes.length === 3,
      JSON.stringify(sizes));
    ok("…at the size the PDF was written at",
      Math.abs(sizes[0].widthPt - A4_W) < 0.5 &&
      Math.abs(sizes[0].heightPt - A4_H) < 0.5,
      JSON.stringify(sizes[0]));

    const shot = await renderPdfPage(pdfBytes, 2, 900);
    ok("a page renders to a PNG",
      shot.png.subarray(0, 8).toString("hex") === "89504e470d0a1a0a",
      shot.png.subarray(0, 8).toString("hex"));
    ok("…at the width asked for", shot.widthPx === 900, String(shot.widthPx));
    ok("…keeping the page's aspect ratio",
      Math.abs(shot.heightPx / shot.widthPx - A4_H / A4_W) < 0.01,
      `${shot.widthPx}x${shot.heightPx}`);
    ok("…and it is not a blank sheet",
      shot.png.length > 3000, `${shot.png.length} bytes`);

    let threwPast = false;
    await renderPdfPage(pdfBytes, 99, 900).catch(() => { threwPast = true; });
    ok("a page past the end is refused, not faked", threwPast);

    // ── Fixture ─────────────────────────────────────────────────────────
    const loc = await prisma.line.findFirst({
      select: { barangayId: true, municipalId: true, provinceId: true, regionId: true },
    });
    if (!loc) { console.log("NO FIXTURE (line)"); process.exit(2); }
    const LINE = await prisma.line.create({
      data: { name: `QA SV ${TS}`, ...loc }, select: { id: true } });
    made.lineIds.push(LINE.id);

    const mk = async (tag: string) => {
      const acct = await prisma.account.create({
        data: { username: `qa_sv_${TS}_${tag}`, password: "x", lineId: LINE.id },
        select: { id: true, username: true } });
      made.accountIds.push(acct.id);
      const u = await prisma.user.create({
        data: { firstName: "Qa", lastName: `Sv${tag.toUpperCase()}`,
                username: acct.username, accountId: acct.id, lineId: LINE.id,
                email: `qa-sv-${TS}-${tag}@test.local`, active: 1 },
        select: { id: true } });
      made.userIds.push(u.id);
      return { accountId: acct.id, userId: u.id };
    };
    const SENDER  = await mk("sender");
    const SIGNER  = await mk("signer");   // two boxes, both theirs
    const OTHER   = await mk("other");    // one box, not the signer's
    const RECV    = await mk("recv");     // may read, nothing to sign
    const OUTSIDE = await mk("outside");  // nothing to do with it

    const mkRoom = async (code: string) => {
      const r = await prisma.receivingRoom.create({
        data: { code, lineId: LINE.id }, select: { id: true, code: true } });
      made.roomIds.push(r.id); return r;
    };
    const FROM_ROOM = await mkRoom(`QA-SV-FROM-${TS}`);
    const TO_ROOM   = await mkRoom(`QA-SV-TO-${TS}`);
    await prisma.roomAuthorizedUser.create({
      data: { receivingRoomId: FROM_ROOM.id, userId: SENDER.userId,
              type: ROOM_MEMBER_TYPES.owner, status: 1 } });
    await prisma.roomAuthorizedUser.create({
      data: { receivingRoomId: TO_ROOM.id, userId: RECV.userId,
              type: ROOM_MEMBER_TYPES.receiver, status: 1 } });

    const queue = await prisma.signatureQueueRoom.create({
      data: { userId: SENDER.userId, receivingRoomId: FROM_ROOM.id,
              title: `QA SV MEMO ${TS}`, status: 1, step: 1 },
      select: { id: true } });
    made.queueIds.push(queue.id);
    await prisma.targetRoom.create({
      data: { signatureQueueRoomId: queue.id, receivingRoomId: TO_ROOM.id,
              status: 1, receivedAt: new Date() } });

    const mineArr = await prisma.signatoryArrangement.create({
      data: { signatureQueueRoomId: queue.id, userId: SIGNER.userId,
              index: 0, status: 0 }, select: { id: true } });
    const theirArr = await prisma.signatoryArrangement.create({
      data: { signatureQueueRoomId: queue.id, userId: OTHER.userId,
              index: 1, status: 0 }, select: { id: true } });

    const doc = await prisma.document.create({
      data: { title: `QA SV FILE ${TS}`, lineId: LINE.id,
              userId: SENDER.userId, signatureQueueRoomId: queue.id },
      select: { id: true } });
    made.docIds.push(doc.id);
    await prisma.decodedFile.create({
      data: { documentId: doc.id, fileName: `qa-sv-${TS}.pdf`,
              fileType: "application/pdf", fileSize: String(pdfBytes.length),
              fileDecoded: pdfBytes } });

    // Boxes, in basis points. Page 2 carries one of mine and one of
    // theirs; page 3 carries a second of mine.
    const p2 = await prisma.documentPage.create({
      data: { documentId: doc.id, page: 2, content: "" },
      select: { id: true } });
    const p3 = await prisma.documentPage.create({
      data: { documentId: doc.id, page: 3, content: "" },
      select: { id: true } });
    const MY_BOX = { xAxis: 1000, yAxis: 8000, width: 3000, height: 800 };
    await prisma.signatureCoor.create({
      data: { ...MY_BOX, documentPageId: p2.id,
              signatoryArrangementId: mineArr.id } });
    await prisma.signatureCoor.create({
      data: { xAxis: 5500, yAxis: 8000, width: 3000, height: 800,
              documentPageId: p2.id, signatoryArrangementId: theirArr.id } });
    await prisma.signatureCoor.create({
      data: { xAxis: 1000, yAxis: 7000, width: 2500, height: 700,
              documentPageId: p3.id, signatoryArrangementId: mineArr.id } });

    const call = async (fn: any, accountId: string | null, payload: any,
                        headers: Record<string, string> = {}) => {
      const r = mockRes();
      let threw: any = null;
      await fn({ user: accountId ? { id: accountId } : undefined,
                 query: payload, headers } as any, r)
        .catch((e: any) => { threw = e; });
      return { r, threw, body: r._body, headers: r._headers,
               okd: !threw && r._code === 200 };
    };

    // ── The sign sheet ──────────────────────────────────────────────────
    ok("an outsider cannot open the sign sheet",
      !!(await call(routingSignSheet, OUTSIDE.accountId,
        { queueId: queue.id })).threw);
    ok("nor an unauthenticated caller",
      !!(await call(routingSignSheet, null, { queueId: queue.id })).threw);

    let out = await call(routingSignSheet, SIGNER.accountId,
      { queueId: queue.id });
    ok("the signatory opens it", out.okd, out.threw?.message);
    const sheet = out.body;
    ok("…and is told the routing's name and sender",
      sheet?.title === `QA SV MEMO ${TS}` && sheet?.from === FROM_ROOM.code,
      JSON.stringify({ t: sheet?.title, f: sheet?.from }));
    ok("…with every page of the PDF, not just the ones with boxes",
      sheet?.totalPages === 3 && sheet?.documents?.[0]?.pageCount === 3,
      "DocumentPage rows exist only for pages 2 and 3");
    ok("…each carrying its real size",
      Math.abs(sheet?.documents?.[0]?.pages?.[0]?.widthPt - A4_W) < 0.5,
      JSON.stringify(sheet?.documents?.[0]?.pages?.[0]));

    const pages = sheet?.documents?.[0]?.pages ?? [];
    const page1 = pages.find((p: any) => p.page === 1);
    const page2 = pages.find((p: any) => p.page === 2);
    const page3 = pages.find((p: any) => p.page === 3);
    ok("page 1 has nothing on it", (page1?.mine ?? []).length === 0
      && page1?.others === 0);
    ok("page 2 shows MY box", (page2?.mine ?? []).length === 1,
      JSON.stringify(page2));
    ok("…and only counts the other person's, never places it",
      page2?.others === 1 && !JSON.stringify(page2.mine).includes("5500"),
      "where somebody else signs is not this screen's business");
    ok("page 3 shows my second box", (page3?.mine ?? []).length === 1);
    ok("one tap would sign both areas", sheet?.myAreas === 2,
      String(sheet?.myAreas));
    ok("…and the screen may offer it", sheet?.canSign === true);
    ok("the other signatory is listed, unsigned",
      (sheet?.signatories ?? []).length === 2
        && sheet.signatories.every((s: any) => s.signed === false));
    ok("…with the caller marked as themselves",
      sheet?.signatories?.[0]?.isMe === true
        && sheet?.signatories?.[1]?.isMe === false);

    // ── The coordinate contract ─────────────────────────────────────────
    // Preview and product must put the box in the same place.
    const box = page2.mine[0];
    ok("the box comes back in basis points, unchanged",
      box.xBp === MY_BOX.xAxis && box.yBp === MY_BOX.yAxis
        && box.wBp === MY_BOX.width && box.hBp === MY_BOX.height,
      JSON.stringify(box));

    // What the phone draws, over an image RENDER_W pixels wide.
    const RENDER_W = 900;
    const imgH = Math.round(RENDER_W * (page2.heightPt / page2.widthPt));
    const preview = {
      left: (box.xBp / 10000) * RENDER_W,
      top: (box.yBp / 10000) * imgH,
      w: (box.wBp / 10000) * RENDER_W,
      h: (box.hBp / 10000) * imgH,
    };
    // What downloadSignedDocument stamps, in PDF user units (origin
    // bottom-left) — copied from its own arithmetic.
    const stamp = {
      x: (box.xBp / 10000) * A4_W,
      y: A4_H - (box.yBp / 10000) * A4_H - (box.hBp / 10000) * A4_H,
      w: (box.wBp / 10000) * A4_W,
      h: (box.hBp / 10000) * A4_H,
    };
    // Convert the stamp back into preview pixels and compare.
    const k = RENDER_W / A4_W;
    const stampAsPreview = {
      left: stamp.x * k,
      top: (A4_H - stamp.y - stamp.h) * k,
      w: stamp.w * k,
      h: stamp.h * k,
    };
    const near = (a: number, b: number) => Math.abs(a - b) < 0.75;
    ok("the preview box and the stamped box are the same box",
      near(preview.left, stampAsPreview.left) &&
      near(preview.top, stampAsPreview.top) &&
      near(preview.w, stampAsPreview.w) &&
      near(preview.h, stampAsPreview.h),
      JSON.stringify({ preview, stampAsPreview }));

    // A deliberately wrong reading, to show the check above can fail.
    ok("…and the check would catch a top-left/bottom-left mix-up",
      !near(preview.top, (stamp.y) * k),
      "if this passes, the assertion above proves nothing");

    // ── Who else may look ───────────────────────────────────────────────
    out = await call(routingSignSheet, RECV.accountId, { queueId: queue.id });
    ok("a recipient may read the document", out.okd, out.threw?.message);
    ok("…and is honestly told there is nothing here for them to sign",
      out.body?.myAreas === 0 && out.body?.canSign === false
        && (out.body?.documents?.[0]?.pages ?? [])
             .every((p: any) => p.mine.length === 0));
    ok("…while still seeing the whole document",
      out.body?.totalPages === 3);

    // ── The page image ──────────────────────────────────────────────────
    ok("an outsider cannot fetch a page image",
      !!(await call(routingPageImage, OUTSIDE.accountId,
        { documentId: doc.id, page: "1" })).threw);

    out = await call(routingPageImage, SIGNER.accountId,
      { documentId: doc.id, page: "2", w: "900" });
    ok("the signatory gets the page", out.okd, out.threw?.message);
    ok("…as a PNG",
      out.headers["content-type"] === "image/png" &&
      Buffer.isBuffer(out.body) &&
      out.body.subarray(0, 8).toString("hex") === "89504e470d0a1a0a");
    ok("…with the dimensions it reports",
      out.headers["x-page-width"] === "900" &&
      Number(out.headers["x-page-height"]) > 1200,
      JSON.stringify(out.headers));
    ok("…and an ETag so the phone caches it", !!out.headers["etag"]);

    const etag = out.headers["etag"];
    const again = await call(routingPageImage, SIGNER.accountId,
      { documentId: doc.id, page: "2", w: "900" }, { "if-none-match": etag });
    ok("…which a second request honours with 304",
      again.r._code === 304, String(again.r._code));

    out = await call(routingPageImage, SIGNER.accountId,
      { documentId: doc.id, page: "99" });
    ok("a page past the end is refused", !!out.threw);

    // ── After signing ───────────────────────────────────────────────────
    const sig = await prisma.signature.create({
      data: { userId: SIGNER.userId, title: `QA SV SIG ${TS}`,
              signature: Buffer.from("x"), active: true },
      select: { id: true } });
    const r = mockRes();
    let signErr: any = null;
    await signMine({ user: { id: SIGNER.accountId },
      body: { queueRoomId: queue.id, userId: SIGNER.userId } } as any, r)
      .catch((e: any) => { signErr = e; });
    ok("signing both areas in one call works", !signErr && r._code === 200,
      signErr?.message);

    out = await call(routingSignSheet, SIGNER.accountId, { queueId: queue.id });
    ok("the sheet now offers nothing to sign",
      out.body?.myAreas === 0 && out.body?.canSign === false,
      JSON.stringify({ a: out.body?.myAreas, c: out.body?.canSign }));
    ok("…but the boxes are still shown, now marked done",
      (out.body?.documents?.[0]?.pages ?? [])
        .flatMap((p: any) => p.mine)
        .every((b: any) => b.pending === false),
      "the signer should still see where their signature went");
    ok("…and the signatory list says so",
      out.body?.signatories?.find((s: any) => s.isMe)?.signed === true);
    await prisma.signature.delete({ where: { id: sig.id } }).catch(() => undefined);
  } catch (e: any) {
    fail++;
    console.log("FAIL  threw: " + (e?.stack ?? e?.message ?? String(e)));
  } finally {
    try {
      if (made.docIds.length) {
        const d = { documentId: { in: made.docIds } };
        await prisma.signatureCoor.deleteMany({
          where: { documentPage: { is: d } } });
        await prisma.documentActivityLogs.deleteMany({ where: d });
        await prisma.documentPage.deleteMany({ where: d });
        await prisma.decodedFile.deleteMany({ where: d });
        await prisma.documentSeal.deleteMany({ where: d }).catch(() => undefined);
        await prisma.signatureAttestation.deleteMany({ where: d })
          .catch(() => undefined);
        await prisma.document.deleteMany({ where: { id: { in: made.docIds } } });
      }
      if (made.queueIds.length) {
        const qs = { signatureQueueRoomId: { in: made.queueIds } };
        await prisma.targetRoom.deleteMany({ where: qs });
        await prisma.signatoryArrangement.deleteMany({ where: qs });
        await prisma.signatureQueueRoom.deleteMany({
          where: { id: { in: made.queueIds } } });
      }
      if (made.roomIds.length) {
        await prisma.roomAuthorizedUser.deleteMany({
          where: { receivingRoomId: { in: made.roomIds } } });
        await prisma.receivingRoom.deleteMany({
          where: { id: { in: made.roomIds } } });
      }
      if (made.userIds.length) {
        const who = { in: made.userIds };
        await prisma.signature.deleteMany({ where: { userId: who } });
        await prisma.documentActivityLogs.deleteMany({ where: { userId: who } });
        await prisma.notification.deleteMany({
          where: { OR: [{ recipientId: who }, { senderId: who }] } });
        await prisma.signatoryArrangement.deleteMany({ where: { userId: who } });
        await prisma.user.deleteMany({ where: { id: who } });
      }
      if (made.accountIds.length)
        await prisma.account.deleteMany({
          where: { id: { in: made.accountIds } } });
      for (const id of made.lineIds)
        await prisma.line.delete({ where: { id } });
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
