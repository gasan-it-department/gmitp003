/* Does concurrent dispensing lose stock?
 *
 *   npx ts-node --transpile-only e2e_dispense_race.ts
 *
 * dispenseSupply reads the stock row, works out the remainder in
 * application code, and writes that number back as an absolute value:
 *
 *     const stock = await prisma.supplyStockTrack.findUnique(...)   // read
 *     ...
 *     const remainingPieces = ...                                   // compute
 *     await prisma.$transaction(async (tx) => {
 *       await tx.supplyStockTrack.update({ data: { stock: remainingPieces } })
 *     })
 *
 * The transaction makes the two WRITES atomic with each other. It does
 * nothing about the read, which happened before it and is not locked, so
 * two requests can both read 200, both compute 190, and both write 190 —
 * twenty pieces issued, ten deducted. The "insufficient stock" guard is
 * checked against the same stale read, so it cannot catch it either.
 *
 * This matters here rather than in theory because the inventory desktop
 * app is offline-first: a queue of dispenses is pushed in a burst when the
 * machine reconnects, which is precisely a pile of concurrent requests for
 * the same items.
 *
 * The test fires N dispenses at once and checks the only thing that has to
 * be true: what was taken out plus what is left equals what there was.
 * Everything it creates is removed in the finally block.
 */
import path from "path";
const entry = path.join(process.cwd(), "src", "index.ts");
require.cache[entry] = {
  id: entry,
  filename: entry,
  loaded: true,
  exports: { notificationSocket: { emitUserNotification: () => undefined } },
} as never;

import { prisma } from "./src/barrel/prisma";
import { addSupply, dispenseSupply } from "./src/controller/supplyController";

