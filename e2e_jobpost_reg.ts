/* END-TO-END test of the FIXED job-post applicant registration
 * (POST /application/user/registration) against the local API + dev DB.
 * The old code crashed at the slot-assignment step on every use; this
 * proves the rewrite: registers, claims a slot atomically, links the
 * application — and returns the clear "fully filled" error when no slot
 * remains. Cleans up everything it created.
 * Run (server on :3000): npx ts-node --transpile-only e2e_jobpost_reg.ts */
import { prisma } from "./src/barrel/prisma";
import { EncryptionService } from "./src/service/encryption";

const API = "http://localhost:3000";
const TS = Date.now();
const sh = (s?: string | null) => (s ? ".." + String(s).slice(-6) : "-");

const post = async (body: unknown) => {
  const res = await fetch(`${API}/application/user/registration`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  let out: any = null;
  try {
    out = await res.json();
  } catch {
    out = { raw: await res.text().catch(() => "") };
  }
  return { status: res.status, body: out };
};

(async () => {
  let pass = 0,
    fail = 0;
  const ok = (label: string, cond: boolean, detail = "") => {
    if (cond) {
      pass++;
      console.log("PASS  " + label);
    } else {
      fail++;
      console.log("FAIL  " + label + (detail ? "  → " + detail : ""));
    }
  };

  const created = {
    slotIds: [] as string[],
    jobPostId: null as string | null,
    applicationIds: [] as string[],
    userIds: [] as string[],
    accountIds: [] as string[],
  };

  try {
    // ── fixture: unit position with positionId + line and NO vacant slots
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
      console.log("NO FIXTURE");
      process.exit(2);
    }

    const slot = await prisma.positionSlot.create({
      data: { unitPositionId: up.id, occupied: false },
      select: { id: true },
    });
    created.slotIds.push(slot.id);

    const jp = await prisma.jobPost.create({
      data: {
        slot: 1,
        showApplicationCount: false,
        location: "QA Test",
        status: 1,
        lineId: up.lineId,
        unitPositionId: up.id,
        positionId: up.positionId,
      },
      select: { id: true },
    });
    created.jobPostId = jp.id;
    console.log(`fixture: unitPos${sh(up.id)} slot${sh(slot.id)} jobPost${sh(jp.id)}`);

    const mkApplication = async (tag: string) => {
      const encEmail = await EncryptionService.encrypt(
        `qa-jp-${TS}-${tag}@test.local`,
      );
      const encMobile = await EncryptionService.encrypt("09171234567");
      const app = await prisma.submittedApplication.create({
        data: {
          firstname: "QaJob",
          lastname: `Post${tag.toUpperCase()}`,
          birthDate: "1995-05-05",
          email: encEmail.encryptedData,
          emailIv: encEmail.iv,
          gender: "male",
          filipino: true,
          dualCitizen: false,
          byBirth: true,
          byNatural: false,
          cvilStatus: "Single",
          resBarangay: "QA",
          resCity: "Gasan",
          resProvince: "Marinduque",
          resZipCode: "4905",
          permaBarangay: "QA",
          permaCity: "Gasan",
          permaProvince: "Marinduque",
          permaZipCode: "4905",
          teleNo: "N/A",
          mobileNo: encMobile.encryptedData,
          ivMobileNo: encMobile.iv,
          height: 1.7,
          weight: 70,
          fatherAge: 60,
          motherAge: 58,
          children: "[]",
          govId: {},
          batch: new Date(),
          firsntameIv: "qa", // (sic — schema field name)
          lastnameIv: "qa",
          dualCitizenHalf: "N/A",
          lineId: up.lineId as string,
          jobPostId: jp.id,
          positionId: up.positionId,
        },
        select: { id: true },
      });
      created.applicationIds.push(app.id);
      return app;
    };

    // ── 1) the fixed happy path: register a job-post applicant
    const appA = await mkApplication("a");
    const rA = await post({
      username: `qa_jp_${TS}_a`,
      password: "TestPass123!",
      lineId: up.lineId,
      applicationId: appA.id,
    });
    ok(
      "job-post applicant registers (HTTP 200, OK) — old code crashed here",
      rA.status === 200 && rA.body?.message === "OK",
      `status=${rA.status} body=${JSON.stringify(rA.body).slice(0, 180)}`,
    );

    const userA = await prisma.user.findFirst({
      where: { username: `qa_jp_${TS}_a` },
      select: { id: true, accountId: true, positionId: true },
    });
    if (userA) {
      created.userIds.push(userA.id);
      if (userA.accountId) created.accountIds.push(userA.accountId);
    }
    ok("User row created with a position", !!userA && !!userA.positionId);

    const claimedSlot = userA
      ? await prisma.positionSlot.findFirst({
          where: { userId: userA.id },
          select: { id: true, occupied: true, unitPositionId: true },
        })
      : null;
    ok(
      "slot CLAIMED by the new employee (the step that could never work)",
      !!claimedSlot && claimedSlot.occupied && claimedSlot.unitPositionId === up.id,
      JSON.stringify(claimedSlot),
    );

    const appRow = await prisma.submittedApplication.findUnique({
      where: { id: appA.id },
      select: { userId: true },
    });
    ok("application linked to the new user", !!userA && appRow?.userId === userA.id);

    // ── 2) negative: no vacant slot left → clear message, NOT a crash
    const appB = await mkApplication("b");
    const rB = await post({
      username: `qa_jp_${TS}_b`,
      password: "TestPass123!",
      lineId: up.lineId,
      applicationId: appB.id,
    });
    ok(
      "position full → clear 'fully filled' message (no 500 crash)",
      rB.status === 400 &&
        String(rB.body?.message ?? "").includes("fully filled"),
      `status=${rB.status} msg=${rB.body?.message}`,
    );
    const userB = await prisma.user.findFirst({
      where: { username: `qa_jp_${TS}_b` },
      select: { id: true, accountId: true },
    });
    ok("no half-created user on the failed attempt (tx rolled back)", !userB);
    if (userB) {
      created.userIds.push(userB.id);
      if (userB.accountId) created.accountIds.push(userB.accountId);
    }
    // the failed attempt's account must be rolled back too
    const acctB = await prisma.account.findFirst({
      where: { username: `qa_jp_${TS}_b` },
      select: { id: true },
    });
    ok("no orphan account on the failed attempt", !acctB);
    if (acctB) created.accountIds.push(acctB.id);
  } catch (e: any) {
    fail++;
    console.log("FATAL:", e?.message || e?.name || String(e));
    console.log("FATAL-DETAIL:", (e?.stack || JSON.stringify(e))?.slice(0, 2400));
  } finally {
    try {
      await prisma.notification
        .deleteMany({ where: { recipientId: { in: created.userIds } } })
        .catch(() => {});
      await prisma.positionSlot.updateMany({
        where: { userId: { in: created.userIds } },
        data: { occupied: false, userId: null },
      });
      if (created.applicationIds.length)
        await prisma.submittedApplication.deleteMany({
          where: { id: { in: created.applicationIds } },
        });
      if (created.userIds.length)
        await prisma.user.deleteMany({ where: { id: { in: created.userIds } } });
      if (created.accountIds.length)
        await prisma.account.deleteMany({
          where: { id: { in: created.accountIds } },
        });
      if (created.slotIds.length)
        await prisma.positionSlot.deleteMany({
          where: { id: { in: created.slotIds } },
        });
      if (created.jobPostId)
        await prisma.jobPost.delete({ where: { id: created.jobPostId } }).catch(() => {});
      console.log("cleanup: done");
    } catch (e: any) {
      console.log("CLEANUP WARNING:", e?.message ?? e);
    }
    await prisma.$disconnect();
    console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
  }
})();
