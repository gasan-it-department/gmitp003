"use strict";
// Nudging the person a document is waiting on.
//
// A routing dies quietly in exactly one way: it is dispatched, one
// signatory does not get round to it, and nobody notices for a week. The
// sender assumes it is moving; the signatory has forgotten; the office
// waiting for the memo phones somebody. This sweep is the fix, and it is
// deliberately small — a notification, on a schedule, with a hard stop.
//
// Three properties matter more than the feature itself:
//
//  1. It must not become noise. Reminders that arrive every hour forever
//     get muted, and then the ONE that mattered is muted too. Hence a
//     delay before the first, a gap between repeats, and a cap.
//  2. It must not arrive at three in the morning. Municipal staff are not
//     on call; a push at 3am about a memo is a reason to turn push off.
//  3. It must be exactly-once. The claim is a conditional updateMany, the
//     same trick releaseCopyFurnished uses, so two workers waking at the
//     same instant cannot both nudge.
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.startSignatureReminders = exports.SWEEP_INTERVAL_MS = exports.resetReminderClock = exports.runSignatureReminders = exports.lastSweep = exports.isWorkingHours = exports.STALE_AFTER_DAYS = exports.MAX_NUDGES = exports.REPEAT_NUDGE_HOURS = exports.FIRST_NUDGE_HOURS = void 0;
const prisma_1 = require("../barrel/prisma");
const notificationEvents_1 = require("./notificationEvents");
/** Hours after dispatch before the first nudge. */
exports.FIRST_NUDGE_HOURS = 24;
/** Hours between nudges after that. */
exports.REPEAT_NUDGE_HOURS = 48;
/** After this many, stop nudging the signatory and tell the sender. */
exports.MAX_NUDGES = 3;
/**
 * Past this, stop caring.
 *
 * Not a nicety — a safety catch. The first sweep after this shipped found
 * twenty-four unsigned slots on the dev database, every one of them
 * between 107 and 108 days old, and cheerfully nudged all of them. On
 * production that is three months of dead routings arriving in people's
 * pockets on the morning of the deploy, followed by two more each and a
 * "your routing is stuck" to every sender. The single loudest possible
 * introduction for a feature whose whole job is to not be noise.
 *
 * A document nobody has signed in three weeks is not waiting on a
 * reminder; it is waiting on a decision. Three weeks also clears the full
 * nudge cycle — 24h then 48h then 48h is five working days, nine or ten
 * calendar with weekends — with room to spare for a holiday.
 */
exports.STALE_AFTER_DAYS = 21;
const HOUR = 60 * 60 * 1000;
const PH_OFFSET_MIN = 8 * 60;
/**
 * Is it a reasonable moment to make somebody's phone buzz?
 *
 * Office hours in Gasan, Monday to Friday. The server runs in UTC and the
 * office does not, so the check is done on a shifted clock. A routing
 * dispatched at four on a Friday afternoon gets its first nudge on Monday
 * morning, which is exactly when it is useful.
 */
const isWorkingHours = (now = new Date()) => {
    const ph = new Date(now.getTime() + PH_OFFSET_MIN * 60000);
    const day = ph.getUTCDay(); // 0 Sun … 6 Sat
    if (day === 0 || day === 6)
        return false;
    const hour = ph.getUTCHours();
    return hour >= 8 && hour < 17;
};
exports.isWorkingHours = isWorkingHours;
/**
 * What the last sweep did, for /health/build.
 *
 * The sweep swallows its own errors so a bad pass cannot take the server
 * down — which also means a sweep that fails every fifteen minutes is
 * completely silent from outside. This is how you find out. Reported
 * rather than logged because Railway logs are not somewhere you look
 * unless you already suspect something.
 */
exports.lastSweep = null;
const plural = (n, one, many) => n === 1 ? one : many;
const agoText = (from, now) => {
    const hours = Math.max(1, Math.round((now.getTime() - from.getTime()) / HOUR));
    if (hours < 48)
        return `${hours} ${plural(hours, "hour", "hours")}`;
    const days = Math.round(hours / 24);
    return `${days} ${plural(days, "day", "days")}`;
};
/**
 * One pass. Safe to call as often as you like — the delays and the claim
 * do the rate limiting, not the caller.
 *
 * Exported so the scheduler, and the tests, drive the same code. A test
 * that waits on a timer is a test nobody runs.
 */
