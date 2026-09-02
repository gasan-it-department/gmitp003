/* PROOF: super-admins bypass per-storage access (transfer/dispense/edit) even
 * on legacy storages with NULL createdById, while regular staff stay blocked
 * until granted. Run: npx ts-node --transpile-only e2e_super_storage.ts */
import { prisma } from "./src/barrel/prisma";
import {
  canWriteStorage,
  assertStorageAccess,
  isSuperAdmin,
} from "./src/controller/storageAccessController";
import { generateStorageRef } from "./src/middleware/handler";

const TS = Date.now();
(async () => {
  let pass = 0, fail = 0;
  const ok = (l: string, c: boolean, d = "") => {
    if (c) { pass++; console.log("PASS  " + l); }
    else { fail++; console.log("FAIL  " + l + (d ? "  → " + d : "")); }
  };
  const made = {
    accountIds: [] as string[], userIds: [] as string[],
    privilegeIds: [] as string[], storageIds: [] as string[],
  };

  const mkUser = async (tag: string, lineId: string, superAdmin: boolean) => {
    const acct = await prisma.account.create({
      data: { username: `qa_sup_${TS}_${tag}`, password: "x", lineId },
      select: { id: true, username: true },
    });
    made.accountIds.push(acct.id);
    // Create the Privilege first so the User can use plain scalar FKs
    // (accountId/lineId/privilegeId) — mixing a nested relation write forces
    // Prisma's "checked" input and rejects the scalar accountId.
    let privilegeId: string | undefined;
    if (superAdmin) {
      const p = await prisma.privilege.create({
        data: { super: true },
        select: { id: true },
      });
      privilegeId = p.id;
      made.privilegeIds.push(p.id);
    }
    const u = await prisma.user.create({
      data: {
        firstName: "QaSup", lastName: tag.toUpperCase(), username: acct.username,
        accountId: acct.id, lineId, email: `qa-sup-${TS}-${tag}@test.local`,
        ...(privilegeId ? { privilegeId } : {}),
      },
      select: { id: true },
    });
    made.userIds.push(u.id);
    return u.id;
  };

  try {
    const line = await prisma.line.findFirst({ select: { id: true } });
    const dept = await prisma.department.findFirst({ select: { id: true } });
    if (!line || !dept) { console.log("NO FIXTURE"); process.exit(2); }

    const superId = await mkUser("super", line.id, true);
    const regularId = await mkUser("regular", line.id, false);

    // Legacy storage: NO creator (createdById null), NO grants — the exact
    // situation that was locking the admin out.
    const storage = await prisma.medicineStorage.create({
      data: {
        lineId: line.id, name: `QA Sup Storage ${TS}`, desc: "QA",
        refNumber: await generateStorageRef(), departmentId: dept.id,
        timestamp: new Date().toISOString(), // createdById intentionally omitted
      },
      select: { id: true, createdById: true },
    });
    made.storageIds.push(storage.id);
    ok("storage has NULL createdById (legacy simulation)", storage.createdById === null);

    ok("isSuperAdmin(super) = true", await isSuperAdmin(superId));
    ok("isSuperAdmin(regular) = false", (await isSuperAdmin(regularId)) === false);

    // canWriteStorage
    ok("super canWrite legacy storage = true", await canWriteStorage(superId, storage.id));
    ok("regular canWrite legacy storage = false",
      (await canWriteStorage(regularId, storage.id)) === false);

    // assertStorageAccess (the throwing gate used by transfer/dispense/edit)
    let superThrew = false;
    try { await assertStorageAccess(superId, [storage.id], "transfer"); }
    catch { superThrew = true; }
    ok("assertStorageAccess allows super (no throw)", !superThrew);

    let regThrew = false;
    try { await assertStorageAccess(regularId, [storage.id], "transfer"); }
    catch { regThrew = true; }
    ok("assertStorageAccess blocks regular (throws)", regThrew);

    // grant the regular user → now allowed (strict path still works)
    await prisma.medicineStorageAccess.create({
      data: { medicineStorageId: storage.id, userId: regularId, previlege: 1 },
    });
    ok("regular canWrite after grant = true", await canWriteStorage(regularId, storage.id));
  } catch (e) {
    fail++;
    console.log("FAIL  threw → " + (e as Error).message);
  } finally {
    const step = async (fn: () => Promise<unknown>) => { try { await fn(); } catch {} };
    await step(() => prisma.medicineStorageAccess.deleteMany({ where: { OR: [
      { userId: { in: made.userIds } }, { medicineStorageId: { in: made.storageIds } },
    ] } }));
    await step(() => prisma.medicineStorage.deleteMany({ where: { id: { in: made.storageIds } } }));
    await step(() => prisma.user.deleteMany({ where: { id: { in: made.userIds } } }));
    await step(() => prisma.privilege.deleteMany({ where: { id: { in: made.privilegeIds } } }));
    await step(() => prisma.account.deleteMany({ where: { id: { in: made.accountIds } } }));
    await prisma.$disconnect();
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
