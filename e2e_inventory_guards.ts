/**
 * The item-code generator, and the import path that took a line id on
 * trust.
 *
 * generatedItemCode drew its candidate once, outside its retry loop, and
 * then looked for that number in `quantity` rather than `code`. So it
 * could not see the collision it existed to prevent, and a six-figure
 * quantity — a plausible piece count — put it in a loop re-asking the
 * same question of the database forever.
 *
 * uploadBulkExcel read lineId and dataSetId out of the multipart form
 * and wrote with them unchecked, which is a cross-municipality write by
 * anyone signed in. Its siblings all assert the line; this one's inputs
 * arrive as form parts, which is how it was missed.
 *
 * Also here: searching a container's access list for two words, which
 * filtered on firstname/lastname while the model spells them firstName
 * and lastName, and that list being readable for any container id.
 */
import path from "path";
const entry = path.join(process.cwd(), "src", "index.ts");
require.cache[entry] = {
  id: entry, filename: entry, loaded: true,
  exports: { notificationSocket: { emitUserNotification: () => undefined } },
} as never;

import ExcelJS from "exceljs";
import { prisma } from "./src/barrel/prisma";
import { generatedItemCode } from "./src/middleware/handler";
import { uploadBulkExcel } from "./src/controller/supplyController";
import { inventoryLogsAccessList } from "./src/controller/inventory";