let pass = 0;
const fails: string[] = [];
const ok = (name: string, cond: boolean, detail = "") => {
  if (cond) { pass++; console.log(`  ok    ${name}`); }
  else { fails.push(name); console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`); }
};

const TAG = "__e2e_race__";
const START = 200;      // pieces on the shelf
const EACH = 10;        // pieces per request
const CONCURRENT = 10;  // requests fired together  -> 100 pieces total

const mockRes = () => {
  const r: any = {
    _code: 0, _body: null as any,
    code(c: number) { r._code = c; return r; },
    send(b: any) { r._body = b; return r; },
    header() { return r; },
  };
  return r;
};

const made = {
  stockIds: [] as string[], supplyIds: [] as string[],
  accountIds: [] as string[], userIds: [] as string[], logIds: [] as string[],
};

(async () => {
  try {
    const line = await prisma.line.findFirst({ select: { id: true } });
    if (!line) { console.log("no line in this database"); process.exit(1); }

    /*
      A real account in the same line: dispensing is scoped to the
      caller's municipality now, so a stub user is no longer enough —
      which is the point.
    */
    const acct = await prisma.account.create({
      data: {
        username: `${TAG}acct${Date.now()}`,
        password: "x",
        lineId: line.id,
        status: 1,
        User: {
          create: {
            firstName: TAG, lastName: "adder", lineId: line.id,
            username: `${TAG}u${Date.now()}`, email: `${TAG}@example.invalid`,
          },
        },
      },
      select: { id: true, User: { select: { id: true } } },
    });
    made.accountIds.push(acct.id);
    if (acct.User) made.userIds.push(acct.User.id);

    const supply = await prisma.supplies.create({
      data: { item: `${TAG}item`, lineId: line.id, quantity: 1 },
      select: { id: true },
    });
    made.supplyIds.push(supply.id);

    const stock = await prisma.supplyStockTrack.create({
      data: {
        suppliesId: supply.id,
        stock: START,
        quantity: START,   // perQuantity 1 => one piece per "box"
        perQuantity: 1,
        desc: TAG,
      },
      select: { id: true },
    });
    made.stockIds.push(stock.id);

    console.log("");
    console.log(`-- ${CONCURRENT} dispenses of ${EACH}, fired together, from ${START} --`);

    const results = await Promise.all(
      Array.from({ length: CONCURRENT }, async (_, i) => {
        const res = mockRes();
        try {
          await dispenseSupply(
            {
              body: {
                id: stock.id,
                quantity: String(EACH),
                remark: `${TAG}${i}`,
              },
              user: { id: acct.id },
            } as never,
            res,
          );
          return { okd: res._code === 200 || res._body?.success === true, err: null as string | null };
        } catch (e) {
          return { okd: false, err: e instanceof Error ? e.message : String(e) };
        }
      }),
    );

    const accepted = results.filter((r) => r.okd).length;
    const refused = results.length - accepted;

    const after = await prisma.supplyStockTrack.findUnique({
      where: { id: stock.id },
      select: { stock: true, quantity: true },
    });
    const records = await prisma.supplyDispenseRecord.findMany({
      where: { supplyStockTrackId: stock.id },
      select: { quantity: true },
    });
    const issued = records.reduce((a, r) => a + Number(r.quantity || 0), 0);

    console.log(`     accepted=${accepted}  refused=${refused}`);
    console.log(`     dispense records=${records.length}, pieces issued=${issued}`);
    console.log(`     stock now=${after?.stock}  (started ${START})`);

    // The only invariant that has to hold.
    ok("issued + remaining === starting stock",
      issued + (after?.stock ?? -1) === START,
      `${issued} + ${after?.stock} = ${issued + (after?.stock ?? 0)}, expected ${START}`);

    ok("every accepted request produced exactly one record",
      records.length === accepted,
      `${records.length} records for ${accepted} accepted`);

    ok("stock never went negative", (after?.stock ?? 0) >= 0, String(after?.stock));

    /*
      The second invariant: the row carries the same amount twice, as
      pieces and as boxes. With perQuantity 1 they must agree, and the
      controller only warns to the console when they do not.
    */
    ok("the two quantity fields still agree (stock === quantity * perQuantity)",
      (after?.stock ?? -1) === (after?.quantity ?? -2) * 1,
      `stock=${after?.stock} quantity=${after?.quantity}`);
    // -- the other half: more demand than stock --------------------
    console.log("");
    console.log("-- 10 dispenses of 10 against only 40 pieces --");
    const scarce = await prisma.supplyStockTrack.create({
      data: {
        suppliesId: supply.id, stock: 40, quantity: 40,
        perQuantity: 1, desc: TAG,
      },
      select: { id: true },
    });
    made.stockIds.push(scarce.id);

    const scarceRuns = await Promise.all(
      Array.from({ length: 10 }, async (_, i) => {
        const res = mockRes();
        try {
          await dispenseSupply(
            {
              body: { id: scarce.id, quantity: "10", remark: `${TAG}s${i}` },
              user: { id: acct.id },
            } as never,
            res,
          );
          return res._code === 200 || res._body?.success === true;
        } catch {
          return false;
        }
      }),
    );
    const got = scarceRuns.filter(Boolean).length;
    const scarceAfter = await prisma.supplyStockTrack.findUnique({
      where: { id: scarce.id }, select: { stock: true },
    });
    const scarceRecs = await prisma.supplyDispenseRecord.findMany({
      where: { supplyStockTrackId: scarce.id }, select: { quantity: true },
    });
    const scarceIssued = scarceRecs.reduce((a, r) => a + Number(r.quantity || 0), 0);
    console.log(`     accepted=${got} of 10, issued=${scarceIssued}, stock now=${scarceAfter?.stock}`);

    ok("exactly four of the ten succeed", got === 4, `${got} accepted`);
    ok("the shelf is emptied, not overdrawn", scarceAfter?.stock === 0,
      String(scarceAfter?.stock));
    ok("no record exists for a dispense that was refused",
      scarceIssued === 40, `${scarceIssued} pieces recorded`);
    // -- the cross-municipality door --------------------------------
    console.log("");
    console.log("-- a caller from another municipality --");
    const other = await prisma.line.findFirst({
      where: { id: { not: line.id } }, select: { id: true },
    });
    if (other) {
      const outsider = await prisma.account.create({
        data: {
          username: `${TAG}out${Date.now()}`,
          password: "x",
          lineId: other.id,
          status: 1,
          User: {
            create: {
              firstName: TAG, lastName: "outsider", lineId: other.id,
              username: `${TAG}o${Date.now()}`, email: `${TAG}o@example.invalid`,
            },
          },
        },
        select: { id: true, User: { select: { id: true } } },
      });
      made.accountIds.push(outsider.id);
      if (outsider.User) made.userIds.push(outsider.User.id);

      const before = await prisma.supplyStockTrack.findUnique({
        where: { id: stock.id }, select: { stock: true },
      });
      const r = mockRes();
      let refused = "";
      try {
        await dispenseSupply(
          {
            body: { id: stock.id, quantity: "5", remark: `${TAG}intruder` },
            user: { id: outsider.id },
          } as never,
          r,
        );
      } catch (e) {
        refused = e instanceof Error ? e.message : String(e);
      }
      const afterIntruder = await prisma.supplyStockTrack.findUnique({
        where: { id: stock.id }, select: { stock: true },
      });

      ok("another municipality cannot dispense this stock",
        /not your municipality/i.test(refused), refused || `code ${r._code}`);
      ok("and nothing moved", before?.stock === afterIntruder?.stock,
        `${before?.stock} -> ${afterIntruder?.stock}`);
    } else {
      console.log("  (only one line in this database - skipped)");
    }

    // -- who may add a supply, and in whose name ---------------------
    console.log("");
    console.log("-- /add-supply takes the line and the actor from the token --");

    const ds = await prisma.suppliesDataSet.findFirst({
      where: { lineId: line.id },
      select: { id: true },
    });

    const callAdd = async (reqLike: Record<string, unknown>) => {
      const r = mockRes();
      try {
        await addSupply(reqLike as never, r);
        return { code: r._code, body: r._body, threw: null as string | null };
      } catch (e) {
        return { code: 0, body: null, threw: e instanceof Error ? e.message : String(e) };
      }
    };

    const anon = await callAdd({
      body: { item: `${TAG}anon`, suppliesDataSetId: ds?.id, lineId: line.id },
    });
    ok("an unauthenticated caller is refused",
      !!anon.threw && /signed in/i.test(anon.threw), anon.threw || `code ${anon.code}`);

    const otherLine = await prisma.line.findFirst({
      where: { id: { not: line.id } }, select: { id: true },
    });
    if (otherLine && ds) {
      const cross = await callAdd({
        user: { id: acct.id },
        body: { item: `${TAG}cross`, suppliesDataSetId: ds.id, lineId: otherLine.id },
      });
      ok("a lineId for ANOTHER municipality is refused",
        !!cross.threw && /not your municipality/i.test(cross.threw),
        cross.threw || `code ${cross.code}`);
    } else {
      console.log("  (only one line here - cross-line check skipped)");
    }

    if (ds) {
      const good = await callAdd({
        user: { id: acct.id },
        body: {
          item: `${TAG}good`, suppliesDataSetId: ds.id, lineId: line.id,
          // A forged actor: the audit row must NOT believe this.
          userId: "11111111-1111-1111-1111-111111111111",
        },
      });
      ok("the caller's own line is accepted", good.code === 200,
        good.threw || `code ${good.code}`);

      const row = await prisma.supplies.findFirst({
        where: { item: `${TAG}good` }, select: { id: true, lineId: true },
      });
      if (row) made.supplyIds.push(row.id);
      ok("the row is filed under the caller's line", row?.lineId === line.id,
        String(row?.lineId));

      const log = await prisma.inventoryAccessLogs.findFirst({
        where: { action: { contains: `${TAG}good` } },
        select: { id: true, userId: true },
      });
      if (log) made.logIds.push(log.id);
      ok("the audit row names the real actor, not the body's claim",
        log?.userId === acct.User?.id,
        `logged ${log?.userId}, actor ${acct.User?.id}`);
    }
  } finally {
    await prisma.supplyDispenseRecord.deleteMany({
      where: { supplyStockTrackId: { in: made.stockIds } },
    });
    await prisma.supplyStockTrack.deleteMany({ where: { id: { in: made.stockIds } } });
    await prisma.inventoryAccessLogs.deleteMany({ where: { id: { in: made.logIds } } });
    await prisma.supplies.deleteMany({ where: { id: { in: made.supplyIds } } });
    await prisma.user.deleteMany({ where: { id: { in: made.userIds } } });
    await prisma.account.deleteMany({ where: { id: { in: made.accountIds } } });
    console.log(`\n(removed ${made.stockIds.length} stock row(s) and their records)`);
    await prisma.$disconnect();
  }

  console.log(`\n${pass} passed, ${fails.length} failed`);
  process.exit(fails.length ? 1 : 0);
})();
