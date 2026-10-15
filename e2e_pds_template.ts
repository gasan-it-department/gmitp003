/* Is the PDS template safe for the generator to write into?
 *
 *   npx ts-node --transpile-only e2e_pds_template.ts [path-to-xlsx]
 *
 * ── Why this exists ──────────────────────────────────────────────────────
 *
 * The generator writes to FIXED cell addresses: `I24` is the residential
 * city, `L24` the province, and so on. Excel renders a merged range from
 * its TOP-LEFT cell only — a value written to any other cell inside the
 * range is kept in the file and shown nowhere.
 *
 * So if a new revision of the official form merges two input boxes into
 * one, every write to the second box silently vanishes. The export still
 * opens, still looks like a filled-in PDS, and is quietly missing a field.
 * Nothing in a typecheck, a build or a smoke test notices, because nothing
 * threw.
 *
 * That is exactly what a re-saved copy of the 2026 form did to `L24`
 * (province) and to row 29 (permanent subdivision/barangay), which is why
 * this check is now part of the repo rather than something somebody
 * remembers to eyeball.
 *
 * Every address below is kept in step with pdsExportController by
 * construction: the row ranges mirror the `.slice(0, n)` caps on each
 * repeating block, so a cap raised there without raising it here shows up
 * as an untested row rather than a false pass.
 */
import fs from "fs";
import path from "path";

const JSZip = require("jszip");

const TEMPLATE =
  process.argv[2] || path.join(process.cwd(), "templates", "cs_form_212.xlsx");

/** Column letters -> 1-based index. */
const colNum = (s: string): number => {
  let n = 0;
  for (const ch of s) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
};
const split = (ref: string): [number, number] => {
  const m = /^([A-Z]+)(\d+)$/.exec(ref);
  if (!m) throw new Error(`bad cell ref ${ref}`);
  return [parseInt(m[2], 10), colNum(m[1])];
};

interface Merge {
  ref: string;
  r1: number;
  c1: number;
  r2: number;
  c2: number;
}

/** The merged ranges declared by a sheet, parsed the same way the
 *  generator parses everything else: with a regex, no library. */
const merges = (xml: string): Merge[] => {
  const out: Merge[] = [];
  for (const m of xml.matchAll(/<mergeCell ref="([A-Z]+\d+):([A-Z]+\d+)"/g)) {
    const [r1, c1] = split(m[1]);
    const [r2, c2] = split(m[2]);
    out.push({ ref: `${m[1]}:${m[2]}`, r1, c1, r2, c2 });
  }
  return out;
};

const range = (from: number, to: number): number[] => {
  const out: number[] = [];
  for (let i = from; i <= to; i++) out.push(i);
  return out;
};
const grid = (cols: string[], rows: number[]): string[] =>
  rows.flatMap((r) => cols.map((c) => `${c}${r}`));

/*
  Every address pdsExportController writes, per sheet.

  Row spans come straight from the `.slice(0, n)` caps in the controller:
  civil service 7 from row 5, work experience 28 from row 18, voluntary
  work 7 from row 6, learning & development 20 from row 18.
*/
const TARGETS: Record<string, string[]> = {
  "xl/worksheets/sheet1.xml": [
    // identity
    "D10", "D11", "D12", "L12", "D13", "D22", "D24", "D25",
    "D27", "D29", "D31", "D32", "D33", "D34",
    // residential address
    "I19", "L19", "I22", "L22", "I24", "L24",
    // permanent address
    "I27", "L27", "I29", "L29", "I31", "L31",
    // contact
    "I32", "I33", "I34",
    // family
    "D36", "D37", "D38", "D43", "D44", "D47", "D48",
  ],
  "xl/worksheets/sheet2.xml": [
    ...grid(["A", "F", "G", "I", "L", "M"], range(5, 11)),
    ...grid(["A", "C", "D", "G", "L", "M"], range(18, 45)),
  ],
  "xl/worksheets/sheet3.xml": [
    ...grid(["A", "E", "F", "G", "H"], range(6, 12)),
    ...grid(["A", "E", "F", "G", "H", "I"], range(18, 37)),
    "A42", "C42", "I42",
  ],
  "xl/worksheets/sheet4.xml": [
    "D61", "D62", "D64",
    // "If YES, give details" answers, written onto their label cells
    "G14", "G38", "G44", "G46", "G48",
  ],
};

/* Cells whose grey fill the generator clears. These must be the full
   footprint of their merges, or part of a box stays shaded. */
const WHITE_CELLS: Record<string, string[]> = {
  "xl/worksheets/sheet1.xml": ["I24", "J24", "K24", "L24", "M24", "N24"],
};

(async () => {
  if (!fs.existsSync(TEMPLATE)) {
    console.error(`No template at ${TEMPLATE}`);
    process.exit(1);
  }
  console.log(`\ntemplate: ${TEMPLATE}`);
  console.log(`bytes:    ${fs.statSync(TEMPLATE).size}\n`);

  const zip = await JSZip.loadAsync(fs.readFileSync(TEMPLATE));
  let pass = 0;
  const fails: string[] = [];

  for (const [file, refs] of Object.entries(TARGETS)) {
    const entry = zip.file(file);
    if (!entry) {
      fails.push(`${file} is missing from the template`);
      continue;
    }
    const xml: string = await entry.async("string");
    const ms = merges(xml);
    const sheet = file.replace("xl/worksheets/", "").replace(".xml", "");

    let sheetFails = 0;
    for (const ref of refs) {
      const [r, c] = split(ref);
      const inside = ms.find(
        (m) => r >= m.r1 && r <= m.r2 && c >= m.c1 && c <= m.c2,
      );
      if (!inside) {
        pass++; // unmerged: a plain cell, always renders
        continue;
      }
      if (inside.r1 === r && inside.c1 === c) {
        pass++; // the anchor: renders
        continue;
      }
      sheetFails++;
      fails.push(
        `${sheet} ${ref} is INSIDE merge ${inside.ref} but is not its ` +
          `top-left cell — a value written here renders nowhere ` +
          `(anchor is the cell at row ${inside.r1}, col ${inside.c1})`,
      );
    }
    console.log(
      `  ${sheet}: ${refs.length} write targets, ${sheetFails} unsafe` +
        `  (${ms.length} merges declared)`,
    );
  }

  // ── the fill-clearing must cover whole boxes ──
  for (const [file, refs] of Object.entries(WHITE_CELLS)) {
    const entry = zip.file(file);
    if (!entry) continue;
    const xml: string = await entry.async("string");
    const ms = merges(xml);
    const set = new Set(refs);
    for (const ref of refs) {
      const [r, c] = split(ref);
      const m = ms.find(
        (x) => r >= x.r1 && r <= x.r2 && c >= x.c1 && c <= x.c2,
      );
      if (!m) continue;
      // every cell of that merge should also be in the white list
      for (let rr = m.r1; rr <= m.r2; rr++) {
        for (let cc = m.c1; cc <= m.c2; cc++) {
          const letter = String.fromCharCode(64 + cc);
          const other = `${letter}${rr}`;
          if (!set.has(other)) {
            fails.push(
              `WHITE_CELLS covers ${ref} but not ${other}, which is in the ` +
                `same merge ${m.ref} — part of that box would stay grey`,
            );
          }
        }
      }
    }
    pass++;
  }

  console.log(
    `\n${pass} write targets safe, ${fails.length} problem${fails.length === 1 ? "" : "s"}`,
  );
  if (fails.length) {
    console.log("");
    for (const f of fails) console.log(`  FAIL  ${f}`);
    process.exit(1);
  }
  console.log("Every cell the generator writes renders where it should.\n");
})();
