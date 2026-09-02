/* PROOF: user A can no longer touch user B's e-signature.
 *
 * The bug: every signature endpoint took the owner's `userId` from the REQUEST
 * instead of the token, so any authenticated user could name someone else's id
 * and read, activate, delete or QR-toggle their signature — and `list` returns
 * the signature IMAGE as a data URL, so this leaked the Mayor's actual
 * signature to anyone with a login. `signMine` had the same flaw, which meant
 * signing a document AS another person.
 *
 * Run: npx ts-node --transpile-only e2e_signature_idor.ts */
import { prisma } from "./src/barrel/prisma";
import {
  listUserSignatures,
  activateUserSignature,
  deleteUserSignature,
  setSignatureQr,
} from "./src/controller/signatureController";

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
/** A request as a given ACCOUNT, carrying whatever the client claims. */
const reqAs = (accountId: string, extra: any = {}) =>
  ({ user: { id: accountId }, ...extra }) as any;

(async () => {
  let pass = 0, fail = 0;
  const ok = (l: string, c: boolean, d = "") => {
    if (c) { pass++; console.log("PASS  " + l); }
    else { fail++; console.log("FAIL  " + l + (d ? "  → " + d : "")); }
  };
  const made = { accountIds: [] as string[], userIds: [] as string[], sigIds: [] as string[] };

  try {
    const line = await prisma.line.findFirst({ select: { id: true } });
    if (!line) { console.log("NO FIXTURE (line)"); process.exit(2); }

    const mkUser = async (tag: string) => {
      const acct = await prisma.account.create({
        data: { username: `qa_idor_${TS}_${tag}`, password: "x", lineId: line.id },
        select: { id: true, username: true },
      });
      made.accountIds.push(acct.id);
      const u = await prisma.user.create({
        data: {
          firstName: "Qa", lastName: tag.toUpperCase(), username: acct.username,
          accountId: acct.id, lineId: line.id,
          email: `qa-idor-${TS}-${tag}@test.local`,
        },
        select: { id: true },
      });
      made.userIds.push(u.id);
      return { accountId: acct.id, userId: u.id };
    };

    const A = await mkUser("attacker");
    const B = await mkUser("victim");

    // B owns a signature with recognisable image bytes.
    const SECRET_IMAGE = Buffer.from("\x89PNG\r\n\x1a\nVICTIM-SIGNATURE-PIXELS");
    const bSig = await prisma.signature.create({
      data: {
        title: "Victim official signature",
        userId: B.userId,
        active: true,
        signature: SECRET_IMAGE,
      },
      select: { id: true },
    });
    made.sigIds.push(bSig.id);

    // A owns one too, so we can prove A still works normally.
    const aSig = await prisma.signature.create({
      data: {
        title: "Attacker own signature",
        userId: A.userId,
        active: true,
        signature: Buffer.from("\x89PNG\r\n\x1a\nATTACKER-PIXELS"),
      },
      select: { id: true },
    });
    made.sigIds.push(aSig.id);

    // ── 1. LIST: A asks for B's signatures by id ────────────────────────
    let res = mockRes();
    await listUserSignatures(reqAs(A.accountId, { query: { id: B.userId } }), res);
    const listed = res._body?.list ?? [];
    ok("list ignores the client-supplied userId", res._code === 200);
    ok("A does NOT receive B's signature",
      !listed.some((r: any) => r.id === bSig.id),
      JSON.stringify(listed.map((r: any) => r.title)));
    ok("A receives only their OWN signature",
      listed.length === 1 && listed[0].id === aSig.id,
      JSON.stringify(listed.map((r: any) => r.title)));
    const leaked = JSON.stringify(listed).includes(
      SECRET_IMAGE.toString("base64").slice(0, 24),
    );
    ok("B's signature IMAGE is not leaked in the payload", !leaked);

    // ── 2. ACTIVATE: A tries to flip B's signature ──────────────────────
    let threw = "";
    try {
      await activateUserSignature(
        reqAs(A.accountId, { body: { id: bSig.id, userId: B.userId } }),
        mockRes(),
      );
    } catch (e: any) { threw = e?.message ?? "err"; }
    ok("A cannot activate B's signature", !!threw, threw || "NO THROW");

    // ── 3. QR TOGGLE: A tries to change B's signature settings ──────────
    threw = "";
    try {
      await setSignatureQr(
        reqAs(A.accountId, { body: { id: bSig.id, userId: B.userId, qrEnabled: true } }),
        mockRes(),
      );
    } catch (e: any) { threw = e?.message ?? "err"; }
    ok("A cannot toggle QR on B's signature", !!threw, threw || "NO THROW");
    const qrCheck = await prisma.signature.findUnique({
      where: { id: bSig.id }, select: { qrEnabled: true },
    });
    ok("B's qrEnabled is unchanged", qrCheck?.qrEnabled === false);

    // ── 4. DELETE: the destructive one ──────────────────────────────────
    threw = "";
    try {
      await deleteUserSignature(
        reqAs(A.accountId, { query: { id: bSig.id, userId: B.userId } }),
        mockRes(),
      );
    } catch (e: any) { threw = e?.message ?? "err"; }
    ok("A cannot DELETE B's signature", !!threw, threw || "NO THROW");
    const still = await prisma.signature.findUnique({ where: { id: bSig.id } });
    ok("B's signature still exists", !!still);
    ok("B's signature bytes are intact",
      !!still?.signature &&
        Buffer.from(still.signature).equals(SECRET_IMAGE));

    // ── 5. The owner can still do all of it ─────────────────────────────
    res = mockRes();
    await listUserSignatures(reqAs(B.accountId, { query: {} }), res);
    ok("B CAN list their own signature",
      (res._body?.list ?? []).some((r: any) => r.id === bSig.id));

    res = mockRes();
    await setSignatureQr(
      reqAs(B.accountId, { body: { id: bSig.id, qrEnabled: true } }),
      res,
    );
    const afterOwn = await prisma.signature.findUnique({
      where: { id: bSig.id }, select: { qrEnabled: true },
    });
    ok("B CAN toggle QR on their own signature", afterOwn?.qrEnabled === true);

    // ── 6. Unauthenticated is refused ───────────────────────────────────
    threw = "";
    try {
      await listUserSignatures({ query: { id: B.userId } } as any, mockRes());
    } catch (e: any) { threw = e?.message ?? "err"; }
    ok("an unauthenticated caller is refused", !!threw, threw || "NO THROW");
  } catch (e: any) {
    fail++;
    console.log("FAIL  threw: " + (e?.stack ?? e?.message ?? String(e)));
  } finally {
    try {
      if (made.userIds.length) {
        await prisma.signature.deleteMany({ where: { userId: { in: made.userIds } } });
        await prisma.signingKey.deleteMany({ where: { userId: { in: made.userIds } } });
        await prisma.user.deleteMany({ where: { id: { in: made.userIds } } });
      }
      if (made.accountIds.length)
        await prisma.account.deleteMany({ where: { id: { in: made.accountIds } } });
      const left = await prisma.user.count({
        where: { username: { startsWith: `qa_idor_${TS}_` } },
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
