/* Fill every cell of the PDS template and read it back.
 *
 *   npx ts-node --transpile-only e2e_pds_cells.ts [path-to-xlsx]
 *
 * ── What this proves that the typecheck cannot ───────────────────────────
 *
 * The generator writes values into a template it does not own. A new
 * revision of the official form can move a merge, rename a form control or
 * drop a VML shape, and every one of those failures is SILENT: the export
 * still builds, still opens, and is quietly missing a field or a tick.
 *
 * So this drives the real `applyCells` over every address the generator
 * uses, with a distinct sentinel per cell, repackages the workbook, and
 * reads it back to confirm each sentinel is both PRESENT and RENDERABLE —
 * that is, sitting in a cell Excel will actually draw, not buried inside a
 * merged range that only shows its top-left corner.
 *
 * It then checks the checkbox machinery the same way: every ctrlProp file
 * the code names must exist, and every VML shape id it targets must be
 * findable in the drawing it belongs to. Those ids are template-specific,
 * and the attached 2026 file shipped different VML from the one deployed,
 * which is exactly the kind of change that ticks nothing and says nothing.
 */
import fs from "fs";
import os from "os";
import path from "path";

// Importing the controller pulls in the prisma barrel, which reaches for
// src/index.ts and would boot Fastify. Stub it first.
const entry = path.join(process.cwd(), "src", "index.ts");
require.cache[entry] = {
  id: entry,
  filename: entry,
  loaded: true,
  exports: {
    notificationSocket: { emitUserNotification: () => undefined },
  },
} as never;

const JSZip = require("jszip");

import {
  applyCells,
  DISCLOSURE_BOXES,
  SHEET1_BOXES,
  WHITE_CELLS,
} from "./src/controller/pdsExportController";

const TEMPLATE =
  process.argv[2] || path.join(process.cwd(), "templates", "cs_form_212.xlsx");

const colNum = (s: string): number => {
  let n = 0;
  for (const ch of s) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
};
const split = (ref: string): [number, number] => {
  const m = /^([A-Z]+)(\d+)$/.exec(ref);
  if (!m) throw new Error(`bad ref ${ref}`);
  return [parseInt(m[2], 10), colNum(m[1])];
};
const merges = (xml: string) => {
  const out: Array<{ ref: string; r1: number; c1: number; r2: number; c2: number }> = [];
  for (const m of xml.matchAll(/<mergeCell ref="([A-Z]+\d+):([A-Z]+\d+)"/g)) {
    const [r1, c1] = split(m[1]);
    const [r2, c2] = split(m[2]);
    out.push({ ref: `${m[1]}:${m[2]}`, r1, c1, r2, c2 });
  }
  return out;
};
const range = (a: number, b: number) =>
  Array.from({ length: b - a + 1 }, (_, i) => a + i);
const grid = (cols: string[], rows: number[]) =>
  rows.flatMap((r) => cols.map((c) => `${c}${r}`));

/* Mirrors pdsExportController's write map. Row spans come from the
   `.slice(0, n)` caps there: civil service 7 from row 5, experience 28 from
   row 18, voluntary work 7 from row 6, learning & development 20 from 18. */
const TARGETS: Record<string, string[]> = {
  "xl/worksheets/sheet1.xml": [
    "D10", "D11", "D12", "L12", "D13", "D22", "D24", "D25",
    "D27", "D29", "D31", "D32", "D33", "D34",
    // Each value sits in the box ABOVE its caption; the ZIP row is
    // one wide box so it has no right-hand partner.
    "I17", "L17", "I19", "L19", "I22", "L22", "I24",
    "I25", "L25", "I27", "L27", "I29", "L29", "I31",
    "I32", "I33", "I34",
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
    "D61", "D62", "D64", "G14", "G38", "G44", "G46", "G48",
  ],
};

/** The cells whose values a reader would actually see. */
const readCells = (xml: string): Map<string, string> => {
  const out = new Map<string, string>();
  for (const m of xml.matchAll(
    /<c r="([A-Z]+\d+)"[^>]*t="inlineStr"[^>]*>\s*<is>\s*<t[^>]*>([\s\S]*?)<\/t>/g,
  )) {
    out.set(m[1], m[2]);
  }
  return out;
};

let pass = 0;
const fails: string[] = [];
const ok = (cond: boolean, name: string) => {
  if (cond) pass++;
  else fails.push(name);
};

