/**
 * Give the values written into a workbook one consistent look.
 *
 * The template's own cells were authored by hand over several revisions,
 * so the boxes the generator fills carry whatever font the person drawing
 * the form happened to use: Arial Narrow at 7, 8, 9 and 10 points, some
 * bold and some not, aligned left in one row and centred in the next. The
 * form looks tidy blank and ragged once filled, because every value
 * inherits a different style from the box it lands in.
 *
 * So the generator stops inheriting and states what it wants.
 *
 * ── Why styles are cloned rather than replaced ──────────────────────────
 *
 * A cell's style carries its BORDERS and its fill as well as its font, and
 * those borders are what draw the form's grid. Pointing a cell at a plain
 * new style would erase the lines around it. Every style here is therefore
 * a copy of the one the cell already had, with only the font and alignment
 * changed, appended as a new entry — never an edit in place, because a
 * single xf is shared by dozens of cells and editing it would restyle
 * boxes nobody asked about.
 *
 * Entries are de-duplicated by (original style, font, alignment), so a
 * table of two hundred cells adds a handful of styles rather than two
 * hundred.
 */

export interface FontSpec {
  name: string;
  size: number;
  bold?: boolean;
  italic?: boolean;
}

export type Align = "left" | "center" | "right";

const xmlEscape = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * Find or append a font, returning its index.
 *
 * Reused on an exact match so repeated calls do not grow the font table.
 */
export const ensureFont = (
  stylesXml: string,
  f: FontSpec,
): { styles: string; fontId: number } => {
  const block = stylesXml.match(/<fonts count="(\d+)"([^>]*)>([\s\S]*?)<\/fonts>/);
  if (!block) throw new Error("styles.xml has no <fonts> table");
  const fonts: string[] = block[3].match(/<font\b[^>]*\/>|<font\b[^>]*>[\s\S]*?<\/font>/g) ?? [];

  const want =
    `<font>${f.bold ? "<b/>" : ""}${f.italic ? "<i/>" : ""}` +
    `<sz val="${f.size}"/><color theme="1"/>` +
    `<name val="${xmlEscape(f.name)}"/><family val="2"/></font>`;

  const existing = fonts.indexOf(want);
  if (existing >= 0) return { styles: stylesXml, fontId: existing };

  const next = fonts.length;
  const rebuilt =
    `<fonts count="${next + 1}"${block[2]}>${block[3]}${want}</fonts>`;
  return {
    styles:
      stylesXml.slice(0, block.index!) +
      rebuilt +
      stylesXml.slice(block.index! + block[0].length),
    fontId: next,
  };
};

const parseCellXfs = (stylesXml: string) => {
  const block = stylesXml.match(
    /<cellXfs count="(\d+)"([^>]*)>([\s\S]*?)<\/cellXfs>/,
  );
  if (!block) throw new Error("styles.xml has no <cellXfs> table");
  const xfs: string[] =
    block[3].match(/<xf\b[^>]*\/>|<xf\b[^>]*>[\s\S]*?<\/xf>/g) ?? [];
  return { block, xfs };
};

