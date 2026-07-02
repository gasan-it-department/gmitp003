/**
 * Proves the desktop login path: create a throwaway account, POST /auth with
 * its credentials, confirm a token comes back in the web's shape, confirm that
 * token is accepted by /sync/ping, then delete the account.
 *
 * Run:  npx ts-node scripts/login_itest.ts
 */
import "dotenv/config";
import * as argon from "argon2";
import { prisma } from "../src/barrel/prisma";

const BASE = "http://localhost:3000";

function ok(label: string, cond: boolean, extra?: unknown) {
  console.log((cond ? "  PASS  " : "  FAIL  ") + label + (extra !== undefined ? "  " + JSON.stringify(extra) : ""));
  if (!cond) throw new Error("FAILED: " + label);
}

async function main() {
  const line = await prisma.line.findFirst({ select: { id: true } });
  const username = "itest_" + Date.now();
  const password = "Test#12345";
  const hashed = await argon.hash(password);

  const acct = await prisma.account.create({
    data: { username, password: hashed, lineId: line?.id ?? null, role: "user", active: true, status: 1 },
    select: { id: true },
  });
  console.log("created account", acct.id, "line", line?.id);

  try {
    // 1) login
    let r = await fetch(BASE + "/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    const j = await r.json();
    const token = j?.data?.token as string | undefined;
    ok("login returns a token", !!token, { error: j?.error, message: j?.message });
    ok("login returns line id", j?.data?.line === (line?.id ?? null), j?.data?.line);

    // 2) wrong password is rejected with an error code
    r = await fetch(BASE + "/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password: "wrong" }),
    });
    const j2 = await r.json();
    ok("wrong password rejected", j2?.error === 2 && !j2?.data?.token, j2?.message);

    // 3) the login token is accepted by the authenticated sync endpoint
    r = await fetch(BASE + "/sync/ping", { headers: { Authorization: "Bearer " + token } });
    const j3 = await r.json();
    ok("login token works on /sync/ping", r.status === 200 && j3.ok === true);

    console.log("\nLOGIN ITEST OK");
  } finally {
    await prisma.account.delete({ where: { id: acct.id } });
    console.log("cleaned up account");
    await prisma.$disconnect();
  }
}

main().catch(async (e) => { console.error(e); process.exitCode = 1; await prisma.$disconnect(); });
