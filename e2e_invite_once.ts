/* PROOF: an invitation registers EXACTLY ONCE — sequential reuse refused,
 * and even two SIMULTANEOUS submits of the same link produce exactly one
 * registration (atomic conclude claim). Local API on :3000 + local dev DB.
 * Run: npx ts-node --transpile-only e2e_invite_once.ts */
import { prisma } from "./src/barrel/prisma";

const API = "http://localhost:3000";
const TS = Date.now();
const sh = (s?: string | null) => (s ? ".." + String(s).slice(-6) : "-");

const post = async (form: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(form)) fd.append(k, v);
  const res = await fetch(`${API}/position/quick-register`, {
    method: "POST",
    body: fd,
  });
  let body: any = null;
  try {
    body = await res.json();
  } catch {
    body = { raw: await res.text().catch(() => "") };
  }
  // The API signals soft errors as {error:1} with 200 too — treat both.
  const success = res.status === 200 && !body?.error && !body?.message?.match(/already|used|refused/i)
    ? body?.message === "OK"
    : false;
  return { status: res.status, body, success };
};

(async () => {
  let pass = 0,
    fail = 0;
  const ok = (l: string, c: boolean, d = "") => {
    if (c) {
      pass++;
      console.log("PASS  " + l);
    } else {
      fail++;
      console.log("FAIL  " + l + (d ? "  → " + d : ""));
    }
  };

  const inviteIds: string[] = [];
  const slotIds: string[] = [];

  try {
    const ups = await prisma.unitPosition.findMany({
      select: {
        id: true,
        lineId: true,
        positionId: true,
        slot: { where: { occupied: false, userId: null }, select: { id: true } },
      },
      take: 500,
    });
    const up = ups.find((u) => u.positionId && u.slot.length === 0 && u.lineId);
    if (!up) {
      console.log("NO FIXTURE: no unit position with 0 vacant slots.");
      process.exit(2);
    }
    // 3 open slots — if the invite gate failed, BOTH racers could register.
    for (let i = 0; i < 3; i++) {
      const s = await prisma.positionSlot.create({
        data: { unitPositionId: up.id, occupied: false },
        select: { id: true },
      });
      slotIds.push(s.id);
    }
    const mkInvite = async (tag: string) => {
      const inv = await prisma.fillPositionInvitation.create({
        data: {
          email: `qa-once-${TS}-${tag}@test.local`,
          lineId: up.lineId as string,
          unitPositionId: up.id,
          positionSlotId: slotIds[0],
          mode: "quick",
          expiresAt: new Date(Date.now() + 86_400_000),
        },
        select: { id: true },
      });
      inviteIds.push(inv.id);
      return inv;
    };
    console.log(`fixture: unitPos${sh(up.id)} line${sh(up.lineId)}`);

    const form = (linkId: string, tag: string) => ({
      lineId: up.lineId as string,
      linkId,
      slotId: slotIds[0],
      username: `qa_once_${TS}_${tag}`,
      password: "TestPass123!",
      firstName: "QaOnce",
      lastName: tag.toUpperCase(),
      email: `qa-once-${TS}-${tag}@test.local`,
      birthDate: new Date("1995-05-05").toISOString(),
      gender: "female",
      mobileNumber: "09171234567",
    });

    // 1) first registration through the link → works
    const inv1 = await mkInvite("seq");
    const r1 = await post(form(inv1.id, "first"));
    ok("first registration through the link succeeds", r1.success,
      JSON.stringify(r1.body).slice(0, 160));

    // 2) SEQUENTIAL reuse of the SAME link (different username) → refused
    const r2 = await post(form(inv1.id, "second"));
    ok("reusing the used link is refused", !r2.success &&
      /already|used|concluded/i.test(JSON.stringify(r2.body)),
      JSON.stringify(r2.body).slice(0, 160));
    const secondUser = await prisma.user.findFirst({
      where: { username: `qa_once_${TS}_second` }, select: { id: true },
    });
    ok("refused reuse created NO user row", !secondUser);

    // 3) CONCURRENT double-submit of ONE fresh link → exactly one winner
    const inv2 = await mkInvite("race");
    const [ra, rb] = await Promise.all([
      post(form(inv2.id, "racea")),
      post(form(inv2.id, "raceb")),
    ]);
    const winners = [ra, rb].filter((r) => r.success).length;
    ok("simultaneous submits: exactly ONE registers", winners === 1,
      `winners=${winners} A=${JSON.stringify(ra.body).slice(0, 80)} B=${JSON.stringify(rb.body).slice(0, 80)}`);
    const raceUsers = await prisma.user.count({
      where: { username: { in: [`qa_once_${TS}_racea`, `qa_once_${TS}_raceb`] } },
    });
    ok("exactly ONE user row exists from the race", raceUsers === 1,
      `rows=${raceUsers}`);
  } catch (e: any) {
    fail++;
    console.log("FATAL:", e?.message || e);
  } finally {
    try {
      const users = await prisma.user.findMany({
        where: { username: { startsWith: `qa_once_${TS}_` } },
        select: { id: true, accountId: true },
      });
      const uids = users.map((u) => u.id);
      const aids = users.map((u) => u.accountId).filter(Boolean) as string[];
      await prisma.notification.deleteMany({ where: { recipientId: { in: uids } } });
      await prisma.userProfilePicture.deleteMany({ where: { userId: { in: uids } } });
      await prisma.positionSlot.updateMany({
        where: { id: { in: slotIds } },
        data: { occupied: false, userId: null },
      });
      await prisma.user.deleteMany({ where: { id: { in: uids } } });
      await prisma.account.deleteMany({ where: { id: { in: aids } } });
      await prisma.fillPositionInvitation.deleteMany({ where: { id: { in: inviteIds } } });
      await prisma.positionSlot.deleteMany({ where: { id: { in: slotIds } } });
      console.log("cleanup: done");
    } catch (e: any) {
      console.log("CLEANUP WARNING:", e?.message || e);
    }
    await prisma.$disconnect();
    console.log(`RESULT: ${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
  }
})();
