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
  saveReceiveStamp,
  uploadReceiveStampImage,
  renderReceiveStamp,
  STAMP_W_MM,
  STAMP_H_MM,
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
const fileReq = (accountId: string, buf: Buffer, mimetype = "image/png") => ({
  user: { id: accountId },
  isMultipart: () => true,
  parts: async function* () {
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

  const made = { userIds: [] as string[], accountIds: [] as string[], sigIds: [] as string[] };

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

    // ══ 1. Nothing set up yet ══════════════════════════════════════════
    console.log("\n-- before anything is uploaded --");
    const empty = await call(myReceiveStamp, { user: { id: ME.accountId } });
    ok("the endpoint answers", empty.ok, empty.message);
    ok("...with no stamp", empty.body?.stamp === null);
    ok("...and no signature on file", empty.body?.signature === null);
    ok("...and states the physical size the artwork must be",
      empty.body?.stampSize?.widthMm === STAMP_W_MM &&
        empty.body?.stampSize?.heightMm === STAMP_H_MM,
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
    const notPng = await call(uploadReceiveStampImage, fileReq(ME.accountId, jpegish, "image/jpeg"));
    ok("a JPEG is refused", !notPng.ok, notPng.message);
    ok("...because it cannot be transparent",
      /transparent|white box/i.test(notPng.message), notPng.message);

    const square = await call(uploadReceiveStampImage, fileReq(ME.accountId, makePng(300, 300)));
    ok("a square image is refused", !square.ok, square.message);
    ok("...naming the size it should be",
      /58mm/.test(square.message) && /30mm/.test(square.message), square.message);

    // 58 x 30 -> 1.93:1. 580 x 300 is exactly that.
    const good = await call(uploadReceiveStampImage, fileReq(ME.accountId, makePng(580, 300)));
    ok("artwork of the right shape is accepted", good.ok, good.message);
    ok("...and its real pixel size is recorded",
      good.body?.stamp?.imageW === 580 && good.body?.stamp?.imageH === 300,
      JSON.stringify([good.body?.stamp?.imageW, good.body?.stamp?.imageH]));

    // ══ 3. Placements ══════════════════════════════════════════════════
    console.log("\n-- where things sit --");
    const saved = await call(saveReceiveStamp, {
      user: { id: ME.accountId },
      body: {
        nickname: "JUDE",
        sigX: 5000, sigY: 6000, sigW: 4000, sigH: 3000,
        nameX: 2000, nameY: 8500, nameSizePt: 8,
        dateX: 2000, dateY: 6800, dateSizePt: 8,
      },
    });
    ok("placements save", saved.ok, saved.message);
    ok("...and come back exactly as given",
      saved.body?.stamp?.sigX === 5000 && saved.body?.stamp?.nickname === "JUDE",
      JSON.stringify(saved.body?.stamp));

    const tiny = await call(saveReceiveStamp, {
      user: { id: ME.accountId },
      body: { sigW: 10, sigH: 10 },
    });
    ok("a signature area with no room in it is refused", !tiny.ok, tiny.message);

    const huge = await call(saveReceiveStamp, {
      user: { id: ME.accountId },
      body: { nameSizePt: 400, dateSizePt: 0.1, sigX: 99999 },
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
        nickname: "JUDE",
        sigX: 5000, sigY: 6000, sigW: 4000, sigH: 3000,
        nameX: 2000, nameY: 8500, nameSizePt: 8,
        dateX: 2000, dateY: 6800, dateSizePt: 8,
      },
    });

    // ══ 4. The render ══════════════════════════════════════════════════
    console.log("\n-- composing the finished stamp --");
    const noSig = await renderReceiveStamp(ME.userId, new Date("2026-09-25T02:00:00Z"), 600);
    ok("it renders without a signature on file", Buffer.isBuffer(noSig) && noSig.length > 0);
    ok("...as a PNG",
      noSig.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])));
    const w1 = noSig.readUInt32BE(16), h1 = noSig.readUInt32BE(20);
    ok("...at the width asked for", Math.abs(w1 - 600) <= 2, String(w1));
    ok("...and the stamp's own proportions, not the page's",
      Math.abs(w1 / h1 - STAMP_W_MM / STAMP_H_MM) < 0.05,
      `${w1}x${h1} = ${(w1 / h1).toFixed(2)}:1`);

    const sg = await prisma.signature.create({
      data: {
        title: `qa-rs-${TS}`, userId: ME.userId, active: true,
        signature: makePng(240, 120),
      },
      select: { id: true },
    });
    made.sigIds.push(sg.id);

    const withSig = await renderReceiveStamp(ME.userId, new Date("2026-09-25T02:00:00Z"), 600);
    ok("it renders with the signature", withSig.length > 0);
    ok("...and the result differs from the unsigned one — ink landed",
      !withSig.equals(noSig),
      `${noSig.length} vs ${withSig.length} bytes`);

    const now = await call(myReceiveStamp, { user: { id: ME.accountId } });
    ok("the setup screen now sees a signature on file",
      now.body?.signature?.hasImage === true, JSON.stringify(now.body?.signature));
    ok("...and knows the artwork is uploaded",
      now.body?.stamp?.hasImage === true);
    ok("...without shipping the bytes to a screen that only draws a box",
      now.body?.stamp?.image === undefined);

    console.log(`\n${pass} passed, ${fail} failed`);
    process.exitCode = fail === 0 ? 0 : 1;
  } catch (e) {
    console.error("THREW", e);
    process.exitCode = 1;
  } finally {
    for (const id of made.userIds) {
      await prisma.receiveStamp.deleteMany({ where: { userId: id } }).catch(() => {});
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
    await prisma.$disconnect();
  }
})();
