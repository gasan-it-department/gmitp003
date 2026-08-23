/* PROOF: /user/my-verify-qr hands back the CALLER's own QR, and the PNG the
 * web downloads actually decodes to that person's verify link.
 *
 * The web profile shows an image it did not draw, so "it renders" proves
 * nothing on its own — a QR that encodes the wrong URL still looks like a
 * QR. This decodes the pixels back to text and compares.
 *
 * jsqr lives in the web repo, not this one; it is pulled in by path because
 * this file is a local check and never ships (tsconfig excludes e2e_*).
 *
 * Run: npx ts-node --transpile-only e2e_my_verify_qr.ts */
import { PNG } from "pngjs";
import { prisma } from "./src/barrel/prisma";
import { myVerifyQr } from "./src/controller/idCardController";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const jsQRmod = require("C:/Users/vincent/Desktop/gasan_municipal_project/gmitp003-v2/node_modules/jsqr");
const jsQR = jsQRmod.default ?? jsQRmod;

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

/** data:image/png;base64,… → the text the QR encodes. */
const decodeQrDataUrl = (dataUrl: string): string | null => {
  const b64 = dataUrl.split(",")[1] ?? "";
  const png = PNG.sync.read(Buffer.from(b64, "base64"));
  const out = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);
  return out?.data ?? null;
};

(async () => {
  let pass = 0, fail = 0;
  const ok = (l: string, c: boolean, d = "") => {
    if (c) { pass++; console.log("PASS  " + l); }
    else { fail++; console.log("FAIL  " + l + (d ? "  -> " + d : "")); }
  };
  const made = { userIds: [] as string[], accountIds: [] as string[] };

  try {
    const line = await prisma.line.findFirst({ select: { id: true } });
    if (!line) { console.log("NO FIXTURE (line)"); process.exit(2); }

    const mk = async (tag: string) => {
      const acct = await prisma.account.create({
        data: { username: `qa_qr_${TS}_${tag}`, password: "x", lineId: line.id },
        select: { id: true, username: true },
      });
      made.accountIds.push(acct.id);
      const u = await prisma.user.create({
        data: {
          firstName: "Qa", lastName: `QR${TS}${tag.toUpperCase()}`,
          username: acct.username, accountId: acct.id, lineId: line.id,
          email: `qa-qr-${TS}-${tag}@test.local`,
          // deliberately NO verifyCode — the endpoint must mint one
        },
        select: { id: true, verifyCode: true },
      });
      made.userIds.push(u.id);
      return { accountId: acct.id, userId: u.id, hadCode: u.verifyCode };
    };

    const A = await mk("a");
    const B = await mk("b");
    ok("the fixture starts with no verifyCode", !A.hadCode);

    // ── Default shape: URL only, no image ───────────────────────────────
    let res = mockRes();
    await myVerifyQr({ user: { id: A.accountId }, query: {} } as any, res);
    const plain = res._body;
    ok("returns a code", typeof plain?.code === "string" && plain.code.length > 0);
    ok("returns the verify url", /\/verify-id\?code=/.test(plain?.url ?? ""),
      String(plain?.url));
    ok("does NOT ship the PNG unless asked", plain?.qr === undefined,
      plain?.qr ? `${String(plain.qr).length} chars` : "");

    // ── The code is persisted, not regenerated per call ─────────────────
    const stored = await prisma.user.findUnique({
      where: { id: A.userId }, select: { verifyCode: true },
    });
    ok("the minted code is saved on the user", stored?.verifyCode === plain.code,
      `${stored?.verifyCode} vs ${plain.code}`);

    res = mockRes();
    await myVerifyQr({ user: { id: A.accountId }, query: {} } as any, res);
    ok("a second call returns the SAME code", res._body?.code === plain.code);

    // ── png=1: the web's request ────────────────────────────────────────
    res = mockRes();
    await myVerifyQr({ user: { id: A.accountId }, query: { png: "1" } } as any, res);
    const withPng = res._body;
    ok("png=1 returns a PNG data URL",
      typeof withPng?.qr === "string" && withPng.qr.startsWith("data:image/png;base64,"),
      String(withPng?.qr).slice(0, 40));
    ok("the url is unchanged by asking for the image", withPng?.url === plain.url);

    // ── The pixels ──────────────────────────────────────────────────────
    const decoded = decodeQrDataUrl(withPng.qr);
    ok("the PNG decodes back to a QR at all", !!decoded, String(decoded));
    ok("…and it encodes THIS user's verify url", decoded === withPng.url,
      `${decoded} vs ${withPng.url}`);
    ok("…which carries A's code, not B's", (decoded ?? "").includes(plain.code));

    const png = PNG.sync.read(Buffer.from(withPng.qr.split(",")[1], "base64"));
    ok("the image is big enough to print", png.width >= 512 && png.height >= 512,
      `${png.width}x${png.height}`);

    // ── Self-scoping: B's call gives B, never A ─────────────────────────
    res = mockRes();
    await myVerifyQr({ user: { id: B.accountId }, query: { png: "1" } } as any, res);
    const bBody = res._body;
    ok("B gets a different code", bBody?.code && bBody.code !== plain.code);
    const bDecoded = decodeQrDataUrl(bBody.qr);
    ok("B's PNG encodes B's url", bDecoded === bBody.url, String(bDecoded));
    ok("B's QR does not contain A's code", !(bDecoded ?? "").includes(plain.code));

    // ── No session, no QR ───────────────────────────────────────────────
    res = mockRes();
    await myVerifyQr({ query: { png: "1" } } as any, res);
    ok("an unauthenticated call is refused", res._code === 401, String(res._code));
    ok("…and leaks nothing", !res._body?.qr && !res._body?.code);

    // ── png=true is accepted too (the truthy-string form) ───────────────
    res = mockRes();
    await myVerifyQr({ user: { id: A.accountId }, query: { png: "true" } } as any, res);
    ok("png=true also returns the image", typeof res._body?.qr === "string");

    // ── An unrelated query value must not switch the image on ───────────
    res = mockRes();
    await myVerifyQr({ user: { id: A.accountId }, query: { png: "0" } } as any, res);
    ok("png=0 stays off", res._body?.qr === undefined);
  } catch (e: any) {
    fail++;
    console.log("FAIL  threw: " + (e?.stack ?? e?.message ?? String(e)));
  } finally {
    try {
      if (made.userIds.length)
        await prisma.user.deleteMany({ where: { id: { in: made.userIds } } });
      if (made.accountIds.length)
        await prisma.account.deleteMany({ where: { id: { in: made.accountIds } } });
      const left = await prisma.user.count({
        where: { username: { startsWith: `qa_qr_${TS}_` } },
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
