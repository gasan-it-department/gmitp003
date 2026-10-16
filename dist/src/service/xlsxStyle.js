"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.rowsFrom = exports.spread = exports.restyleCells = exports.ensureFont = void 0;
const xmlEscape = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
/**
 * Find or append a font, returning its index.
 *
 * Reused on an exact match so repeated calls do not grow the font table.
 */
const ensureFont = (stylesXml, f) => {
    var _a;
    const block = stylesXml.match(/<fonts count="(\d+)"([^>]*)>([\s\S]*?)<\/fonts>/);
    if (!block)
        throw new Error("styles.xml has no <fonts> table");
    const fonts = (_a = block[3].match(/<font\b[^>]*\/>|<font\b[^>]*>[\s\S]*?<\/font>/g)) !== null && _a !== void 0 ? _a : [];
    const want = `<font>${f.bold ? "<b/>" : ""}${f.italic ? "<i/>" : ""}` +
        `<sz val="${f.size}"/><color theme="1"/>` +
        `<name val="${xmlEscape(f.name)}"/><family val="2"/></font>`;
    const existing = fonts.indexOf(want);
    if (existing >= 0)
        return { styles: stylesXml, fontId: existing };
    const next = fonts.length;
    const rebuilt = `<fonts count="${next + 1}"${block[2]}>${block[3]}${want}</fonts>`;
    return {
        styles: stylesXml.slice(0, block.index) +
            rebuilt +
            stylesXml.slice(block.index + block[0].length),
        fontId: next,
    };
};
exports.ensureFont = ensureFont;
const parseCellXfs = (stylesXml) => {
    var _a;
    const block = stylesXml.match(/<cellXfs count="(\d+)"([^>]*)>([\s\S]*?)<\/cellXfs>/);
    if (!block)
        throw new Error("styles.xml has no <cellXfs> table");
    const xfs = (_a = block[3].match(/<xf\b[^>]*\/>|<xf\b[^>]*>[\s\S]*?<\/xf>/g)) !== null && _a !== void 0 ? _a : [];
    return { block, xfs };
};
/** A copy of `xf` with this font, and optionally this alignment. */
const derive = (xf, fontId, align) => {
    let out = xf;
    // font
    if (/\bfontId="\d+"/.test(out)) {
        out = out.replace(/\bfontId="\d+"/, `fontId="${fontId}"`);
    }
    else {
        out = out.replace(/^<xf\b/, `<xf fontId="${fontId}"`);
    }
    if (!/\bapplyFont="1"/.test(out)) {
        out = out.replace(/^<xf\b/, '<xf applyFont="1"');
    }
    if (align) {
        const set = (m) => {
            let a = m;
            if (/\bhorizontal="[^"]*"/.test(a)) {
                a = a.replace(/\bhorizontal="[^"]*"/, `horizontal="${align}"`);
            }
            else {
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
        }
        else if (out.endsWith("/>")) {
            out =
                out.slice(0, -2) +
                    `><alignment horizontal="${align}" vertical="center"/></xf>`;
        }
        else {
            out = out.replace("</xf>", `<alignment horizontal="${align}" vertical="center"/></xf>`);
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
const restyleCells = (sheetXml, stylesXml, specs) => {
    var _a, _b, _c, _d, _e;
    const { block, xfs } = parseCellXfs(stylesXml);
    const added = [];
    const seen = new Map();
    let sheet = sheetXml;
    let restyled = 0;
    for (const [ref, spec] of Object.entries(specs)) {
        if (spec.fontId === undefined && !spec.align)
            continue;
        const cell = sheet.match(new RegExp(`<c r="${ref}"(?=[ />])([^>]*)(?:/>|>)`));
        if (!cell)
            continue; // no such cell — nothing was written there
        const sAttr = cell[1].match(/\bs="(\d+)"/);
        const base = sAttr ? parseInt(sAttr[1], 10) : 0;
        if (base >= xfs.length)
            continue;
        const key = `${base}|${(_a = spec.fontId) !== null && _a !== void 0 ? _a : "-"}|${(_b = spec.align) !== null && _b !== void 0 ? _b : "-"}`;
        let idx = seen.get(key);
        if (idx === undefined) {
            const fontId = (_c = spec.fontId) !== null && _c !== void 0 ? _c : parseInt((_e = (_d = xfs[base].match(/\bfontId="(\d+)"/)) === null || _d === void 0 ? void 0 : _d[1]) !== null && _e !== void 0 ? _e : "0", 10);
            added.push(derive(xfs[base], fontId, spec.align));
            idx = xfs.length + added.length - 1;
            seen.set(key, idx);
        }
        // repoint just this cell
        const withS = new RegExp(`(<c r="${ref}"(?=[ />])[^>]*?)\\bs="\\d+"`);
        if (withS.test(sheet)) {
            sheet = sheet.replace(withS, `$1s="${idx}"`);
        }
        else {
            sheet = sheet.replace(new RegExp(`<c r="${ref}"(?=[ />])`), `<c r="${ref}" s="${idx}"`);
        }
        restyled++;
    }
    if (!added.length)
        return { sheet, styles: stylesXml, restyled };
    const rebuilt = `<cellXfs count="${xfs.length + added.length}"${block[2]}>` +
        `${block[3]}${added.join("")}</cellXfs>`;
    const styles = stylesXml.slice(0, block.index) +
        rebuilt +
        stylesXml.slice(block.index + block[0].length);
    return { sheet, styles, restyled };
};
exports.restyleCells = restyleCells;
/** Build `{ref: spec}` for a rectangle of columns across a row range. */
const spread = (cols, rows, spec) => {
    const out = {};
    for (const r of rows)
        for (const c of cols)
            out[`${c}${r}`] = spec;
    return out;
};
exports.spread = spread;
const rowsFrom = (from, count) => Array.from({ length: count }, (_, i) => from + i);
exports.rowsFrom = rowsFrom;
