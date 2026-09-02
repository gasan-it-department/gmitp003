"use strict";
// Fills the OFFICIAL CS Form 212 (Revised 2026) template with a person's PDS
// data and returns it as .xlsx. To keep the template byte-for-byte intact
// (logo, lines, form-control boxes, fonts, print areas) we DO NOT round-trip
// through a spreadsheet library — that drops drawings/VML and effectively
// rebuilds the file. Instead we open the .xlsx as a ZIP and edit only the
// cell values inside each sheet's XML, leaving every other part untouched.
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.exportPdsExcel = exports.clearCellFills = exports.WHITE_CELLS = void 0;
const prisma_1 = require("../barrel/prisma");
const errors_1 = require("../errors/errors");
const encryption_1 = require("../service/encryption");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
// jszip@3.1.3 ships no type declarations; a typed require keeps ts-node happy
// without pulling in a missing @types package.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const JSZip = require("jszip");
const TEMPLATE = path_1.default.join(process.cwd(), "templates", "cs_form_212.xlsx");
const dec = (data, iv) => __awaiter(void 0, void 0, void 0, function* () {
    if (!data || !iv)
        return data !== null && data !== void 0 ? data : "";
    try {
        return yield encryption_1.EncryptionService.decrypt(data, iv);
    }
    catch (_a) {
        return data !== null && data !== void 0 ? data : "";
    }
});
const arr = (v) => (Array.isArray(v) ? v : []);
const obj = (v) => (v && typeof v === "object" ? v : {});
const S = (v) => {
    if (v === null || v === undefined)
        return "";
    const s = String(v).trim();
    // Treat placeholder/garbage values as empty so they never render on the form.
    // (Older submissions saved literal "undefined"/"null" strings for blank fields.)
    const low = s.toLowerCase();
    if (s === "N/A" || low === "undefined" || low === "null")
        return "";
    return s;
};
// Format a full date string (ISO or yyyy-mm-dd) as dd/mm/yyyy — the format the
// CS Form 212 expects. Year-only ("2010") or non-date strings pass through
// unchanged, so it's safe to apply to any date-ish cell.
const fmtDate = (v) => {
    const s = S(v);
    if (!s || !/^\d{4}-\d{2}-\d{2}/.test(s))
        return s;
    const d = new Date(s);
    if (isNaN(d.getTime()))
        return s;
    const dd = String(d.getUTCDate()).padStart(2, "0");
    const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
    return `${dd}/${mm}/${d.getUTCFullYear()}`;
};
// ── PSGC code → place name resolution ─────────────────────────────────────
// The address selects store PSGC codes (e.g. "174003000"), not names. Resolve
// them to readable names via the public PSGC API (same source the UI uses).
const psgcCache = new Map();
const isCode = (v) => /^\d{6,}$/.test(v);
const psgcName = (kind, code) => __awaiter(void 0, void 0, void 0, function* () {
    const key = `${kind}:${code}`;
    if (psgcCache.has(key))
        return psgcCache.get(key);
    try {
        const r = yield fetch(`https://psgc.gitlab.io/api/${kind}/${code}/`);
        if (!r.ok)
            return null;
        const j = yield r.json();
        if (j === null || j === void 0 ? void 0 : j.name) {
            psgcCache.set(key, j.name);
            return j.name;
        }
    }
    catch (_a) {
        /* offline / unreachable → fall back to the raw value */
    }
    return null;
});
const resolvePlace = (value, kinds) => __awaiter(void 0, void 0, void 0, function* () {
    const v = S(value);
    if (!v || !isCode(v))
        return v;
    for (const k of kinds) {
        const n = yield psgcName(k, v);
        if (n)
            return n;
    }
    return v;
});
// ── XML cell editing ──────────────────────────────────────────────────────
const xmlEsc = (s) => s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
// Set the given cells (ref → value) inside one sheet's XML, preserving each
// cell's existing style (`s` attribute) and writing the value as an inline
// string. Cells absent from the template are skipped.
const applyCells = (xml, cells) => {
    for (const [ref, raw] of Object.entries(cells)) {
        const val = S(raw);
        if (!val)
            continue;
        const esc = xmlEsc(val);
        const build = (attrs) => `<c r="${ref}"${attrs.replace(/\s+t="[^"]*"/g, "")} t="inlineStr">` +
            `<is><t xml:space="preserve">${esc}</t></is></c>`;
        const selfClose = new RegExp(`<c r="${ref}"([^>]*?)/>`);
        const open = new RegExp(`<c r="${ref}"([^>]*?)>[\\s\\S]*?</c>`);
        let m = xml.match(selfClose);
        if (m) {
            xml = xml.replace(selfClose, build(m[1]));
            continue;
        }
        m = xml.match(open);
        if (m) {
            xml = xml.replace(open, build(m[1]));
        }
    }
    return xml;
};
/**
 * Cells the 2026 template ships with a grey background that should be plain
 * white: the residential CITY/MUNICIPALITY (I24:K24) and PROVINCE (L24:N24)
 * input boxes on sheet C1.
 *
 * The 2025 template had these white; the 2026 revision shades them, so the
 * template swap made every export come out grey in that one block. Every
 * other input box on the form is white, this one included in the printed
 * original, so it reads as a defect rather than a design.
 *
 * Fixed here rather than by editing the template binary, so that dropping in
 * a fresh copy of the official file does not silently bring the shading back.
 */
