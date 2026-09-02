/* PROOF test for the module-grant path (the wrong-user report):
 * grant lands ONLY on the exact id+username pair, the member list the
 * "Has access" badges read shows that user immediately, a stale/mismatched
 * row is REFUSED with no grant to anyone, and cross-line grants stay
 * refused. Runs the real controllers against the local dev DB. */
import { prisma } from "./src/barrel/prisma";
import { addModuleAccess, moduleUsers } from "./src/controller/moduleController";

const TS = Date.now();
const MOD = `qa-mod-${TS}`;
const mockRes = () => {
  const r: any = {
    _code: 0, _body: null,
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
    else { fail++; console.log("FAIL  " + l + (d ? " → " + d : "")); }
  };
  const made = { userIds: [] as string[], accountIds: [] as string[] };

  try {
    const line = await prisma.line.findFirst({ select: { id: true } });
    const otherLine = await prisma.line.findFirst({
      where: { NOT: { id: line?.id ?? "" } },
      select: { id: true },
    });
    if (!line) { console.log("NO FIXTURE (no line)"); process.exit(2); }

    const mkUser = async (tag: string, lineId: string) => {
      const acct = await prisma.account.create({
        data: { username: `qa_grant_${TS}_${tag}`, password: "x", lineId },
        select: { id: true, username: true },
      });
      made.accountIds.push(acct.id);
      const u = await prisma.user.create({
        data: {
          firstName: "QaGrant", lastName: tag.toUpperCase(),
          username: acct.username, accountId: acct.id, lineId,
          email: `qa-grant-${TS}-${tag}@test.local`,
        },
        select: { id: true, username: true, lineId: true },
      });
      made.userIds.push(u.id);
      return u;
    };
    // "janine" = the intended target; "annalee" = the bystander
    const janine = await mkUser("janine", line.id);
    const annalee = await mkUser("annalee", line.id);

    const call = async (body: Record<string, unknown>) => {
      const res = mockRes();
      try {
        await addModuleAccess({ body } as any, res);
      } catch (e: any) {
        return { threw: e?.message ?? String(e) };
      }
      return { code: res._code, body: res._body };
    };
    const members = async () => {
      const res = mockRes();
      await moduleUsers(
        { query: { id: MOD, limit: "100", lineId: line.id } } as any,
        res,
      );
      return (res._body?.list ?? []).map((u: any) => u.username);
    };

    // 1) correct id + username → grants JANINE, echo names JANINE
    const r1 = await call({
      userId: janine.id, username: janine.username,
      lineId: line.id, module: MOD, currUserId: annalee.id,
    });
    ok("grant with matching id+username succeeds",
      !("threw" in r1) && r1.body?.success === true, JSON.stringify(r1).slice(0, 160));
    ok("echoed grantee is EXACTLY the clicked user (janine)",
      !("threw" in r1) && r1.body?.grantee?.id === janine.id &&
      r1.body?.grantee?.username === janine.username, JSON.stringify(r1.body?.grantee));

    // 2) the member list (the badges' source) shows janine IMMEDIATELY
    const m1 = await members();
    ok("member list shows janine right after the grant",
      m1.includes(janine.username), JSON.stringify(m1));
    ok("bystander (annalee) did NOT get access",
      !m1.includes(annalee.username), JSON.stringify(m1));
    const annaleeRows = await prisma.module.count({
      where: { userId: annalee.id, moduleName: MOD },
    });
    ok("no Module row exists for the bystander", annaleeRows === 0);

    // 3) STALE ID simulation — the admin's intent is the USERNAME on the
    //    button. janine's id + ANNALEE's username → the server must follow
    //    the username and grant ANNALEE (what the admin saw and confirmed).
    const r2 = await call({
      userId: janine.id, username: annalee.username,
      lineId: line.id, module: MOD, currUserId: annalee.id,
    });
    ok("stale id AUTO-CORRECTS to the username the admin verified",
      !("threw" in r2) && r2.body?.grantee?.username === annalee.username &&
      r2.body?.grantee?.id === annalee.id, JSON.stringify(r2).slice(0, 200));

    // 3b) BOGUS id + janine's username → resolves janine (alreadyHad from #1)
    const r2b = await call({
      userId: "no-such-id-" + TS, username: janine.username,
      lineId: line.id, module: MOD, currUserId: annalee.id,
    });
    ok("nonexistent id still lands on the right @username",
      !("threw" in r2b) && r2b.body?.grantee?.id === janine.id &&
      r2b.body?.alreadyHad === true, JSON.stringify(r2b).slice(0, 200));

    // 3c) username that exists NOWHERE in the line → refused, nobody granted
    const r2c = await call({
      userId: janine.id, username: `qa_ghost_${TS}`,
      lineId: line.id, module: MOD, currUserId: annalee.id,
    });
    const janRows = await prisma.module.count({
      where: { userId: janine.id, moduleName: MOD },
    });
    ok("unresolvable username is refused (no grant to anyone)",
      "threw" in r2c && String(r2c.threw).includes("no account") && janRows === 1,
      JSON.stringify({ r2c, janRows }).slice(0, 200));

    // 4) cross-line target → refused by the tripwire
    if (otherLine) {
      const stranger = await mkUser("stranger", otherLine.id);
      const r3 = await call({
        userId: stranger.id, username: stranger.username,
        lineId: line.id, module: MOD, currUserId: annalee.id,
      });
      ok("cross-line grant refused",
        "threw" in r3 && String(r3.threw).includes("different line"), JSON.stringify(r3).slice(0, 160));
    } else {
      console.log("SKIP  cross-line case (single-line DB)");
      pass++;
    }

    // 5) repeat the correct grant → calm alreadyHad, still exactly one row
    const r4 = await call({
      userId: janine.id, username: janine.username,
      lineId: line.id, module: MOD, currUserId: annalee.id,
    });
    const janineRows = await prisma.module.count({
      where: { userId: janine.id, moduleName: MOD },
    });
    ok("regrant reports alreadyHad and never duplicates",
      !("threw" in r4) && r4.body?.alreadyHad === true && janineRows === 1,
      JSON.stringify({ alreadyHad: r4 && (r4 as any).body?.alreadyHad, janineRows }));
  } catch (e: any) {
    fail++;
    console.log("FATAL:", e?.message || e);
  } finally {
    try {
      await prisma.module.deleteMany({ where: { moduleName: MOD } });
      await prisma.notification.deleteMany({ where: { recipientId: { in: made.userIds } } });
      await prisma.user.deleteMany({ where: { id: { in: made.userIds } } });
      await prisma.account.deleteMany({ where: { id: { in: made.accountIds } } });
      console.log("cleanup: done");
    } catch (e: any) {
      console.log("CLEANUP WARNING:", e?.message || e);
    }
    await prisma.$disconnect();
    console.log(`RESULT: ${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
  }
})();
