/* PROOF: a signature sits ON the line, and its tail is allowed to hang below.
 *
 * The reported behaviour ("Current" in the attached doc): the signature file
 * was fitted into the placement box and centred, so the visible mark floated
 * near the TOP of the box and the long descending tail ran straight down
 * through the printed name underneath.
 *
 * The wanted behaviour ("My suggestion"): the writing line of the signature
 * lands on the bottom edge of the box at a size its owner chose, and only
 * the tail goes past it.
 *
 * Run: npx ts-node --transpile-only e2e_signature_placement.ts */
import { prisma } from "./src/barrel/prisma";
import {
  placeSignature,
  normalizeInk,
  FULL_INK,
} from "./src/service/signaturePlacement";
import { setSignaturePlacement } from "./src/controller/signatureController";

const TS = Date.now();

const mockRes = () => {
  const r: any = {
    _code: 0,
    _body: null as any,
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
  const near = (a: number, b: number, tol = 0.01) => Math.abs(a - b) <= tol;
  const made = { userIds: [] as string[], accountIds: [] as string[] };

  try {
    // A box someone dragged on the page: 200pt wide, 40pt tall, bottom at y=500.
    const box = { x: 100, y: 500, width: 200, height: 40 };
    // A signature file shaped like the real one: 900x520 px, the writing in
    // the upper-middle, a tail sweeping to the bottom-left. Ink from 6% to
    // 92% down, and the WRITING LINE sits 62% down the ink — everything
    // under that is tail.
    const IMG = { w: 900, h: 520 };
    const ink = { x0: 0.05, y0: 0.06, x1: 0.97, y1: 0.92 };

    // ── The old behaviour is still there when no size is chosen ─────────
    const old = placeSignature(box, IMG.w, IMG.h, {});
    ok("with no chosen size it still fits the box", old.sized === false);
    ok("…filling the width or the height, never overflowing",
      old.width <= box.width + 0.01 && old.height <= box.height + 0.01,
      `${old.width}x${old.height}`);
    ok("…and centred in the box",
      near(old.x + old.width / 2, box.x + box.width / 2) &&
      near(old.y + old.height / 2, box.y + box.height / 2));
    ok("…which is exactly the problem: it cannot reach past the box",
      old.y >= box.y - 0.01);

    // ── The wanted behaviour ────────────────────────────────────────────
    const r = placeSignature(box, IMG.w, IMG.h, {
      inkHeightPt: 24,
      baselinePct: 62,
      ink,
    });
    ok("a chosen size is reported as sized", r.sized === true);

    // The ink really comes out the height that was asked for.
    const inkH = (ink.y1 - ink.y0) * r.height;
    ok("the INK prints at the chosen height, not the box height",
      near(inkH, 24, 0.05), `${inkH.toFixed(2)}pt`);
    ok("…which is independent of the box", (() => {
      const taller = placeSignature(
        { ...box, height: 120 }, IMG.w, IMG.h,
        { inkHeightPt: 24, baselinePct: 62, ink });
      return near((ink.y1 - ink.y0) * taller.height, 24, 0.05);
    })());

    // The writing line lands on the bottom edge of the box.
    const lineFromTop = ink.y0 + 0.62 * (ink.y1 - ink.y0);
    const lineY = r.y + (1 - lineFromTop) * r.height;
    ok("the WRITING LINE lands on the bottom edge of the box",
      near(lineY, box.y, 0.05), `${lineY.toFixed(2)} vs ${box.y}`);

    // The tail hangs below; the body does not.
    const inkBottom = r.y + (1 - ink.y1) * r.height;
    const inkTop = r.y + (1 - ink.y0) * r.height;
    ok("the tail hangs BELOW the box", inkBottom < box.y - 0.5,
      `${inkBottom.toFixed(2)} vs ${box.y}`);
    ok("the body of the writing sits above the line", inkTop > box.y,
      `${inkTop.toFixed(2)}`);
    ok("…and the drop below the line is the rest of the ink",
      near(box.y - inkBottom, (1 - 0.62) * 24, 0.05),
      `${(box.y - inkBottom).toFixed(2)}`);

    // Horizontally the INK is centred, not the file's empty margins.
    const inkCx = r.x + (ink.x0 + (ink.x1 - ink.x0) / 2) * r.width;
    ok("the ink is centred across the box, not the file",
      near(inkCx, box.x + box.width / 2, 0.05), `${inkCx.toFixed(2)}`);

    // ── baselinePct 100 = nothing hangs below ───────────────────────────
    const flat = placeSignature(box, IMG.w, IMG.h, {
      inkHeightPt: 24, baselinePct: 100, ink,
    });
    const flatBottom = flat.y + (1 - ink.y1) * flat.height;
    ok("a writing line at 100 puts the whole mark above the line",
      near(flatBottom, box.y, 0.05), `${flatBottom.toFixed(2)}`);

    // ── Nonsense measurements fall back to the whole file ───────────────
    ok("an inverted ink box is refused", normalizeInk({ x0: 0.9, y0: 0.9, x1: 0.1, y1: 0.1 }) === FULL_INK);
    ok("a hairline ink box is refused", normalizeInk({ x0: 0, y0: 0.5, x1: 1, y1: 0.502 }) === FULL_INK);
    ok("a missing ink box is the whole file", normalizeInk(null) === FULL_INK);
    ok("out-of-range values are clamped, not trusted", (() => {
      const n = normalizeInk({ x0: -3, y0: 0.1, x1: 9, y1: 0.9 });
      return n.x0 === 0 && n.x1 === 1;
    })());
    ok("a zero height still means fit-to-box",
      placeSignature(box, IMG.w, IMG.h, { inkHeightPt: 0, ink }).sized === false);

    // ── The endpoint stores it, scoped to the owner ─────────────────────
    const line = await prisma.line.findFirst({ select: { id: true } });
    if (!line) { console.log("NO FIXTURE (line)"); process.exit(2); }
    const mk = async (tag: string) => {
      const acct = await prisma.account.create({
        data: { username: `qa_sig_${TS}_${tag}`, password: "x", lineId: line.id },
        select: { id: true, username: true },
      });
      made.accountIds.push(acct.id);
      const u = await prisma.user.create({
        data: {
          firstName: "Qa", lastName: `SIG${TS}${tag.toUpperCase()}`,
          username: acct.username, accountId: acct.id, lineId: line.id,
          email: `qa-sig-${TS}-${tag}@test.local`,
        },
        select: { id: true },
      });
      made.userIds.push(u.id);
      return { accountId: acct.id, userId: u.id };
    };
    const A = await mk("a");
    const B = await mk("b");

    const sigA = await prisma.signature.create({
      data: { userId: A.userId, title: `QA sig ${TS}`, signature: Buffer.from([0x89, 0x50]) },
      select: { id: true, baselinePct: true, inkHeightPt: true },
    });
    ok("a fresh signature starts unsized", sigA.inkHeightPt === null);
    ok("…with the writing line at the bottom of the ink", sigA.baselinePct === 100);

    let res = mockRes();
    await setSignaturePlacement(
      { user: { id: A.accountId }, body: { id: sigA.id, inkHeightPt: 24, baselinePct: 62, ink } } as any,
      res,
    );
    ok("the owner can set the size", res._body?.signature?.inkHeightPt === 24);
    ok("…and the writing line", res._body?.signature?.baselinePct === 62);
    ok("…and the ink box", res._body?.signature?.inkX1 === ink.x1);

    res = mockRes();
    await setSignaturePlacement(
      { user: { id: A.accountId }, body: { id: sigA.id, inkHeightPt: 9999, baselinePct: 500 } } as any,
      res,
    );
    ok("an absurd height is clamped, not stored", res._body?.signature?.inkHeightPt === 288,
      String(res._body?.signature?.inkHeightPt));
    ok("a writing line past 100 is clamped", res._body?.signature?.baselinePct === 100);

    res = mockRes();
    await setSignaturePlacement(
      { user: { id: A.accountId }, body: { id: sigA.id, inkHeightPt: null } } as any, res);
    ok("clearing the height goes back to fit-to-box",
      res._body?.signature?.inkHeightPt === null);

    let msg = "";
    try {
      await setSignaturePlacement(
        { user: { id: B.accountId }, body: { id: sigA.id, inkHeightPt: 30 } } as any, mockRes());
    } catch (e: any) { msg = e?.message ?? "err"; }
    ok("somebody else cannot resize your signature", /not found/i.test(msg), msg);
    const untouched = await prisma.signature.findUnique({
      where: { id: sigA.id }, select: { inkHeightPt: true },
    });
    ok("…and nothing was written", untouched?.inkHeightPt === null);
  } catch (e: any) {
    fail++;
    console.log("FAIL  threw: " + (e?.stack ?? e?.message ?? String(e)));
  } finally {
    try {
      if (made.userIds.length) {
        await prisma.signature.deleteMany({ where: { userId: { in: made.userIds } } });
        await prisma.user.deleteMany({ where: { id: { in: made.userIds } } });
      }
      if (made.accountIds.length)
        await prisma.account.deleteMany({ where: { id: { in: made.accountIds } } });
      const left = await prisma.user.count({
        where: { username: { startsWith: `qa_sig_${TS}_` } },
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
