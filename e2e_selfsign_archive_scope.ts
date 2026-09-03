/* PROOF: Self Sign is private, and the archive belongs to its municipality.
 *
 * The first assertion here is the leak I demonstrated before fixing it:
 * signed in as one account, ask for another user's Self Sign list, get
 * their private documents back. Eight handlers were in that state.
 *
 * What makes this group interesting is that the ownership checks already
 * EXISTED — `if (arr.userId !== body.userId) throw "Not your arrangement"`
 * reads like a real check. It was circular: the attacker supplied both
 * sides of the comparison and it agreed with itself. Taking the id from
 * the token is the whole fix; the checks that follow were always right.
 *
 * The archive is a different rule — a municipal record, not a personal
 * one — so it is scoped to the line, and a record addressed by id has its
 * line read off the record rather than taken from the query, because an
 * id is not a permission.
 *
 * Run: npx ts-node --transpile-only e2e_selfsign_archive_scope.ts */
import path from "path";

const entry = path.join(__dirname, "src", "index.ts");
require.cache[entry] = {
  id: entry, filename: entry, loaded: true,
  exports: { notificationSocket: { emitUserNotification: () => undefined } },
} as any;

import { prisma } from "./src/barrel/prisma";
import {
  selfSignList,
  selfSignDetail,
  selfSignRemove,
  selfSignSavePlacements,
} from "./src/controller/selfSignController";
import {
  archives,
  archiveDetail,
  downloadArchiveFile,
  rooms,
} from "./src/controller/documentController";

const TS = Date.now();

