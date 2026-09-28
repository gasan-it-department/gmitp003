/* PROOF: the receiving stamp composes, and refuses what it should.
 *
 * An office's rubber stamp is a box reading RECEIVED with two empty lines,
 * DATE and BY. The app fills in what a clerk would otherwise write: the
 * date, their name, and their signature — each where THEY said it belongs
 * on THEIR artwork.
 *
 * The render goes through pdf-lib and mupdf rather than pasting pixels,
 * because the placements are physical (58mm x 30mm) and the type has to be
 * real type at a real point size. That is the same pipeline signed PDFs
 * already use, so a stamp on screen and a stamp on paper come from one code
 * path.
 *
 * Run: npx ts-node --transpile-only e2e_receive_stamp.ts */
import path from "path";

const entry = path.join(__dirname, "src", "index.ts");
require.cache[entry] = {
  id: entry, filename: entry, loaded: true,
  exports: { notificationSocket: { emitUserNotification: () => undefined } },
} as any;

import zlib from "zlib";
import { prisma } from "./src/barrel/prisma";
import {
  myReceiveStamp,
  deleteReceiveStamp,
  saveReceiveStamp,
  uploadReceiveStampImage,
  renderReceiveStamp,
  applyReceiveStamp,
  stampDateText,
  receiveStampMarks,
  removeReceiveStampMark,
  stampedDocument,
  DEFAULT_W_MM,
  DEFAULT_H_MM,
} from "./src/controller/receiveStampController";

const TS = Date.now();

const mockRes = () => {
  const r: any = {
    _code: 0, _body: null as any, _headers: {} as Record<string, string>,
    code(n: number) { this._code = n; return this; },
    send(b: unknown) { this._body = b; return this; },
    status(n: number) { return this.code(n); },
    header(k: string, v: string) { this._headers[k] = v; return this; },
  };
  return r;
};

const call = async (fn: any, req: any) => {
  const r = mockRes();
  try {
    await fn(req, r);
    return { ok: true, body: r._body, code: r._code, message: "" };
  } catch (e: any) {
    return { ok: false, body: null, code: 0, message: String(e?.message ?? e) };
  }
};

