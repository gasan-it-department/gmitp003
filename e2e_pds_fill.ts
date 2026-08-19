/* PROOF: the residential City/Municipality + Province boxes come out WHITE.
 *
 * The 2026 template ships I24:K24 (City/Municipality) and L24:N24 (Province)
 * on sheet C1 with a solid grey fill; the 2025 template had them white, so
 * swapping templates made every export grey in that one block.
 *
 * This runs the real transform over the real template and re-reads the
 * produced workbook, rather than trusting the code by eye.
 *
 * Run: npx ts-node --transpile-only e2e_pds_fill.ts */
import fs from "fs";
import path from "path";
// jszip ships no type declarations — same typed require the exporter uses.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const JSZip = require("jszip");
import {
  WHITE_CELLS,
  clearCellFills,
} from "./src/controller/pdsExportController";

const TEMPLATE = path.join(__dirname, "templates", "cs_form_212.xlsx");
const SHEET = "xl/worksheets/sheet1.xml";
/** The two merged input boxes, every cell of them. */
const ADDRESS_BOXES = ["I24", "J24", "K24", "L24", "M24", "N24"];

/** fillId behind a cell's style index. */
const readStyles = (stylesXml: string) => {
  const block = stylesXml.match(/<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/);
  const xfs = block
    ? [...block[1].matchAll(/<xf\b[^>]*?\/>|<xf\b[^>]*?>[\s\S]*?<\/xf>/g)].map(
        (m) => m[0],
      )
    : [];
  const count = Number(stylesXml.match(/<cellXfs[^>]*count="(\d+)"/)?.[1] ?? 0);
  return { xfs, count };
};
const attr = (xf: string, name: string) =>
  xf?.match(new RegExp(`${name}="([^"]*)"`))?.[1] ?? null;

const cellStyle = (sheetXml: string, ref: string) => {
  const m = sheetXml.match(new RegExp(`<c r="${ref}"([^>]*?)(/>|>)`));
  if (!m) return null;
  const s = m[1].match(/\bs="(\d+)"/);
  return s ? Number(s[1]) : 0;
};

/** Solid/patterned fills read as coloured; `none` and pure white do not. */
const fillIsColoured = (stylesXml: string, fillId: number) => {
  const fills = [
    ...(stylesXml.match(/<fills[^>]*>([\s\S]*?)<\/fills>/)?.[1] ?? "").matchAll(
      /<fill>([\s\S]*?)<\/fill>/g,
    ),
  ].map((m) => m[1]);
  const f = fills[fillId];
  if (!f) return false;
  if (/patternType="none"/.test(f)) return false;
  // indexed 9 and theme 0 are white; anything else solid is a real colour.
  if (/patternType="solid"/.test(f)) {
    return !/fgColor\s+(indexed="9"|theme="0"|rgb="FFFFFFFF")/.test(f);
  }
  return false;
};

(async () => {
  let pass = 0,
    fail = 0;
  const ok = (l: string, c: boolean, d = "") => {
    if (c) {
      pass++;
      console.log("PASS  " + l);
    } else {
      fail++;
      console.log("FAIL  " + l + (d ? "  -> " + d : ""));
    }
  };

  try {
    ok("the template is on disk", fs.existsSync(TEMPLATE));
    const zip = await JSZip.loadAsync(fs.readFileSync(TEMPLATE));
    const beforeSheet = await zip.file(SHEET)!.async("string");
    const beforeStyles = await zip.file("xl/styles.xml")!.async("string");

    // ── The defect is really there in the template ──────────────────────
    const beforeXfs = readStyles(beforeStyles);
    const greyBefore = ADDRESS_BOXES.filter((ref) => {
      const s = cellStyle(beforeSheet, ref);
      if (s === null) return false;
      const fid = Number(attr(beforeXfs.xfs[s], "fillId") ?? 0);
      return fillIsColoured(beforeStyles, fid);
    });
    ok("the template really does shade all six address cells",
      greyBefore.length === ADDRESS_BOXES.length, JSON.stringify(greyBefore));

    ok("the fix targets exactly those cells",
      JSON.stringify(WHITE_CELLS[SHEET]) === JSON.stringify(ADDRESS_BOXES),
      JSON.stringify(WHITE_CELLS[SHEET]));

    // ── Run the real transform ──────────────────────────────────────────
    const out = clearCellFills(beforeSheet, beforeStyles, WHITE_CELLS[SHEET]);
    const afterXfs = readStyles(out.styles);

    for (const ref of ADDRESS_BOXES) {
      const s = cellStyle(out.sheet, ref)!;
      const fid = Number(attr(afterXfs.xfs[s], "fillId") ?? 0);
      ok(`${ref} is no longer coloured`, !fillIsColoured(out.styles, fid),
        `fillId=${fid}`);
    }

    // ── Everything else about the cell must survive ─────────────────────
    for (const ref of ADDRESS_BOXES) {
      const before = beforeXfs.xfs[cellStyle(beforeSheet, ref)!];
      const after = afterXfs.xfs[cellStyle(out.sheet, ref)!];
      const same = (n: string) => attr(before, n) === attr(after, n);
      ok(`${ref} keeps its border, font and number format`,
        same("borderId") && same("fontId") && same("numFmtId"),
        JSON.stringify({
          border: [attr(before, "borderId"), attr(after, "borderId")],
          font: [attr(before, "fontId"), attr(after, "fontId")],
        }));
    }

    // ── The rest of the sheet must be untouched ─────────────────────────
    for (const ref of ["I22", "L22", "I23", "L23", "I25", "L31"]) {
      ok(`${ref} is left alone`,
        cellStyle(beforeSheet, ref) === cellStyle(out.sheet, ref),
        `${cellStyle(beforeSheet, ref)} -> ${cellStyle(out.sheet, ref)}`);
    }

    // ── The styles part must stay well-formed ───────────────────────────
    ok("cellXfs count matches the number of entries",
      afterXfs.count === afterXfs.xfs.length,
      `count=${afterXfs.count} entries=${afterXfs.xfs.length}`);
    ok("styles only grew (no original style was rewritten)",
      afterXfs.xfs.length > beforeXfs.xfs.length &&
        afterXfs.xfs.slice(0, beforeXfs.xfs.length).join("") ===
          beforeXfs.xfs.join(""));
    ok("the six cells share the two twins rather than making six",
      afterXfs.xfs.length - beforeXfs.xfs.length <= 3,
      `added ${afterXfs.xfs.length - beforeXfs.xfs.length}`);

    // ── And Excel can still open the result ─────────────────────────────
    zip.file(SHEET, out.sheet);
    zip.file("xl/styles.xml", out.styles);
    const buf = await zip.generateAsync({ type: "nodebuffer" });
    const reopened = await JSZip.loadAsync(buf);
    const rSheet = await reopened.file(SHEET)!.async("string");
    const rStyles = await reopened.file("xl/styles.xml")!.async("string");
    const rXfs = readStyles(rStyles);
    const stillWhite = ADDRESS_BOXES.every((ref) => {
      const s = cellStyle(rSheet, ref)!;
      return !fillIsColoured(rStyles, Number(attr(rXfs.xfs[s], "fillId") ?? 0));
    });
    ok("re-packaged and re-read, the cells are still white", stillWhite);
    ok("the workbook still contains all its parts",
      Object.keys(reopened.files).length === Object.keys(zip.files).length);
  } catch (e: any) {
    fail++;
    console.log("FAIL  threw: " + (e?.stack ?? e?.message ?? String(e)));
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
