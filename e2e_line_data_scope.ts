/* PROOF: a line's record belongs to its own municipality, and never
 * carries the password column.
 *
 * lineData took the id from the query and answered for any line, and it
 * returned the whole Line row — password included. Nothing has ever read
 * that column, and no line in this database has one set, so nothing was
 * leaking today; the point is that the shape would leak it the moment one
 * was. This is also now a dependency of Document Receiving, which is what
 * brought it to attention.
 *
 * Run: npx ts-node --transpile-only e2e_line_data_scope.ts */
import path from "path";
const entry = path.join(__dirname, "src", "index.ts");
require.cache[entry] = { id: entry, filename: entry, loaded: true,
  exports: { notificationSocket: { emitUserNotification: () => undefined } } } as any;

import { prisma } from "./src/barrel/prisma";
import { lineData } from "./src/controller/lineController";

const TS = Date.now();
const mockRes = () => {
  const r: any = { _code: 0, _body: null as any,
    code(n: number) { this._code = n; return this; },
    send(b: unknown) { this._body = b; return this; },
    status(n: number) { return this.code(n); } };
  return r;
};

(async () => {
  let pass = 0, fail = 0;
  const ok = (l: string, c: boolean, d = "") => {
    if (c) { pass++; console.log("PASS  " + l); }
    else { fail++; console.log("FAIL  " + l + (d ? "  -> " + d : "")); }
  };
  const made = { userIds: [] as string[], accountIds: [] as string[], lineIds: [] as string[] };
  try {
    const loc = await prisma.line.findFirst({
      select: { barangayId: true, municipalId: true, provinceId: true, regionId: true } });
    if (!loc) { console.log("NO FIXTURE"); process.exit(2); }
    const mkLine = async (t: string) => {
      const l = await prisma.line.create({
        // a password on the record, so the omission is actually exercised
        data: { name: `QA Line ${TS} ${t}`, password: `secret-${TS}`, ...loc },
        select: { id: true } });
      made.lineIds.push(l.id); return l;
    };
    const A = await mkLine("A"), B = await mkLine("B");
    const mk = async (tag: string, lineId: string) => {
      const acct = await prisma.account.create({
        data: { username: `qa_ld_${TS}_${tag}`, password: "x", lineId },
        select: { id: true, username: true } });
      made.accountIds.push(acct.id);
      const u = await prisma.user.create({
        data: { firstName: "Qa", lastName: `LD${tag.toUpperCase()}`, username: acct.username,
                accountId: acct.id, lineId, email: `qa-ld-${TS}-${tag}@t.local`, active: 1 },
        select: { id: true } });
      made.userIds.push(u.id); return { accountId: acct.id, userId: u.id };
    };
    const MINE = await mk("mine", A.id), FOREIGN = await mk("foreign", B.id);

    const call = async (accountId: string | null, id: string) => {
      const r = mockRes(); let threw: any = null;
      await lineData({ user: accountId ? { id: accountId } : undefined,
                       query: { id } } as any, r).catch((e) => { threw = e; });
      return { r, threw, body: r._body };
    };

    let out = await call(MINE.accountId, A.id);
    ok("your own line still loads", !out.threw && out.r._code === 200, out.threw?.message);
    ok("…with the municipality name the labels need", !!out.body?.municipal?.name);
    ok("…and the province", !!out.body?.province?.name);
    ok("the password column is NOT in the response",
      !("password" in (out.body ?? {})), JSON.stringify(Object.keys(out.body ?? {}).filter(k=>/pass/i.test(k))));
    ok("…even though the row genuinely has one",
      (await prisma.line.findUnique({ where: { id: A.id }, select: { password: true } }))?.password === `secret-${TS}`);

    out = await call(FOREIGN.accountId, A.id);
    ok("another municipality cannot read your line", !!out.threw, out.threw?.message);
    ok("…and gets nothing back", !out.body);
    out = await call(FOREIGN.accountId, B.id);
    ok("…while their own still works", !out.threw && out.r._code === 200, out.threw?.message);
    out = await call(null, A.id);
    ok("an unauthenticated call is refused", !!out.threw);
  } catch (e: any) {
    fail++; console.log("FAIL  threw: " + (e?.stack ?? e?.message ?? String(e)));
  } finally {
    try {
      if (made.userIds.length) await prisma.user.deleteMany({ where: { id: { in: made.userIds } } });
      if (made.accountIds.length) await prisma.account.deleteMany({ where: { id: { in: made.accountIds } } });
      for (const id of made.lineIds) await prisma.line.delete({ where: { id } }).catch(() => undefined);
      const left = await prisma.line.count({ where: { name: { contains: `QA Line ${TS}` } } });
      console.log(`CLEANUP  leftover lines=${left}`);
      if (left) fail++;
    } catch (e: any) { console.log("CLEANUP FAILED: " + (e?.message ?? e)); fail++; }
    console.log(`\n${pass} passed, ${fail} failed`);
    await prisma.$disconnect();
    process.exit(fail ? 1 : 0);
  }
})();
