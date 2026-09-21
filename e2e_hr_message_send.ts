/* PROOF: one bad recipient must not take down the whole send.
 *
 * The send and retry loops were unguarded. `renderFor` reads and decrypts
 * the employee's own record, so a single unreadable row — a bad ciphertext,
 * a relation that has gone — threw out of the entire handler. Everybody
 * already sent in that wave stayed sent, the rest stayed pending, and HR got
 * a bare "Request failed with status code 500" naming neither the person nor
 * the reason. There was no way to find out which of forty people it was.
 *
 * Now the failure is written to the row it belongs to and the wave carries
 * on, so the batch reports what actually happened per recipient.
 *
 * Nothing is sent: every number here is deliberately malformed, so the new
 * validation short-circuits before the gateway and no credit is spent.
 *
 * Run: npx ts-node --transpile-only e2e_hr_message_send.ts */
import path from "path";
const entry = path.join(__dirname, "src", "index.ts");
require.cache[entry] = { id: entry, filename: entry, loaded: true,
  exports: { notificationSocket: { emitUserNotification: () => undefined } } } as any;
import { prisma } from "./src/barrel/prisma";
import * as C from "./src/controller/hrMessageController";

const res = () => { const r: any = { _code:0,_body:null,
  code(n:number){this._code=n;return this;}, send(b:unknown){this._body=b;return this;},
  status(n:number){return this.code(n);} }; return r; };

(async () => {
  const TS = Date.now();
  let pass = 0, fail = 0;
  const ok = (l:string,c:boolean,d="") => { if(c){pass++;console.log("PASS  "+l);}
    else {fail++;console.log("FAIL  "+l+(d?"  -> "+d:""));} };

  const hrMod = await prisma.module.findFirst({
    where: { moduleName: "human-resources" }, select: { userId: true } });
  const actor = await prisma.user.findUnique({
    where: { id: hrMod!.userId }, select: { id: true, accountId: true, lineId: true } });
  const lineId = actor!.lineId!;
  const req = (e:any={}) => ({ user:{id:actor!.accountId}, query:{}, params:{}, body:{}, ...e }) as any;

  // Three throwaway employees so the wave has more than one row.
  const made: string[] = [], accts: string[] = [];
  for (let i = 0; i < 3; i++) {
    const a = await prisma.account.create({
      data:{username:`qa_rs_${TS}_${i}`,password:"x",lineId}, select:{id:true,username:true}});
    accts.push(a.id);
    const u = await prisma.user.create({
      data:{firstName:`Qa${i}`,lastName:`RS${TS}`,username:a.username,accountId:a.id,
            lineId,email:`qa-rs-${TS}-${i}@test.local`,active:1}, select:{id:true}});
    made.push(u.id);
  }

  const batch = await prisma.hrMessageBatch.create({
    data:{ name:`qa-resil-${TS}`, channel:"sms", lineId, createdById: actor!.id,
           body:"Hi {{firstName}}, test.", status:"draft" }, select:{id:true}});
  for (let i = 0; i < made.length; i++) {
    await prisma.hrMessageRecipient.create({
      data:{ batchId:batch.id, userId:made[i], name:`RS, Qa${i}`,
             toAddress:"0912345", renderedBody:"", status:"pending" }});
  }

  // Make the MIDDLE recipient's render blow up, the way an unreadable
  // employee record would. renderFor is called through the module object,
  // so replacing it there is exactly the path sendBatch takes.
  const realRender = (C as any).renderFor;
  let n = 0;
  Object.defineProperty(C, "renderFor", {
    configurable: true,
    value: async (body: string, userId: string) => {
      n++;
      if (n === 2) throw new Error("simulated unreadable employee record");
      return realRender(body, userId);
    },
  });

  console.log("\n-- one recipient cannot render --");
  const s = res();
  let threw = false;
  try { await C.sendBatch(req({ params:{id:batch.id}, body:{} }), s); }
  catch (e:any) { threw = true; console.log("  THREW", e?.message); }

  ok("the wave does not 500", !threw);
  ok("...it reports a result", s._code === 200, JSON.stringify(s._body));
  ok("...for all three recipients", s._body?.dispatched === 3, JSON.stringify(s._body));

  const rows = await prisma.hrMessageRecipient.findMany({
    where:{batchId:batch.id}, orderBy:{name:"asc"},
    select:{name:true,status:true,error:true}});
  for (const r of rows) console.log(`   ${r.status.padEnd(7)} ${r.name}  ${r.error ?? ""}`);
  ok("every recipient got a row written", rows.length === 3);
  ok("...all three recorded as failed with a reason",
    rows.every(r => r.status === "failed" && !!r.error));
  ok("...the bad number is named for the two that could render",
    rows.filter(r => /Not a valid PH mobile number/.test(r.error ?? "")).length === 2,
    JSON.stringify(rows.map(r=>r.error)));
  ok("...and the unreadable one says so, instead of vanishing",
    rows.some(r => /Could not prepare this message/.test(r.error ?? "")),
    JSON.stringify(rows.map(r=>r.error)));

  Object.defineProperty(C, "renderFor", { configurable: true, value: realRender });

  // ── the wave budget ───────────────────────────────────────────────────
  // Twenty sequential gateway calls inside one HTTP request is how this
  // outlives whatever is timing that request. The loop is supposed to stop
  // cleanly and hand the rest back as still-pending, rather than run on and
  // let the caller receive a proxy error page.
  console.log("\n-- a wave that runs long --");
  await prisma.hrMessageRecipient.updateMany({
    where: { batchId: batch.id }, data: { status: "pending" },
  });
  // Make each render take longer than the whole budget, so the second
  // recipient is past the deadline.
  Object.defineProperty(C, "renderFor", {
    configurable: true,
    value: async (body: string, userId: string) => {
      await new Promise((r) => setTimeout(r, 46_000));
      return realRender(body, userId);
    },
  });
  const t0 = Date.now();
  const slow = res();
  let slowThrew = false;
  try { await C.sendBatch(req({ params:{id:batch.id}, body:{} }), slow); }
  catch (e:any) { slowThrew = true; console.log("  THREW", e?.message); }
  const elapsed = Date.now() - t0;
  Object.defineProperty(C, "renderFor", { configurable: true, value: realRender });

  ok("a long wave still returns", !slowThrew);
  ok("...it stops at the budget instead of running through everyone",
    slow._body?.stoppedEarly === true, JSON.stringify(slow._body));
  ok("...having attempted only the first",
    slow._body?.dispatched === 1, JSON.stringify(slow._body));
  ok("...and says how many are left",
    slow._body?.remaining === 2, JSON.stringify(slow._body));
  ok("...in roughly one slow send, not three",
    elapsed < 90_000, `${Math.round(elapsed/1000)}s`);
  const left = await prisma.hrMessageRecipient.count({
    where: { batchId: batch.id, status: "pending" } });
  ok("...the untouched two are still pending, ready for the next press",
    left === 2, `pending=${left}`);


  await prisma.hrMessageRecipient.deleteMany({ where:{batchId:batch.id} });
  await prisma.hrMessageBatch.delete({ where:{id:batch.id} });
  for (const id of made) await prisma.user.delete({where:{id}}).catch(()=>{});
  for (const id of accts) await prisma.account.delete({where:{id}}).catch(()=>{});
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exitCode = fail === 0 ? 0 : 1;
  await prisma.$disconnect();
})();
