/**
 * Verifies GET /user/my-verify-qr: returns the ID-card verify URL for the
 * logged-in employee, generating + persisting User.verifyCode on first use,
 * and returning the SAME code on repeat calls (permanent → mobile can cache).
 *
 * Run:  npx ts-node scripts/verify_qr_itest.ts   (API must be running)
 */
import "dotenv/config";
import { createSigner } from "fast-jwt";
import { prisma } from "../src/barrel/prisma";

const BASE = "http://localhost:3000";

function ok(label: string, cond: boolean, extra?: unknown) {
  console.log((cond ? "  PASS  " : "  FAIL  ") + label + (extra !== undefined ? "  " + JSON.stringify(extra) : ""));
  if (!cond) throw new Error("FAILED: " + label);
}

async function main() {
  const candidates = await prisma.account.findMany({
    where: { User: { isNot: null } },
    select: { id: true, User: { select: { id: true, verifyCode: true } } },
  });
  const account = candidates.find((a) => a.User?.id);
  if (!account?.User?.id) throw new Error("Need an account with a linked User.");
  const token = createSigner({ key: process.env.JWT_SECRET as string })({ id: account.id });
  const H = { Authorization: "Bearer " + token };
  const hadCode = account.User.verifyCode;

  try {
    let r = await fetch(BASE + "/user/my-verify-qr", { headers: H });
    let j: any = await r.json();
    ok("returns 200 with code + url", r.status === 200 && !!j.code && !!j.url, j);
    ok("url is the ID-card verify format", /\/verify-id\?code=/.test(j.url), j.url);
    const first = j.code;

    const dbUser = await prisma.user.findUnique({
      where: { id: account.User!.id },
      select: { verifyCode: true },
    });
    ok("verifyCode persisted on the User", dbUser?.verifyCode === first);
    if (hadCode) ok("existing code reused (matches ID card)", first === hadCode);

    r = await fetch(BASE + "/user/my-verify-qr", { headers: H });
    j = await r.json();
    ok("repeat call returns the SAME code (permanent → cacheable)", j.code === first);

    r = await fetch(BASE + "/user/my-verify-qr");
    ok("unauthenticated → 401", r.status === 401, r.status);

    console.log("\nVERIFY QR ITEST OK");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(async (e) => { console.error(e); process.exitCode = 1; await prisma.$disconnect(); });
