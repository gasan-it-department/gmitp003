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
exports.exportPdsExcel = exports.exportOwnPdsExcel = exports.DISCLOSURE_BOXES = exports.SHEET1_BOXES = exports.clearCellFills = exports.WHITE_CELLS = exports.applyCells = void 0;
const prisma_1 = require("../barrel/prisma");
const errors_1 = require("../errors/errors");
const encryption_1 = require("../service/encryption");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const callerScope_1 = require("../service/callerScope");
const xlsxStyle_1 = require("../service/xlsxStyle");
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
    /*
      Older submissions saved literal "undefined"/"null" strings for blank
      fields; those are garbage and must never reach the form.
  
      "N/A" used to be stripped here on the same reasoning. It is not any
      more: the form itself says "Indicate N/A if not applicable", so a box
      reading N/A is the correct rendering of a field that does not apply,
      and the export now writes it deliberately. Stripping it here silently
      swallowed every one.
    */
    const low = s.toLowerCase();
    if (low === "undefined" || low === "null")
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
exports.applyCells = applyCells;
/**
 * Cells the 2026 template ships with a grey background that should be plain
 * white: the residential CITY/MUNICIPALITY (I24:K24) and PROVINCE (L24:N24)
 * input boxes on sheet C1.
 *
 * The 2025 template had these white and an earlier 2026 copy shaded them,
 * which made every export come out grey in that one block. Every other input
 * box on the form is white, this one included in the printed original, so it
 * read as a defect rather than a design.
 *
 * The template now in service does NOT shade them, so this pass currently
 * changes nothing. It is kept deliberately: it is cheap, and it means
 * dropping in a fresh copy of the official file cannot silently bring the
 * shading back. e2e_pds_template.ts asserts these cells still exist and that
 * the list covers whole merges, so the guard fails loudly rather than
 * half-clearing a box if the form is revised again.
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
exports.SHEET1_BOXES = {
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
exports.DISCLOSURE_BOXES = {
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
        xml = (0, exports.applyCells)(xml, { [ref]: label ? `${label} ${val}` : val });
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
/**
 * The applicant's OWN PDS, for the public application page.
 *
 * Identical export, but the application id is taken from the verified temp
 * token instead of the query string. An applicant's token is scoped to one
 * application, and `exportPdsExcel` does no scoping of its own — it returns
 * whatever id it is handed — so trusting the client here would let any
 * applicant download anybody's PDS, which is their birth date, TIN,
 * PhilHealth number, home address and parents' names.
 *
 * Deriving the id from the token rather than checking it against the token
 * makes that impossible by construction rather than by remembering to
 * validate.
 */
