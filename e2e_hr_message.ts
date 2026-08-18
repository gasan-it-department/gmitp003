/* PROOF: HR Message Queue.
 *
 * Deliberately uses fixture users with NO usable contact detail (or a
 * non-Gmail address) so every send fails LOCALLY, before any SMS/email is
 * dispatched. Nothing is sent to a real person by this test.
 *
 * Run: npx ts-node --transpile-only e2e_hr_message.ts */
import { prisma } from "./src/barrel/prisma";
import {
  extractTokens,
  renderFor,
  saveTemplate,
  listTemplates,
  deleteTemplate,
  searchRecipients,
  sendBatch,
  retryBatch,
  listBatches,
  batchDetail,
  MAX_RECIPIENTS,
} from "./src/controller/hrMessageController";

const TS = Date.now();

const mockRes = () => {
  const r: any = {
    _code: 0,
    _body: null as any,
    code(n: number) {
      this._code = n;
      return this;
    },
    send(b: unknown) {
      this._body = b;
      return this;
    },
    status(n: number) {
      return this.code(n);
    },
    header() {
      return this;
    },
  };
  return r;
};
const reqAs = (accountId: string, extra: any = {}) =>
  ({ user: { id: accountId }, ...extra }) as any;

(async () => {
  let pass = 0;
  let fail = 0;
  const ok = (l: string, c: boolean, d = "") => {
    if (c) {
      pass++;
      console.log("PASS  " + l);
    } else {
      fail++;
      console.log("FAIL  " + l + (d ? "  -> " + d : ""));
    }
  };
  const made = {
    accountIds: [] as string[],
    userIds: [] as string[],
    templateIds: [] as string[],
    batchIds: [] as string[],
  };

  try {
    const lines = await prisma.line.findMany({ select: { id: true }, take: 2 });
    if (!lines.length) {
      console.log("NO FIXTURE (line)");
      process.exit(2);
    }
    const LINE = lines[0].id;
    const OTHER_LINE = lines[1]?.id ?? null;

    const mkUser = async (
      tag: string,
      opts: { status?: string; lineId?: string; email?: string } = {},
    ) => {
      const lineId = opts.lineId ?? LINE;
      const acct = await prisma.account.create({
        data: { username: `qa_msg_${TS}_${tag}`, password: "x", lineId },
        select: { id: true, username: true },
      });
      made.accountIds.push(acct.id);
      const enc = await import("./src/service/encryption");
      const E = enc.EncryptionService;
      const st = await E.encrypt(opts.status ?? "Permanent");
      const fn = await E.encrypt("Qa" + tag);
      const ln = await E.encrypt("MSGTEST" + tag.toUpperCase());
      const u = await prisma.user.create({
        data: {
          firstName: fn.encryptedData,
          firstNameIv: fn.iv,
          lastName: ln.encryptedData,
          lastNameIv: ln.iv,
          status: st.encryptedData,
          statusIV: st.iv,
          username: acct.username,
          accountId: acct.id,
          lineId,
          // No phone number, and a non-Gmail address on purpose: both send
          // channels must refuse LOCALLY so nothing leaves this machine.
          email: opts.email ?? `qa-msg-${TS}-${tag}@invalid.test`,
        },
        select: { id: true },
      });
      made.userIds.push(u.id);
      return { accountId: acct.id, userId: u.id };
    };

    const HR = await mkUser("hr");
    const PLANT = await mkUser("plantilla", { status: "Permanent" });
    const NONPLANT = await mkUser("joborder", { status: "Job Order" });

    // -- 1. Token extraction -------------------------------------------
    const body =
      "Good day, {{fullName}}, of {{office}}. Ref {{fullName}} / {{notAField}}.";
    const toks = extractTokens(body);
    ok("tokens are extracted", toks.includes("fullName") && toks.includes("office"));
    ok("repeated tokens are de-duplicated", toks.filter((t) => t === "fullName").length === 1);

    // -- 2. Rendering ---------------------------------------------------
    const rendered = await renderFor(body, PLANT.userId);
    ok("a real value replaces its token", rendered.includes("MSGTEST"), rendered);
    ok("an UNKNOWN token stays visible rather than blanking",
      rendered.includes("{{notAField}}"), rendered);
    ok("no literal {{fullName}} survives", !rendered.includes("{{fullName}}"), rendered);

    // -- 3. Templates ---------------------------------------------------
    let res = mockRes();
    await saveTemplate(
      reqAs(HR.accountId, { body: { name: `QA tpl ${TS}`, channel: "sms", body } }),
      res,
    );
    const tpl = res._body;
    if (tpl?.id) made.templateIds.push(tpl.id);
    ok("template is created", res._code === 201 && !!tpl?.id);
    ok("placeholders are stored on the template",
      Array.isArray(tpl?.placeholders) && tpl.placeholders.includes("office"),
      JSON.stringify(tpl?.placeholders));

    let threw = "";
    try {
      await saveTemplate(
        reqAs(HR.accountId, { body: { name: "x", channel: "email", body: "hi" } }),
        mockRes(),
      );
    } catch (e: any) {
      threw = e?.message ?? "err";
    }
    ok("an email template without a subject is refused", !!threw, threw || "NO THROW");

    res = mockRes();
    await listTemplates(reqAs(HR.accountId, { query: {} }), res);
    ok("the template is listed for its line",
      (res._body?.templates ?? []).some((t: any) => t.id === tpl.id));

    // -- 4. Recipient search + audience split ---------------------------
    res = mockRes();
    await searchRecipients(
      reqAs(HR.accountId, { query: { audience: "plantilla", query: "MSGTEST" } }),
      res,
    );
    let list = res._body?.recipients ?? [];
    ok("Plantilla filter INCLUDES the permanent employee",
      list.some((r: any) => r.id === PLANT.userId));
    ok("Plantilla filter EXCLUDES the job order",
      !list.some((r: any) => r.id === NONPLANT.userId),
      JSON.stringify(list.map((r: any) => r.name)));

    res = mockRes();
    await searchRecipients(
      reqAs(HR.accountId, { query: { audience: "non-plantilla", query: "MSGTEST" } }),
      res,
    );
    list = res._body?.recipients ?? [];
    ok("Non-Plantilla filter INCLUDES the job order",
      list.some((r: any) => r.id === NONPLANT.userId));
    ok("Non-Plantilla filter EXCLUDES the permanent employee",
      !list.some((r: any) => r.id === PLANT.userId));
    ok("the cap is advertised to the UI", res._body?.max === MAX_RECIPIENTS);

    res = mockRes();
    await searchRecipients(
      reqAs(HR.accountId, { query: { channel: "email", query: "MSGTEST" } }),
      res,
    );
    const nonGmail = (res._body?.recipients ?? []).find((r: any) => r.id === PLANT.userId);
    ok("a non-Gmail address is flagged unsendable with a reason",
      nonGmail && nonGmail.sendable === false && /Gmail/i.test(nonGmail.reason ?? ""),
      JSON.stringify(nonGmail));

    res = mockRes();
    await searchRecipients(
      reqAs(HR.accountId, { query: { channel: "sms", query: "MSGTEST" } }),
      res,
    );
    const noPhone = (res._body?.recipients ?? []).find((r: any) => r.id === PLANT.userId);
    ok("a missing mobile number is flagged unsendable with a reason",
      noPhone && noPhone.sendable === false && /mobile/i.test(noPhone.reason ?? ""),
      JSON.stringify(noPhone));

    // -- 5. The 20 cap is enforced SERVER-side --------------------------
    threw = "";
    try {
      await sendBatch(
        reqAs(HR.accountId, {
          body: {
            channel: "sms",
            body: "hi",
            userIds: Array.from({ length: MAX_RECIPIENTS + 1 }, (_, i) => `fake-${i}`),
          },
        }),
        mockRes(),
      );
    } catch (e: any) {
      threw = e?.message ?? "err";
    }
    ok(`sending to ${MAX_RECIPIENTS + 1} people is refused`, !!threw, threw || "NO THROW");

    threw = "";
    try {
      await sendBatch(reqAs(HR.accountId, { body: { channel: "sms", body: "hi", userIds: [] } }), mockRes());
    } catch (e: any) {
      threw = e?.message ?? "err";
    }
    ok("sending to nobody is refused", !!threw, threw || "NO THROW");

    // -- 6. Send (all fail locally — nothing dispatched) ----------------
    res = mockRes();
    await sendBatch(
      reqAs(HR.accountId, {
        body: {
          templateId: tpl.id,
          channel: "sms",
          body,
          audience: "custom",
          userIds: [PLANT.userId, NONPLANT.userId],
        },
      }),
      res,
    );
    const batchId = res._body?.batchId;
    if (batchId) made.batchIds.push(batchId);
    ok("the batch is recorded", res._code === 200 && !!batchId);
    ok("both recipients failed for want of a mobile number",
      res._body?.failed === 2 && res._body?.sent === 0,
      JSON.stringify(res._body));

    res = mockRes();
    await batchDetail(reqAs(HR.accountId, { params: { id: batchId } }), res);
    const recips = res._body?.recipients ?? [];
    ok("a per-recipient row exists for each person", recips.length === 2);
    ok("the failure REASON is recorded per recipient",
      recips.every((r: any) => r.status === "failed" && /mobile/i.test(r.error ?? "")),
      JSON.stringify(recips.map((r: any) => r.error)));
    ok("the rendered text is FROZEN on the row",
      recips.every((r: any) => r.renderedBody.includes("MSGTEST")),
      JSON.stringify(recips.map((r: any) => r.renderedBody)));
    ok("each recipient has exactly one attempt so far",
      recips.every((r: any) => r.attempts === 1));

    // -- 7. Retry touches ONLY the failed rows --------------------------
    // Flip one row to "sent" by hand: a retry must leave it completely alone,
    // because re-sending to someone who already got the message is the worst
    // failure mode this feature can have.
    const alreadySent = recips[0];
    await prisma.hrMessageRecipient.update({
      where: { id: alreadySent.id },
      data: { status: "sent", error: null, sentAt: new Date() },
    });

    res = mockRes();
    await retryBatch(reqAs(HR.accountId, { body: { batchId } }), res);
    ok("retry only picked up the failed row", res._body?.retried === 1, JSON.stringify(res._body));

    const after = await prisma.hrMessageRecipient.findMany({ where: { batchId } });
    const sentRow = after.find((r) => r.id === alreadySent.id)!;
    const failedRow = after.find((r) => r.id !== alreadySent.id)!;
    ok("the already-sent row was NOT re-sent (attempts unchanged)", sentRow.attempts === 1);
    ok("the already-sent row is still marked sent", sentRow.status === "sent");
    ok("the failed row was attempted again", failedRow.attempts === 2);
    ok("the failed row is still failed (no number to send to)", failedRow.status === "failed");

    const bRow = await prisma.hrMessageBatch.findUnique({ where: { id: batchId } });
    ok("batch counters were recomputed", bRow?.sentCount === 1 && bRow?.failedCount === 1,
      JSON.stringify({ s: bRow?.sentCount, f: bRow?.failedCount }));

    // -- 8. Line isolation ----------------------------------------------
    if (OTHER_LINE) {
      const OUTSIDER = await mkUser("outsider", { lineId: OTHER_LINE });
      res = mockRes();
      await sendBatch(
        reqAs(HR.accountId, {
          body: { channel: "sms", body: "hi", userIds: [OUTSIDER.userId] },
        }),
        res,
      );
      if (res._body?.batchId) made.batchIds.push(res._body.batchId);
      ok("a user from ANOTHER line is never messaged", res._body?.sent === 0);
      const outRows = await prisma.hrMessageRecipient.count({
        where: { batchId: res._body?.batchId, userId: OUTSIDER.userId },
      });
      ok("no recipient row is written for the outsider", outRows === 0);

      res = mockRes();
      await searchRecipients(reqAs(HR.accountId, { query: { query: "MSGTEST" } }), res);
      ok("the outsider does not appear in recipient search",
        !(res._body?.recipients ?? []).some((r: any) => r.id === OUTSIDER.userId));
    } else {
      console.log("SKIP  line isolation (only one line in this DB)");
    }

    // -- 9. History ------------------------------------------------------
    res = mockRes();
    await listBatches(reqAs(HR.accountId, { query: {} }), res);
    ok("the batch appears in history",
      (res._body?.batches ?? []).some((x: any) => x.id === batchId));
    ok("history is paginated", typeof res._body?.pages === "number");

    // -- 10. Template delete ---------------------------------------------
    res = mockRes();
    await deleteTemplate(reqAs(HR.accountId, { params: { id: tpl.id } }), res);
    ok("the template can be deleted", res._code === 200);
    made.templateIds = made.templateIds.filter((x) => x !== tpl.id);
    const stillThere = await prisma.hrMessageBatch.findUnique({ where: { id: batchId } });
    ok("deleting a template does NOT delete the sent history", !!stillThere);
  } catch (e: any) {
    fail++;
    console.log("FAIL  threw: " + (e?.stack ?? e?.message ?? String(e)));
  } finally {
    try {
      if (made.batchIds.length) {
        await prisma.hrMessageRecipient.deleteMany({
          where: { batchId: { in: made.batchIds } },
        });
        await prisma.hrMessageBatch.deleteMany({ where: { id: { in: made.batchIds } } });
      }
      if (made.templateIds.length)
        await prisma.hrMessageTemplate.deleteMany({ where: { id: { in: made.templateIds } } });
      if (made.userIds.length)
        await prisma.user.deleteMany({ where: { id: { in: made.userIds } } });
      if (made.accountIds.length)
        await prisma.account.deleteMany({ where: { id: { in: made.accountIds } } });

      const leftU = await prisma.user.count({
        where: { username: { startsWith: `qa_msg_${TS}_` } },
      });
      const leftT = await prisma.hrMessageTemplate.count({
        where: { name: { startsWith: `QA tpl ${TS}` } },
      });
      console.log(`CLEANUP  leftover users=${leftU} templates=${leftT}`);
      if (leftU || leftT) fail++;
    } catch (e: any) {
      console.log("CLEANUP FAILED: " + (e?.message ?? e));
      fail++;
    }
    console.log(`\n${pass} passed, ${fail} failed`);
    await prisma.$disconnect();
    process.exit(fail ? 1 : 0);
  }
})();
