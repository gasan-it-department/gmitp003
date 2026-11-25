/**
 * Editing a dispense: the figures an edit measures itself against.
 *
 * The original record's quantity is never rewritten. An edit writes a
 * compensating "ADJ:" row instead, which is what keeps the audit trail
 * intact — so an edit must read the base row AND its adjustments to know
 * what the transaction currently stands at. Reading the base row alone
 * measured every edit against the amount first dispensed, and an edit
 * that was resent applied twice:
 *
 *   dispense 10, then "set this transaction to 15" three times
 *     -> 25 pieces taken, logged as 10, +5, +5, +5
 *
 *   dispense 10, then transfer 8 away twice
 *     -> 16 units moved out of a 10-unit transaction, and a transfer
 *        moves no stock, so nothing anywhere refused it
 *
 * Both were silent: every request named an absolute target and every one
 * was accepted. Alongside those, the quantity a dispense will accept at
 * all — parseInt takes 9 from "9abc" and ONE from "1e3", and a `<= 0`
 * guard lets NaN past entirely.
 */
import path from "path";
const entry = path.join(process.cwd(), "src", "index.ts");
require.cache[entry] = {
  id: entry, filename: entry, loaded: true,
  exports: { notificationSocket: { emitUserNotification: () => undefined } },
} as never;

import { prisma } from "./src/barrel/prisma";
import {
  dispenseSupply,
  updateSupplyDispense,
} from "./src/controller/supplyController";

