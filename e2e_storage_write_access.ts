/* PROOF: storage writes are strictly gated to the CREATOR or a Dispense &
 * Stock Access holder. canWriteStorage reflects that rule, and removeStorage
 * enforces it (creator ok; non-creator/non-granted blocked; grant unlocks).
 * Run: npx ts-node --transpile-only e2e_storage_write_access.ts */
import { prisma } from "./src/barrel/prisma";
import {
  canWriteStorage,
  assertStorageAccess,
} from "./src/controller/storageAccessController";
import { removeStorage } from "./src/controller/medicineController";
import { generateStorageRef } from "./src/middleware/handler";

const TS = Date.now();
const mockRes = () => {
  const r: any = {
    _code: 0, _body: null,
    code(n: number) { this._code = n; return this; },
    send(b: unknown) { this._body = b; return this; },
    status(n: number) { return this.code(n); },
    header() { return this; },
  };
  return r;
};

(async () => {
  let pass = 0, fail = 0;
  const ok = (l: string, c: boolean, d = "") => {
    if (c) { pass++; console.log("PASS  " + l); }
    else { fail++; console.log("FAIL  " + l + (d ? "  → " + d : "")); }
  };
  const made = { accountIds: [] as string[], userIds: [] as string[], storageIds: [] as string[] };

  const mkUser = async (tag: string, lineId: string) => {
    const acct = await prisma.account.create({
      data: { username: `qa_sw_${TS}_${tag}`, password: "x", lineId },
      select: { id: true, username: true },
    });
    made.accountIds.push(acct.id);
    const u = await prisma.user.create({
      data: {
        firstName: "QaSw", lastName: tag.toUpperCase(), username: acct.username,
        accountId: acct.id, lineId, email: `qa-sw-${TS}-${tag}@test.local`,
      },
      select: { id: true },
    });
    made.userIds.push(u.id);
    return { acctId: acct.id, userId: u.id };
  };

  try {
    const line = await prisma.line.findFirst({ select: { id: true } });
    const dept = await prisma.department.findFirst({ select: { id: true } });
    if (!line || !dept) { console.log("NO FIXTURE (line/department)"); process.exit(2); }

    const creator = await mkUser("creator", line.id);
    const other = await mkUser("other", line.id);
    const third = await mkUser("third", line.id);

    const storage = await prisma.medicineStorage.create({
      data: {
        lineId: line.id, name: `QA Storage ${TS}`, desc: "QA fixture",
        refNumber: await generateStorageRef(), departmentId: dept.id,
        createdById: creator.userId, timestamp: new Date().toISOString(),
      },
      select: { id: true },
    });
    made.storageIds.push(storage.id);

    // ── canWriteStorage rule ────────────────────────────────────────────────
    ok("creator canWrite = true", await canWriteStorage(creator.userId, storage.id));
    ok("non-creator/non-granted canWrite = false",
      (await canWriteStorage(other.userId, storage.id)) === false);
    ok("null user canWrite = false", (await canWriteStorage(null, storage.id)) === false);

    // grant `other` → now allowed
    await prisma.medicineStorageAccess.create({
      data: { medicineStorageId: storage.id, userId: other.userId, previlege: 1 },
    });
    ok("granted user canWrite = true", await canWriteStorage(other.userId, storage.id));

    // ── assertStorageAccess throws for the blocked user ─────────────────────
    let threw = false;
    try { await assertStorageAccess(third.userId, [storage.id], "remove"); }
    catch { threw = true; }
    ok("assertStorageAccess blocks non-creator/non-granted", threw);

    // ── removeStorage endpoint enforces it ──────────────────────────────────
    // blocked user (third) → throws, storage stays
    let removeBlocked = false;
    try {
      await removeStorage(
        { query: { id: storage.id, userId: third.userId, lineId: line.id }, user: { id: third.acctId } } as any,
        mockRes() as any,
      );
    } catch { removeBlocked = true; }
    ok("removeStorage blocks a non-creator/non-granted user", removeBlocked);
    const still = await prisma.medicineStorage.findUnique({
      where: { id: storage.id }, select: { status: true },
    });
    ok("storage NOT removed by the blocked attempt", still?.status !== 0, `status=${still?.status}`);

    // creator → allowed (empty storage → soft-deletes)
    const res = mockRes();
    let creatorRemoveErr: string | null = null;
    try {
      await removeStorage(
        { query: { id: storage.id, userId: creator.userId, lineId: line.id }, user: { id: creator.acctId } } as any,
        res as any,
      );
    } catch (e) { creatorRemoveErr = (e as Error).message; }
    ok("removeStorage allows the creator", creatorRemoveErr === null, creatorRemoveErr ?? "");
    const gone = await prisma.medicineStorage.findUnique({
      where: { id: storage.id }, select: { status: true },
    });
    ok("storage soft-removed by the creator (status=0)", gone?.status === 0, `status=${gone?.status}`);
  } catch (e) {
    fail++;
    console.log("FAIL  threw → " + (e as Error).message);
    console.log("  meta:", JSON.stringify((e as any)?.meta));
    console.log("  cause:", (e as any)?.cause?.message ?? (e as any)?.cause);
  } finally {
    const step = async (label: string, fn: () => Promise<unknown>) => {
      try { await fn(); } catch (e) { console.log(`  cleanup ${label} failed: ${(e as Error).message}`); }
    };
    // access grants first (FK → storage & user), then storage, users, accounts
    await step("access", () =>
      prisma.medicineStorageAccess.deleteMany({
        where: {
          OR: [
            ...(made.userIds.length ? [{ userId: { in: made.userIds } }] : []),
            ...(made.storageIds.length ? [{ medicineStorageId: { in: made.storageIds } }] : []),
          ],
        },
      }));
    await step("storage", () =>
      prisma.medicineStorage.deleteMany({ where: { id: { in: made.storageIds } } }));
    // removeStorage wrote audit logs referencing the actor (FK SetDefault →
    // null on user delete), so clear them before deleting the users.
    await step("medicineLogs", () =>
      prisma.medicineLogs.deleteMany({ where: { userId: { in: made.userIds } } }));
    await step("activityLogs", () =>
      prisma.activityLogs.deleteMany({ where: { userId: { in: made.userIds } } }));
    await step("user", () =>
      prisma.user.deleteMany({ where: { id: { in: made.userIds } } }));
    await step("account", () =>
      prisma.account.deleteMany({ where: { id: { in: made.accountIds } } }));
    await prisma.$disconnect();
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
