/* PROOF: reopening a draft routing must not cost you the setup.
 *
 * The wizard hydrated its recipients from the server but not its
 * signatories — the detail payload did not carry enough to rebuild the
 * chips, so the comment in the client said "user re-picks if they need
 * changes" and the list came back empty.
 *
 * Empty is not neutral. Stepping past the Signatories screen POSTs whatever
 * is in that list, and setSignatories drops every arrangement at or beyond
 * the new count. So walking back through your own draft deleted the
 * signatories you had already chosen, and with them the slot each signature
 * box was bound to. You then had to do the whole thing again — which is
 * exactly what it felt like.
 *
 * This file pins both halves: the detail payload has to carry who is
 * signing, and the ordered list has to survive a round trip.
 *
 * Run: npx ts-node --transpile-only e2e_resume_draft.ts */
import path from "path";

const entry = path.join(__dirname, "src", "index.ts");
require.cache[entry] = {
  id: entry,
  filename: entry,
  loaded: true,
  exports: { notificationSocket: { emitUserNotification: () => undefined } },
} as any;

import { prisma } from "./src/barrel/prisma";
import {
  disseminationDetail,
  setSignatoryArrangement,
  saveSignaturePlacements,
} from "./src/controller/disseminationController";

const TS = Date.now();

const mockRes = () => {
  const r: any = {
    _code: 0,
    _body: null as any,
    code(n: number) { this._code = n; return this; },
    send(b: unknown) { this._body = b; return this; },
    status(n: number) { return this.code(n); },
  };
  return r;
};