let pass = 0;
const fails: string[] = [];
const ok = (name: string, cond: boolean, detail = "") => {
  if (cond) { pass++; console.log(`  ok    ${name}`); }
  else { fails.push(name); console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`); }
};

const TAG = "__e2e_edit__";
const START = 100;

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
  accountIds: [] as string[], userIds: [] as string[],
};

/* Run a handler and report what came back, without throwing. */
const call = async (fn: any, req: any) => {
  const res = mockRes();
  try {
    await fn(req, res);
    return { code: res._code, body: res._body, threw: "" };
  } catch (e) {
    return { code: 0, body: null, threw: e instanceof Error ? e.message : String(e) };
  }
};

(async () => {
  try {
    const line = await prisma.line.findFirst({ select: { id: true } });
    if (!line) { console.log("no line in this database — skipping"); process.exit(0); }

    const makeActor = async (n: string) => {
      const a = await prisma.account.create({
        data: {
          username: `${TAG}${n}${Date.now()}`, password: "x",
          lineId: line.id, status: 1,
          User: { create: {
            firstName: TAG + n, lastName: "e2e", lineId: line.id,
            username: `${TAG}u${n}${Date.now()}`, email: `${TAG}${n}@e.invalid`,
          } },
        },
        select: { id: true, User: { select: { id: true } } },
      });
      made.accountIds.push(a.id);
      if (a.User) made.userIds.push(a.User.id);
      return { acctId: a.id, userId: a.User!.id };
    };

    const me = await makeActor("me");
    const dest = await makeActor("dest");

    const supply = await prisma.supplies.create({
      data: { item: `${TAG}item`, lineId: line.id, quantity: 1 },
      select: { id: true },
    });
    made.supplyIds.push(supply.id);

    const freshStock = async () => {
      const st = await prisma.supplyStockTrack.create({
        data: {
          suppliesId: supply.id, stock: START, quantity: START,
          perQuantity: 1, desc: TAG,
        },
        select: { id: true },
      });
      made.stockIds.push(st.id);
      return st.id;
    };

    const stockOf = async (id: string) =>
      (await prisma.supplyStockTrack.findUnique({
        where: { id }, select: { stock: true },
      }))!.stock;

    const recordsOf = async (stockId: string) =>
      prisma.supplyDispenseRecord.findMany({
        where: { supplyStockTrackId: stockId },
        select: { quantity: true, desc: true, userId: true },
        orderBy: { timestamp: "asc" },
      });

    const netOf = async (stockId: string) =>
      (await recordsOf(stockId)).reduce(
        (total, r) => total + (parseInt(r.quantity, 10) || 0), 0,
      );

    /* Dispense N and hand back the id of the record it wrote. */
    const dispense = async (stockId: string, quantity: string) => {
      const r = await call(dispenseSupply, {
        body: { id: stockId, quantity, remark: TAG, userId: me.userId },
        user: { id: me.acctId },
      });
      const rec = await prisma.supplyDispenseRecord.findFirst({
        where: { supplyStockTrackId: stockId },
        select: { id: true },
        orderBy: { timestamp: "asc" },
      });
      return { ...r, recordId: rec?.id ?? "" };
    };

    // ── what a dispense will accept as a quantity ─────────────────────
    console.log("\nquantity a dispense accepts");

    const refusals: [string, string][] = [
      ["abc", "unparseable"],
      ["", "empty"],
      ["0", "zero"],
      ["-5", "negative"],
      ["5.9", "fractional"],
      ["9abc", "parseInt would take 9"],
      ["1e3", "parseInt would take 1, not 1000"],
    ];
    for (const [input, why] of refusals) {
      const id = await freshStock();
      const r = await dispense(id, input);
      const after = await stockOf(id);
      ok(`"${input}" is refused (${why})`,
        r.threw !== "" && after === START,
        `threw=${r.threw.slice(0, 40) || "nothing"} stock=${after}`);
    }

    const padded = await freshStock();
    const paddedRes = await dispense(padded, "  7  ");
    ok("a whitespace-padded quantity still dispenses",
      paddedRes.code === 200 && (await stockOf(padded)) === START - 7,
      `code=${paddedRes.code} stock=${await stockOf(padded)}`);

    // ── adjusting the same transaction twice ──────────────────────────
    console.log("\nadjusting a transaction to an absolute target");

    const adjStock = await freshStock();
    const adj = await dispense(adjStock, "10");
    ok("the dispense of 10 took 10 pieces",
      (await stockOf(adjStock)) === START - 10, `stock=${await stockOf(adjStock)}`);

    const setTo = (quantity: string) =>
      call(updateSupplyDispense, {
        body: { id: adj.recordId, quantity, mode: "adjust", currUserId: me.userId },
        user: { id: me.acctId },
      });

    const first = await setTo("15");
    ok("raising it to 15 is applied", first.threw === "", first.threw);
    ok("raising it to 15 took 5 more pieces",
      (await stockOf(adjStock)) === START - 15, `stock=${await stockOf(adjStock)}`);

    const second = await setTo("15");
    ok("setting it to 15 again changes nothing",
      second.threw.includes("Nothing to update"),
      second.threw || `code ${second.code}`);
    ok("...and the stock is untouched by the repeat",
      (await stockOf(adjStock)) === START - 15, `stock=${await stockOf(adjStock)}`);

    const third = await setTo("15");
    ok("a third identical request is refused too",
      third.threw.includes("Nothing to update"), third.threw);

    const adjRows = (await recordsOf(adjStock)).filter(
      (r) => r.desc && r.desc.startsWith("ADJ:"),
    );
    ok("exactly one adjustment row was written", adjRows.length === 1,
      `${adjRows.length} rows: ${adjRows.map((r) => r.quantity).join(", ")}`);

    await setTo("12");
    ok("lowering it to 12 returns 3 pieces",
      (await stockOf(adjStock)) === START - 12, `stock=${await stockOf(adjStock)}`);
    ok("the records net to the 12 actually dispensed",
      (await netOf(adjStock)) === 12, `net=${await netOf(adjStock)}`);

    // ── transferring out of the same transaction twice ────────────────
    console.log("\ntransferring units to another recipient");

    const xferStock = await freshStock();
    const xfer = await dispense(xferStock, "10");
    const stockBeforeTransfer = await stockOf(xferStock);

    const transfer = (quantity: string) =>
      call(updateSupplyDispense, {
        body: {
          id: xfer.recordId, mode: "transfer", transferQuantity: quantity,
          toUserId: dest.userId, currUserId: me.userId,
        },
        user: { id: me.acctId },
      });

    const t1 = await transfer("8");
    ok("transferring 8 of the 10 is applied", t1.threw === "", t1.threw);
    ok("a transfer moves no stock",
      (await stockOf(xferStock)) === stockBeforeTransfer,
      `${stockBeforeTransfer} -> ${await stockOf(xferStock)}`);

    const t2 = await transfer("8");
    ok("transferring 8 again is refused — only 2 are left",
      t2.threw.includes("only has 2"), t2.threw || `code ${t2.code}`);

    ok("the records still net to the 10 dispensed",
      (await netOf(xferStock)) === 10, `net=${await netOf(xferStock)}`);

    const xferRows = await recordsOf(xferStock);
    ok("the deduction stayed with the original recipient",
      xferRows.some((r) => r.quantity === "-8" && r.userId === me.userId),
      xferRows.map((r) => `${r.quantity}@${r.userId?.slice(0, 6)}`).join(", "));
    ok("the receipt is filed under the new recipient",
      xferRows.some((r) => r.quantity === "+8" && r.userId === dest.userId),
      xferRows.map((r) => `${r.quantity}@${r.userId?.slice(0, 6)}`).join(", "));

    const t3 = await transfer("2");
    ok("transferring the remaining 2 is allowed", t3.threw === "", t3.threw);
    const t4 = await transfer("1");
    ok("nothing is left to transfer afterwards",
      t4.threw.includes("only has 0"), t4.threw || `code ${t4.code}`);
  } finally {
    await prisma.supplyDispenseRecord.deleteMany({
      where: { supplyStockTrackId: { in: made.stockIds } },
    });
    await prisma.supplyStockTrack.deleteMany({ where: { id: { in: made.stockIds } } });
    await prisma.supplies.deleteMany({ where: { id: { in: made.supplyIds } } });
    await prisma.user.deleteMany({ where: { id: { in: made.userIds } } });
    await prisma.account.deleteMany({ where: { id: { in: made.accountIds } } });
    console.log(`\n(removed ${made.stockIds.length} stock row(s) and their records)`);
    await prisma.$disconnect();
  }

  console.log(`\n${pass} passed, ${fails.length} failed`);
  process.exit(fails.length ? 1 : 0);
})();