exports.WHITE_CELLS = {
    "xl/worksheets/sheet1.xml": ["I24", "J24", "K24", "L24", "M24", "N24"],
};
/**
 * Repoints the given cells at a style identical to their current one but with
 * no fill, appending the new styles to `cellXfs`. Borders, font and alignment
 * are untouched — only the background changes.
 *
 * Returns the rewritten sheet + styles XML.
 */
const clearCellFills = (sheetXml, stylesXml, refs) => {
    const block = stylesXml.match(/<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/);
    if (!block)
        return { sheet: sheetXml, styles: stylesXml };
    const xfs = [...block[1].matchAll(/<xf\b[^>]*?\/>|<xf\b[^>]*?>[\s\S]*?<\/xf>/g)].map((m) => m[0]);
    const added = [];
    // Same source style used by several cells → reuse the one twin we make.
    const twinOf = new Map();
    const indexFor = (sIdx) => {
        const xf = xfs[sIdx];
        if (!xf)
            return null;
        const fill = xf.match(/fillId="(\d+)"/);
        if (!fill || fill[1] === "0")
            return null; // already unfilled
        const cached = twinOf.get(sIdx);
        if (cached !== undefined)
            return cached;
        let twin = xf
            .replace(/\sfillId="\d+"/, ' fillId="0"')
            .replace(/\sapplyFill="[^"]*"/, ' applyFill="0"');
        if (!/applyFill=/.test(twin)) {
            twin = twin.replace(/^<xf\b/, '<xf applyFill="0"');
        }
        const at = xfs.length + added.length;
        added.push(twin);
        twinOf.set(sIdx, at);
        return at;
    };
    let sheet = sheetXml;
    for (const ref of refs) {
        const re = new RegExp(`<c r="${ref}"([^>]*?)(/>|>)`);
        const m = sheet.match(re);
        if (!m)
            continue;
        const sAttr = m[1].match(/\bs="(\d+)"/);
        const next = indexFor(sAttr ? Number(sAttr[1]) : 0);
        if (next === null)
            continue;
        const attrs = sAttr
            ? m[1].replace(/\bs="\d+"/, `s="${next}"`)
            : `${m[1]} s="${next}"`;
        sheet = sheet.replace(re, `<c r="${ref}"${attrs}${m[2]}`);
    }
    if (!added.length)
        return { sheet, styles: stylesXml };
    const styles = stylesXml.replace(/<cellXfs([^>]*)count="\d+"([^>]*)>([\s\S]*?)<\/cellXfs>/, (_all, a, b, body) => `<cellXfs${a}count="${xfs.length + added.length}"${b}>${body}${added.join("")}</cellXfs>`);
    return { sheet, styles };
};
exports.clearCellFills = clearCellFills;
const VML1 = "xl/drawings/vmlDrawing1.vml"; // sheet 1
const VML2 = "xl/drawings/vmlDrawing2.vml"; // sheet 4
const B1 = (ctrlProp, vmlId) => ({ ctrlProp, vmlFile: VML1, vmlId });
const B4 = (ctrlProp, vmlId) => ({ ctrlProp, vmlFile: VML2, vmlId });
// Sheet 1: citizenship / sex / civil status (single-select per group).
const SHEET1_BOXES = {
    filipino: B1("ctrlProp2.xml", "_x0000_s1045"),
    dual: B1("ctrlProp3.xml", "_x0000_s1046"),
    byBirth: B1("ctrlProp11.xml", "_x0000_s1063"),
    byNatural: B1("ctrlProp12.xml", "_x0000_s1064"),
    male: B1("ctrlProp4.xml", "_x0000_s1049"),
    female: B1("ctrlProp5.xml", "_x0000_s1050"),
    single: B1("ctrlProp6.xml", "_x0000_s1058"),
    married: B1("ctrlProp7.xml", "_x0000_s1059"),
    widowed: B1("ctrlProp8.xml", "_x0000_s1060"),
    others: B1("ctrlProp9.xml", "_x0000_s1061"),
    separated: B1("ctrlProp10.xml", "_x0000_s1062"),
};
// Sheet 4: disclosure questionnaire #34-40 — one YES/NO pair per question.
const DISCLOSURE_BOXES = {
    relatedThirdDegree: { yes: B4("ctrlProp13.xml", "Check_x0020_Box_x0020_1"), no: B4("ctrlProp14.xml", "Check_x0020_Box_x0020_2") },
    relatedFourthDegree: { yes: B4("ctrlProp15.xml", "Check_x0020_Box_x0020_3"), no: B4("ctrlProp16.xml", "Check_x0020_Box_x0020_4") },
    guiltyAdmin: { yes: B4("ctrlProp17.xml", "Check_x0020_Box_x0020_5"), no: B4("ctrlProp18.xml", "Check_x0020_Box_x0020_6") },
    criminallyCharged: { yes: B4("ctrlProp19.xml", "Check_x0020_Box_x0020_7"), no: B4("ctrlProp20.xml", "Check_x0020_Box_x0020_8") },
    convicted: { yes: B4("ctrlProp21.xml", "Check_x0020_Box_x0020_9"), no: B4("ctrlProp22.xml", "Check_x0020_Box_x0020_10") },
    separatedFromService: { yes: B4("ctrlProp23.xml", "Check_x0020_Box_x0020_11"), no: B4("ctrlProp24.xml", "Check_x0020_Box_x0020_12") },
    candidateLastYear: { yes: B4("ctrlProp34.xml", "Check_x0020_Box_x0020_26"), no: B4("ctrlProp35.xml", "Check_x0020_Box_x0020_27") },
    resignedToCampaign: { yes: B4("ctrlProp36.xml", "Check_x0020_Box_x0020_28"), no: B4("ctrlProp37.xml", "Check_x0020_Box_x0020_29") },
    immigrant: { yes: B4("ctrlProp25.xml", "Check_x0020_Box_x0020_13"), no: B4("ctrlProp26.xml", "Check_x0020_Box_x0020_14") },
    indigenousMember: { yes: B4("ctrlProp27.xml", "Check_x0020_Box_x0020_15"), no: B4("ctrlProp30.xml", "Check_x0020_Box_x0020_18") },
    pwd: { yes: B4("ctrlProp28.xml", "Check_x0020_Box_x0020_16"), no: B4("ctrlProp31.xml", "Check_x0020_Box_x0020_19") },
    soloParent: { yes: B4("ctrlProp29.xml", "Check_x0020_Box_x0020_17"), no: B4("ctrlProp32.xml", "Check_x0020_Box_x0020_20") },
};
// Tick the given checkboxes by (a) setting checked="Checked" in each control's
// ctrlProp (what modern Excel reads) and (b) adding <x:Checked> to the legacy
// VML ClientData (older Excel / LibreOffice). Controls left out stay unchecked.
const tickBoxes = (zip, boxes) => __awaiter(void 0, void 0, void 0, function* () {
    if (!boxes.length)
        return;
    for (const b of boxes) {
        const f = zip.file(`xl/ctrlProps/${b.ctrlProp}`);
        if (!f)
            continue;
        let xml = yield f.async("string");
        xml = /checked="/.test(xml)
            ? xml.replace(/checked="[^"]*"/, 'checked="Checked"')
            : xml.replace(/objectType="CheckBox"/, 'objectType="CheckBox" checked="Checked"');
        zip.file(`xl/ctrlProps/${b.ctrlProp}`, xml);
    }
    for (const vf of [...new Set(boxes.map((b) => b.vmlFile))]) {
        const vmlFile = zip.file(vf);
        if (!vmlFile)
            continue;
        let vml = yield vmlFile.async("string");
        for (const b of boxes.filter((x) => x.vmlFile === vf)) {
            // Index-based insertion, deliberately NOT a regex. A lazy match spanning
            // the ~650 characters between a shape's id and its <x:ClientData> does
            // not reliably match this VML — verified against the real template — so
            // the previous version silently left EVERY box unticked in the legacy
            // view while the ctrlProps claimed "Checked". Walk the shape's own span.
            const start = vml.indexOf(`<v:shape id="${b.vmlId}"`);
            if (start === -1)
                continue;
            const end = vml.indexOf("</v:shape>", start);
            if (end === -1)
                continue;
            const shape = vml.slice(start, end);
            if (shape.includes("<x:Checked>"))
                continue; // already ticked
            const TAG = '<x:ClientData ObjectType="Checkbox">';
            const anchor = shape.indexOf(TAG);
            if (anchor === -1)
                continue;
            const at = start + anchor + TAG.length;
            vml = vml.slice(0, at) + "<x:Checked>Checked</x:Checked>" + vml.slice(at);
        }
        zip.file(vf, vml);
    }
});
// Read a cell's current text (resolving a shared-string reference if needed).
const cellText = (xml, ref, shared) => {
    var _a;
    const m = xml.match(new RegExp(`<c r="${ref}"([^>]*)(?:/>|>([\\s\\S]*?)</c>)`));
    if (!m)
        return null; // cell absent
    const attrs = m[1];
    const inner = m[2] || "";
    if (/t="s"/.test(attrs)) {
        const v = inner.match(/<v>(\d+)<\/v>/);
        return v ? (_a = shared[+v[1]]) !== null && _a !== void 0 ? _a : "" : "";
    }
    const it = inner.match(/<t[^>]*>([\s\S]*?)<\/t>/);
    if (it)
        return it[1];
    const v = inner.match(/<v>([\s\S]*?)<\/v>/);
    return v ? v[1] : "";
};
// Write "If YES, give details" answers ONTO their label cells: keep the label,
// drop its trailing fill-in underscores, and append the value.
const appendDetails = (xml, fields, shared) => {
    for (const [ref, raw] of Object.entries(fields)) {
        const val = S(raw);
        if (!val)
            continue;
        const label = (cellText(xml, ref, shared) || "").replace(/[_\s]+$/, "").trim();
        xml = applyCells(xml, { [ref]: label ? `${label} ${val}` : val });
    }
    return xml;
};
const parseSharedStrings = (xml) => {
    const out = [];
    for (const m of xml.matchAll(/<si>([\s\S]*?)<\/si>/g)) {
        out.push((m[1].match(/<t[^>]*>([\s\S]*?)<\/t>/g) || [])
            .map((t) => t.replace(/<[^>]+>/g, ""))
            .join(""));
    }
    return out;
};
const exportPdsExcel = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d;
    const q = req.query;
    let app = null;
    if (q.id) {
        app = yield prisma_1.prisma.submittedApplication.findUnique({ where: { id: q.id } });
    }
    else if (q.userId) {
        const user = yield prisma_1.prisma.user.findUnique({
            where: { id: q.userId },
            select: { submittedApplications: true },
        });
        app = (_a = user === null || user === void 0 ? void 0 : user.submittedApplications) !== null && _a !== void 0 ? _a : null;
    }
    else {
        throw new errors_1.ValidationError("INVALID REQUIRED ID");
    }
    if (!app)
        throw new errors_1.NotFoundError("APPLICATION NOT FOUND");
    // ── Decrypt encrypted PII ─────────────────────────────────────────────
    const [email, civilStatus, mobileNo, resProvinceRaw, resCityRaw, resBarangayRaw, resStreet, resSub, resHouse, permaProvinceRaw, permaCityRaw, permaBarangayRaw, permaStreet, permaSub, permaHouse, fatherSurname, fatherFirstname, motherSurname, motherFirstname, birthDate, umidNo, pagIbigNo, philHealthNo, philSys, tinNo, agencyNo, spouseSurname, spouseFirstname, spouseMiddle,] = yield Promise.all([
        dec(app.email, app.emailIv),
        dec(app.cvilStatus, app.cvilStatusIv),
        dec(app.mobileNo, app.ivMobileNo),
        dec(app.resProvince, app.resProvinceIv),
        dec(app.resCity, app.resCityIv),
        dec(app.resBarangay, app.resBarangayIv),
        dec(app.resStreet, app.resStreetIv),
        dec(app.resSub, app.resSubIv),
        dec(app.reshouseBlock, app.reshouseBlockIv),
        dec(app.permaProvince, app.permaProvinceIv),
        dec(app.permaCity, app.permaCityIv),
        dec(app.permaBarangay, app.permaBarangayIv),
        dec(app.permaStreet, app.permaStreetIv),
        dec(app.permaSub, app.permaSubIv),
        dec(app.permahouseBlock, app.permahouseBlockIv),
        dec(app.fatherSurname, app.fatherSurnameIv),
        dec(app.fatherFirstname, app.fatherFirstnameIv),
        dec(app.motherSurname, app.motherSurnameIv),
        dec(app.motherFirstname, app.motherFirstnameIv),
        dec(app.birthDate, app.bdayIv),
        dec(app.umidNo, app.umidNoIv),
        dec(app.pagIbigNo, app.pagIbigNoIv),
        dec(app.philHealthNo, app.philHealthNoIv),
        dec(app.philSys, app.philSysIv),
        dec(app.tinNo, app.tinNoIv),
        dec(app.agencyNo, app.agencyNoIv),
        dec(app.spouseSurname, app.spouseSurnameIv),
        dec(app.spouseFirstname, app.spouseFirstnameIv),
        dec(app.spouseMiddle, app.spouseMiddleIv),
    ]);
    // Resolve PSGC codes → place names (province / city-municipality / barangay).
    const [resProvince, resCity, resBarangay, permaProvince, permaCity, permaBarangay,] = yield Promise.all([
        resolvePlace(resProvinceRaw, ["provinces"]),
        resolvePlace(resCityRaw, ["municipalities", "cities"]),
        resolvePlace(resBarangayRaw, ["barangays"]),
        resolvePlace(permaProvinceRaw, ["provinces"]),
        resolvePlace(permaCityRaw, ["municipalities", "cities"]),
        resolvePlace(permaBarangayRaw, ["barangays"]),
    ]);
    const govId = obj(app.govId);
    const disc = obj(app.disclosures);
    const otherInfo = (_b = arr(app.otherInfo)[0]) !== null && _b !== void 0 ? _b : {};
    let children = [];
    try {
        children = JSON.parse(app.children || "[]");
    }
    catch (_e) {
        children = [];
    }
    // ── Build the per-sheet cell maps ─────────────────────────────────────
    const c1 = {
        D10: app.lastname,
        D11: app.firstname,
        D12: app.middleName,
        L12: app.suffix,
        D13: fmtDate(birthDate),
        // Citizenship (J13), Sex (D16) and Civil Status (D17) are NOT typed here —
        // they are official form-control checkboxes, ticked via tickCheckboxes().
        D22: app.height,
        D24: app.weight,
        D25: app.bloodType,
        D27: umidNo,
        D29: pagIbigNo,
        D31: philHealthNo,
        D32: philSys,
        D33: tinNo,
        D34: agencyNo,
        I19: resHouse,
        L19: resStreet,
        I22: resSub,
        L22: resBarangay,
        // City and Province are SEPARATE cells. The 2025 template merged
        // I24:N24 into one box, so both had to be crammed into a single
        // string; the 2026 revision splits it into I24:K24 + L24:N24.
        I24: resCity,
        L24: resProvince,
        I27: permaHouse,
        L27: permaStreet,
        I29: permaSub,
        L29: permaBarangay,
        // I31:K31 / L31:N31 were ALREADY separate cells in the 2025
        // template — cramming them here also left Province blank.
        I31: permaCity,
        L31: permaProvince,
        I32: app.teleNo,
        I33: mobileNo,
        I34: email,
        // Spouse (item 22) — value cells mirror the father/mother layout.
        D36: spouseSurname,
        D37: spouseFirstname,
        D38: spouseMiddle,
        D43: fatherSurname,
        D44: fatherFirstname,
        D47: motherSurname,
        D48: motherFirstname,
    };
    children.slice(0, 11).forEach((ch, i) => {
        c1[`I${37 + i}`] = ch === null || ch === void 0 ? void 0 : ch.fullname;
        c1[`M${37 + i}`] = fmtDate(ch === null || ch === void 0 ? void 0 : ch.dateOfBirth);
    });
    const eduRow = (row, e) => {
        if (!e)
            return;
        c1[`D${row}`] = e.name;
        c1[`G${row}`] = e.course;
        c1[`J${row}`] = e.from;
        c1[`K${row}`] = e.to;
        c1[`L${row}`] = e.highestAttained;
        c1[`M${row}`] = e.yearGraduate;
        c1[`N${row}`] = e.records;
    };
    eduRow(54, obj(app.elementary));
    eduRow(55, obj(app.secondary));
    eduRow(56, obj(app.vocational));
    eduRow(57, obj(app.college));
    eduRow(58, obj(app.graduateCollege));
    // Dual-citizenship country sits next to "Pls. indicate country:" (row 16).
    if (app.dualCitizen)
        c1["N16"] = app.dualCitizenHalf;
    const c2 = {};
    arr(app.civilService)
        .slice(0, 7)
        .forEach((el, i) => {
        const r = 5 + i;
        c2[`A${r}`] = el === null || el === void 0 ? void 0 : el.title;
        c2[`F${r}`] = el === null || el === void 0 ? void 0 : el.rating;
        c2[`G${r}`] = fmtDate(el === null || el === void 0 ? void 0 : el.dateExami);
        c2[`I${r}`] = el === null || el === void 0 ? void 0 : el.placeOfExam;
        // 2026: the LICENSE block moved right two columns (J/K -> L/M).
        c2[`L${r}`] = el === null || el === void 0 ? void 0 : el.licenceNumber;
        c2[`M${r}`] = fmtDate(el === null || el === void 0 ? void 0 : el.licenceValidity);
    });
    arr(app.experience)
        .slice(0, 28)
        .forEach((w, i) => {
        const r = 18 + i;
        c2[`A${r}`] = w === null || w === void 0 ? void 0 : w.from;
        c2[`C${r}`] = w === null || w === void 0 ? void 0 : w.to;
        c2[`D${r}`] = w === null || w === void 0 ? void 0 : w.position;
        c2[`G${r}`] = w === null || w === void 0 ? void 0 : w.department;
        // 2026 inserted MONTHLY SALARY (J) and SALARY/JOB/PAY GRADE & STEP
        // INCREMENT (K), pushing the old columns right by two. The PDS form
        // captures no salary today, so J/K are left for the employee to fill.
        c2[`L${r}`] = w === null || w === void 0 ? void 0 : w.status;
        c2[`M${r}`] = (w === null || w === void 0 ? void 0 : w.govService) ? "Y" : "N";
    });
    const c3 = {};
    arr(app.voluntaryWork)
        .slice(0, 7)
        .forEach((v, i) => {
        const r = 6 + i;
        c3[`A${r}`] = v === null || v === void 0 ? void 0 : v.organization;
        c3[`E${r}`] = v === null || v === void 0 ? void 0 : v.from;
        c3[`F${r}`] = v === null || v === void 0 ? void 0 : v.to;
        c3[`G${r}`] = v === null || v === void 0 ? void 0 : v.hours;
        c3[`H${r}`] = v === null || v === void 0 ? void 0 : v.position;
    });
    arr(app.learningDev)
        .slice(0, 20)
        .forEach((t, i) => {
        const r = 18 + i;
        c3[`A${r}`] = t === null || t === void 0 ? void 0 : t.title; // title is merged A:D — anchor cell is A, not B
        c3[`E${r}`] = t === null || t === void 0 ? void 0 : t.from;
        c3[`F${r}`] = t === null || t === void 0 ? void 0 : t.to;
        c3[`G${r}`] = t === null || t === void 0 ? void 0 : t.hours;
        c3[`H${r}`] = t === null || t === void 0 ? void 0 : t.type;
        c3[`I${r}`] = t === null || t === void 0 ? void 0 : t.conductedBy;
    });
    c3["A42"] = otherInfo.specialSkills;
    c3["C42"] = (_c = otherInfo.distinctions) !== null && _c !== void 0 ? _c : otherInfo.recognition;
    c3["I42"] = (_d = otherInfo.memberships) !== null && _d !== void 0 ? _d : otherInfo.membership;
    // C4 #34-40 YES/NO are checkboxes (ticked below) — only Gov-ID + references
    // are plain answer cells here.
    const c4 = {
        D61: govId.type, // "Government Issued ID:"
        D62: govId.number, // "ID/License/Passport No.:"
        D64: `${govId.dateIssuance || ""}${govId.placeIssuance ? " / " + govId.placeIssuance : ""}`, // "Date/Place of Issuance:"
    };
    arr(app.references)
        .slice(0, 3)
        .forEach((rf, i) => {
        var _a, _b;
        const r = 52 + i;
        c4[`A${r}`] = rf === null || rf === void 0 ? void 0 : rf.name;
        c4[`F${r}`] = (_a = rf === null || rf === void 0 ? void 0 : rf.residentialAddress) !== null && _a !== void 0 ? _a : rf === null || rf === void 0 ? void 0 : rf.address;
        c4[`G${r}`] = (_b = rf === null || rf === void 0 ? void 0 : rf.contact) !== null && _b !== void 0 ? _b : rf === null || rf === void 0 ? void 0 : rf.telephone;
    });
    // "If YES, give details" answers — appended onto their label cells (so the
    // label text is kept, not clobbered).
    const c4Details = {
        G14: disc.guiltyAdminDetails,
        G19: disc.criminalDetails,
        G24: disc.convictedDetails,
        G28: disc.separatedDetails,
        G32: disc.candidateDetails,
        G38: disc.immigrantDetails,
        G44: disc.indigenousDetails,
        G46: disc.pwdId,
        G48: disc.soloParentId,
    };
    // ── Open the template ZIP, edit cell XML in place, repackage ───────────
    const zip = yield JSZip.loadAsync(fs_1.default.readFileSync(TEMPLATE));
    const sheets = {
        "xl/worksheets/sheet1.xml": c1,
        "xl/worksheets/sheet2.xml": c2,
        "xl/worksheets/sheet3.xml": c3,
        "xl/worksheets/sheet4.xml": c4,
    };
    for (const [file, cells] of Object.entries(sheets)) {
        const entry = zip.file(file);
        if (!entry)
            continue;
        const xml = yield entry.async("string");
        zip.file(file, applyCells(xml, cells));
    }
    // Strip the grey background the 2026 template puts on a few input boxes.
    const stylesEntry = zip.file("xl/styles.xml");
    if (stylesEntry) {
        let stylesXml = yield stylesEntry.async("string");
        for (const [file, refs] of Object.entries(exports.WHITE_CELLS)) {
            const entry = zip.file(file);
            if (!entry)
                continue;
            const out = (0, exports.clearCellFills)(yield entry.async("string"), stylesXml, refs);
            zip.file(file, out.sheet);
            stylesXml = out.styles;
        }
        zip.file("xl/styles.xml", stylesXml);
    }
    // Append the "If YES, give details" answers onto their label cells (sheet 4).
    const shared = parseSharedStrings(yield zip.file("xl/sharedStrings.xml").async("string"));
    const s4 = zip.file("xl/worksheets/sheet4.xml");
    if (s4) {
        const xml = yield s4.async("string");
        zip.file("xl/worksheets/sheet4.xml", appendDetails(xml, c4Details, shared));
    }
    // Tick all checkboxes (form controls, not cells):
    //  • sheet 1 — citizenship / sex / civil status
    //  • sheet 4 — disclosure questionnaire #34-40 (YES or NO per question)
    const boxes = [];
    const add = (k) => SHEET1_BOXES[k] && boxes.push(SHEET1_BOXES[k]);
    if (app.filipino)
        add("filipino");
    if (app.dualCitizen) {
        add("dual");
        if (app.byBirth)
            add("byBirth");
        if (app.byNatural)
            add("byNatural");
    }
    const g = S(app.gender).toLowerCase();
    if (g === "male")
        add("male");
    else if (g === "female")
        add("female");
    const cs = S(civilStatus).toLowerCase();
    if (cs.includes("single"))
        add("single");
    else if (cs.includes("married"))
        add("married");
    else if (cs.includes("widow"))
        add("widowed");
    else if (cs.includes("separat"))
        add("separated");
    else if (cs.includes("other"))
        add("others");
    for (const [field, pair] of Object.entries(DISCLOSURE_BOXES)) {
        boxes.push(disc[field] ? pair.yes : pair.no);
    }
    yield tickBoxes(zip, boxes);
    const out = yield zip.generateAsync({
        type: "nodebuffer",
        compression: "DEFLATE",
    });
    const safeName = `${app.lastname || "PDS"}_${app.firstname || ""}`.replace(/[^\w.-]/g, "_");
    res.header("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.header("Content-Disposition", `attachment; filename="PDS_${safeName}.xlsx"`);
    return res.send(out);
});
exports.exportPdsExcel = exportPdsExcel;
