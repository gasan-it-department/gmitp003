/* PROOF: the three Non-Plantilla defects.
 *
 * 1. Hires vanished from Non-Plantilla > Personnel. Every hire path writes a
 *    status that was NOT in PROVISIONAL_STATUSES — "Non-Plantilla" (the
 *    placeholder empType the position UI stores) or "Provisional" (quick
 *    register / full-PDS fallback) — so the list filtered them out, while the
 *    plantilla Employees list happily showed them.
 * 2. The open-slot badge counted invitation rows, so a position whose holder
 *    was archived any way other than provisionalRemove stayed "0 open".
 * 3. There was no way to list the people of ONE position.
 *
 * Run: npx ts-node --transpile-only e2e_provisional_slots.ts */
import { prisma } from "./src/barrel/prisma";
import {
  provisionalPersonnel,
  provisionalPositions,
  provisionalPositionPersonnel,
  PROVISIONAL_STATUSES,
  PROVISIONAL_EMP_TYPES,
} from "./src/controller/provisionalController";

const TS = Date.now();

const mockRes = () => {
  const r: any = {
    _code: 0,
    _body: null as any,
    code(n: number) { this._code = n; return this; },
    send(b: unknown) { this._body = b; return this; },
    status(n: number) { return this.code(n); },
    header() { return this; },
  };
  return r;
};
const req = (query: any) => ({ query }) as any;