const exportOwnPdsExcel = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    // tempAuthenticated has already put the application row on the request.
    const own = (_a = req.user) === null || _a === void 0 ? void 0 : _a.id;
    if (!own)
        throw new errors_1.ValidationError("INVALID REQUIRED ID");
    req.query = { id: own };
    // No line check: there is no account behind a temp token, and the id
    // came from the token rather than the caller.
    return exportPds(req, res, { scopeToCallerLine: false });
});
exports.exportOwnPdsExcel = exportOwnPdsExcel;
/** The HR download. Restricted to the caller's own municipality. */
const exportPdsExcel = (req, res) => __awaiter(void 0, void 0, void 0, function* () { return exportPds(req, res, { scopeToCallerLine: true }); });
exports.exportPdsExcel = exportPdsExcel;
const exportPds = (req, res, opts) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d, _e, _f;
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
    /*
      A PDS belongs to ONE PERSON, not to an office. The id came from the
      query string, so without this any signed-in employee could export a
      colleague's birth date, place of birth, TIN, PhilHealth number, home
      address and parents' names by changing it.
  
      Same line is not enough for that, so this is you, or HR of the
      municipality the record belongs to.
  
      Checked against the record that was actually loaded rather than
      against values passed alongside the id, because a caller who can
      choose both can always make them agree.
  
      Skipped for the applicant's own copy, which runs on a temp token with
      no account behind it and is already restricted to one application by
      exportOwnPdsExcel.
    */
    if (opts.scopeToCallerLine) {
        const { caller, via } = yield (0, callerScope_1.requireHrOrSelf)(req, { userId: app.userId, lineId: app.lineId }, "a Personal Data Sheet");
        // Somebody reading their own file and HR reading somebody else's are
        // different events; they should not look the same in the log.
        if (via === "hr") {
            console.log(`[pds] HR ${caller.actorId} exported the PDS of ` +
                `${(_b = app.userId) !== null && _b !== void 0 ? _b : `application ${app.id}`}`);
        }
    }
    // ── Decrypt encrypted PII ─────────────────────────────────────────────
    const [email, civilStatus, mobileNo, resProvinceRaw, resCityRaw, resBarangayRaw, resStreet, resSub, resHouse, permaProvinceRaw, permaCityRaw, permaBarangayRaw, permaStreet, permaSub, permaHouse, resZip, permaZip, fatherSurname, fatherFirstname, motherSurname, motherFirstname, birthDate, placeOfBirth, umidNo, pagIbigNo, philHealthNo, philSys, tinNo, agencyNo, spouseSurname, spouseFirstname, spouseMiddle,] = yield Promise.all([
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
        dec(app.resZipCode, app.resZipCodeIv),
        dec(app.permaZipCode, app.permaZipCodeIv),
        dec(app.fatherSurname, app.fatherSurnameIv),
        dec(app.fatherFirstname, app.fatherFirstnameIv),
        dec(app.motherSurname, app.motherSurnameIv),
        dec(app.motherFirstname, app.motherFirstnameIv),
        dec(app.birthDate, app.bdayIv),
        dec(app.placeOfBirth, app.placeOfBirthIv),
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
    const otherInfo = (_c = arr(app.otherInfo)[0]) !== null && _c !== void 0 ? _c : {};
    let children = [];
    try {
        children = JSON.parse(app.children || "[]");
    }
    catch (_g) {
        children = [];
    }
    // ── Build the per-sheet cell maps ─────────────────────────────────────
    const c1 = {
        D10: app.lastname,
        D11: app.firstname,
        D12: app.middleName,
        L12: app.suffix,
        D13: fmtDate(birthDate),
        D15: placeOfBirth,
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
        /*
          On this form the caption sits BENEATH the box it describes, not
          above it: a writing box, then "House/Block/Lot No." underneath in
          italics. Every address value was being written one row too low — into
          the box belonging to the NEXT caption — so the house number printed
          under "Subdivision/Village", the subdivision under
          "City/Municipality", and the city and province ended up in the ZIP
          CODE box at the bottom of the block.
    
          Each value now goes in the box its own caption describes.
        */
        I17: resHouse,
        L17: resStreet,
        I19: resSub,
        L19: resBarangay,
        I22: resCity,
        L22: resProvince,
        // The ZIP row is one wide box spanning I:N, which is why it takes the
        // whole value rather than sharing the row.
        I24: resZip,
        // City and Province are SEPARATE cells. The 2025 template merged
        // I24:N24 into one box, so both had to be crammed into a single
        // string; the 2026 revision splits it into I24:K24 + L24:N24.
        I25: permaHouse,
        L25: permaStreet,
        I27: permaSub,
        L27: permaBarangay,
        I29: permaCity,
        L29: permaProvince,
        I31: permaZip,
        // I31:K31 / L31:N31 were ALREADY separate cells in the 2025
        // template — cramming them here also left Province blank.
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
    c3["C42"] = (_d = otherInfo.distinctions) !== null && _d !== void 0 ? _d : otherInfo.recognition;
    c3["I42"] = (_e = otherInfo.memberships) !== null && _e !== void 0 ? _e : otherInfo.membership;
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
    /*
      One look for every value.
  
      The template's boxes carry whatever font each revision's author used —
      Arial Narrow at 7, 8, 9 and 10 points, some bold, some not — so a
      filled form came out ragged while a blank one looks tidy. Arial Narrow
      keeps the form's own face; 9pt is the middle of the range it already
      uses and clears the shortest row; regular weight because bold at this
      size turns a dense table into a smear.
    */
    const VALUE_FONT = { name: "Arial Narrow", size: 9, bold: false };
    /*
      Where the sections want their values. Columns come from the write map
      above, so these stay in step with what is actually filled in.
  
      C4 is deliberately absent — it is left exactly as the form ships.
    */
    const alignFor = (sheet) => {
        const out = {};
        const put = (cols, rows, align) => {
            for (const r of rows)
                for (const c of cols)
                    out[`${c}${r}`] = align;
        };
        if (sheet === "sheet1") {
            // III. Educational Background — every value centred.
            put(["D", "G", "J", "K", "L", "M", "N"], (0, xlsxStyle_1.rowsFrom)(54, 5), "center");
        }
        if (sheet === "sheet2") {
            // IV. Civil Service Eligibility — the examination title reads as a
            // sentence and stays left; everything measured about it is centred.
            put(["A"], (0, xlsxStyle_1.rowsFrom)(5, 7), "left");
            put(["F", "G", "I", "L", "M"], (0, xlsxStyle_1.rowsFrom)(5, 7), "center");
            // ...and its column headers.
            for (const ref of ["F3", "G3", "I3", "L4", "M4"])
                out[ref] = "center";
            // V. Work Experience — centred throughout.
            put(["A", "C", "D", "G", "L", "M"], (0, xlsxStyle_1.rowsFrom)(18, 28), "center");
        }
        if (sheet === "sheet3") {
            // VI. Voluntary Work — the organisation's name and address is prose.
            put(["A"], (0, xlsxStyle_1.rowsFrom)(6, 7), "left");
            put(["E", "F", "G", "H"], (0, xlsxStyle_1.rowsFrom)(6, 7), "center");
            // VII. Learning and Development — likewise the programme title.
            put(["A"], (0, xlsxStyle_1.rowsFrom)(18, 20), "left");
            put(["E", "F", "G", "H", "I"], (0, xlsxStyle_1.rowsFrom)(18, 20), "center");
        }
        return out;
    };
    /*
      "Indicate N/A if not applicable" is printed at the top of the form, so
      a box the generator manages and cannot fill says so rather than being
      left ambiguously empty. Only cells already in the write map are
      touched: a repeating block only has entries for records that exist, so
      unused rows stay blank instead of filling with N/A.
    */
    const naFill = (cells) => {
        for (const k of Object.keys(cells)) {
            if (!S(cells[k]))
                cells[k] = "N/A";
        }
        return cells;
    };
    /*
      A repeating block with no records at all gets N/A across its first
      row, which is how the form is filled by hand — not down all seven
      eligibility rows or all twenty-eight work rows, which would bury the
      page in it.
    */
    const emptySection = (cells, cols, firstRow, count) => {
        for (let r = firstRow; r < firstRow + count; r++) {
            for (const c of cols)
                if (S(cells[`${c}${r}`]))
                    return;
        }
        for (const c of cols)
            cells[`${c}${firstRow}`] = "N/A";
    };
    emptySection(c2, ["A", "F", "G", "I", "L", "M"], 5, 7); // eligibility
    emptySection(c2, ["A", "C", "D", "G", "L", "M"], 18, 28); // work
    emptySection(c3, ["A", "E", "F", "G", "H"], 6, 7); // voluntary
    emptySection(c3, ["A", "E", "F", "G", "H", "I"], 18, 20); // L&D
    naFill(c1);
    naFill(c2);
    naFill(c3);
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
        zip.file(file, (0, exports.applyCells)(xml, cells));
    }
    /*
      Restyle AFTER the values are written: a style on a cell that holds
      nothing renders nothing, and restyleCells deliberately skips cells
      that do not exist yet.
    */
    const stylesEntry0 = zip.file("xl/styles.xml");
    if (stylesEntry0) {
        let stylesXml0 = yield stylesEntry0.async("string");
        const font = (0, xlsxStyle_1.ensureFont)(stylesXml0, VALUE_FONT);
        stylesXml0 = font.styles;
        for (const sheetName of ["sheet1", "sheet2", "sheet3"]) {
            const file = `xl/worksheets/${sheetName}.xml`;
            const e2 = zip.file(file);
            if (!e2)
                continue;
            const cells = (_f = sheets[file]) !== null && _f !== void 0 ? _f : {};
            const aligns = alignFor(sheetName);
            // Every value this sheet carries gets the font; alignment only
            // where a section asks for it. Headers named in alignFor but never
            // written keep their own font and are only realigned.
            /*
              Column headers are part of the printed form, so they are only
              realigned — their own face is left alone. Everything else is a
              value box and takes the house font whether or not it holds
              anything today, so an empty row does not sit at a different size
              from a filled one.
            */
            const HEADERS = new Set(["F3", "G3", "I3", "L4", "M4"]);
            const specs = {};
            for (const [ref, align] of Object.entries(aligns)) {
                specs[ref] = HEADERS.has(ref)
                    ? { align }
                    : { fontId: font.fontId, align };
            }
            for (const ref of Object.keys(cells)) {
                specs[ref] = { fontId: font.fontId, align: aligns[ref] };
            }
            const out = (0, xlsxStyle_1.restyleCells)(yield e2.async("string"), stylesXml0, specs);
            zip.file(file, out.sheet);
            stylesXml0 = out.styles;
        }
        zip.file("xl/styles.xml", stylesXml0);
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
    const shared = parseSharedStrings(yield zip.file("xl/sharedStrings.xml").async("string"));
    /*
      The zip codes used to be appended onto their own G24/G31 label cells,
      because the address values had pushed down into the boxes those zips
      belong in and there was nowhere else to put them. With every value
      back on its own caption, I24 and I31 are free and the zips are written
      there like any other field.
    */
    // Append the "If YES, give details" answers onto their label cells (sheet 4).
    const s4 = zip.file("xl/worksheets/sheet4.xml");
    if (s4) {
        const xml = yield s4.async("string");
        zip.file("xl/worksheets/sheet4.xml", appendDetails(xml, c4Details, shared));
    }
    // Tick all checkboxes (form controls, not cells):
    //  • sheet 1 — citizenship / sex / civil status
    //  • sheet 4 — disclosure questionnaire #34-40 (YES or NO per question)
    const boxes = [];
    const add = (k) => exports.SHEET1_BOXES[k] && boxes.push(exports.SHEET1_BOXES[k]);
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
    for (const [field, pair] of Object.entries(exports.DISCLOSURE_BOXES)) {
        boxes.push(disc[field] ? pair.yes : pair.no);
    }
    yield tickBoxes(zip, boxes);
    const out = yield zip.generateAsync({
        type: "nodebuffer",
        compression: "DEFLATE",
    });
    /*
      Named after the person: "Juan_Dela_Cruz.xlsx". HR downloads these in
      batches, and a folder of files all called PDS_something is no use to
      anybody.
    */
    const safeName = [S(app.firstname), S(app.lastname)]
        .filter(Boolean)
        .join("_")
        .replace(/[^\w.-]+/g, "_")
        .replace(/^_+|_+$/g, "") || "PDS";
    res.header("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.header("Content-Disposition", `attachment; filename="${safeName}.xlsx"`);
    return res.send(out);
});
