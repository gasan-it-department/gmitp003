/* Sessions expire, and the immortal ones are refused.
 *
 *   npx ts-node --transpile-only e2e_token_expiry.ts
 *
 * Tokens used to be minted with no `exp` claim, so a stolen one was valid
 * for ever and nothing could take it back. Three things have to hold now,
 * and only the first is obvious:
 *
 *   1. a newly minted token carries an exp,
 *   2. a token WITHOUT one is refused — those are the tokens already in
 *      circulation, and they are the ones worth stealing,
 *   3. ALLOW_LEGACY_TOKENS=1 still lets them through, because deploying
 *      this signs everybody out and a rollout may need a grace period.
 *
 * The old token is produced the honest way: a second Fastify registered
 * exactly as the API was BEFORE this change, signing with the same secret.
 * That is a real legacy token, not a hand-rolled imitation of one.
 *
 * It also proves the @fastify/jwt v9 -> v10 upgrade did not break signing
 * or verification, which is the whole reason that upgrade is risky.
 */
import path from "path";
const entry = path.join(process.cwd(), "src", "index.ts");
require.cache[entry] = {
  id: entry,
  filename: entry,
  loaded: true,
  exports: { notificationSocket: { emitUserNotification: () => undefined } },
} as never;

import Fastify from "fastify";
import jwt from "@fastify/jwt";
import { prisma } from "./src/barrel/prisma";
import { authenticated } from "./src/middleware/handler";

let pass = 0;
const fails: string[] = [];
const ok = (name: string, cond: boolean, detail = "") => {
  if (cond) { pass++; console.log(`  ok    ${name}`); }
  else { fails.push(name); console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`); }
};

const SECRET = process.env.JWT_SECRET || "test-secret-for-e2e-only";
const TAG = "__e2e_tok__";
const made = { accountIds: [] as string[], userIds: [] as string[] };

/** The API as it is now: every token gets an expiry. */
const buildCurrent = async () => {
  const app = Fastify();
  await app.register(jwt, { secret: SECRET, sign: { expiresIn: "30d" } });
  app.get("/guarded", { preHandler: authenticated }, async () => ({ ok: true }));
  await app.ready();
  return app;
};

/** The API as it WAS: no sign options, so no exp claim. */
const buildLegacy = async () => {
  const app = Fastify();
  await app.register(jwt, { secret: SECRET });
  await app.ready();
  return app;
};

(async () => {
  let current: Awaited<ReturnType<typeof buildCurrent>> | null = null;
  let legacy: Awaited<ReturnType<typeof buildLegacy>> | null = null;
  const hadFlag = process.env.ALLOW_LEGACY_TOKENS;
  try {
    const line = await prisma.line.findFirst({
      where: { status: 1 },
      select: { id: true },
    });
    if (!line) { console.log("no active line in this database"); process.exit(1); }

    const account = await prisma.account.create({
      data: {
        username: `${TAG}${Date.now()}`,
        password: "x",
        lineId: line.id,
        status: 1,
        User: {
          create: {
            firstName: TAG, lastName: "tok", lineId: line.id,
            username: `${TAG}u${Date.now()}`, email: `${TAG}@example.invalid`,
          },
        },
      },
      select: { id: true, User: { select: { id: true } } },
    });
    made.accountIds.push(account.id);
    if (account.User) made.userIds.push(account.User.id);

    current = await buildCurrent();
    legacy = await buildLegacy();

    // ── the claim itself ───────────────────────────────────────────────
    console.log("");
    console.log("-- what the two mints produce --");
    const newTok = current.jwt.sign({ id: account.id, username: TAG });
    const oldTok = legacy.jwt.sign({ id: account.id, username: TAG });

    const claims = (t: string) =>
      JSON.parse(Buffer.from(t.split(".")[1], "base64").toString()) as {
        exp?: number; iat?: number;
      };

    const nc = claims(newTok);
    const oc = claims(oldTok);
    ok("a new token carries an exp", typeof nc.exp === "number", JSON.stringify(nc));
    ok("a legacy token carries none", oc.exp === undefined, JSON.stringify(oc));

    const days = nc.exp && nc.iat ? (nc.exp - nc.iat) / 86400 : 0;
    ok("and it is the 30 days the desktop clients need",
      Math.round(days) === 30, `${days} days`);

    // ── what the gate does with each ───────────────────────────────────
    console.log("");
    console.log("-- the gate --");
    delete process.env.ALLOW_LEGACY_TOKENS;

    const call = (t: string) =>
      current!.inject({
        method: "GET", url: "/guarded",
        headers: { authorization: `Bearer ${t}` },
      });

    const good = await call(newTok);
    ok("an expiring token is accepted", good.statusCode === 200,
      `${good.statusCode} ${good.body.slice(0, 90)}`);

    const immortal = await call(oldTok);
    ok("a NON-EXPIRING token is refused", immortal.statusCode === 401,
      `${immortal.statusCode} ${immortal.body.slice(0, 90)}`);

    const none = await current.inject({ method: "GET", url: "/guarded" });
    ok("no token at all is refused", none.statusCode === 401);

    const junk = await call("not.a.token");
    ok("a forged token is refused", junk.statusCode === 401);

    // ── the rollout escape hatch ───────────────────────────────────────
    console.log("");
    console.log("-- ALLOW_LEGACY_TOKENS, for a staged rollout --");
    process.env.ALLOW_LEGACY_TOKENS = "1";
    const reprieved = await call(oldTok);
    ok("the flag lets legacy tokens through", reprieved.statusCode === 200,
      `${reprieved.statusCode} ${reprieved.body.slice(0, 90)}`);
    delete process.env.ALLOW_LEGACY_TOKENS;
    const refusedAgain = await call(oldTok);
    ok("and unsetting it closes the door again", refusedAgain.statusCode === 401);

    // ── an expired token is not merely old, it is rejected ─────────────
    console.log("");
    console.log("-- expiry is enforced, not decorative --");
    const expired = current.jwt.sign(
      { id: account.id, username: TAG },
      { expiresIn: "1ms" },
    );
    await new Promise((r) => setTimeout(r, 30));
    const dead = await call(expired);
    ok("an expired token is refused", dead.statusCode === 401,
      `${dead.statusCode} ${dead.body.slice(0, 90)}`);
  } finally {
    if (hadFlag === undefined) delete process.env.ALLOW_LEGACY_TOKENS;
    else process.env.ALLOW_LEGACY_TOKENS = hadFlag;
    if (made.userIds.length)
      await prisma.user.deleteMany({ where: { id: { in: made.userIds } } });
    if (made.accountIds.length)
      await prisma.account.deleteMany({ where: { id: { in: made.accountIds } } });
    console.log(`\n(removed ${made.accountIds.length} test account(s))`);
    await current?.close();
    await legacy?.close();
    await prisma.$disconnect();
  }

  console.log(`\n${pass} passed, ${fails.length} failed`);
  process.exit(fails.length ? 1 : 0);
})();