let pass = 0;
const fails: string[] = [];
const ok = (name: string, cond: boolean, detail = "") => {
  if (cond) { pass++; console.log(`  ok    ${name}`); }
  else { fails.push(name); console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`); }
};

const TAG = "__e2e_guard__";

const mockRes = () => {
  const r: any = {
    _code: 0, _body: null as any,
    code(c: number) { r._code = c; return r; },
    // The importer replies with res.status(); Fastify offers both.
    status(c: number) { r._code = c; return r; },
    send(b: any) { r._body = b; return r; },
    header() { return r; },
  };
  return r;
};

const made = {
  supplyIds: [] as string[], accountIds: [] as string[],
  userIds: [] as string[], datasetIds: [] as string[],
  containerIds: [] as string[], allowedIds: [] as string[],
};

const call = async (fn: any, req: any) => {
  const res = mockRes();
  try {
    await fn(req, res);
    return { code: res._code, body: res._body, threw: "" };
  } catch (e) {
    return { code: 0, body: null, threw: e instanceof Error ? e.message : String(e) };
  }
};

/* Resolve, or give up after ms — a hang has to be observable. */
const within = async <T>(ms: number, work: Promise<T>) =>
  Promise.race([
    work.then((value) => ({ value, timedOut: false })),
    new Promise<{ value: null; timedOut: true }>((resolve) =>
      setTimeout(() => resolve({ value: null, timedOut: true }), ms),
    ),
  ]);

(async () => {
  const realRandom = Math.random;
  try {
    const lines = await prisma.line.findMany({ select: { id: true }, take: 2 });
    if (lines.length === 0) { console.log("no line here — skipping"); process.exit(0); }
    const line = lines[0];

    const makeActor = async (lineId: string, n: string) => {
      const a = await prisma.account.create({
        data: {
          username: `${TAG}${n}${Date.now()}`, password: "x",
          lineId, status: 1,
          User: { create: {
            firstName: `${TAG}${n}`, lastName: "guard", lineId,
            username: `${TAG}u${n}${Date.now()}`, email: `${TAG}${n}@e.invalid`,
          } },
        },
        select: { id: true, User: { select: { id: true } } },
      });
      made.accountIds.push(a.id);
      if (a.User) made.userIds.push(a.User.id);
      return { acctId: a.id, userId: a.User!.id };
    };

    const me = await makeActor(line.id, "me");

    /* A container, which the data set below belongs to and the access
       list tests read from. Its code is a unique Int. */
    const boxCode = () => 800000000 + Math.floor(Math.random() * 99000000);
    const container = await prisma.inventoryBox.create({
      data: {
        name: `${TAG}box`, code: boxCode(),
        lineId: line.id, userId: me.userId,
      },
      select: { id: true },
    });
    made.containerIds.push(container.id);

    // ── the item-code generator ───────────────────────────────────────
    console.log("\nthe item-code generator");

    const CODE = 550000; // Math.floor(100000 + 0.5 * 900000)

    /*
      A row whose QUANTITY is the number the generator is about to draw.
      The old code searched `quantity`, found this, and then re-asked
      about the same number for ever, because the candidate was drawn
      outside the loop.
    */
    const decoy = await prisma.supplies.create({
      data: { item: `${TAG}decoy`, lineId: line.id, quantity: CODE },
      select: { id: true, code: true },
    });
    made.supplyIds.push(decoy.id);

    Math.random = () => 0.5;
    const notHung = await within(6000, generatedItemCode());
    ok("a six-figure quantity does not hang the generator",
      !notHung.timedOut, "still running after 6s");
    ok("...and it returns the free code it drew",
      notHung.value === CODE, `got ${notHung.value}`);

    /* Now make that CODE genuinely taken, and offer a second draw. */
    const taken = await prisma.supplies.create({
      data: { item: `${TAG}taken`, lineId: line.id, quantity: 1, code: CODE },
      select: { id: true },
    });
    made.supplyIds.push(taken.id);

    const draws = [0.5, 0.6]; // -> 550000 (taken), then 640000 (free)
    let drawn = 0;
    Math.random = () => draws[Math.min(drawn++, draws.length - 1)];
    const retried = await within(6000, generatedItemCode());
    ok("a taken code is not handed out again",
      !retried.timedOut && retried.value === 640000,
      retried.timedOut ? "timed out" : `got ${retried.value}`);
    ok("...which took a second draw", drawn >= 2, `drew ${drawn} time(s)`);
    Math.random = realRandom;

    // ── the bulk importer ─────────────────────────────────────────────
    console.log("\nthe bulk importer");

    const dataset = await prisma.suppliesDataSet.create({
      data: {
        title: `${TAG}ds`, lineId: line.id, inventoryBoxId: container.id,
      },
      select: { id: true },
    });
    made.datasetIds.push(dataset.id);

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("items");
    sheet.addRow([`${TAG}penA`]);
    sheet.addRow([`${TAG}penB`]);
    const xlsx = Buffer.from(await workbook.xlsx.writeBuffer());

    const multipartReq = (fields: Record<string, string>, acctId: string) => ({
      isMultipart: () => true,
      parts: async function* () {
        yield {
          type: "file",
          file: (async function* () { yield xlsx; })(),
        };
        for (const [fieldname, value] of Object.entries(fields)) {
          yield { type: "field", fieldname, value };
        }
      },
      user: { id: acctId },
    });

    const mine = await call(uploadBulkExcel, multipartReq(
      { lineId: line.id, dataSetId: dataset.id }, me.acctId,
    ));
    ok("an import into the caller's own line is accepted",
      mine.code === 200, mine.threw || `code ${mine.code}`);

    const imported = await prisma.supplies.findMany({
      where: { item: { startsWith: `${TAG}pen` } },
      select: { id: true, lineId: true, code: true },
    });
    imported.forEach((s) => made.supplyIds.push(s.id));
    ok("both rows landed under the caller's line",
      imported.length === 2 && imported.every((s) => s.lineId === line.id),
      `${imported.length} row(s): ${imported.map((s) => s.lineId).join(", ")}`);
    ok("each imported row got a distinct code",
      new Set(imported.map((s) => s.code)).size === imported.length,
      imported.map((s) => s.code).join(", "));

    if (lines.length > 1) {
      const other = lines[1];
      const theirs = await call(uploadBulkExcel, multipartReq(
        { lineId: other.id, dataSetId: dataset.id }, me.acctId,
      ));
      ok("an import aimed at another municipality is refused",
        theirs.threw.includes("not your municipality"),
        theirs.threw || `code ${theirs.code}`);

      const leaked = await prisma.supplies.count({
        where: { item: { startsWith: `${TAG}pen` }, lineId: other.id },
      });
      ok("...and nothing was written there", leaked === 0, `${leaked} row(s)`);
    } else {
      console.log("  (only one line here - cross-line import check skipped)");
    }

    // ── the container access list ─────────────────────────────────────
    console.log("\na container's access list");

    const allowed = await prisma.containerAllowedUser.create({
      data: {
        inventoryBoxId: container.id,
        userId: me.userId,
        grantByUserId: me.userId,
      },
      select: { id: true },
    });
    made.allowedIds.push(allowed.id);

    const oneWord = await call(inventoryLogsAccessList, {
      query: { id: container.id, query: "guard" }, user: { id: me.acctId },
    });
    ok("a one-word search works", oneWord.code === 200,
      oneWord.threw || `code ${oneWord.code}`);

    const twoWords = await call(inventoryLogsAccessList, {
      query: { id: container.id, query: `${TAG}me guard` },
      user: { id: me.acctId },
    });
    ok("a two-word search works too", twoWords.code === 200,
      twoWords.threw || `code ${twoWords.code}`);

    const noLimit = await call(inventoryLogsAccessList, {
      query: { id: container.id }, user: { id: me.acctId },
    });
    ok("omitting the limit returns a page rather than failing",
      noLimit.code === 200, noLimit.threw || `code ${noLimit.code}`);
    ok("...and does not claim there is more to come",
      noLimit.body?.hasMore === false, String(noLimit.body?.hasMore));

    if (lines.length > 1) {
      const otherBox = await prisma.inventoryBox.create({
        data: {
          name: `${TAG}box2`, code: boxCode(),
          lineId: lines[1].id, userId: me.userId,
        },
        select: { id: true },
      });
      made.containerIds.push(otherBox.id);

      const peek = await call(inventoryLogsAccessList, {
        query: { id: otherBox.id }, user: { id: me.acctId },
      });
      ok("another municipality's access list is refused",
        peek.threw !== "" && peek.code !== 200,
        peek.threw || `code ${peek.code}`);
    } else {
      console.log("  (only one line here - cross-line access check skipped)");
    }
  } finally {
    Math.random = realRandom;
    await prisma.containerAllowedUser.deleteMany({ where: { id: { in: made.allowedIds } } });
    await prisma.inventoryAccessLogs.deleteMany({
      where: { inventoryBoxId: { in: made.containerIds } },
    });
    await prisma.supplies.deleteMany({ where: { id: { in: made.supplyIds } } });
    await prisma.supplies.deleteMany({ where: { item: { startsWith: TAG } } });
    await prisma.inventoryBox.deleteMany({ where: { id: { in: made.containerIds } } });
    await prisma.suppliesDataSet.deleteMany({ where: { id: { in: made.datasetIds } } });
    await prisma.user.deleteMany({ where: { id: { in: made.userIds } } });
    await prisma.account.deleteMany({ where: { id: { in: made.accountIds } } });
    await prisma.$disconnect();
  }

  console.log(`\n${pass} passed, ${fails.length} failed`);
  process.exit(fails.length ? 1 : 0);
})();