(async () => {
  let pass = 0, fail = 0;
  const ok = (l: string, c: boolean, d = "") => {
    if (c) { pass++; console.log("PASS  " + l); }
    else { fail++; console.log("FAIL  " + l + (d ? "  -> " + d : "")); }
  };
  const made = {
    userIds: [] as string[],
    appIds: [] as string[],
    inviteIds: [] as string[],
    positionIds: [] as string[],
  };

  try {
    const lines = await prisma.line.findMany({ select: { id: true }, take: 2 });
    if (!lines.length) { console.log("NO FIXTURE (line)"); process.exit(2); }
    const LINE = lines[0].id;
    const OTHER = lines[1]?.id ?? null;

    const mkPosition = async (title: string, slots: number, lineId = LINE) => {
      const p = await prisma.provisionalPosition.create({
        data: {
          title: `QA ${TS} ${title}`,
          // The real UI stores this placeholder, not a CSC category.
          empType: "Non-Plantilla",
          termMonths: 6,
          slots,
          lineId,
        },
        select: { id: true },
      });
      made.positionIds.push(p.id);
      return p.id;
    };

    /** A hired person, wired the way registration wires them. */
    const mkHire = async (opts: {
      tag: string;
      status: string;
      positionId?: string;
      lineId?: string;
      archived?: boolean;
      inviteReason?: string;
    }) => {
      const lineId = opts.lineId ?? LINE;
      const u = await prisma.user.create({
        data: {
          firstName: "Qa" + opts.tag,
          lastName: `PROVTEST${TS}`,
          username: `qa_prov_${TS}_${opts.tag}`,
          email: `qa-prov-${TS}-${opts.tag}@test.local`,
          lineId,
          status: opts.status,
          ...(opts.archived
            ? { archivedAt: new Date(), archiveReason: "qa" }
            : {}),
        },
        select: { id: true },
      });
      made.userIds.push(u.id);

      if (opts.positionId) {
        const app = await prisma.submittedApplication.create({
          data: {
            lastname: `PROVTEST${TS}`, firstname: "Qa" + opts.tag,
            birthDate: "1990-01-01", email: `qa-prov-${TS}-${opts.tag}@test.local`,
            gender: "Male", filipino: true, dualCitizen: false,
            byBirth: true, byNatural: false, cvilStatus: "Single",
            resBarangay: "B", resCity: "C", resProvince: "P", resZipCode: "4905",
            permaBarangay: "B", permaCity: "C", permaProvince: "P",
            permaZipCode: "4905", teleNo: "N/A", mobileNo: "09170000000",
            height: 1.7, weight: 60, fatherAge: 60, motherAge: 58,
            children: "0", userId: u.id,
            govId: [], civilService: [], experience: [], voluntaryWork: [],
            learningDev: [], otherInfo: [], references: [],
            status: 1, lineId, timestamp: new Date(), batch: new Date(),
            firsntameIv: "", ivMobileNo: "", lastnameIv: "",
            dualCitizenHalf: "",
          },
          select: { id: true },
        });
        made.appIds.push(app.id);

        const inv = await prisma.fillPositionInvitation.create({
          data: {
            email: `qa-prov-${TS}-${opts.tag}@test.local`,
            lineId,
            provisionalPositionId: opts.positionId,
            submittedApplicationId: app.id,
            concluded: true,
            concludedReason: opts.inviteReason ?? "accepted",
          },
          select: { id: true },
        });
        made.inviteIds.push(inv.id);
      }
      return u.id;
    };

    // ── 1. The statuses the hire paths actually write ───────────────────
    ok('"Non-Plantilla" counts as non-plantilla',
      PROVISIONAL_STATUSES.includes("Non-Plantilla"));
    ok('"Provisional" counts as non-plantilla',
      PROVISIONAL_STATUSES.includes("Provisional"));
    ok("the assignable CSC categories are still exactly five",
      PROVISIONAL_EMP_TYPES.length === 5 &&
        PROVISIONAL_EMP_TYPES.includes("Job Order"));

    const POS = await mkPosition("Encoder", 3);
    const uNonPlantilla = await mkHire({ tag: "np", status: "Non-Plantilla", positionId: POS });
    const uProvisional = await mkHire({ tag: "pv", status: "Provisional", positionId: POS });
    const uJobOrder = await mkHire({ tag: "jo", status: "Job Order", positionId: POS });
    // Casing / stray whitespace drift, straight from a free-typed empType.
    const uDrift = await mkHire({ tag: "dr", status: "job order " });
    const uArchived = await mkHire({ tag: "ar", status: "Non-Plantilla", archived: true });
    const uRegular = await mkHire({ tag: "rg", status: "Regular" });

    let res = mockRes();
    await provisionalPersonnel(req({ id: LINE, limit: "200", query: `PROVTEST${TS}` }), res);
    const ids = (res._body?.list ?? []).map((u: any) => u.id);

    ok('a "Non-Plantilla" hire NOW shows in Personnel', ids.includes(uNonPlantilla),
      JSON.stringify((res._body?.list ?? []).map((u: any) => u.status)));
    ok('a "Provisional" hire NOW shows in Personnel', ids.includes(uProvisional));
    ok('a "Job Order" hire still shows', ids.includes(uJobOrder));
    ok('"job order " (wrong case + trailing space) still shows', ids.includes(uDrift));
    ok("an ARCHIVED person does NOT show", !ids.includes(uArchived));
    ok("a plantilla (Regular) employee does NOT show", !ids.includes(uRegular));

    // Narrowing to one category must still narrow.
    res = mockRes();
    await provisionalPersonnel(
      req({ id: LINE, limit: "200", query: `PROVTEST${TS}`, status: "Job Order" }), res);
    const narrowed = (res._body?.list ?? []).map((u: any) => u.id);
    ok("filtering to Job Order includes the Job Order hire", narrowed.includes(uJobOrder));
    ok("filtering to Job Order matches the drifted spelling too", narrowed.includes(uDrift));
    ok("filtering to Job Order excludes the others", !narrowed.includes(uProvisional));

    // ── 2. Slots count PEOPLE, not invitation rows ──────────────────────
    res = mockRes();
    await provisionalPositions(req({ id: LINE, limit: "200", query: `QA ${TS}` }), res);
    let pos = (res._body?.list ?? []).find((p: any) => p.id === POS);
    ok("the position is listed", !!pos);
    ok("3 accepted hires fill 3 of 3 slots", pos?.filled === 3, JSON.stringify(pos));
    ok("so it reads as 0 open", pos?.open === 0);

    // Archive one holder WITHOUT going through provisionalRemove — this is the
    // case that used to leave the slot stuck at "filled" forever.
    await prisma.user.update({
      where: { id: uJobOrder },
      data: { archivedAt: new Date(), archiveReason: "qa direct archive" },
    });

    res = mockRes();
    await provisionalPositions(req({ id: LINE, limit: "200", query: `QA ${TS}` }), res);
    pos = (res._body?.list ?? []).find((p: any) => p.id === POS);
    ok("archiving a holder frees the slot even without provisionalRemove",
      pos?.filled === 2 && pos?.open === 1,
      JSON.stringify({ filled: pos?.filled, open: pos?.open }));

    // A cancelled invitation never occupied a slot.
    const cancelled = await mkHire({
      tag: "cx", status: "Non-Plantilla", positionId: POS, inviteReason: "cancelled",
    });
    res = mockRes();
    await provisionalPositions(req({ id: LINE, limit: "200", query: `QA ${TS}` }), res);
    pos = (res._body?.list ?? []).find((p: any) => p.id === POS);
    ok("a cancelled invitation does not occupy a slot", pos?.filled === 2,
      JSON.stringify({ filled: pos?.filled }));
    ok("over-commitment is reported", typeof pos?.overCommitted === "number");

    // ── 3. The people of ONE position ───────────────────────────────────
    const POS2 = await mkPosition("Driver", 2);
    const other1 = await mkHire({ tag: "d1", status: "Non-Plantilla", positionId: POS2 });

    res = mockRes();
    await provisionalPositionPersonnel(req({ id: LINE, positionId: POS, limit: "200" }), res);
    const inPos = (res._body?.list ?? []).map((u: any) => u.id);
    ok("the endpoint returns the position it was asked about",
      res._body?.position?.id === POS);
    ok("it lists that position's people", inPos.includes(uNonPlantilla) && inPos.includes(uProvisional));
    ok("it does NOT list another position's people", !inPos.includes(other1));
    ok("it excludes the archived holder", !inPos.includes(uJobOrder));
    ok("it excludes the cancelled invitation", !inPos.includes(cancelled));
    ok("it reports filled/open for the header",
      res._body?.position?.filled === 2 && res._body?.position?.open === 1,
      JSON.stringify(res._body?.position && {
        f: res._body.position.filled, o: res._body.position.open }));

    // Cursor paging must not skip or repeat anyone, even when people share a
    // createdAt — the old ordering was non-deterministic.
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 10; page++) {
      const r2 = mockRes();
      await provisionalPositionPersonnel(
        req({ id: LINE, positionId: POS, limit: "1", ...(cursor ? { lastCursor: cursor } : {}) }),
        r2,
      );
      const batch = (r2._body?.list ?? []).map((u: any) => u.id);
      seen.push(...batch);
      cursor = r2._body?.lastCursor ?? null;
      if (!r2._body?.hasMore) break;
    }
    ok("paging one-at-a-time returns every person exactly once",
      seen.length === 2 && new Set(seen).size === 2 &&
        seen.includes(uNonPlantilla) && seen.includes(uProvisional),
      JSON.stringify(seen));

    // Search within the position.
    res = mockRes();
    await provisionalPositionPersonnel(
      req({ id: LINE, positionId: POS, limit: "200", query: "Qanp" }), res);
    ok("the per-position list is searchable",
      (res._body?.list ?? []).length === 1 &&
        res._body.list[0].id === uNonPlantilla);

    // ── 4. Line isolation ───────────────────────────────────────────────
    if (OTHER) {
      const outsiderPos = await mkPosition("Outsider", 1, OTHER);
      await mkHire({ tag: "out", status: "Non-Plantilla", positionId: outsiderPos, lineId: OTHER });
      res = mockRes();
      await provisionalPersonnel(req({ id: LINE, limit: "200", query: `PROVTEST${TS}` }), res);
      ok("another line's provisional staff never appear",
        !(res._body?.list ?? []).some((u: any) => u.firstName === "Qaout"));

      let threw = "";
      try {
        await provisionalPositionPersonnel(
          req({ id: LINE, positionId: outsiderPos, limit: "20" }), mockRes());
      } catch (e: any) { threw = e?.message ?? "err"; }
      ok("another line's position cannot be opened", !!threw, threw || "NO THROW");
    } else {
      console.log("SKIP  line isolation (only one line in this DB)");
    }

    let threw = "";
    try {
      await provisionalPositionPersonnel(req({ id: LINE, limit: "20" }), mockRes());
    } catch (e: any) { threw = e?.message ?? "err"; }
    ok("positionId is required", !!threw, threw || "NO THROW");
  } catch (e: any) {
    fail++;
    console.log("FAIL  threw: " + (e?.stack ?? e?.message ?? String(e)));
  } finally {
    try {
      if (made.inviteIds.length)
        await prisma.fillPositionInvitation.deleteMany({ where: { id: { in: made.inviteIds } } });
      if (made.appIds.length)
        await prisma.submittedApplication.deleteMany({ where: { id: { in: made.appIds } } });
      if (made.userIds.length)
        await prisma.user.deleteMany({ where: { id: { in: made.userIds } } });
      if (made.positionIds.length)
        await prisma.provisionalPosition.deleteMany({ where: { id: { in: made.positionIds } } });

      const leftU = await prisma.user.count({
        where: { username: { startsWith: `qa_prov_${TS}_` } },
      });
      const leftP = await prisma.provisionalPosition.count({
        where: { title: { startsWith: `QA ${TS} ` } },
      });
      console.log(`CLEANUP  leftover users=${leftU} positions=${leftP}`);
      if (leftU || leftP) fail++;
    } catch (e: any) {
      console.log("CLEANUP FAILED: " + (e?.message ?? e));
      fail++;
    }
    console.log(`\n${pass} passed, ${fail} failed`);
    await prisma.$disconnect();
    process.exit(fail ? 1 : 0);
  }
})();
