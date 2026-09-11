/* PROOF: the person a document is waiting on gets reminded, and nobody
 * else does.
 *
 * A routing dies quietly in one way: dispatched, one signatory does not
 * get round to it, nobody notices for a week. The sweep fixes that — but
 * a reminder feature is judged almost entirely on what it does NOT send.
 * Reminders that arrive hourly get muted, and then the one that mattered
 * is muted too. So most of this file is the silences:
 *
 *   - not before the delay
 *   - not twice in the same window
 *   - not to somebody who has signed
 *   - not on a draft, a completed routing or a cancelled one
 *   - not forever — a hard cap, then the SENDER is told once
 *   - not at three in the morning, and not at the weekend
 *   - not twice for one document to somebody holding two slots
 *   - not twice if two workers sweep at the same instant
 *
 * Time is injected rather than waited on: every case is driven by passing
 * `now` to the sweep, so the whole file runs in a second.
 *
 * Run: npx ts-node --transpile-only e2e_signature_reminders.ts */
import path from "path";

const entry = path.join(__dirname, "src", "index.ts");
require.cache[entry] = {
  id: entry, filename: entry, loaded: true,
  exports: { notificationSocket: { emitUserNotification: () => undefined } },
} as any;

import { prisma } from "./src/barrel/prisma";
import {
  runSignatureReminders,
  isWorkingHours,
  FIRST_NUDGE_HOURS,
  REPEAT_NUDGE_HOURS,
  MAX_NUDGES,
  STALE_AFTER_DAYS,
} from "./src/service/signatureReminders";
import { ROOM_MEMBER_TYPES } from "./src/controller/roomConfigController";

const TS = Date.now();
const HOUR = 60 * 60 * 1000;

/** A Wednesday at 10:00 Manila time, expressed in UTC. */
const workday = (): Date => {
  const d = new Date(Date.UTC(2026, 8, 9, 2, 0, 0)); // 10:00 PHT
  return d;
};
const plusHours = (base: Date, h: number) =>
  new Date(base.getTime() + h * HOUR);