(async () => {
  let pass = 0, fail = 0;
  const ok = (l: string, c: boolean, d = "") => {
    if (c) { pass++; console.log("PASS  " + l); }
    else { fail++; console.log("FAIL  " + l + (d ? "  -> " + d : "")); }
  };

  const made = {
    userIds: [] as string[],
    accountIds: [] as string[],
    roomIds: [] as string[],
    queueIds: [] as string[],
    docIds: [] as string[],
  };

  try {
    const line = await prisma.line.findFirst({ select: { id: true } });
    if (!line) { console.log("NO FIXTURE (line)"); process.exit(2); }

    const mk = async (tag: string) => {
      const acct = await prisma.account.create({
        data: { username: `qa_rd_${TS}_${tag}`, password: "x", lineId: line.id },
        select: { id: true, username: true },
      });
      made.accountIds.push(acct.id);
      const u = await prisma.user.create({
        data: {
          firstName: `Qa${tag}`, lastName: `RD${TS}`,
          username: acct.username, accountId: acct.id, lineId: line.id,
          email: `qa-rd-${TS}-${tag}@test.local`, active: 1,
        },
        select: { id: true },
      });
      made.userIds.push(u.id);
      return { accountId: acct.id, userId: u.id };
    };

    const SENDER = await mk("sender");
    const A = await mk("a");
    const B = await mk("b");
    const C = await mk("c");

    const FROM = await prisma.receivingRoom.create({
      data: { code: `QA-RD-FROM-${TS}`, lineId: line.id },
      select: { id: true },
    });
    made.roomIds.push(FROM.id);

    /** Everyone needs a room membership: that row's id is what the wizard
     *  sends as a signatory. */
    const authOf = new Map<string, string>();
    for (const [tag, who] of [
      ["sender", SENDER], ["a", A], ["b", B], ["c", C],
    ] as const) {
      const rau = await prisma.roomAuthorizedUser.create({
        data: {
          receivingRoomId: FROM.id,
          userId: who.userId,
          type: tag === "sender" ? 0 : 1,
          status: 1,
        },
        select: { id: true },
      });
      authOf.set(who.userId, rau.id);
    }

    const queue = await prisma.signatureQueueRoom.create({
      data: {
        title: `qa-rd-${TS}`,
        userId: SENDER.userId,
        receivingRoomId: FROM.id,
        status: 0,
        step: 0,
      },
      select: { id: true },
    });
    made.queueIds.push(queue.id);

    const doc = await prisma.document.create({
      data: {
        title: `qa-rd-doc-${TS}`,
        lineId: line.id,
        userId: SENDER.userId,
        signatureQueueRoomId: queue.id,
      },
      select: { id: true },
    });
    made.docIds.push(doc.id);

    const setSigs = async (userIds: string[]) => {
      const r = mockRes();
      try {
        await setSignatoryArrangement(
          {
            user: { id: SENDER.accountId },
            body: {
              queueRoomId: queue.id,
              signatories: userIds.map((u) => ({
                roomAuthorizedUserId: authOf.get(u)!,
              })),
              userId: SENDER.userId,
              lineId: line.id,
            },
          } as any,
          r,
        );
        return { ok: true, message: "" };
      } catch (e: any) {
        return { ok: false, message: String(e?.message ?? e) };
      }
    };

    const detail = async () => {
      const r = mockRes();
      await disseminationDetail(
        { user: { id: SENDER.accountId }, query: { id: queue.id } } as any,
        r,
      );
      return r._body as any;
    };

    const arrangements = () =>
      prisma.signatoryArrangement.findMany({
        where: { signatureQueueRoomId: queue.id },
        orderBy: { index: "asc" },
        select: { index: true, userId: true },
      });

    // ══ 1. Pick three signatories, in order ════════════════════════════
    console.log("\n-- set up the draft --");
    const s1 = await setSigs([A.userId, B.userId, C.userId]);
    ok("three signatories saved", s1.ok, s1.message);
    const arr1 = await arrangements();
    ok("...three arrangements exist", arr1.length === 3, `got ${arr1.length}`);
    ok(
      "...in the order they were picked",
      arr1[0].userId === A.userId &&
        arr1[1].userId === B.userId &&
        arr1[2].userId === C.userId,
    );

    // Boxes bound to slots 1-3, the way the Documents step would.
    const sp = mockRes();
    await saveSignaturePlacements(
      {
        user: { id: SENDER.accountId },
        body: {
          queueRoomId: queue.id,
          documentId: doc.id,
          userId: SENDER.userId,
          lineId: line.id,
          placements: [1, 2, 3].map((s) => ({
            page: 1, slotIndex: s,
            xAxis: 1000 * s, yAxis: 2000, width: 1500, height: 500,
          })),
        },
      } as any,
      sp,
    );
    const coorBefore = await prisma.signatureCoor.count({
      where: { documentPage: { documentId: doc.id } },
    });
    ok("three signature boxes placed", coorBefore === 3, `got ${coorBefore}`);

    // ══ 2. Reopening the draft must be able to show who signs ══════════
    console.log("\n-- what the wizard gets when it reopens --");
    const d = await detail();
    const sigs = (d?.signatotyArrangement ?? []) as any[];
    ok("the detail payload carries the arrangements", sigs.length === 3);
    ok(
      "...each one says WHICH USER is signing",
      sigs.every((s) => typeof s.userId === "string" && s.userId.length > 0),
      JSON.stringify(sigs.map((s: any) => s.userId)),
    );
    ok(
      "...and carries a name, so the chip can be drawn",
      sigs.every((s) => s.user && typeof s.user.firstName === "string"),
      JSON.stringify(sigs.map((s: any) => s.user ?? null)),
    );
    ok(
      "...in signing order",
      sigs[0]?.userId === A.userId &&
        sigs[1]?.userId === B.userId &&
        sigs[2]?.userId === C.userId,
    );

    // This is the whole point: from the payload alone, can the client
    // rebuild the exact list it would POST back?
    const rebuilt = sigs
      .slice()
      .sort((x: any, y: any) => x.index - y.index)
      .map((s: any) => s.userId as string);
    ok(
      "the client can rebuild the list from the payload alone",
      rebuilt.length === 3 &&
        rebuilt[0] === A.userId &&
        rebuilt[1] === B.userId &&
        rebuilt[2] === C.userId,
    );

    // ══ 3. A round trip changes nothing ════════════════════════════════
    console.log("\n-- reopen, step through, dispatch --");
    const s2 = await setSigs(rebuilt);
    ok("re-saving the rebuilt list succeeds", s2.ok, s2.message);
    const arr2 = await arrangements();
    ok(
      "...still three signatories, not zero",
      arr2.length === 3,
      `got ${arr2.length}`,
    );
    ok(
      "...still the same three, in the same order",
      arr2[0].userId === A.userId &&
        arr2[1].userId === B.userId &&
        arr2[2].userId === C.userId,
    );
    const coorAfter = await prisma.signatureCoor.count({
      where: { documentPage: { documentId: doc.id } },
    });
    ok(
      "...and the signature boxes are still bound",
      coorAfter === 3,
      `got ${coorAfter}`,
    );
    const orphans = await prisma.signatureCoor.count({
      where: {
        documentPage: { documentId: doc.id },
        signatoryArrangementId: null,
      },
    });
    ok("...with no orphaned boxes", orphans === 0, `got ${orphans}`);

    // ══ 3b. A signatory who lost their room is still their slot ═══════
    // Somebody already on the routing can have their room membership
    // removed. The wizard can still name them from the arrangement, but
    // the id it has is no longer a membership id, so the handler takes a
    // userId fallback. Without it the slot resolved to nothing and the
    // person was silently unassigned — the very loss this file is about.
    console.log("\n-- signatory whose room membership is gone --");
    await setSigs([A.userId, B.userId, C.userId]);
    await prisma.roomAuthorizedUser.deleteMany({
      where: { receivingRoomId: FROM.id, userId: B.userId },
    });

    const rSalvage = mockRes();
    let salvaged = true;
    try {
      await setSignatoryArrangement(
        {
          user: { id: SENDER.accountId },
          body: {
            queueRoomId: queue.id,
            signatories: [
              { roomAuthorizedUserId: authOf.get(A.userId)!, userId: A.userId },
              // B's membership is gone; only the fallback identifies them.
              { roomAuthorizedUserId: "not-a-membership-id", userId: B.userId },
              { roomAuthorizedUserId: authOf.get(C.userId)!, userId: C.userId },
            ],
            userId: SENDER.userId,
            lineId: line.id,
          },
        } as any,
        rSalvage,
      );
    } catch (e: any) {
      salvaged = false;
      console.log("  threw:", String(e?.message ?? e));
    }
    ok("saving over a dead membership is accepted", salvaged);
    const arr3 = await arrangements();
    ok(
      "...all three slots survive",
      arr3.length === 3,
      `got ${arr3.length}`,
    );
    ok(
      "...and the one with no room KEEPS its signatory",
      arr3[1]?.userId === B.userId,
      `slot 2 userId = ${arr3[1]?.userId}`,
    );

    // ══ 4. The destructive case, kept as a guard rail ══════════════════
    // Sending an empty list still means "nobody signs" — that has to keep
    // working, because it is how a routing is turned into a no-signature
    // one on purpose. The bug was the CLIENT sending it by accident.
    console.log("\n-- deliberately clearing still works --");
    const s3 = await setSigs([]);
    ok("an explicit empty list is accepted", s3.ok, s3.message);
    ok("...and really does clear them", (await arrangements()).length === 0);

    console.log(`\n${pass} passed, ${fail} failed`);
    process.exitCode = fail === 0 ? 0 : 1;
  } catch (e) {
    console.error("THREW", e);
    process.exitCode = 1;
  } finally {
    for (const id of made.docIds) {
      await prisma.signatureCoor.deleteMany({
        where: { documentPage: { documentId: id } },
      }).catch(() => {});
      await prisma.documentPage.deleteMany({ where: { documentId: id } }).catch(() => {});
      await prisma.documentActivityLogs.deleteMany({
        where: { desc: { contains: id } },
      }).catch(() => {});
      await prisma.document.delete({ where: { id } }).catch(() => {});
    }
    for (const id of made.queueIds) {
      await prisma.documentActivityLogs.deleteMany({
        where: { desc: { contains: id } },
      }).catch(() => {});
      await prisma.signatoryArrangement.deleteMany({
        where: { signatureQueueRoomId: id },
      }).catch(() => {});
      await prisma.signatureQueueRoom.delete({ where: { id } }).catch(() => {});
    }
    for (const id of made.roomIds) {
      await prisma.roomAuthorizedUser.deleteMany({
        where: { receivingRoomId: id },
      }).catch(() => {});
      await prisma.receivingRoom.delete({ where: { id } }).catch(() => {});
    }
    for (const id of made.userIds) {
      await prisma.documentActivityLogs.deleteMany({ where: { userId: id } }).catch(() => {});
      await prisma.user.delete({ where: { id } }).catch(() => {});
    }
    for (const id of made.accountIds) {
      await prisma.account.delete({ where: { id } }).catch(() => {});
    }
    await prisma.$disconnect();
  }
})();
