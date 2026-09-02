/* PROOF: every office shows up in the dissemination picker.
 *
 * The bug this covers: the picker filtered to rooms that had at least one
 * authorized-user row, so an office with nobody in it simply was not there.
 * A sender looking at one office out of a dozen had no way to learn that the
 * other eleven were empty rather than lost — the list just quietly stopped
 * mentioning them.
 *
 * The protection behind that filter was real, though: a document sent to a
 * room with no members lands where nobody can open it. So the rule now is
 * SHOW every room, mark the ones that cannot receive, and refuse them on the
 * write. This file proves all three, plus the awkward cases that make "has
 * members" harder than it looks — a member who was removed still has a row,
 * and a placeholder row can have no user at all. Neither is a person.
 *
 * Run: npx ts-node --transpile-only e2e_target_room_visibility.ts */
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
  targetRoomCandidates,
  setTargetRooms,
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
    lineId: "",
  };

  try {
    // A line of its own, so the counts in this test mean something —
    // borrowing a real one would make "4 rooms" depend on live data.
    // A Line is pinned to a real barangay/municipality/province/region, so
    // borrow those from one that already exists rather than inventing them.
    const where = await prisma.line.findFirst({
      select: { barangayId: true, municipalId: true, provinceId: true,
                regionId: true },
    });
    if (!where) { console.log("NO FIXTURE (line to copy location from)"); process.exit(2); }
    const line = await prisma.line.create({
      data: { name: `QA Rooms ${TS}`, ...where },
      select: { id: true },
    });
    made.lineId = line.id;

    const mk = async (tag: string) => {
      const acct = await prisma.account.create({
        data: { username: `qa_vis_${TS}_${tag}`, password: "x", lineId: line.id },
        select: { id: true, username: true },
      });
      made.accountIds.push(acct.id);
      const u = await prisma.user.create({
        data: {
          firstName: "Qa", lastName: `VIS${TS}${tag.toUpperCase()}`,
          username: acct.username, accountId: acct.id, lineId: line.id,
          email: `qa-vis-${TS}-${tag}@test.local`, active: 1,
        },
        select: { id: true },
      });
      made.userIds.push(u.id);
      return { accountId: acct.id, userId: u.id };
    };

    const mkRoom = async (code: string) => {
      const room = await prisma.receivingRoom.create({
        data: { code: `${code}-${TS}`, address: code, lineId: line.id },
        select: { id: true, code: true },
      });
      made.roomIds.push(room.id);
      return room;
    };

    const SENDER = await mk("sender");
    const STAFF = await mk("staff");
    const GONE = await mk("gone");

    const FROM = await mkRoom("QA-FROM");
    await prisma.roomAuthorizedUser.create({
      data: { receivingRoomId: FROM.id, userId: SENDER.userId, type: 0, status: 1 },
    });

    // Four shapes of office, all real in the wild.
    const STAFFED = await mkRoom("QA-STAFFED");
    await prisma.roomAuthorizedUser.create({
      data: { receivingRoomId: STAFFED.id, userId: STAFF.userId, type: 1, status: 1 },
    });
    const EMPTY = await mkRoom("QA-EMPTY"); // nobody, ever
    const EMPTIED = await mkRoom("QA-EMPTIED"); // had someone, removed
    await prisma.roomAuthorizedUser.create({
      data: { receivingRoomId: EMPTIED.id, userId: GONE.userId, type: 1, status: 0 },
    });
    const PLACEHOLDER = await mkRoom("QA-PLACEHOLDER"); // a row with no user
    await prisma.roomAuthorizedUser.create({
      data: { receivingRoomId: PLACEHOLDER.id, userId: null, type: 1, status: 1 },
    });

    const list = async () => {
      const r = mockRes();
      await targetRoomCandidates(
        { user: { id: SENDER.accountId },
          query: { lineId: line.id, excludeRoomId: FROM.id } } as any,
        r,
      );
      return r._body;
    };

    const body = await list();
    const rows: any[] = body?.list ?? [];
    const byId = (id: string) => rows.find((x) => x.id === id);

    // ── The bug: they were missing entirely ─────────────────────────────
    ok("every office in the line is listed", rows.length === 4,
      `got ${rows.length}: ${rows.map((r) => r.code).join(", ")}`);
    ok("…the staffed one", !!byId(STAFFED.id));
    ok("…the one nobody was ever added to", !!byId(EMPTY.id));
    ok("…the one whose member was removed", !!byId(EMPTIED.id));
    ok("…the one holding only a placeholder row", !!byId(PLACEHOLDER.id));
    ok("the sender's own room is still excluded", !byId(FROM.id));

    // ── But each says whether it can actually receive ───────────────────
    ok("the staffed room can receive", byId(STAFFED.id)?.receivable === true);
    ok("…and reports its member", byId(STAFFED.id)?.memberCount === 1);
    ok("the empty room cannot", byId(EMPTY.id)?.receivable === false);
    ok("a REMOVED member does not make a room receivable",
      byId(EMPTIED.id)?.receivable === false,
      JSON.stringify(byId(EMPTIED.id)?.memberCount));
    ok("a member row with no user does not either",
      byId(PLACEHOLDER.id)?.receivable === false,
      JSON.stringify(byId(PLACEHOLDER.id)?.memberCount));

    // ── The summary lets a short list explain itself ────────────────────
    ok("the summary counts them", body?.summary?.total === 4,
      JSON.stringify(body?.summary));
    ok("…splitting receivable from the rest",
      body?.summary?.receivable === 1 && body?.summary?.needMembers === 3,
      JSON.stringify(body?.summary));

    // ── And the write refuses what the list greys out ───────────────────
    const q = await prisma.signatureQueueRoom.create({
      data: { title: `QA vis ${TS}`, userId: SENDER.userId,
              receivingRoomId: FROM.id, status: 0, step: 0 },
      select: { id: true },
    });
    made.queueIds.push(q.id);

    const setTargets = async (targetRoomIds: string[], cc: string[] = []) => {
      const r = mockRes();
      let threw: any = null;
      await setTargetRooms({
        user: { id: SENDER.accountId },
        body: { queueRoomId: q.id, targetRoomIds, copyFurnishedRoomIds: cc,
                userId: SENDER.userId, lineId: line.id },
      } as any, r).catch((e) => { threw = e; });
      return { r, threw };
    };

    let out = await setTargets([STAFFED.id]);
    ok("a staffed room can be targeted", out.r._code === 200 && !out.threw,
      out.threw?.message);
    ok("…and the row is there",
      (await prisma.targetRoom.count({
        where: { signatureQueueRoomId: q.id, receivingRoomId: STAFFED.id },
      })) === 1);

    out = await setTargets([STAFFED.id, EMPTY.id]);
    ok("an EMPTY room is refused on the write", !!out.threw);
    ok("…and the refusal names it",
      /QA-EMPTY/.test(out.threw?.message ?? ""), out.threw?.message);
    ok("…and says how to fix it",
      /Document Rooms/.test(out.threw?.message ?? ""), out.threw?.message);
    ok("…the earlier valid targets survive the refusal",
      (await prisma.targetRoom.count({
        where: { signatureQueueRoomId: q.id, receivingRoomId: STAFFED.id },
      })) === 1);

    out = await setTargets([STAFFED.id], [EMPTIED.id]);
    ok("an empty room is refused as COPY FURNISHED too", !!out.threw,
      "copy furnished still has to be openable by someone");

    // Add someone, and the same room becomes usable — no other change.
    await prisma.roomAuthorizedUser.create({
      data: { receivingRoomId: EMPTY.id, userId: GONE.userId, type: 1, status: 1 },
    });
    const after = (await list()).list.find((x: any) => x.id === EMPTY.id);
    ok("adding a member makes the room receivable", after?.receivable === true);
    out = await setTargets([STAFFED.id, EMPTY.id]);
    ok("…and it can now be targeted", out.r._code === 200 && !out.threw,
      out.threw?.message);
  } catch (e: any) {
    fail++;
    console.log("FAIL  threw: " + (e?.stack ?? e?.message ?? String(e)));
  } finally {
    try {
      if (made.queueIds.length) {
        await prisma.targetRoom.deleteMany({
          where: { signatureQueueRoomId: { in: made.queueIds } },
        });
        await prisma.signatureQueueRoom.deleteMany({
          where: { id: { in: made.queueIds } },
        });
      }
      if (made.roomIds.length) {
        await prisma.roomAuthorizedUser.deleteMany({
          where: { receivingRoomId: { in: made.roomIds } },
        });
        await prisma.receivingRoom.deleteMany({
          where: { id: { in: made.roomIds } },
        });
      }
      if (made.userIds.length) {
        const who = { in: made.userIds };
        await prisma.notification.deleteMany({
          where: { OR: [{ recipientId: who }, { senderId: who }] },
        }).catch(() => undefined);
        await prisma.documentActivityLogs.deleteMany({ where: { userId: who } })
          .catch(() => undefined);
        await prisma.user.deleteMany({ where: { id: who } });
      }
      if (made.accountIds.length)
        await prisma.account.deleteMany({ where: { id: { in: made.accountIds } } });
      if (made.lineId)
        await prisma.line.delete({ where: { id: made.lineId } }).catch(() => undefined);
      const left = await prisma.receivingRoom.count({
        where: { code: { endsWith: `-${TS}` } },
      });
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