(async () => {
  let pass = 0, fail = 0;
  const ok = (l: string, c: boolean, d = "") => {
    if (c) { pass++; console.log("PASS  " + l); }
    else { fail++; console.log("FAIL  " + l + (d ? "  -> " + d : "")); }
  };
  const made = {
    userIds: [] as string[], accountIds: [] as string[],
    roomIds: [] as string[], queueIds: [] as string[], lineIds: [] as string[],
    docIds: [] as string[],
  };

  try {
    // ── Working hours, on its own ───────────────────────────────────────
    const at = (y: number, m: number, d: number, phHour: number) =>
      new Date(Date.UTC(y, m, d, phHour - 8, 0, 0));
    ok("10am on a Wednesday is a fine time to nudge",
      isWorkingHours(at(2026, 8, 9, 10)));
    ok("…3am is not", !isWorkingHours(at(2026, 8, 9, 3)));
    ok("…7am is not (before office hours)",
      !isWorkingHours(at(2026, 8, 9, 7)));
    ok("…5pm is not (after office hours)",
      !isWorkingHours(at(2026, 8, 9, 17)));
    ok("…and Saturday is not, at any hour",
      !isWorkingHours(at(2026, 8, 12, 10)),
      "2026-09-12 is a Saturday");
    ok("…nor Sunday", !isWorkingHours(at(2026, 8, 13, 10)));

    // ── Fixture ─────────────────────────────────────────────────────────
    const loc = await prisma.line.findFirst({
      select: { barangayId: true, municipalId: true, provinceId: true, regionId: true },
    });
    if (!loc) { console.log("NO FIXTURE (line)"); process.exit(2); }
    const LINE = await prisma.line.create({
      data: { name: `QA RM ${TS}`, ...loc }, select: { id: true } });
    made.lineIds.push(LINE.id);

    const mk = async (tag: string) => {
      const acct = await prisma.account.create({
        data: { username: `qa_rm_${TS}_${tag}`, password: "x", lineId: LINE.id },
        select: { id: true, username: true } });
      made.accountIds.push(acct.id);
      const u = await prisma.user.create({
        data: { firstName: "Qa", lastName: `Rm${tag.toUpperCase()}`,
                username: acct.username, accountId: acct.id, lineId: LINE.id,
                email: `qa-rm-${TS}-${tag}@test.local`, active: 1 },
        select: { id: true } });
      made.userIds.push(u.id);
      return { accountId: acct.id, userId: u.id };
    };
    const SENDER = await mk("sender");
    const SLOW   = await mk("slow");    // never signs
    // Its own person: SLOW is followed through the whole nudge cycle
    // below, and a second document of theirs coming due partway would
    // add reminders that are correct but make the counts unreadable.
    const FRESHIE = await mk("freshie");
    const PROMPT = await mk("prompt");  // signs straight away
    const DOUBLE = await mk("double");  // holds two slots on one routing

    const room = await prisma.receivingRoom.create({
      data: { code: `QA-RM-${TS}`, lineId: LINE.id },
      select: { id: true, code: true } });
    made.roomIds.push(room.id);
    await prisma.roomAuthorizedUser.create({
      data: { receivingRoomId: room.id, userId: SENDER.userId,
              type: ROOM_MEMBER_TYPES.owner, status: 1 } });

    /** A dispatched routing, dispatched `hoursAgo` before `now`. */
    const routing = async (
      title: string, dispatchedAt: Date | null, status = 1,
    ) => {
      const q = await prisma.signatureQueueRoom.create({
        data: { userId: SENDER.userId, receivingRoomId: room.id,
                title, status, step: 1, dispatchedAt },
        select: { id: true } });
      made.queueIds.push(q.id);
      return q.id;
    };
    const slot = async (queueId: string, userId: string, index = 0) =>
      (await prisma.signatoryArrangement.create({
        data: { signatureQueueRoomId: queueId, userId, index, status: 0 },
        select: { id: true } })).id;

    const NOW = workday();
    /** Nudges recorded against one arrangement of ours. */
    const countOn = async (id: string) =>
      (await prisma.signatoryArrangement.findUnique({
        where: { id }, select: { reminderCount: true } }))?.reminderCount ?? -1;
    const nudgesFor = (userId: string) =>
      prisma.notification.count({
        where: { recipientId: userId, title: { contains: "signature" } } });
    const allFor = (userId: string) =>
      prisma.notification.findMany({
        where: { recipientId: userId },
        select: { title: true, content: true } });

    // ── Too early ───────────────────────────────────────────────────────
    const fresh = await routing(`QA RM FRESH ${TS}`,
      plusHours(NOW, -(FIRST_NUDGE_HOURS - 2)));
    await slot(fresh, FRESHIE.userId);
    let r = await runSignatureReminders(NOW);
    ok("a routing sent two hours ago is left alone",
      (await nudgesFor(FRESHIE.userId)) === 0, JSON.stringify(r));

    // ── Due ─────────────────────────────────────────────────────────────
    const overdue = await routing(`QA RM OVERDUE ${TS}`,
      plusHours(NOW, -(FIRST_NUDGE_HOURS + 1)));
    const slowSlot = await slot(overdue, SLOW.userId);
    r = await runSignatureReminders(NOW);
    ok("a routing past the delay does get a nudge",
      (await countOn(slowSlot)) === 1, JSON.stringify(r));
    const first = await allFor(SLOW.userId);
    ok("…addressed to the person who owes the signature",
      first.some((n) => n.title.startsWith("Reminder:")),
      JSON.stringify(first));
    ok("…naming the document and the office",
      first.some((n) => n.content.includes(`QA RM OVERDUE ${TS}`) &&
                        n.content.includes(room.code)),
      JSON.stringify(first));
    ok("…and saying how long it has been waiting",
      first.some((n) => /waiting \d+ (hour|day)/.test(n.content)),
      JSON.stringify(first.map((n) => n.content)));
    ok("the row records the nudge",
      (await prisma.signatoryArrangement.findUnique({
        where: { id: slowSlot },
        select: { reminderCount: true, remindedAt: true } }))?.reminderCount === 1);

    // ── Not again, yet ──────────────────────────────────────────────────
    r = await runSignatureReminders(plusHours(NOW, 1));
    ok("an hour later it is not nudged again", (await countOn(slowSlot)) === 1);
    r = await runSignatureReminders(plusHours(NOW, REPEAT_NUDGE_HOURS - 1));
    ok("…nor just before the repeat window", (await countOn(slowSlot)) === 1);
    ok("…still exactly one reminder on record",
      (await nudgesFor(SLOW.userId)) === 1);

    // ── The repeat, then the cap ────────────────────────────────────────
    // Real weekdays rather than raw hour arithmetic: NOW is a Wednesday,
    // so NOW + 96h is a SUNDAY and the sweep correctly says nothing. The
    // cycle a signatory actually experiences is Wed, Fri, then Monday —
    // the weekend defers the third nudge, which is the point of the
    // working-hours rule and worth asserting rather than stepping over.
    r = await runSignatureReminders(at(2026, 8, 11, 11)); // Friday
    ok("after the repeat window it nudges again",
      (await countOn(slowSlot)) === 2);
    r = await runSignatureReminders(at(2026, 8, 13, 11)); // Sunday
    ok("the third nudge is NOT delivered at the weekend",
      (await countOn(slowSlot)) === 2,
      "48h after Friday is Sunday; it waits");
    r = await runSignatureReminders(at(2026, 8, 14, 9)); // Monday
    ok("…it arrives on Monday morning instead",
      (await countOn(slowSlot)) === 3);
    ok(`…which is ${MAX_NUDGES} reminders`,
      (await prisma.signatoryArrangement.findUnique({
        where: { id: slowSlot }, select: { reminderCount: true } }))
        ?.reminderCount === MAX_NUDGES);
    const lastOne = await allFor(SLOW.userId);
    ok("…the last of which says it is the last",
      lastOne.some((n) => n.title.startsWith("Last reminder")),
      JSON.stringify(lastOne.map((n) => n.title)));

    const capTime = at(2026, 8, 16, 10); // the following Wednesday
    const beforeCap = await nudgesFor(SLOW.userId);
    r = await runSignatureReminders(capTime);
    ok("past the cap the signatory is left in peace",
      (await nudgesFor(SLOW.userId)) === beforeCap &&
      (await countOn(slowSlot)) === MAX_NUDGES,
      "a reminder that never stops is one nobody reads");
    ok("…and the SENDER is told it is stuck",
      (await allFor(SENDER.userId)).some(
        (n) => n.title === "Your routing is still unsigned"),
      "the point of a reminder is to unblock the document");
    const senderNotes = await allFor(SENDER.userId);
    ok("…by name, so they know who to chase",
      senderNotes.some((n) => n.title === "Your routing is still unsigned" &&
                              n.content.includes("Qa RmSLOW")),
      JSON.stringify(senderNotes.map((n) => n.content)));
    // Scoped to THIS routing: the sender owns every fixture here, and
    // another of their documents legitimately reaching the cap would
    // earn its own notice.
    const noticesForOverdue = async () =>
      (await allFor(SENDER.userId)).filter(
        (n) => n.title === "Your routing is still unsigned" &&
               n.content.includes(`QA RM OVERDUE ${TS}`)).length;
    ok("that notice went out exactly once", (await noticesForOverdue()) === 1);
    await runSignatureReminders(at(2026, 8, 18, 10)); // Friday after
    ok("…and a later sweep does not repeat it",
      (await noticesForOverdue()) === 1,
      "stalledNoticeAt is the claim that makes it once");

    // ── Signed, so silent ───────────────────────────────────────────────
    const mixed = await routing(`QA RM MIXED ${TS}`,
      plusHours(NOW, -(FIRST_NUDGE_HOURS + 1)));
    const promptSlot = await slot(mixed, PROMPT.userId, 0);
    await prisma.signatoryArrangement.update({
      where: { id: promptSlot },
      data: { status: 1, signedAt: NOW } });
    r = await runSignatureReminders(NOW);
    ok("somebody who has already signed is never nudged",
      (await nudgesFor(PROMPT.userId)) === 0, JSON.stringify(r));

    // ── The backlog that nearly went out on day one ─────────────────────
    // The first sweep this file ever ran found two dozen unsigned slots
    // on routings 107 days old and nudged every one. On production that
    // is three months of dead paperwork arriving in people's pockets on
    // deploy morning.
    const ancient = await mk("ancient");
    const oldQ = await routing(`QA RM ANCIENT ${TS}`,
      plusHours(NOW, -(STALE_AFTER_DAYS + 5) * 24));
    const oldSlot = await slot(oldQ, ancient.userId);
    await runSignatureReminders(NOW);
    ok(`a routing dispatched over ${STALE_AFTER_DAYS} days ago is left alone`,
      (await nudgesFor(ancient.userId)) === 0 &&
      (await countOn(oldSlot)) === 0,
      "not waiting on a reminder — waiting on a decision");
    ok("…and its sender is not told it is stuck either",
      !(await allFor(SENDER.userId)).some((n) =>
        n.content.includes(`QA RM ANCIENT ${TS}`)),
      "the backlog must not arrive one step later instead of not at all");

    // Just inside the window, it still works.
    const recent = await mk("recent");
    const recentQ = await routing(`QA RM RECENT ${TS}`,
      plusHours(NOW, -(STALE_AFTER_DAYS - 2) * 24));
    await slot(recentQ, recent.userId);
    await runSignatureReminders(NOW);
    ok("…while one just inside the window still gets its nudge",
      (await nudgesFor(recent.userId)) === 1);

    // ── One person, two slots, one document ─────────────────────────────
    const twoSlots = await routing(`QA RM TWOSLOT ${TS}`,
      plusHours(NOW, -(FIRST_NUDGE_HOURS + 1)));
    await slot(twoSlots, DOUBLE.userId, 0);
    await slot(twoSlots, DOUBLE.userId, 1);
    await runSignatureReminders(NOW);
    ok("holding two slots on one document earns ONE reminder",
      (await nudgesFor(DOUBLE.userId)) === 1,
      "signMine signs both at once; two nudges would be two lies");
    ok("…and both rows are stamped",
      (await prisma.signatoryArrangement.count({
        where: { signatureQueueRoomId: twoSlots, reminderCount: 1 } })) === 2);

    // ── Two workers, same instant ───────────────────────────────────────
    const race = await routing(`QA RM RACE ${TS}`,
      plusHours(NOW, -(FIRST_NUDGE_HOURS + 1)));
    const racer = await mk("racer");
    await slot(race, racer.userId);
    const when = plusHours(NOW, 0.5);
    const [a, b] = await Promise.all([
      runSignatureReminders(when),
      runSignatureReminders(when),
    ]);
    ok("two sweeps at the same instant send one reminder between them",
      a.nudged + b.nudged === 1, JSON.stringify({ a, b }));
    ok("…and the count moved by exactly one",
      (await prisma.signatoryArrangement.count({
        where: { signatureQueueRoomId: race, reminderCount: 1 } })) === 1);

    // ── Not on a draft, a finished one, or a cancelled one ──────────────
    for (const [label, status] of [
      ["a draft", 0], ["a completed routing", 2], ["a cancelled routing", 3],
    ] as [string, number][]) {
      const person = await mk(`s${status}`);
      const q = await routing(`QA RM ST${status} ${TS}`,
        plusHours(NOW, -(FIRST_NUDGE_HOURS + 1)), status);
      await slot(q, person.userId);
      await runSignatureReminders(NOW);
      ok(`nobody is nudged about ${label}`,
        (await nudgesFor(person.userId)) === 0);
    }

    // ── Out of hours ────────────────────────────────────────────────────
    const nightPerson = await mk("night");
    const nightQ = await routing(`QA RM NIGHT ${TS}`,
      plusHours(NOW, -(FIRST_NUDGE_HOURS + 1)));
    await slot(nightQ, nightPerson.userId);
    r = await runSignatureReminders(at(2026, 8, 9, 3));
    ok("a sweep at 3am sends nothing at all",
      r.nudged === 0 && r.skipped === "outside-working-hours",
      JSON.stringify(r));
    r = await runSignatureReminders(at(2026, 8, 12, 10));
    ok("…nor one on a Saturday morning",
      r.nudged === 0 && r.skipped === "outside-working-hours");
    ok("…and the person's phone stayed quiet",
      (await nudgesFor(nightPerson.userId)) === 0);
    await runSignatureReminders(at(2026, 8, 14, 9));
    ok("come Monday morning, it goes out",
      (await nudgesFor(nightPerson.userId)) === 1,
      "2026-09-14 is a Monday");

    // ── An unassigned slot has nobody to remind ─────────────────────────
    const unassigned = await routing(`QA RM UNASSIGNED ${TS}`,
      plusHours(NOW, -(FIRST_NUDGE_HOURS + 1)));
    await prisma.signatoryArrangement.create({
      data: { signatureQueueRoomId: unassigned, userId: null,
              index: 0, status: 0 } });
    r = await runSignatureReminders(plusHours(NOW, 4));
    const stillNone = await prisma.signatoryArrangement.count({
      where: { signatureQueueRoomId: unassigned, reminderCount: { gt: 0 } } });
    ok("an unassigned slot is skipped rather than crashing the sweep",
      stillNone === 0, "a third of slots in the wild carry no user");
  } catch (e: any) {
    fail++;
    console.log("FAIL  threw: " + (e?.stack ?? e?.message ?? String(e)));
  } finally {
    try {
      if (made.queueIds.length) {
        const qs = { signatureQueueRoomId: { in: made.queueIds } };
        await prisma.targetRoom.deleteMany({ where: qs });
        await prisma.signatoryArrangement.deleteMany({ where: qs });
        await prisma.signatureQueueRoom.deleteMany({
          where: { id: { in: made.queueIds } } });
      }
      if (made.roomIds.length) {
        await prisma.roomAuthorizedUser.deleteMany({
          where: { receivingRoomId: { in: made.roomIds } } });
        await prisma.receivingRoom.deleteMany({
          where: { id: { in: made.roomIds } } });
      }
      if (made.userIds.length) {
        const w = { in: made.userIds };
        await prisma.documentActivityLogs.deleteMany({ where: { userId: w } });
        await prisma.notification.deleteMany({
          where: { OR: [{ recipientId: w }, { senderId: w }] } });
        await prisma.signatoryArrangement.deleteMany({ where: { userId: w } });
        await prisma.user.deleteMany({ where: { id: w } });
      }
      if (made.accountIds.length)
        await prisma.account.deleteMany({
          where: { id: { in: made.accountIds } } });
      for (const id of made.lineIds)
        await prisma.line.delete({ where: { id } });
      const left = await prisma.receivingRoom.count({
        where: { code: { contains: `${TS}` } } });
      console.log(`CLEANUP  leftover rooms=${left}`);
      if (left) fail++;
    } catch (e: any) {
      console.log("CLEANUP FAILED: " + (e?.message ?? e));
      fail++;
    }
    console.log(`\n${pass} passed, ${fail} failed`);
    await prisma.$disconnect();
    process.exit(fail ? 1 : 0);
  }
})();
