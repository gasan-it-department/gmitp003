/* PROOF, END TO END: run the REAL PDS export and read the bytes it produces.
 *
 * The earlier test exercised the fill-clearing transform in isolation, which
 * proved the helper worked but NOT that the export actually calls it. This
 * drives exportPdsExcel itself, captures the .xlsx it sends, and inspects the
 * residential City/Municipality (I24:K24) and Province (L24:N24) boxes in the
 * delivered workbook.
 *
 * Run: npx ts-node --transpile-only e2e_pds_export_fill.ts */
// jszip ships no type declarations — same typed require the exporter uses.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const JSZip = require("jszip");
import { prisma } from "./src/barrel/prisma";
import { exportPdsExcel } from "./src/controller/pdsExportController";

const SHEET = "xl/worksheets/sheet1.xml";
/** The two merged address boxes that must print white. */
const MUST_BE_WHITE = ["I24", "J24", "K24", "L24", "M24", "N24"];
/** The form's grey label gutter — must stay grey, or we broke the design. */
const MUST_STAY_GREY = ["G24", "H24", "A24", "B24"];

const captureRes = () => {
  const r: any = {
    _code: 0,
    _headers: {} as Record<string, string>,
    _payload: null as Buffer | null,
    code(n: number) { this._code = n; return this; },
    status(n: number) { return this.code(n); },
    header(k: string, v: string) { this._headers[k] = v; return this; },
    headers(h: Record<string, string>) { Object.assign(this._headers, h); return this; },
    type(t: string) { this._headers["content-type"] = t; return this; },
    send(b: unknown) { this._payload = b as Buffer; return this; },
  };
  return r;
};

const fillsOf = (stylesXml: string) =>
  [...(stylesXml.match(/<fills[^>]*>([\s\S]*?)<\/fills>/)?.[1] ?? "").matchAll(
    /<fill>([\s\S]*?)<\/fill>/g,
  )].map((m) => m[1]);

const isGrey = (stylesXml: string, fillId: number) => {
  const f = fillsOf(stylesXml)[fillId];
  if (!f || /patternType="none"/.test(f)) return false;
  if (!/patternType="solid"/.test(f)) return false;
  return !/fgColor\s+(indexed="9"|theme="0"|rgb="FFFFFFFF")/.test(f);
};

const cellFill = (sheetXml: string, stylesXml: string, ref: string) => {
  const m = sheetXml.match(new RegExp(`<c r="${ref}"([^>]*?)(/>|>)`));
  if (!m) return null;
  const sIdx = Number(m[1].match(/\bs="(\d+)"/)?.[1] ?? 0);
  const xfs = [...(stylesXml.match(/<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/)?.[1] ?? "")
    .matchAll(/<xf\b[^>]*?\/>|<xf\b[^>]*?>[\s\S]*?<\/xf>/g)].map((x) => x[0]);
  return Number(xfs[sIdx]?.match(/fillId="(\d+)"/)?.[1] ?? 0);
};

(async () => {
  let pass = 0, fail = 0;
  const ok = (l: string, c: boolean, d = "") => {
    if (c) { pass++; console.log("PASS  " + l); }
    else { fail++; console.log("FAIL  " + l + (d ? "  -> " + d : "")); }
  };

  try {
    const app = await prisma.submittedApplication.findFirst({
      select: { id: true, firstname: true, lastname: true },
      orderBy: { timestamp: "desc" },
    });
    if (!app) { console.log("NO FIXTURE (submittedApplication)"); process.exit(2); }
    console.log(`exporting for: ${app.lastname}, ${app.firstname}\n`);

    const res = captureRes();
    await exportPdsExcel({ query: { id: app.id } } as any, res);

    // The handler streams the workbook with res.header(...).send(buf) and
    // never calls res.code(), so the payload and the download headers are
    // what there is to assert.
    ok("it sent a payload", Buffer.isBuffer(res._payload) && res._payload.length > 0,
      `${res._payload ? (res._payload as Buffer).length : 0} bytes`);
    ok("it is served as a spreadsheet download",
      /sheet|excel|octet/i.test(
        Object.entries(res._headers)
          .filter(([k]) => /content-(type|disposition)/i.test(k))
          .map(([, v]) => v)
          .join(" "),
      ),
      JSON.stringify(res._headers));

    const zip = await JSZip.loadAsync(res._payload as Buffer);
    ok("the payload is a readable xlsx", !!zip.file(SHEET));

    const sheetXml = await zip.file(SHEET)!.async("string");
    const stylesXml = await zip.file("xl/styles.xml")!.async("string");

    // ── The actual complaint ────────────────────────────────────────────
    for (const ref of MUST_BE_WHITE) {
      const fid = cellFill(sheetXml, stylesXml, ref);
      ok(`${ref} prints WHITE in the delivered file`,
        fid !== null && !isGrey(stylesXml, fid), `fillId=${fid}`);
    }

    // ── We must not have bleached the form's own grey label gutter ──────
    for (const ref of MUST_STAY_GREY) {
      const fid = cellFill(sheetXml, stylesXml, ref);
      ok(`${ref} (label gutter) is still grey, as the form intends`,
        fid !== null && isGrey(stylesXml, fid), `fillId=${fid}`);
    }

    // ── The data still landed in those boxes ────────────────────────────
    const textAt = (ref: string) => {
      const m = sheetXml.match(new RegExp(`<c r="${ref}"[^>]*>([\\s\\S]*?)</c>`));
      return m ? (m[1].match(/<t[^>]*>([\s\S]*?)<\/t>/)?.[1] ?? "") : "";
    };
    ok("City/Municipality still carries its value", textAt("I24").trim().length > 0,
      JSON.stringify(textAt("I24")));
    ok("Province still carries its value", textAt("L24").trim().length > 0,
      JSON.stringify(textAt("L24")));
    console.log(`      I24=${JSON.stringify(textAt("I24"))}  L24=${JSON.stringify(textAt("L24"))}`);

    // ── Neighbouring address boxes untouched ────────────────────────────
    for (const ref of ["I22", "L22", "I23", "L23", "I25"]) {
      const fid = cellFill(sheetXml, stylesXml, ref);
      ok(`${ref} is still white`, fid !== null && !isGrey(stylesXml, fid), `fillId=${fid}`);
    }
  } catch (e: any) {
    fail++;
    console.log("FAIL  threw: " + (e?.stack ?? e?.message ?? String(e)));
  } finally {
    console.log(`\n${pass} passed, ${fail} failed`);
    await prisma.$disconnect();
    process.exit(fail ? 1 : 0);
  }
})();
