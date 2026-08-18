/* PROOF: HR Message Queue — the batch flow.
 *
 * create batch -> write message -> add recipients (pending) -> send ->
 * each row flips to sent/failed -> retry only the failures.
 *
 * Deliberately uses fixture users with NO usable contact detail (or a
 * non-Gmail address) so every send fails LOCALLY, before any SMS or email is
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
  searchEmployees,
  listBatches,
  createBatch,
  updateBatch,
  deleteBatch,
  batchDetail,
  addRecipients,
  removeRecipient,
  sendBatch,
  retryBatch,
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
  const threwWith = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      return "";
    } catch (e: any) {
      return e?.message ?? "err";
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
      opts: { status?: string; lineId?: string } = {},
    ) => {
      const lineId = opts.lineId ?? LINE;
      const acct = await prisma.account.create({
        data: { username: `qa_msg_${TS}_${tag}`, password: "x", lineId },
        select: { id: true, username: true },
      });
      made.accountIds.push(acct.id);
      const { EncryptionService: E } = await import("./src/service/encryption");
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
          // No phone number, and a non-Gmail address on purpose: both
          // channels must refuse LOCALLY so nothing leaves this machine.
          email: `qa-msg-${TS}-${tag}@invalid.test`,
        },
        select: { id: true },
      });
      made.userIds.push(u.id);
      return { accountId: acct.id, userId: u.id };
    };

    const HR = await mkUser("hr");
    const PLANT = await mkUser("plantilla", { status: "Permanent" });
    const NONPLANT = await mkUser("joborder", { status: "Job Order" });

    // -- 1. Tokens and rendering ---------------------------------------
    const body =
      "Good day, {{fullName}}, of {{office}}. Ref {{fullName}} / {{notAField}}.";
    const toks = extractTokens(body);
    ok("tokens are extracted", toks.includes("fullName") && toks.includes("office"));
    ok("repeated tokens are de-duplicated",
      toks.filter((t) => t === "fullName").length === 1);

    const rendered = await renderFor(body, PLANT.userId);
    ok("a real value replaces its token", rendered.includes("MSGTEST"), rendered);
    ok("an UNKNOWN token stays visible rather than blanking",
      rendered.includes("{{notAField}}"), rendered);
    ok("no literal {{fullName}} survives", !rendered.includes("{{fullName}}"));

    // -- 2. Templates ---------------------------------------------------
    let res = mockRes();
    await saveTemplate(
      reqAs(HR.accountId, { body: { name: `QA tpl ${TS}`, channel: "sms", body } }),
      res,
    );
    const tpl = res._body;
    if (tpl?.id) made.templateIds.push(tpl.id);
    ok("template is created", res._code === 201 && !!tpl?.id);
    ok("placeholders are stored on the template",
      Array.isArray(tpl?.placeholders) && tpl.placeholders.includes("office"));

    ok("an email template without a subject is refused",
      !!(await threwWith(() =>
        saveTemplate(
          reqAs(HR.accountId, { body: { name: "x", channel: "email", body: "hi" } }),
          mockRes(),
        ))));

    res = mockRes();
    await listTemplates(reqAs(HR.accountId, { query: {} }), res);
    ok("the template is listed for its line",
      (res._body?.templates ?? []).some((t: any) => t.id === tpl.id));

    // -- 3. Create a batch FROM the template ----------------------------
    res = mockRes();
    await createBatch(
      reqAs(HR.accountId, {
        body: { name: `QA batch ${TS}`, channel: "sms", templateId: tpl.id },
      }),
      res,
    );
    const batch = res._body;
    if (batch?.id) made.batchIds.push(batch.id);
    ok("batch is created as a DRAFT", res._code === 201 && batch?.status === "draft");
    ok("the template pre-filled the draft body", batch?.body === body, batch?.body);
    ok("a new draft starts with no recipients", batch?.total === 0);

    // -- 4. Employee search + audience split ----------------------------
    res = mockRes();
    await searchEmployees(
      reqAs(HR.accountId, {
        query: { audience: "plantilla", query: "MSGTEST", batchId: batch.id },
      }),
      res,
    );
    let list = res._body?.employees ?? [];
    ok("Plantilla filter INCLUDES the permanent employee",
      list.some((r: any) => r.id === PLANT.userId));
    ok("Plantilla filter EXCLUDES the job order",
      !list.some((r: any) => r.id === NONPLANT.userId));
    ok("the cap is advertised to the UI", res._body?.max === MAX_RECIPIENTS);
    ok("nobody is marked as already added yet",
      list.every((r: any) => r.added === false));

    res = mockRes();
    await searchEmployees(
      reqAs(HR.accountId, { query: { audience: "non-plantilla", query: "MSGTEST" } }),
      res,
    );
    list = res._body?.employees ?? [];
    ok("Non-Plantilla filter INCLUDES the job order",
      list.some((r: any) => r.id === NONPLANT.userId));
    ok("Non-Plantilla filter EXCLUDES the permanent employee",
      !list.some((r: any) => r.id === PLANT.userId));

    res = mockRes();
    await searchEmployees(
      reqAs(HR.accountId, { query: { channel: "email", query: "MSGTEST" } }),
      res,
    );
    const nonGmail = (res._body?.employees ?? []).find((r: any) => r.id === PLANT.userId);
    ok("a non-Gmail address is flagged unsendable with a reason",
      nonGmail && nonGmail.sendable === false && /Gmail/i.test(nonGmail.reason ?? ""),
      JSON.stringify(nonGmail));

    res = mockRes();
    await searchEmployees(
      reqAs(HR.accountId, { query: { channel: "sms", query: "MSGTEST" } }),
      res,
    );
    const noPhone = (res._body?.employees ?? []).find((r: any) => r.id === PLANT.userId);
    ok("a missing mobile number is flagged unsendable with a reason",
      noPhone && noPhone.sendable === false && /mobile/i.test(noPhone.reason ?? ""));

    // -- 5. Add recipients ----------------------------------------------
    res = mockRes();
    await addRecipients(
      reqAs(HR.accountId, {
        params: { id: batch.id },
        body: { userIds: [PLANT.userId, NONPLANT.userId] },
      }),
      res,
    );
    ok("two recipients are added", res._body?.added === 2 && res._body?.total === 2);

    // Adding the same person twice must not duplicate the row.
    res = mockRes();
    await addRecipients(
      reqAs(HR.accountId, { params: { id: batch.id }, body: { userIds: [PLANT.userId] } }),
      res,
    );
    ok("re-adding the same person does NOT duplicate the row", res._body?.total === 2);

    res = mockRes();
    await searchEmployees(
      reqAs(HR.accountId, { query: { query: "MSGTEST", batchId: batch.id } }),
      res,
    );
    ok("the picker marks people already on the batch",
      (res._body?.employees ?? []).find((r: any) => r.id === PLANT.userId)?.added === true);

    res = mockRes();
    await batchDetail(reqAs(HR.accountId, { params: { id: batch.id }, query: {} }), res);
    ok("recipients sit at PENDING before sending",
      res._body?.counts?.pending === 2 && res._body?.counts?.sent === 0);
    const pendingRows = res._body?.recipients ?? [];

    // Searching the recipient list must not change the counts.
    res = mockRes();
    await batchDetail(
      reqAs(HR.accountId, { params: { id: batch.id }, query: { search: "JOBORDER" } }),
      res,
    );
    ok("the recipient list is searchable", (res._body?.recipients ?? []).length === 1,
      JSON.stringify((res._body?.recipients ?? []).map((r: any) => r.name)));
    ok("searching does not change the batch counts", res._body?.counts?.total === 2);

    // -- 6. A pending recipient can be removed --------------------------
    const dropMe = pendingRows.find((r: any) => r.userId === NONPLANT.userId);
    res = mockRes();
    await removeRecipient(
      reqAs(HR.accountId, { params: { id: batch.id, recipientId: dropMe.id } }),
      res,
    );
    ok("a pending recipient can be removed", res._body?.total === 1);
    res = mockRes();
    await addRecipients(
      reqAs(HR.accountId, { params: { id: batch.id }, body: { userIds: [NONPLANT.userId] } }),
      res,
    );
    ok("and added back", res._body?.total === 2);

    // -- 7. The cap is enforced SERVER-side ------------------------------
    const capMsg = await threwWith(() =>
      addRecipients(
        reqAs(HR.accountId, {
          params: { id: batch.id },
          body: { userIds: Array.from({ length: MAX_RECIPIENTS, }, (_, i) => `fake-${i}`) },
        }),
        mockRes(),
      ));
    ok(`going past ${MAX_RECIPIENTS} recipients is refused`, !!capMsg, capMsg || "NO THROW");

    // -- 8. Editing the draft --------------------------------------------
    res = mockRes();
    await updateBatch(
      reqAs(HR.accountId, {
        params: { id: batch.id },
        body: { body: body + " Regards.", audience: "plantilla" },
      }),
      res,
    );
    ok("a draft can be edited", res._body?.body?.endsWith("Regards."));
    ok("the audience is recorded", res._body?.audience === "plantilla");

    // -- 9. Send (all fail locally — nothing dispatched) -----------------
    res = mockRes();
    await sendBatch(reqAs(HR.accountId, { params: { id: batch.id } }), res);
    ok("both recipients failed for want of a mobile number",
      res._body?.failed === 2 && res._body?.sent === 0 && res._body?.pending === 0,
      JSON.stringify(res._body));

    res = mockRes();
    await batchDetail(reqAs(HR.accountId, { params: { id: batch.id }, query: {} }), res);
    const sentBatch = res._body?.batch;
    const recips = res._body?.recipients ?? [];
    ok("the batch is now marked SENT", sentBatch?.status === "sent" && !!sentBatch?.sentAt);
    ok("the failure REASON is recorded per recipient",
      recips.every((r: any) => r.status === "failed" && /mobile/i.test(r.error ?? "")));
    ok("the rendered text is FROZEN on each row",
      recips.every((r: any) => r.renderedBody.includes("MSGTEST")));
    ok("each recipient has exactly one attempt so far",
      recips.every((r: any) => r.attempts === 1));

    // -- 10. A sent batch is immutable ------------------------------------
    ok("a sent batch cannot be edited",
      !!(await threwWith(() =>
        updateBatch(
          reqAs(HR.accountId, { params: { id: batch.id }, body: { body: "tampered" } }),
          mockRes(),
        ))));
    ok("a sent batch cannot be deleted",
      !!(await threwWith(() =>
        deleteBatch(reqAs(HR.accountId, { params: { id: batch.id } }), mockRes()))));
    ok("recipients cannot be added to a sent batch",
      !!(await threwWith(() =>
        addRecipients(
          reqAs(HR.accountId, { params: { id: batch.id }, body: { userIds: [HR.userId] } }),
          mockRes(),
        ))));
    ok("a contacted recipient cannot be removed",
      !!(await threwWith(() =>
        removeRecipient(
          reqAs(HR.accountId, { params: { id: batch.id, recipientId: recips[0].id } }),
          mockRes(),
        ))));
    ok("it cannot be sent twice",
      !!(await threwWith(() =>
        sendBatch(reqAs(HR.accountId, { params: { id: batch.id } }), mockRes()))));

    // -- 11. Retry touches ONLY the failed rows ---------------------------
    // Flip one row to "sent" by hand: a retry must leave it completely alone,
    // because re-sending to someone who already got the message is the worst
    // failure mode this feature can have.
    const alreadySent = recips[0];
    await prisma.hrMessageRecipient.update({
      where: { id: alreadySent.id },
      data: { status: "sent", error: null, sentAt: new Date() },
    });

    res = mockRes();
    await retryBatch(reqAs(HR.accountId, { params: { id: batch.id }, body: {} }), res);
    ok("retry only picked up the failed row", res._body?.retried === 1,
      JSON.stringify(res._body));

    const after = await prisma.hrMessageRecipient.findMany({
      where: { batchId: batch.id },
    });
    const sentRow = after.find((r) => r.id === alreadySent.id)!;
    const failedRow = after.find((r) => r.id !== alreadySent.id)!;
    ok("the already-sent row was NOT re-sent (attempts unchanged)", sentRow.attempts === 1);
    ok("the already-sent row is still marked sent", sentRow.status === "sent");
    ok("the failed row was attempted again", failedRow.attempts === 2);
    ok("the failed row is still failed (no number to send to)", failedRow.status === "failed");

    const bRow = await prisma.hrMessageBatch.findUnique({ where: { id: batch.id } });
    ok("batch counters were recomputed",
      bRow?.sentCount === 1 && bRow?.failedCount === 1,
      JSON.stringify({ s: bRow?.sentCount, f: bRow?.failedCount }));

    // With nothing left in "failed", a retry must refuse rather than quietly
    // re-sending to people who already received the message.
    await prisma.hrMessageRecipient.updateMany({
      where: { batchId: batch.id, status: "failed" },
      data: { status: "sent", error: null, sentAt: new Date() },
    });
    ok("retrying with nothing failing is refused",
      !!(await threwWith(() =>
        retryBatch(reqAs(HR.accountId, { params: { id: batch.id }, body: {} }), mockRes()))));
    // Put it back so the counter assertions below still describe reality.
    await prisma.hrMessageRecipient.update({
      where: { id: failedRow.id },
      data: { status: "failed", error: "No mobile number on file", sentAt: null },
    });

    // -- 12. Line isolation ------------------------------------------------
    if (OTHER_LINE) {
      const OUTSIDER = await mkUser("outsider", { lineId: OTHER_LINE });
      res = mockRes();
      await createBatch(reqAs(HR.accountId, { body: { channel: "sms" } }), res);
      const b2 = res._body;
      made.batchIds.push(b2.id);
      res = mockRes();
      await addRecipients(
        reqAs(HR.accountId, { params: { id: b2.id }, body: { userIds: [OUTSIDER.userId] } }),
        res,
      );
      ok("a user from ANOTHER line is never added", res._body?.total === 0);

      res = mockRes();
      await searchEmployees(reqAs(HR.accountId, { query: { query: "MSGTEST" } }), res);
      ok("the outsider does not appear in employee search",
        !(res._body?.employees ?? []).some((r: any) => r.id === OUTSIDER.userId));

      // A draft with nobody on it cannot be sent.
      ok("an empty draft cannot be sent",
        !!(await threwWith(() =>
          sendBatch(reqAs(HR.accountId, { params: { id: b2.id } }), mockRes()))));

      // A draft CAN be deleted.
      res = mockRes();
      await deleteBatch(reqAs(HR.accountId, { params: { id: b2.id } }), res);
      ok("a draft can be deleted", res._code === 200);
      made.batchIds = made.batchIds.filter((x) => x !== b2.id);
    } else {
      console.log("SKIP  line isolation (only one line in this DB)");
    }

    // -- 13. Batch list ----------------------------------------------------
    res = mockRes();
    await listBatches(reqAs(HR.accountId, { query: {} }), res);
    ok("the batch appears in the list",
      (res._body?.batches ?? []).some((x: any) => x.id === batch.id));
    ok("the list is paginated", typeof res._body?.pages === "number");

    res = mockRes();
    await listBatches(reqAs(HR.accountId, { query: { search: `QA batch ${TS}` } }), res);
    ok("the batch list is searchable by name",
      (res._body?.batches ?? []).length === 1 &&
        res._body.batches[0].id === batch.id);

    res = mockRes();
    await listBatches(reqAs(HR.accountId, { query: { search: `nope-${TS}` } }), res);
    ok("a search that matches nothing returns nothing",
      (res._body?.batches ?? []).length === 0);

    res = mockRes();
    await listBatches(reqAs(HR.accountId, { query: { status: "draft" } }), res);
    ok("the list can be filtered to drafts only",
      !(res._body?.batches ?? []).some((x: any) => x.id === batch.id));

    // -- 14. Template delete does not erase history ------------------------
    res = mockRes();
    await deleteTemplate(reqAs(HR.accountId, { params: { id: tpl.id } }), res);
    ok("the template can be deleted", res._code === 200);
    made.templateIds = made.templateIds.filter((x) => x !== tpl.id);
    ok("deleting a template does NOT delete the sent batch",
      !!(await prisma.hrMessageBatch.findUnique({ where: { id: batch.id } })));
  } catch (e: any) {
    fail++;
    console.log("FAIL  threw: " + (e?.stack ?? e?.message ?? String(e)));
  } finally {
    try {
      if (made.batchIds.length) {
        await prisma.hrMessageRecipient.deleteMany({
          where: { batchId: { in: made.batchIds } },
        });
        await prisma.hrMessageBatch.deleteMany({
          where: { id: { in: made.batchIds } },
        });
      }
      if (made.templateIds.length)
        await prisma.hrMessageTemplate.deleteMany({
          where: { id: { in: made.templateIds } },
        });
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
      const leftB = await prisma.hrMessageBatch.count({
        where: { name: { startsWith: `QA batch ${TS}` } },
      });
      console.log(`CLEANUP  leftover users=${leftU} templates=${leftT} batches=${leftB}`);
      if (leftU || leftT || leftB) fail++;
    } catch (e: any) {
      console.log("CLEANUP FAILED: " + (e?.message ?? e));
      fail++;
    }
    console.log(`\n${pass} passed, ${fail} failed`);
    await prisma.$disconnect();
    process.exit(fail ? 1 : 0);
  }
})();