/** A copy of `xf` with this font, and optionally this alignment. */
const derive = (xf: string, fontId: number, align?: Align): string => {
  let out = xf;

  // font
  if (/\bfontId="\d+"/.test(out)) {
    out = out.replace(/\bfontId="\d+"/, `fontId="${fontId}"`);
  } else {
    out = out.replace(/^<xf\b/, `<xf fontId="${fontId}"`);
  }
  if (!/\bapplyFont="1"/.test(out)) {
    out = out.replace(/^<xf\b/, '<xf applyFont="1"');
  }

  if (align) {
    const set = (m: string) => {
      let a = m;
      if (/\bhorizontal="[^"]*"/.test(a)) {
        a = a.replace(/\bhorizontal="[^"]*"/, `horizontal="${align}"`);
      } else {
        a = a.replace(/^<alignment\b/, `<alignment horizontal="${align}"`);
      }
      // Keep text on the writing line of its box.
      if (!/\bvertical="[^"]*"/.test(a)) {
        a = a.replace(/^<alignment\b/, '<alignment vertical="center"');
      }
      return a;
    };
    if (/<alignment\b[^/>]*\/>/.test(out)) {
      out = out.replace(/<alignment\b[^/>]*\/>/, (m) => set(m));
    } else if (out.endsWith("/>")) {
      out =
        out.slice(0, -2) +
        `><alignment horizontal="${align}" vertical="center"/></xf>`;
    } else {
      out = out.replace(
        "</xf>",
        `<alignment horizontal="${align}" vertical="center"/></xf>`,
      );
    }
    if (!/\bapplyAlignment="1"/.test(out)) {
      out = out.replace(/^<xf\b/, '<xf applyAlignment="1"');
    }
  }
  return out;
};

/**
 * Restyle the given cells.
 *
 * Only cells that already exist in the sheet are touched — a style on a
 * cell with no value would render nothing and only bloat the file — so
 * this runs AFTER the values have been written.
 */
export const restyleCells = (
  sheetXml: string,
  stylesXml: string,
  specs: Record<string, { fontId?: number; align?: Align }>,
): { sheet: string; styles: string; restyled: number } => {
  const { block, xfs } = parseCellXfs(stylesXml);
  const added: string[] = [];
  const seen = new Map<string, number>();
  let sheet = sheetXml;
  let restyled = 0;

  for (const [ref, spec] of Object.entries(specs)) {
    if (spec.fontId === undefined && !spec.align) continue;

    const cell = sheet.match(
      new RegExp(`<c r="${ref}"(?=[ />])([^>]*)(?:/>|>)`),
    );
    if (!cell) continue; // no such cell — nothing was written there

    const sAttr = cell[1].match(/\bs="(\d+)"/);
    const base = sAttr ? parseInt(sAttr[1], 10) : 0;
    if (base >= xfs.length) continue;

    const key = `${base}|${spec.fontId ?? "-"}|${spec.align ?? "-"}`;
    let idx = seen.get(key);
    if (idx === undefined) {
      const fontId =
        spec.fontId ??
        parseInt(xfs[base].match(/\bfontId="(\d+)"/)?.[1] ?? "0", 10);
      added.push(derive(xfs[base], fontId, spec.align));
      idx = xfs.length + added.length - 1;
      seen.set(key, idx);
    }

    // repoint just this cell
    const withS = new RegExp(`(<c r="${ref}"(?=[ />])[^>]*?)\\bs="\\d+"`);
    if (withS.test(sheet)) {
      sheet = sheet.replace(withS, `$1s="${idx}"`);
    } else {
      sheet = sheet.replace(
        new RegExp(`<c r="${ref}"(?=[ />])`),
        `<c r="${ref}" s="${idx}"`,
      );
    }
    restyled++;
  }

  if (!added.length) return { sheet, styles: stylesXml, restyled };

  const rebuilt =
    `<cellXfs count="${xfs.length + added.length}"${block[2]}>` +
    `${block[3]}${added.join("")}</cellXfs>`;
  const styles =
    stylesXml.slice(0, block.index!) +
    rebuilt +
    stylesXml.slice(block.index! + block[0].length);

  return { sheet, styles, restyled };
};

/** Build `{ref: spec}` for a rectangle of columns across a row range. */
export const spread = (
  cols: string[],
  rows: number[],
  spec: { fontId?: number; align?: Align },
): Record<string, { fontId?: number; align?: Align }> => {
  const out: Record<string, { fontId?: number; align?: Align }> = {};
  for (const r of rows) for (const c of cols) out[`${c}${r}`] = spec;
  return out;
};

export const rowsFrom = (from: number, count: number): number[] =>
  Array.from({ length: count }, (_, i) => from + i);
