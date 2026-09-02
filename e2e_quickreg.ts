/* END-TO-END test of quick-invite registration against the LOCAL API
 * (localhost:3000) + local dev DB, submitting EXACTLY the web form's shape:
 *   A — full form: middle name, suffix, mobile, PSGC-style address codes
 *       that DON'T exist in our tables (the prod P2003 case) + a photo.
 *   B — same baked slot (rollout collision) + degenerate "loading" address.
 * Both must register. Cleans up everything and restores slot state.
 * Run: npx ts-node --transpile-only e2e_quickreg.ts */
import { prisma } from "./src/barrel/prisma";

const API = "http://localhost:3000";
const TS = Date.now();
const sh = (s?: string | null) => (s ? ".." + String(s).slice(-6) : "-");
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

const post = async (form: Record<string, string>, withPhoto = false) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(form)) fd.append(k, v);
  if (withPhoto)
    fd.append("photo", new Blob([PNG], { type: "image/png" }), "avatar.png");
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
  return { status: res.status, body };
};

(async () => {
  let pass = 0;
  let fail = 0;
  const ok = (label: string, cond: boolean, detail = "") => {
    if (cond) {
      pass++;
      console.log("PASS  " + label);
    } else {
      fail++;
      console.log("FAIL  " + label + (detail ? "  → " + detail : ""));
    }
  };

  const inviteIds: string[] = [];
  const createdSlotIds: string[] = [];
  let createdUserIds: string[] = [];
  let createdAccountIds: string[] = [];

  try {
    // ── fixture: position with NO other vacant slots + two temp slots ────
    const ups = await prisma.unitPosition.findMany({
      select: {
        id: true,
        lineId: true,
        positionId: true,
        slot: {
          where: { occupied: false, userId: null },
          select: { id: true },
        },
      },
      take: 500,
    });
    const up = ups.find((u) => u.positionId && u.slot.length === 0 && u.lineId);
    if (!up) {
      console.log("NO FIXTURE: no unit position with 0 vacant slots found.");
      process.exit(2);
    }
    const mkSlot = () =>
      prisma.positionSlot.create({
        data: { unitPositionId: up.id, occupied: false },
        select: { id: true },
      });
    const slotA = await mkSlot();
    const slotB = await mkSlot();
    createdSlotIds.push(slotA.id, slotB.id);

    // a REAL internal region id if the local table has one (should be kept);
    // province/municipal/barangay get PSGC-style codes that DON'T exist here
    // (must be nulled, NOT fail with P2003 — the exact prod bug).
    const realRegion = await prisma.region.findFirst({ select: { id: true } });
    console.log(
      `fixture: unitPos${sh(up.id)} line${sh(up.lineId)} slots ${sh(slotA.id)},${sh(slotB.id)} realRegion=${sh(realRegion?.id)}`,
    );

    const mkInvite = (tag: string) =>
      prisma.fillPositionInvitation.create({
        data: {
          email: `qa-e2e-${TS}-${tag}@test.local`,
          lineId: up.lineId as string,
          unitPositionId: up.id,
          positionSlotId: slotA.id,
          mode: "quick",
          expiresAt: new Date(Date.now() + 86_400_000),
        },
        select: { id: true },
      });
    const invA = await mkInvite("a");
    const invB = await mkInvite("b");
    inviteIds.push(invA.id, invB.id);

    const base = {
      lineId: up.lineId as string,
      password: "TestPass123!",
      birthDate: new Date("1995-05-05").toISOString(),
      gender: "male",
      mobileNumber: "09171234567",
    };

    // ── A: FULL web-form shape — bogus PSGC codes + photo (prod P2003 case)
    const rA = await post(
      {
        ...base,
        linkId: invA.id,
        slotId: slotA.id,
        username: `qa_e2e_${TS}_a`,
        firstName: "QaTest",
        lastName: "Alpha",
        middleName: "Santos",
        suffix: "Jr.",
        email: `qa-e2e-${TS}-a@test.local`,
        ...(realRegion ? { regionId: realRegion.id } : { regionId: "1700000000" }),
        provinceId: "1740000000", // PSGC codes not present in our tables —
        municipalId: "1740100000", // used to explode with P2003
        barangayId: "1740100001",
      },
      true,
    );
    ok(
      "A (bogus PSGC address + photo) registers — HTTP 200 OK",
      rA.status === 200 && rA.body?.message === "OK",
      `status=${rA.status} body=${JSON.stringify(rA.body).slice(0, 200)}`,
    );

    // ── B: same baked slot + degenerate "loading" address value
    const rB = await post({
      ...base,
      linkId: invB.id,
      slotId: slotA.id,
      username: `qa_e2e_${TS}_b`,
      firstName: "QaTest",
      lastName: "Bravo",
      email: `qa-e2e-${TS}-b@test.local`,
      regionId: "loading",
      provinceId: "noData",
    });
    ok(
      "B (slot fallback + 'loading' address) registers — HTTP 200 OK",
      rB.status === 200 && rB.body?.message === "OK",
      `status=${rB.status} body=${JSON.stringify(rB.body).slice(0, 200)}`,
    );

    // ── DB assertions ────────────────────────────────────────────────────
    const users = await prisma.user.findMany({
      where: { username: { in: [`qa_e2e_${TS}_a`, `qa_e2e_${TS}_b`] } },
      select: {
        id: true, username: true, lineId: true, accountId: true,
        regionId: true, provinceId: true, municipalId: true, barangayId: true,
        middleName: true, suffix: true,
      },
    });
    createdUserIds = users.map((u) => u.id);
    createdAccountIds = users.map((u) => u.accountId).filter(Boolean) as string[];
    const a = users.find((u) => u.username === `qa_e2e_${TS}_a`);
    const b = users.find((u) => u.username === `qa_e2e_${TS}_b`);
    ok("both User rows exist", users.length === 2, `found=${users.length}`);
    ok(
      "A: bogus PSGC province/municipal/barangay became NULL",
      !!a && a.provinceId === null && a.municipalId === null && a.barangayId === null,
      a ? JSON.stringify({ p: a.provinceId, m: a.municipalId, b: a.barangayId }) : "no A",
    );
    ok(
      realRegion
        ? "A: VALID region id was kept"
        : "A: bogus region became NULL",
      !!a && (realRegion ? a.regionId === realRegion.id : a.regionId === null),
      a ? `regionId=${a.regionId}` : "no A",
    );
    ok(
      "B: degenerate 'loading'/'noData' became NULL",
      !!b && b.regionId === null && b.provinceId === null,
      b ? JSON.stringify({ r: b.regionId, p: b.provinceId }) : "no B",
    );
    ok("A: middle name + suffix stored", !!a && a.middleName === "Santos" && a.suffix === "Jr.");

    const photo = a
      ? await prisma.userProfilePicture.findUnique({ where: { userId: a.id }, select: { id: true } })
      : null;
    ok("A: profile photo row saved", !!photo);

    const claimed = await prisma.positionSlot.findMany({
      where: { userId: { in: createdUserIds } },
      select: { id: true, unitPositionId: true, occupied: true },
    });
    ok(
      "each registrant occupies their own slot of the same position",
      claimed.length === 2 &&
        claimed[0].id !== claimed[1].id &&
        claimed.every((s) => s.occupied && s.unitPositionId === up.id),
    );

    const inv = await prisma.fillPositionInvitation.findMany({
      where: { id: { in: inviteIds } },
      select: { concluded: true, concludedReason: true },
    });
    ok(
      "both invites burned (concluded=accepted)",
      inv.length === 2 && inv.every((i) => i.concluded && i.concludedReason === "accepted"),
    );

    const rA2 = await post({
      ...base,
      linkId: invA.id,
      slotId: slotA.id,
      username: `qa_e2e_${TS}_a2`,
      firstName: "QaTest",
      lastName: "AlphaTwo",
      email: `qa-e2e-${TS}-a2@test.local`,
    });
    ok(
      "reused link rejected with the clear message",
      rA2.status !== 200 && String(rA2.body?.message ?? "").includes("already been used"),
      `status=${rA2.status} msg=${rA2.body?.message}`,
    );
  } catch (e: any) {
    fail++;
    console.log("FATAL:", e?.message ?? e);
  } finally {
    try {
      if (createdUserIds.length) {
        await prisma.userProfilePicture.deleteMany({ where: { userId: { in: createdUserIds } } });
        await prisma.notification.deleteMany({ where: { recipientId: { in: createdUserIds } } });
        await prisma.positionSlot.updateMany({
          where: { userId: { in: createdUserIds } },
          data: { occupied: false, userId: null },
        });
        await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
      }
      if (createdSlotIds.length) {
        await prisma.positionSlot.deleteMany({ where: { id: { in: createdSlotIds } } });
      }
      if (createdAccountIds.length) {
        await prisma.account.deleteMany({ where: { id: { in: createdAccountIds } } });
      }
      if (inviteIds.length) {
        await prisma.fillPositionInvitation.deleteMany({ where: { id: { in: inviteIds } } });
      }
      console.log("cleanup: done (test rows removed, slots restored)");
    } catch (e: any) {
      console.log("CLEANUP WARNING:", e?.message ?? e);
    }
    await prisma.$disconnect();
    console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
  }
})();