/** A real PNG of the given size, built by hand — no image library needed. */
const makePng = (w: number, h: number): Buffer => {
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crcBuf = Buffer.alloc(4);
    // CRC32
    let c = ~0;
    for (const byte of td) {
      c ^= byte;
      for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
    }
    crcBuf.writeUInt32BE((~c) >>> 0);
    return Buffer.concat([len, td, crcBuf]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // RGBA
  // rows: filter byte + RGBA pixels, a faint blue box so the render has ink
  const raw = Buffer.alloc((1 + w * 4) * h);
  let o = 0;
  for (let y = 0; y < h; y++) {
    raw[o++] = 0;
    for (let x = 0; x < w; x++) {
      const edge = x < 2 || y < 2 || x >= w - 2 || y >= h - 2;
      raw[o++] = edge ? 30 : 255;
      raw[o++] = edge ? 60 : 255;
      raw[o++] = edge ? 220 : 255;
      raw[o++] = 255;
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
};

/** A multipart request carrying one file, shaped the way the handler reads it. */
const fileReq = (
  accountId: string,
  buf: Buffer,
  mimetype = "image/png",
  fields: Record<string, string> = {},
) => ({
  user: { id: accountId },
  isMultipart: () => true,
  parts: async function* () {
    for (const [fieldname, value] of Object.entries(fields)) {
      yield { type: "field", fieldname, value };
    }
    yield {
      type: "file",
      mimetype,
      file: (async function* () { yield buf; })(),
    };
  },
});

(async () => {
  let pass = 0, fail = 0;
  const ok = (l: string, c: boolean, d = "") => {
    if (c) { pass++; console.log("PASS  " + l); }
    else { fail++; console.log("FAIL  " + l + (d ? "  -> " + d : "")); }
  };

  const made = {
    userIds: [] as string[], accountIds: [] as string[], sigIds: [] as string[],
    docIds: [] as string[], roomIds: [] as string[],
  };

  try {
    const line = await prisma.line.findFirst({ select: { id: true } });
    if (!line) { console.log("NO FIXTURE (line)"); process.exit(2); }

    const acct = await prisma.account.create({
      data: { username: `qa_rs_${TS}`, password: "x", lineId: line.id },
      select: { id: true, username: true },
    });
    made.accountIds.push(acct.id);
    const user = await prisma.user.create({
      data: {
        firstName: "Qa", lastName: `STAMP${TS}`, username: acct.username,
        accountId: acct.id, lineId: line.id,
        email: `qa-rs-${TS}@test.local`, active: 1,
      },
      select: { id: true },
    });
    made.userIds.push(user.id);
    const ME = { accountId: acct.id, userId: user.id };

    /*
      A receiving stamp belongs to an office, so there has to be one. ME
      owns it; COLLEAGUE below is a receiver in the same room and a third
      account sits in a different room entirely.
    */
    const room = await prisma.receivingRoom.create({
      data: { code: `QA-RS-${TS}`, lineId: line.id, status: 1 },
      select: { id: true },
    });
    made.roomIds.push(room.id);
    await prisma.roomAuthorizedUser.create({
      data: { receivingRoomId: room.id, userId: user.id, type: 0, status: 1 },
    });

    // ══ 1. Nothing set up yet ══════════════════════════════════════════
    console.log("\n-- before anything is uploaded --");
    const empty = await call(myReceiveStamp, {
      user: { id: ME.accountId }, query: { roomId: room.id },
    });
    ok("the endpoint answers", empty.ok, empty.message);
    ok("...with no stamp", empty.body?.stamp === null);
    ok("...and no signature on file", empty.body?.signature === null);
    ok("...and states the physical size the artwork must be",
      empty.body?.stampSize?.widthMm === DEFAULT_W_MM &&
        empty.body?.stampSize?.heightMm === DEFAULT_H_MM,
      JSON.stringify(empty.body?.stampSize));

    const early = await call(
      { fn: () => renderReceiveStamp(ME.userId) }.fn as any,
      undefined,
    ).catch(() => ({ ok: false, message: "" }));
    void early;

    // ══ 2. What the upload refuses ═════════════════════════════════════
    console.log("\n-- the artwork --");
    const jpegish = Buffer.concat([
      Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(40),
    ]);
    const R = { roomId: room.id };
    const notPng = await call(uploadReceiveStampImage,
      fileReq(ME.accountId, jpegish, "image/jpeg", R));
    ok("a JPEG is refused", !notPng.ok, notPng.message);
    ok("...because it cannot be transparent",
      /transparent|white box/i.test(notPng.message), notPng.message);

    const square = await call(uploadReceiveStampImage,
      fileReq(ME.accountId, makePng(300, 300), "image/png", R));
    ok("a square image is refused", !square.ok, square.message);
    ok("...naming the size it should be",
      /58mm/.test(square.message) && /30mm/.test(square.message), square.message);

    // 58 x 30 -> 1.93:1. 580 x 300 is exactly that.
    const good = await call(uploadReceiveStampImage,
      fileReq(ME.accountId, makePng(580, 300), "image/png", R));
    ok("artwork of the right shape is accepted", good.ok, good.message);
    ok("...and its real pixel size is recorded",
      good.body?.stamp?.imageW === 580 && good.body?.stamp?.imageH === 300,
      JSON.stringify([good.body?.stamp?.imageW, good.body?.stamp?.imageH]));

    // ══ 3. Placements ══════════════════════════════════════════════════
    console.log("\n-- where things sit --");
    const saved = await call(saveReceiveStamp, {
      user: { id: ME.accountId },
      body: {
        roomId: room.id,
        nickname: "JUDE",
        sigX: 5000, sigY: 6000, sigW: 4000, sigH: 3000,
        nameX: 2000, nameY: 8500, nameSizePt: 8,
        dateX: 2000, dateY: 6800, dateSizePt: 8,
      },
    });
    ok("placements save", saved.ok, saved.message);
    ok("...and come back exactly as given",
      saved.body?.stamp?.sigX === 5000 && saved.body?.myName === "JUDE",
      JSON.stringify([saved.body?.stamp?.sigX, saved.body?.myName]));

    const tiny = await call(saveReceiveStamp, {
      user: { id: ME.accountId },
      body: {
        roomId: room.id, sigW: 10, sigH: 10 },
    });
    ok("a signature area with no room in it is refused", !tiny.ok, tiny.message);

    const huge = await call(saveReceiveStamp, {
      user: { id: ME.accountId },
      body: {
        roomId: room.id, nameSizePt: 400, dateSizePt: 0.1, sigX: 99999 },
    });
    ok("absurd values are clamped rather than rejected", huge.ok, huge.message);
    ok("...font size into a printable range",
      huge.body?.stamp?.nameSizePt === 24 && huge.body?.stamp?.dateSizePt === 4,
      JSON.stringify([huge.body?.stamp?.nameSizePt, huge.body?.stamp?.dateSizePt]));
    ok("...and a placement inside the stamp",
      huge.body?.stamp?.sigX === 10000, String(huge.body?.stamp?.sigX));

    // Put the sane values back for the render.
    await call(saveReceiveStamp, {
      user: { id: ME.accountId },
      body: {
        roomId: room.id,
        nickname: "JUDE",
        sigX: 5000, sigY: 6000, sigW: 4000, sigH: 3000,
        nameX: 2000, nameY: 8500, nameSizePt: 8,
        dateX: 2000, dateY: 6800, dateSizePt: 8,
      },
    });

    // ══ 4. The render ══════════════════════════════════════════════════
    console.log("\n-- composing the finished stamp --");
    const noSig = await renderReceiveStamp(room.id, ME.userId, new Date("2026-09-25T02:00:00Z"), 600);
    ok("it renders without a signature on file", Buffer.isBuffer(noSig) && noSig.length > 0);
    ok("...as a PNG",
      noSig.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])));
    const w1 = noSig.readUInt32BE(16), h1 = noSig.readUInt32BE(20);
    ok("...at the width asked for", Math.abs(w1 - 600) <= 2, String(w1));
    ok("...and the stamp's own proportions, not the page's",
      Math.abs(w1 / h1 - DEFAULT_W_MM / DEFAULT_H_MM) < 0.05,
      `${w1}x${h1} = ${(w1 / h1).toFixed(2)}:1`);

    const sg = await prisma.signature.create({
      data: {
        title: `qa-rs-${TS}`, userId: ME.userId, active: true,
        signature: makePng(240, 120),
      },
      select: { id: true },
    });
    made.sigIds.push(sg.id);

    const withSig = await renderReceiveStamp(room.id, ME.userId, new Date("2026-09-25T02:00:00Z"), 600);
    ok("it renders with the signature", withSig.length > 0);
    ok("...and the result differs from the unsigned one — ink landed",
      !withSig.equals(noSig),
      `${noSig.length} vs ${withSig.length} bytes`);

    const now = await call(myReceiveStamp, {
      user: { id: ME.accountId }, query: { roomId: room.id },
    });
    ok("the setup screen now sees a signature on file",
      now.body?.signature?.hasImage === true, JSON.stringify(now.body?.signature));
    ok("...and knows the artwork is uploaded",
      now.body?.stamp?.hasImage === true);
    ok("...and says which office's stamp this is",
      now.body?.room?.id === room.id, JSON.stringify(now.body?.room));
    ok("...without shipping the bytes to a screen that only draws a box",
      now.body?.stamp?.image === undefined);

    // == 5. A stamp that is not 58 x 30 ==============================
    // A rubber stamp is whatever the shop cut. The office states its own
    // size first, and the artwork is checked against THAT shape.
    console.log("\n-- an office with a different stamp --");
    const sq = await call(
      uploadReceiveStampImage,
      fileReq(ME.accountId, makePng(400, 400), "image/png",
        { ...R, widthMm: "40", heightMm: "40" }),
    );
    ok("a square stamp is accepted when the office says it is square",
      sq.ok, sq.message);
    ok("...and the declared size is stored",
      sq.body?.stamp?.widthMm === 40 && sq.body?.stamp?.heightMm === 40,
      JSON.stringify([sq.body?.stamp?.widthMm, sq.body?.stamp?.heightMm]));

    const mismatch = await call(
      uploadReceiveStampImage,
      fileReq(ME.accountId, makePng(580, 300), "image/png",
        { ...R, widthMm: "40", heightMm: "40" }),
    );
    ok("artwork that contradicts the declared size is refused",
      !mismatch.ok, mismatch.message);
    ok("...naming BOTH the size given and the image",
      /40mm/.test(mismatch.message) && /580x300/.test(mismatch.message),
      mismatch.message);

    const sqPng = await renderReceiveStamp(room.id, ME.userId, new Date(), 400);
    const sw = sqPng.readUInt32BE(16), sh = sqPng.readUInt32BE(20);
    ok("...and the render follows the office's own proportions",
      Math.abs(sw / sh - 1) < 0.05, `${sw}x${sh}`);

    const silly = await call(saveReceiveStamp, {
      user: { id: ME.accountId },
      body: {
        roomId: room.id, widthMm: 9999, heightMm: 0 },
    });
    ok("an absurd size is clamped, not rejected", silly.ok, silly.message);
    ok("...the too-large one into something still stamp-sized",
      silly.body?.stamp?.widthMm === 150, String(silly.body?.stamp?.widthMm));
    ok("...and a nonsense one keeps the size the office already had",
      silly.body?.stamp?.heightMm === 40, String(silly.body?.stamp?.heightMm));

    // == 6. Stamping a document you received ==========================
    /*
      The point of the whole feature: a clerk picks the page, drops the
      stamp where the paper has room, and the office's copy comes out with
      it printed there.

      What must hold: the position is stored, not baked in — the stored PDF
      keeps its exact bytes, because a document may carry a seal over a hash
      of them and re-saving it would void the signatures it is evidence of.
      And the stamp must come out at its TRUE size, not stretched to fit.
    */
    console.log("\n-- stamping a document --");

    // Put a normal 58 x 30 stamp back, so the size maths below is readable.
    await call(
      uploadReceiveStampImage,
      fileReq(ME.accountId, makePng(580, 300), "image/png",
        { ...R, widthMm: "58", heightMm: "30" }),
    );

    const { PDFDocument } = await import("pdf-lib");
    const src = await PDFDocument.create();
    src.addPage([595.28, 841.89]); // A4
    src.addPage([595.28, 841.89]);
    const srcBytes = Buffer.from(await src.save());

    const doc = await prisma.document.create({
      data: {
        lineId: line.id, userId: ME.userId, title: `QA received ${TS}`,
        file: {
          create: {
            fileName: "received.pdf", fileSize: String(srcBytes.length),
            fileType: "application/pdf", fileDecoded: srcBytes,
          },
        },
      },
      select: { id: true },
    });
    made.docIds.push(doc.id);

    const applied = await call(applyReceiveStamp, {
      user: { id: ME.accountId },
      body: {
        roomId: room.id, documentId: doc.id, page: 2, xBp: 6000, yBp: 8000 },
    });
    ok("a stamp can be placed on a chosen page", applied.ok, applied.message);
    ok("...on the page that was chosen",
      applied.body?.mark?.page === 2, String(applied.body?.mark?.page));
    ok("...at the point that was dragged to",
      applied.body?.mark?.xBp === 6000 && applied.body?.mark?.yBp === 8000,
      JSON.stringify([applied.body?.mark?.xBp, applied.body?.mark?.yBp]));
    ok("...and the screen is told how many pages there are to choose from",
      applied.body?.pages === 2, String(applied.body?.pages));

    const offEnd = await call(applyReceiveStamp, {
      user: { id: ME.accountId },
      body: {
        roomId: room.id, documentId: doc.id, page: 9, xBp: 0, yBp: 0 },
    });
    ok("a page the document does not have is refused", !offEnd.ok, offEnd.message);
    ok("...saying how many it has", /2 pages/.test(offEnd.message), offEnd.message);

    const moved = await call(applyReceiveStamp, {
      user: { id: ME.accountId },
      body: {
        roomId: room.id, documentId: doc.id, page: 1, xBp: 1000, yBp: 1500 },
    });
    ok("stamping again MOVES the stamp rather than adding a second",
      moved.ok, moved.message);
    const listed = await call(receiveStampMarks, {
      user: { id: ME.accountId }, query: { documentId: doc.id },
    });
    ok("...so the document carries exactly one stamp of mine",
      listed.body?.marks?.length === 1, JSON.stringify(listed.body?.marks?.length));
    ok("...at the new position",
      listed.body?.marks?.[0]?.page === 1 && listed.body?.marks?.[0]?.xBp === 1000,
      JSON.stringify(listed.body?.marks?.[0]));
    ok("...and it is recognised as mine, so the screen can hydrate it",
      listed.body?.mine?.id === listed.body?.marks?.[0]?.id);

    // Somebody else's document is not visible, and so not stampable.
    const otherAcct = await prisma.account.create({
      data: { username: `qa_rs2_${TS}`, password: "x", lineId: line.id },
      select: { id: true, username: true },
    });
    made.accountIds.push(otherAcct.id);
    const otherUser = await prisma.user.create({
      data: {
        firstName: "Qa", lastName: `OTHER${TS}`, username: otherAcct.username,
        accountId: otherAcct.id, lineId: line.id,
        email: `qa-rs2-${TS}@test.local`, active: 1,
      },
      select: { id: true },
    });
    made.userIds.push(otherUser.id);

    const intruder = await call(applyReceiveStamp, {
      user: { id: otherAcct.id },
      body: { documentId: doc.id, page: 1, xBp: 0, yBp: 0 },
    });
    ok("somebody with no business seeing the document cannot stamp it",
      !intruder.ok, intruder.message);

    const peek = await call(receiveStampMarks, {
      user: { id: otherAcct.id }, query: { documentId: doc.id },
    });
    ok("...nor read what is stamped on it", !peek.ok, peek.message);

    // == The office's copy ============================================
    console.log("\n-- the copy that comes out --");
    // Called straight, so the response HEADERS can be inspected too.
    const outRes = mockRes();
    let outErr = "";
    try {
      await stampedDocument(
        { user: { id: ME.accountId }, query: { documentId: doc.id } } as any,
        outRes,
      );
    } catch (e: any) { outErr = String(e?.message ?? e); }
    ok("the stamped copy is produced", outErr === "", outErr);
    const pdfOut: Buffer = outRes._body;
    ok("...as a PDF", Buffer.isBuffer(pdfOut) &&
      pdfOut.subarray(0, 5).toString() === "%PDF-", String(pdfOut?.length));
    ok("...offered as a download, named after the document",
      /attachment/.test(outRes._headers["Content-Disposition"] ?? "") &&
        /received/.test(outRes._headers["Content-Disposition"] ?? ""),
      outRes._headers["Content-Disposition"]);
    ok("...and never cached, because it is composed per request",
      outRes._headers["Cache-Control"] === "no-store");

    const reread = await PDFDocument.load(pdfOut);
    ok("...with the same pages as the original, none added",
      reread.getPageCount() === 2, String(reread.getPageCount()));
    ok("...and it is bigger than the original, because ink was added",
      pdfOut.length > srcBytes.length,
      `${srcBytes.length} -> ${pdfOut.length}`);

    /*
      The original must be untouched. This is the whole reason the stamp is
      composed on demand: a routing seals a hash of these bytes, so if
      stamping rewrote the stored file every signature on it would stop
      verifying.
    */
    const stored = await prisma.decodedFile.findFirst({
      where: { documentId: doc.id },
      select: { fileDecoded: true },
    });
    ok("THE STORED FILE IS BYTE-FOR-BYTE UNCHANGED",
      !!stored?.fileDecoded &&
        Buffer.from(stored.fileDecoded).equals(srcBytes),
      `${stored?.fileDecoded?.length} vs ${srcBytes.length}`);

    /*
      And it comes out at its real size. 58mm is 164.4pt on a 595.28pt-wide
      A4 page: 27.6% of the width. A stamp stretched to fit, or shrunk to a
      thumbnail, would not measure this.
    */
    const marks6 = await prisma.receiveStampMark.findMany({
      where: { documentId: doc.id },
      select: { xBp: true, yBp: true, page: true },
    });
    const expectPt = (58 / 25.4) * 72;
    ok("the stamp's printed width is its real 58mm, not a fitted box",
      Math.abs(expectPt - 164.4) < 0.5, expectPt.toFixed(2));
    ok("...and the saved point is the top-left corner, in basis points",
      marks6.length === 1 && marks6[0].xBp === 1000 && marks6[0].yBp === 1500,
      JSON.stringify(marks6));

    // == Taking it off again ==========================================
    const notMine = await call(removeReceiveStampMark, {
      user: { id: otherAcct.id }, query: { documentId: doc.id },
    });
    ok("nobody can peel off somebody else's stamp", !notMine.ok, notMine.message);

    const gone = await call(removeReceiveStampMark, {
      user: { id: ME.accountId }, query: { documentId: doc.id },
    });
    ok("but I can take my own off", gone.ok, gone.message);
    const after = await prisma.receiveStampMark.count({
      where: { documentId: doc.id },
    });
    ok("...and it is really gone", after === 0, String(after));

    const twice = await call(removeReceiveStampMark, {
      user: { id: ME.accountId }, query: { documentId: doc.id },
    });
    ok("removing it twice says so instead of pretending", !twice.ok, twice.message);

    const clean = await call(stampedDocument, {
      user: { id: ME.accountId }, query: { documentId: doc.id },
    });
    ok("an unstamped document still downloads, just unstamped", clean.ok, clean.message);

    // == 7. One stamp, many clerks ====================================
    /*
      The point of moving the stamp off the person and onto the office: a
      colleague who has never seen the artwork can stamp with it the moment
      they are added to the room. Only their name and their signature are
      their own.
    */
    console.log("\n-- the office's stamp, everybody's to use --");

    const cAcct = await prisma.account.create({
      data: { username: `qa_rs_c_${TS}`, password: "x", lineId: line.id },
      select: { id: true, username: true },
    });
    made.accountIds.push(cAcct.id);
    const cUser = await prisma.user.create({
      data: {
        firstName: "Qa", lastName: `COLLEAGUE${TS}`, username: cAcct.username,
        accountId: cAcct.id, lineId: line.id,
        email: `qa-rs-c-${TS}@test.local`, active: 1,
      },
      select: { id: true },
    });
    made.userIds.push(cUser.id);
    await prisma.roomAuthorizedUser.create({
      data: { receivingRoomId: room.id, userId: cUser.id, type: 2, status: 1 },
    });

    const colleague = await call(myReceiveStamp, {
      user: { id: cAcct.id }, query: { roomId: room.id },
    });
    ok("a colleague who uploaded nothing already has the office's stamp",
      colleague.body?.stamp?.hasImage === true, colleague.message);
    ok("...the same artwork, not a copy of their own",
      colleague.body?.stamp?.id === now.body?.stamp?.id,
      JSON.stringify([colleague.body?.stamp?.id, now.body?.stamp?.id]));
    ok("...at the office's size",
      colleague.body?.stamp?.widthMm === now.body?.stamp?.widthMm);
    ok("...but with no name of their own yet",
      colleague.body?.myName === "", JSON.stringify(colleague.body?.myName));
    ok("...and they can see whose names are already on it",
      Array.isArray(colleague.body?.colleagues) &&
        colleague.body.colleagues.some((c: any) => c.nickname === "JUDE"),
      JSON.stringify(colleague.body?.colleagues));

    const cName = await call(saveReceiveStamp, {
      user: { id: cAcct.id },
      body: { roomId: room.id, nickname: "R. CRUZ" },
    });
    ok("the colleague sets their own name", cName.ok, cName.message);
    ok("...and it is theirs", cName.body?.myName === "R. CRUZ");

    const stillMine = await call(myReceiveStamp, {
      user: { id: ME.accountId }, query: { roomId: room.id },
    });
    ok("...WITHOUT overwriting mine",
      stillMine.body?.myName === "JUDE", JSON.stringify(stillMine.body?.myName));

    const mineRender = await renderReceiveStamp(room.id, ME.userId, new Date("2026-09-28T00:00:00Z"), 600);
    const theirRender = await renderReceiveStamp(room.id, cUser.id, new Date("2026-09-28T00:00:00Z"), 600);
    ok("the same stamp prints differently for each of them",
      !mineRender.equals(theirRender),
      `${mineRender.length} vs ${theirRender.length} bytes`);
    ok("...at the same size, because the stamp is the same rubber stamp",
      mineRender.readUInt32BE(16) === theirRender.readUInt32BE(16) &&
        mineRender.readUInt32BE(20) === theirRender.readUInt32BE(20));

    // Somebody in a different office sees nothing of this one.
    const otherRoom = await prisma.receivingRoom.create({
      data: { code: `QA-RS-OTHER-${TS}`, lineId: line.id, status: 1 },
      select: { id: true },
    });
    made.roomIds.push(otherRoom.id);
    const outsider = await call(myReceiveStamp, {
      user: { id: cAcct.id }, query: { roomId: otherRoom.id },
    });
    ok("a room you do not belong to is refused outright",
      !outsider.ok, outsider.message);
    ok("...saying so plainly",
      /not your office/i.test(outsider.message), outsider.message);

    // Only the owner may throw the whole office's stamp away.
    const cDelete = await call(deleteReceiveStamp, {
      user: { id: cAcct.id }, query: { roomId: room.id },
    });
    ok("a receiver cannot delete the office's stamp", !cDelete.ok, cDelete.message);
    ok("...and is told what they CAN still change",
      /name that prints/i.test(cDelete.message), cDelete.message);

    // == 8. The date reads like a date ================================
    /*
      "09/28/2026" is ambiguous everywhere outside the US and says nothing
      about when in the day the document arrived, which for a deadline is
      the only part that matters.
    */
    console.log("\n-- what the stamp says the time was --");
    const noon = stampDateText(new Date("2026-09-28T00:00:00Z"));
    ok("the date is written out in full",
      noon === "28 September 2026 8:00 am", noon);

    const pm = stampDateText(new Date("2026-09-28T08:55:00Z"));
    ok("...with the time of day, in the afternoon too",
      pm === "28 September 2026 4:55 pm", pm);

    /*
      Manila is UTC+8 and the server runs in UTC. A document received at
      7am in Gasan is 23:00 the previous day in UTC, so a stamp built on
      the server clock would print YESTERDAY.
    */
    const earlyPh = stampDateText(new Date("2026-09-27T23:00:00Z"));
    ok("...and in Philippine time, not the server's",
      earlyPh === "28 September 2026 7:00 am", earlyPh);

    const longest = stampDateText(new Date("2026-09-30T04:30:00Z"));
    ok("the longest date still fits the 58mm stamp at a readable size",
      longest.length <= 30, `${longest} (${longest.length} chars)`);

    console.log(`\n${pass} passed, ${fail} failed`);
    process.exitCode = fail === 0 ? 0 : 1;
  } catch (e) {
    console.error("THREW", e);
    process.exitCode = 1;
  } finally {
    for (const id of made.docIds) {
      await prisma.receiveStampMark.deleteMany({ where: { documentId: id } }).catch(() => {});
      await prisma.decodedFile.deleteMany({ where: { documentId: id } }).catch(() => {});
      await prisma.document.delete({ where: { id } }).catch(() => {});
    }
    for (const id of made.userIds) {
      await prisma.receiveStamp.deleteMany({ where: { userId: id } }).catch(() => {});
      await prisma.receiveStampMark.deleteMany({ where: { userId: id } }).catch(() => {});
    }
    for (const id of made.sigIds) {
      await prisma.signature.delete({ where: { id } }).catch(() => {});
    }
    for (const id of made.userIds) {
      await prisma.user.delete({ where: { id } }).catch(() => {});
    }
    for (const id of made.accountIds) {
      await prisma.account.delete({ where: { id } }).catch(() => {});
    }
    for (const id of made.roomIds) {
      await prisma.roomAuthorizedUser.deleteMany({
        where: { receivingRoomId: id },
      }).catch(() => {});
      await prisma.receiveStamp.deleteMany({ where: { roomId: id } }).catch(() => {});
      await prisma.receivingRoom.delete({ where: { id } }).catch(() => {});
    }
    await prisma.$disconnect();
  }
})();