const mockRes = () => {
  const r: any = {
    _code: 0, _body: null as any,
    code(n: number) { this._code = n; return this; },
    send(b: unknown) { this._body = b; return this; },
    status(n: number) { return this.code(n); },
    header() { return this; },
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
    userIds: [] as string[], accountIds: [] as string[],
    docIds: [] as string[], archiveIds: [] as string[],
    roomIds: [] as string[], lineIds: [] as string[],
  };

  try {
    const loc = await prisma.line.findFirst({
      select: { barangayId: true, municipalId: true, provinceId: true, regionId: true },
    });
    if (!loc) { console.log("NO FIXTURE (line)"); process.exit(2); }
    const mkLine = async (t: string) => {
      const l = await prisma.line.create({
        data: { name: `QA P2 ${TS} ${t}`, ...loc }, select: { id: true } });
      made.lineIds.push(l.id); return l;
    };
    const LINE_A = await mkLine("A");
    const LINE_B = await mkLine("B");

    const mk = async (tag: string, lineId: string) => {
      const acct = await prisma.account.create({
        data: { username: `qa_p2_${TS}_${tag}`, password: "x", lineId },
        select: { id: true, username: true } });
      made.accountIds.push(acct.id);
      const u = await prisma.user.create({
        data: { firstName: "Qa", lastName: `P2${tag.toUpperCase()}`,
                username: acct.username, accountId: acct.id, lineId,
                email: `qa-p2-${TS}-${tag}@test.local`, active: 1 },
        select: { id: true } });
      made.userIds.push(u.id);
      return { accountId: acct.id, userId: u.id };
    };

    const OWNER   = await mk("owner", LINE_A.id);
    const NOSY    = await mk("nosy", LINE_A.id);     // same municipality
    const FOREIGN = await mk("foreign", LINE_B.id);  // another one

    // A private Self Sign document: type 9, no routing, one owner.
    const priv = await prisma.document.create({
      data: { title: `PRIVATE ${TS}`, lineId: LINE_A.id, userId: OWNER.userId,
              type: 9, original: 1 }, select: { id: true } });
    made.docIds.push(priv.id);
    // A self-sign arrangement is one with no queue room; it is tied to the
    // document through its placements, not by a column.
    const arrangement = await prisma.signatoryArrangement.create({
      data: { signatureQueueRoomId: null, userId: OWNER.userId,
              index: 0, status: 0 },
      select: { id: true },
    });

    // A municipal archive record on line A. ArchiveDocument carries no
    // title of its own — it points at a Document.
    const archDoc = await prisma.document.create({
      data: { title: `ARCHIVED ${TS}`, lineId: LINE_A.id, userId: OWNER.userId },
      select: { id: true } });
    made.docIds.push(archDoc.id);
    const arch = await prisma.archiveDocument.create({
      data: { documentId: archDoc.id, lineId: LINE_A.id, status: 1 },
      select: { id: true },
    });
    made.archiveIds.push(arch.id);

    const rmA = await prisma.receivingRoom.create({
      data: { code: `QA-P2-${TS}`, lineId: LINE_A.id }, select: { id: true } });
    made.roomIds.push(rmA.id);

    const call = async (fn: any, accountId: string | null, payload: any,
                        key: "body" | "query" = "query") => {
      const r = mockRes();
      let threw: any = null;
      await fn({ user: accountId ? { id: accountId } : undefined,
                 [key]: payload } as any, r).catch((e: any) => { threw = e; });
      return { r, threw, body: r._body, okd: !threw && r._code === 200 };
    };

    // ── The leak, re-run ────────────────────────────────────────────────
    let out = await call(selfSignList, NOSY.accountId,
      { userId: OWNER.userId, lineId: LINE_A.id });
    ok("asking for a colleague's Self Sign list is refused", !!out.threw,
      out.threw?.message);
    ok("…and no document comes back",
      !((out.body?.list ?? []) as any[]).some((x) => x.id === priv.id));

    out = await call(selfSignList, OWNER.accountId,
      { userId: OWNER.userId, lineId: LINE_A.id });
    ok("the owner still reads their own list", out.okd, out.threw?.message);
    ok("…and their document is in it",
      ((out.body?.list ?? []) as any[]).some((x) => x.id === priv.id));

    // ── Its siblings ────────────────────────────────────────────────────
    out = await call(selfSignDetail, NOSY.accountId,
      { id: priv.id, userId: OWNER.userId });
    ok("nor can they open its detail", !!out.threw);
    out = await call(selfSignDetail, OWNER.accountId,
      { id: priv.id, userId: OWNER.userId });
    ok("…while the owner can", out.okd, out.threw?.message);

    out = await call(selfSignRemove, NOSY.accountId,
      { id: priv.id, userId: OWNER.userId });
    ok("nor delete it", !!out.threw);
    ok("…and it survives",
      (await prisma.document.count({ where: { id: priv.id } })) === 1);

    out = await call(selfSignSavePlacements, NOSY.accountId,
      { documentId: priv.id, arrangementId: arrangement.id,
        userId: OWNER.userId, placements: [] }, "body");
    ok("nor move the signature boxes on it", !!out.threw, out.threw?.message);
    out = await call(selfSignSavePlacements, OWNER.accountId,
      { documentId: priv.id, arrangementId: arrangement.id,
        userId: OWNER.userId, placements: [] }, "body");
    ok("…while the owner can", out.okd, out.threw?.message);

    // ── The archive: a municipal record, scoped to its municipality ─────
    out = await call(archives, FOREIGN.accountId, { id: LINE_A.id, limit: "20" });
    ok("another municipality cannot list your archive", !!out.threw,
      out.threw?.message);
    out = await call(archives, NOSY.accountId, { id: LINE_A.id, limit: "20" });
    ok("a colleague on the line still can", out.okd, out.threw?.message);

    out = await call(archiveDetail, FOREIGN.accountId, { id: arch.id });
    ok("…nor open one of its records by id", !!out.threw,
      "the line is read off the record, not taken from the query");
    out = await call(archiveDetail, NOSY.accountId, { id: arch.id });
    ok("…which the line's own staff still can", out.okd, out.threw?.message);

    out = await call(downloadArchiveFile, FOREIGN.accountId, { id: arch.id });
    ok("…nor download its file", !!out.threw);

    // ── Room listings ───────────────────────────────────────────────────
    out = await call(rooms, FOREIGN.accountId, { id: LINE_A.id, limit: "20" });
    ok("another municipality cannot list your rooms", !!out.threw);
    out = await call(rooms, NOSY.accountId, { id: LINE_A.id, limit: "20" });
    ok("…and the line's own staff still can", out.okd, out.threw?.message);
    ok("…seeing the room that is there",
      ((out.body?.list ?? []) as any[]).some((x: any) => x.id === rmA.id));

    out = await call(rooms, null, { id: LINE_A.id, limit: "20" });
    ok("an unauthenticated call is refused", !!out.threw);
  } catch (e: any) {
    fail++;
    console.log("FAIL  threw: " + (e?.stack ?? e?.message ?? String(e)));
  } finally {
    try {
      await prisma.signatoryArrangement.deleteMany({
        where: { userId: { in: made.userIds } } }).catch(() => undefined);
      if (made.docIds.length) {
        const d = { documentId: { in: made.docIds } };
        await prisma.documentActivityLogs.deleteMany({ where: d }).catch(() => undefined);
        await prisma.documentPage.deleteMany({ where: d }).catch(() => undefined);
        await prisma.decodedFile.deleteMany({ where: d }).catch(() => undefined);
        await prisma.document.deleteMany({ where: { id: { in: made.docIds } } });
      }
      await prisma.archiveDocument.deleteMany({
        where: { id: { in: made.archiveIds } } }).catch(() => undefined);
      if (made.roomIds.length) {
        await prisma.roomAuthorizedUser.deleteMany({
          where: { receivingRoomId: { in: made.roomIds } } });
        await prisma.receivingRoom.deleteMany({ where: { id: { in: made.roomIds } } });
      }
      if (made.userIds.length) {
        const who = { in: made.userIds };
        await prisma.notification.deleteMany({
          where: { OR: [{ recipientId: who }, { senderId: who }] } }).catch(() => undefined);
        await prisma.documentActivityLogs.deleteMany({ where: { userId: who } })
          .catch(() => undefined);
        await prisma.user.deleteMany({ where: { id: who } });
      }
      if (made.accountIds.length)
        await prisma.account.deleteMany({ where: { id: { in: made.accountIds } } });
      for (const id of made.lineIds)
        await prisma.line.delete({ where: { id } }).catch(() => undefined);
      const left = await prisma.document.count({
        where: { title: { contains: `${TS}` } } });
      console.log(`CLEANUP  leftover docs=${left}`);
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