const runSignatureReminders = (...args_1) => __awaiter(void 0, [...args_1], void 0, function* (now = new Date()) {
    var _a, _b, _c, _d, _e, _f, _g;
    if (!(0, exports.isWorkingHours)(now)) {
        exports.lastSweep = {
            at: now.toISOString(), nudged: 0, stalled: 0,
            skipped: "outside-working-hours",
        };
        return { nudged: 0, stalled: 0, skipped: "outside-working-hours" };
    }
    const firstCutoff = new Date(now.getTime() - exports.FIRST_NUDGE_HOURS * HOUR);
    const repeatCutoff = new Date(now.getTime() - exports.REPEAT_NUDGE_HOURS * HOUR);
    const staleCutoff = new Date(now.getTime() - exports.STALE_AFTER_DAYS * 24 * HOUR);
    // Everyone who still owes a signature on a live routing, and is due.
    //
    // `dispatchedAt` is null on routings sent before that column existed;
    // those fall back to `timestamp`, which for an already-dispatched
    // routing is the closest honest answer available.
    const due = yield prisma_1.prisma.signatoryArrangement.findMany({
        where: {
            status: 0,
            userId: { not: null },
            reminderCount: { lt: exports.MAX_NUDGES },
            signatureQueueRoom: {
                is: {
                    status: 1,
                    // Old enough to be worth a nudge, young enough to be worth
                    // nudging about. `dispatchedAt` is null on everything sent
                    // before that column existed, so those fall back to timestamp
                    // — which also puts the entire pre-existing backlog safely on
                    // the far side of the stale cutoff.
                    OR: [
                        {
                            dispatchedAt: { lte: firstCutoff, gte: staleCutoff },
                        },
                        {
                            dispatchedAt: null,
                            timestamp: { lte: firstCutoff, gte: staleCutoff },
                        },
                    ],
                },
            },
            OR: [{ remindedAt: null }, { remindedAt: { lte: repeatCutoff } }],
        },
        select: {
            id: true,
            userId: true,
            reminderCount: true,
            signatureQueueRoom: {
                select: {
                    id: true,
                    title: true,
                    timestamp: true,
                    dispatchedAt: true,
                    fromRoom: { select: { code: true } },
                },
            },
        },
    });
    // One person can hold two slots on the same routing, and signMine signs
    // both at once — so nudge per (routing, person), never per slot, or
    // they get told twice about one document.
    const byPerson = new Map();
    for (const row of due) {
        if (!row.userId || !row.signatureQueueRoom)
            continue;
        const key = `${row.signatureQueueRoom.id}:${row.userId}`;
        const list = (_a = byPerson.get(key)) !== null && _a !== void 0 ? _a : [];
        list.push(row);
        byPerson.set(key, list);
    }
    let nudged = 0;
    for (const rows of byPerson.values()) {
        const first = rows[0];
        const queue = first.signatureQueueRoom;
        const ids = rows.map((r) => r.id);
        // Claim. Conditional on the rows still looking the way they did when
        // we read them, so a second worker's update touches nothing and it
        // sends nothing.
        const claimed = yield prisma_1.prisma.signatoryArrangement.updateMany({
            where: {
                id: { in: ids },
                status: 0,
                OR: [{ remindedAt: null }, { remindedAt: { lte: repeatCutoff } }],
            },
            data: { remindedAt: now, reminderCount: { increment: 1 } },
        });
        if (claimed.count === 0)
            continue;
        const waiting = agoText((_b = queue.dispatchedAt) !== null && _b !== void 0 ? _b : queue.timestamp, now);
        const nth = first.reminderCount + 1;
        const last = nth >= exports.MAX_NUDGES;
        try {
            yield (0, notificationEvents_1.createUserNotification)(prisma_1.prisma, {
                recipientId: first.userId,
                title: last
                    ? "Last reminder: your signature is still needed"
                    : "Reminder: a document is waiting for your signature",
                content: `"${(_c = queue.title) !== null && _c !== void 0 ? _c : "A document"}" from ` +
                    `${(_e = (_d = queue.fromRoom) === null || _d === void 0 ? void 0 : _d.code) !== null && _e !== void 0 ? _e : "another office"} has been waiting ` +
                    `${waiting} for your signature.` +
                    (last
                        ? " This is the last reminder — the sending office will be told it is still unsigned."
                        : ""),
                path: `documents/dissemination?tab=inbox`,
            });
            nudged++;
        }
        catch (e) {
            // A delivery failure must not cost the claim its meaning; the row
            // is stamped, so this person is not hammered on the next pass.
            console.warn("[reminders] could not notify:", e);
        }
    }
    // ── Tell the sender when nudging has run out ────────────────────────
    // The point of a reminder is to unblock the document. If three have
    // gone unanswered, the person who can actually do something about it is
    // the sender — chase them in person, reassign, cancel. Once only.
    const stuck = yield prisma_1.prisma.signatureQueueRoom.findMany({
        where: {
            status: 1,
            stalledNoticeAt: null,
            OR: [
                { dispatchedAt: { gte: staleCutoff } },
                { dispatchedAt: null, timestamp: { gte: staleCutoff } },
            ],
            signatotyArrangement: {
                some: { status: 0, userId: { not: null }, reminderCount: { gte: exports.MAX_NUDGES } },
            },
        },
        select: {
            id: true,
            title: true,
            userId: true,
            timestamp: true,
            dispatchedAt: true,
            signatotyArrangement: {
                where: { status: 0, userId: { not: null } },
                select: { user: { select: { firstName: true, lastName: true } } },
            },
        },
    });
    let stalled = 0;
    for (const q of stuck) {
        const claimed = yield prisma_1.prisma.signatureQueueRoom.updateMany({
            where: { id: q.id, stalledNoticeAt: null },
            data: { stalledNoticeAt: now },
        });
        if (claimed.count === 0)
            continue;
        if (!q.userId)
            continue;
        const names = q.signatotyArrangement
            .map((a) => { var _a, _b, _c, _d; return `${(_b = (_a = a.user) === null || _a === void 0 ? void 0 : _a.firstName) !== null && _b !== void 0 ? _b : ""} ${(_d = (_c = a.user) === null || _c === void 0 ? void 0 : _c.lastName) !== null && _d !== void 0 ? _d : ""}`.trim(); })
            .filter(Boolean);
        try {
            yield (0, notificationEvents_1.createUserNotification)(prisma_1.prisma, {
                recipientId: q.userId,
                title: "Your routing is still unsigned",
                content: `"${(_f = q.title) !== null && _f !== void 0 ? _f : "A document"}" has been waiting ` +
                    `${agoText((_g = q.dispatchedAt) !== null && _g !== void 0 ? _g : q.timestamp, now)} and ` +
                    `${names.length ? names.join(", ") : "a signatory"} ` +
                    `${plural(names.length || 1, "has", "have")} not signed after ` +
                    `${exports.MAX_NUDGES} reminders.`,
                path: `documents/dissemination?tab=outbox`,
            });
            stalled++;
        }
        catch (e) {
            console.warn("[reminders] could not notify sender:", e);
        }
    }
    if (nudged || stalled) {
        console.log(`[reminders] nudged=${nudged} stalled=${stalled}`);
    }
    exports.lastSweep = { at: now.toISOString(), nudged, stalled };
    return { nudged, stalled };
});
exports.runSignatureReminders = runSignatureReminders;
/**
 * Clear the reminder clock on a routing's signatories.
 *
 * Called when a routing is dispatched, so a draft that was set up, sent,
 * cancelled and re-sent does not inherit an old nudge count and skip
 * straight to "last reminder".
 */
