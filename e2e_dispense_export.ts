/* PROOF: /medicine/dispense-history/export builds a per-patient .xlsx —
 * aggregates units per patient, resolves linked-patient full name + address,
 * groups walk-ins by typed name (blank address), and honors the date range.
 * Run: npx ts-node --transpile-only e2e_dispense_export.ts */
import { prisma } from "./src/barrel/prisma";
import { dispenseHistoryExport } from "./src/controller/medicineController";
import ExcelJS from "exceljs";

const TS = Date.now();
const mockRes = () => {
  const r: any = {
    _code: 0,
    _body: null as unknown,
    _headers: {} as Record<string, string>,
    code(n: number) { this._code = n; return this; },
    send(b: unknown) { this._body = b; return this; },
    status(n: number) { return this.code(n); },
    header(k: string, v: string) { this._headers[k.toLowerCase()] = v; return this; },
  };
  return r;
};

(async () => {
  let pass = 0, fail = 0;
  const ok = (l: string, c: boolean, d = "") => {
    if (c) { pass++; console.log("PASS  " + l); }
    else { fail++; console.log("FAIL  " + l + (d ? "  → " + d : "")); }
  };
  const made = { patientId: "", recordIds: [] as string[] };

  try {
    const line = await prisma.line.findFirst({ select: { id: true } });
    if (!line) { console.log("NO FIXTURE (no line)"); process.exit(2); }

    // Optional address parts — use existing PSGC rows if present (don't build
    // the whole hierarchy); the address assertion adapts to what's available.
    const brgy = await prisma.barangay.findFirst({ select: { id: true, name: true } });
    const muni = await prisma.municipal.findFirst({ select: { id: true, name: true } });
    const prov = await prisma.province.findFirst({ select: { id: true, name: true } });

    const patient = await prisma.patient.create({
      data: {
        lineId: line.id,
        lastname: `QAEXPORT${TS}`,
        firstname: "Maria",
        middlename: "Santos",
        barangayId: brgy?.id ?? null,
        municipalId: muni?.id ?? null,
        provinceId: prov?.id ?? null,
      },
      select: { id: true },
    });
    made.patientId = patient.id;

    const JUL = new Date("2026-07-15T03:00:00.000Z");
    const JAN = new Date("2026-01-15T03:00:00.000Z");
    const mkRec = async (
      kind: number,
      patientId: string | null,
      patientName: string | null,
      units: number,
      when: Date,
    ) => {
      const rec = await prisma.dispenseRecord.create({
        data: {
          lineId: line.id, kind, patientId, patientName,
          totalUnits: units, timestamp: when,
        },
        select: { id: true },
      });
      made.recordIds.push(rec.id);
      return rec.id;
    };

    // Linked patient: 5 + 3 in July, 100 in January (out of range)
    await mkRec(1, patient.id, "Maria Santos", 5, JUL);
    await mkRec(1, patient.id, "Maria Santos", 3, JUL);
    await mkRec(1, patient.id, "Maria Santos", 100, JAN);
    // Walk-ins (no patientId): 2 + 4 in July under the same typed name
    await mkRec(0, null, `QA Walkin ${TS}`, 2, JUL);
    await mkRec(0, null, `QA Walkin ${TS}`, 4, JUL);

    const parse = async (body: unknown) => {
      const wb = new ExcelJS.Workbook();
      await (wb.xlsx as any).load(body as Buffer);
      const ws = wb.worksheets[0];
      const rows: { name: string; address: string; units: number }[] = [];
      ws.eachRow((row) => {
        const name = String(row.getCell(2).value ?? "").trim();
        const address = String(row.getCell(3).value ?? "").trim();
        const unitsRaw = row.getCell(4).value;
        const units = typeof unitsRaw === "number" ? unitsRaw : Number(unitsRaw);
        rows.push({ name, address, units: isNaN(units) ? NaN : units });
      });
      return { ws, rows };
    };

    // ── July range: linked patient should aggregate to 8; Jan 100 excluded ──
    {
      const res = mockRes();
      await dispenseHistoryExport(
        {
          query: {
            lineId: line.id, dateFrom: "2026-07-01", dateTo: "2026-07-31",
            periodLabel: "July 2026",
          },
        } as any,
        res as any,
      );
      const ct = res._headers["content-type"] || "";
      ok("export returns an .xlsx content-type", ct.includes("spreadsheetml"), ct);
      ok(
        "filename carries the period label",
        (res._headers["content-disposition"] || "").includes("July_2026"),
        res._headers["content-disposition"],
      );
      ok("body is a non-empty buffer", !!res._body && (res._body as Buffer).length > 0);

      const { rows } = await parse(res._body);
      const maria = rows.find((r) => r.name.startsWith("QAEXPORT"));
      const walkin = rows.find((r) => r.name.includes("QA Walkin"));
      ok("linked patient row present", !!maria, JSON.stringify(rows.slice(0, 8)));
      ok("linked patient units summed (5+3=8, Jan 100 excluded)", maria?.units === 8,
        `got ${maria?.units}`);
      ok("full name is 'Lastname, Firstname Middle'",
        !!maria && maria.name === `QAEXPORT${TS}, Maria Santos`, maria?.name);
      ok("walk-in grouped by typed name (2+4=6)", walkin?.units === 6, `got ${walkin?.units}`);
      ok("walk-in address is blank marker '—'", walkin?.address === "—", walkin?.address);
      if (brgy || muni || prov) {
        const expected = [brgy?.name, muni?.name, prov?.name].filter(Boolean).join(", ");
        ok("linked patient address resolved from PSGC", maria?.address === expected,
          `got '${maria?.address}' expected '${expected}'`);
      } else {
        ok("linked patient address blank (no PSGC rows in DB)", maria?.address === "—", maria?.address);
      }
      // header/title sanity
      const { ws } = await parse(res._body);
      const title = String(ws.getCell("A1").value ?? "");
      ok("title band present", title.includes("DISPENSE HISTORY REPORT"), title);
    }

    // ── All-time: linked patient now includes the January 100 (=108) ──
    {
      const res = mockRes();
      await dispenseHistoryExport(
        { query: { lineId: line.id, periodLabel: "All time" } } as any,
        res as any,
      );
      const wb = new ExcelJS.Workbook();
      await (wb.xlsx as any).load(res._body as Buffer);
      const ws = wb.worksheets[0];
      let maria = 0;
      ws.eachRow((row) => {
        if (String(row.getCell(2).value ?? "").startsWith("QAEXPORT"))
          maria = Number(row.getCell(4).value);
      });
      ok("all-time includes out-of-range record (5+3+100=108)", maria === 108, `got ${maria}`);
    }
  } catch (e) {
    fail++;
    console.log("FAIL  threw → " + (e as Error).message);
  } finally {
    // cleanup — always
    if (made.recordIds.length)
      await prisma.dispenseRecord.deleteMany({ where: { id: { in: made.recordIds } } });
    if (made.patientId)
      await prisma.patient.deleteMany({ where: { id: made.patientId } });
    await prisma.$disconnect();
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