(async () => {
  if (!fs.existsSync(TEMPLATE)) {
    console.error(`no template at ${TEMPLATE}`);
    process.exit(1);
  }
  console.log(`\ntemplate: ${TEMPLATE}`);
  console.log(`bytes:    ${fs.statSync(TEMPLATE).size}\n`);

  const zip = await JSZip.loadAsync(fs.readFileSync(TEMPLATE));

  console.log("── writing a sentinel into every write target ──");
  for (const [file, refs] of Object.entries(TARGETS)) {
    const e = zip.file(file);
    if (!e) {
      fails.push(`${file} missing`);
      continue;
    }
    const original: string = await e.async("string");

    // one distinguishable value per cell, so a value landing in the wrong
    // cell is caught rather than masked by a shared sentinel
    const cells: Record<string, string> = {};
    for (const r of refs) cells[r] = `ZZ-${r}-ZZ`;

    const written = applyCells(original, cells);
    const back = readCells(written);
    const ms = merges(original);
    const sheet = file.replace("xl/worksheets/", "").replace(".xml", "");

    let missing = 0;
    let hidden = 0;
    let misplaced = 0;
    for (const r of refs) {
      const want = `ZZ-${r}-ZZ`;
      const got = back.get(r);
      if (got === undefined) {
        missing++;
        fails.push(`${sheet} ${r}: nothing was written (cell absent from XML)`);
        continue;
      }
      if (got !== want) {
        misplaced++;
        fails.push(`${sheet} ${r}: holds "${got}" instead of its own sentinel`);
        continue;
      }
      const inside = ms.find(
        (m) => {
          const [rr, cc] = split(r);
          return rr >= m.r1 && rr <= m.r2 && cc >= m.c1 && cc <= m.c2;
        },
      );
      if (inside) {
        const [rr, cc] = split(r);
        if (inside.r1 !== rr || inside.c1 !== cc) {
          hidden++;
          fails.push(
            `${sheet} ${r}: written, but hidden inside merge ${inside.ref} ` +
              `— Excel renders only that range's top-left cell`,
          );
          continue;
        }
      }
      pass++;
    }
    console.log(
      `  ${sheet}: ${refs.length} cells — ${missing} not written, ` +
        `${hidden} hidden by a merge, ${misplaced} misplaced`,
    );
    zip.file(file, written);
  }

  // ── the grey-fill cells must still exist to be de-greyed ──
  console.log("\n── fill-clearing targets ──");
  for (const [file, refs] of Object.entries(WHITE_CELLS)) {
    const e = zip.file(file);
    if (!e) {
      fails.push(`${file} missing for WHITE_CELLS`);
      continue;
    }
    const xml: string = await e.async("string");
    for (const r of refs) {
      const found = new RegExp(`<c r="${r}"`).test(xml);
      ok(found, `WHITE_CELLS ${r} is not a cell in ${file}`);
    }
    console.log(`  ${refs.length} cells checked in ${file.split("/").pop()}`);
  }

  // ── checkbox machinery: every control the code names must exist ──
  console.log("\n── checkbox controls ──");
  const allBoxes = [
    ...Object.entries(SHEET1_BOXES).map(([k, b]) => [k, b] as const),
    ...Object.entries(DISCLOSURE_BOXES).flatMap(
      ([k, p]) =>
        [
          [`${k}.yes`, p.yes],
          [`${k}.no`, p.no],
        ] as const,
    ),
  ];
  const vmlCache = new Map<string, string>();
  for (const [name, box] of allBoxes) {
    const cp = zip.file(`xl/ctrlProps/${box.ctrlProp}`);
    ok(!!cp, `checkbox ${name}: xl/ctrlProps/${box.ctrlProp} is missing`);

    if (!vmlCache.has(box.vmlFile)) {
      const ve = zip.file(box.vmlFile);
      vmlCache.set(box.vmlFile, ve ? await ve.async("string") : "");
    }
    const vml = vmlCache.get(box.vmlFile) || "";
    ok(vml.length > 0, `checkbox ${name}: ${box.vmlFile} is missing`);
    ok(
      vml.includes(box.vmlId),
      `checkbox ${name}: VML shape id ${box.vmlId} not found in ` +
        `${box.vmlFile} — this box would never tick`,
    );
  }
  console.log(`  ${allBoxes.length} controls checked (${allBoxes.length * 3} assertions)`);

  // ── the filled workbook must still be a readable xlsx ──
  console.log("\n── repackage and reopen ──");
  const out: Buffer = await zip.generateAsync({ type: "nodebuffer" });
  // os temp, not templates/ — a test must not leave files in the directory
  // the generator reads its template from.
  const tmp = path.join(os.tmpdir(), "e2e_filled_pds.xlsx");
  fs.writeFileSync(tmp, out);
  console.log(`  wrote ${out.length} bytes`);
  const re = await JSZip.loadAsync(out);
  ok(!!re.file("xl/worksheets/sheet1.xml"), "reopened workbook lost sheet1");
  ok(!!re.file("xl/drawings/vmlDrawing1.vml"), "reopened workbook lost VML 1");
  ok(!!re.file("xl/drawings/vmlDrawing2.vml"), "reopened workbook lost VML 2");
  const s1: string = await re.file("xl/worksheets/sheet1.xml")!.async("string");
  ok(s1.includes("ZZ-L22-ZZ"), "the province sentinel is not in the output");
  ok(s1.includes("ZZ-I22-ZZ"), "the city sentinel is not in the output");
  ok(s1.includes("ZZ-I27-ZZ"), "the permanent-subdivision sentinel is missing");
  ok(s1.includes("ZZ-L27-ZZ"), "the permanent-barangay sentinel is missing");
  console.log(`  kept at ${tmp} for inspection`);

  console.log(
    `\n${pass} assertions passed, ${fails.length} failed`,
  );
  if (fails.length) {
    console.log("");
    for (const f of fails.slice(0, 40)) console.log(`  FAIL  ${f}`);
    if (fails.length > 40) console.log(`  ... and ${fails.length - 40} more`);
    process.exit(1);
  }
  console.log(
    "Every field lands in a cell Excel will draw, and every checkbox " +
      "control resolves.\n",
  );
})();