const resetReminderClock = (tx, queueRoomId) => __awaiter(void 0, void 0, void 0, function* () {
    yield tx.signatoryArrangement.updateMany({
        where: { signatureQueueRoomId: queueRoomId },
        data: { remindedAt: null, reminderCount: 0 },
    });
});
exports.resetReminderClock = resetReminderClock;
/** How often the sweep wakes. The delays above do the real pacing. */
exports.SWEEP_INTERVAL_MS = 15 * 60 * 1000;
let timer = null;
/**
 * Start the sweep. Idempotent, and never lets a failure kill the process.
 *
 * A plain interval rather than a cron dependency: the pacing lives in the
 * database columns, not in the schedule, so the only thing the timer has
 * to be is roughly frequent enough.
 */
const startSignatureReminders = () => {
    if (timer)
        return;
    const tick = () => {
        (0, exports.runSignatureReminders)().catch((e) => {
            var _a;
            console.warn("[reminders] sweep failed:", e);
            exports.lastSweep = {
                at: new Date().toISOString(), nudged: 0, stalled: 0,
                error: String((_a = e === null || e === void 0 ? void 0 : e.message) !== null && _a !== void 0 ? _a : e).slice(0, 160),
            };
        });
    };
    // Not immediately on boot: a deploy restarts the process, and a crash
    // loop would otherwise sweep on every restart.
    setTimeout(tick, 2 * 60 * 1000);
    timer = setInterval(tick, exports.SWEEP_INTERVAL_MS);
    if (typeof timer.unref === "function")
        timer.unref();
    console.log(`[reminders] sweep every ${exports.SWEEP_INTERVAL_MS / 60000}m — first nudge ` +
        `after ${exports.FIRST_NUDGE_HOURS}h, repeat ${exports.REPEAT_NUDGE_HOURS}h, max ${exports.MAX_NUDGES}`);
};
exports.startSignatureReminders = startSignatureReminders;
