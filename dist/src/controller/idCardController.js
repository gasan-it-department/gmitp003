"use strict";
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
exports.myVerifyQr = exports.idExportBatch = exports.idIssueList = exports.getCardExtras = void 0;
const prisma_1 = require("../barrel/prisma");
const errors_1 = require("../errors/errors");
const qrcode_1 = __importDefault(require("qrcode"));
const crypto_1 = require("crypto");
const url_1 = require("../service/url");
const encryption_1 = require("../service/encryption");
// pdfkit ships no types and @types/pdfkit isn't installed; require keeps it
// loosely typed and works under both tsc and ts-node (no ambient .d.ts needed).
// eslint-disable-next-line @typescript-eslint/no-var-requires
const PDFDocument = require("pdfkit");
// pdfkit built-in font families (no embedding) — keys match the frontend
const PDF_FONT = {
    sans: { normal: "Helvetica", bold: "Helvetica-Bold" },
    serif: { normal: "Times-Roman", bold: "Times-Bold" },
    mono: { normal: "Courier", bold: "Courier-Bold" },
};
const pdfFont = (key, bold) => {
    const f = PDF_FONT[key || "sans"] || PDF_FONT.sans;
    return bold ? f.bold : f.normal;
};
// placeholder font/QR/photo px are authored against this editor width
const DESIGN_W = 460;
const mm2pt = (mm) => (mm * 72) / 25.4;
const in2pt = (i) => i * 72;
// page sizes in points (portrait)
const PAPER_PT = {
    A4: [mm2pt(210), mm2pt(297)],
    Letter: [612, 792],
    "Folio 8.5×13": [in2pt(8.5), in2pt(13)], // PH long bond / folio
    Legal: [612, 1008],
    A3: [mm2pt(297), mm2pt(420)],
};
const dataUrlToBuffer = (d) => {
    const m = /^data:image\/[a-zA-Z+]+;base64,(.+)$/.exec(d);
    return m ? Buffer.from(m[1], "base64") : null;
};
const safeColor = (c, fallback = "#111827") => c && /^#[0-9a-fA-F]{6}$/.test(c) ? c : fallback;
const fullNameOf = (u) => [u.firstName, u.middleName, u.lastName, u.suffix].filter(Boolean).join(" ");
// ── Extra personal fields for ID cards (PII — authenticated paths only) ─────
const dec = (data, iv) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    if (data && iv) {
        try {
            return (_a = (yield encryption_1.EncryptionService.decrypt(data, iv))) !== null && _a !== void 0 ? _a : "";
        }
        catch (_b) {
            return data;
        }
    }
    return data !== null && data !== void 0 ? data : "";
});
const fmtDate = (d) => {
    if (!d)
        return "";
    const dd = String(d.getDate()).padStart(2, "0");
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    return `${dd}/${mm}/${d.getFullYear()}`;
};
const ageFrom = (d) => {
    if (!d)
        return "";
    const now = new Date();
    let a = now.getFullYear() - d.getFullYear();
    const m = now.getMonth() - d.getMonth();
    if (m < 0 || (m === 0 && now.getDate() < d.getDate()))
        a--;
    return a >= 0 && a < 150 ? String(a) : "";
};
// PSGC code → place name (address parts store codes, not names)
const psgcCache = new Map();
const psgcName = (kind, code) => __awaiter(void 0, void 0, void 0, function* () {
    const key = `${kind}:${code}`;
    if (psgcCache.has(key))
        return psgcCache.get(key);
    try {
        const r = yield fetch(`https://psgc.gitlab.io/api/${kind}/${code}/`);
        if (r.ok) {
            const j = yield r.json();
            if (j === null || j === void 0 ? void 0 : j.name) {
                psgcCache.set(key, j.name);
                return j.name;
            }
        }
    }
    catch (_a) {
        /* offline → fall back to raw */
    }
    return null;
});
const resolvePlace = (value, kinds) => __awaiter(void 0, void 0, void 0, function* () {
    const v = (value || "").trim();
    if (!v || !/^\d{6,}$/.test(v))
        return v;
    for (const k of kinds) {
        const n = yield psgcName(k, v);
        if (n)
            return n;
    }
    return v;
});
const cleanVal = (v) => v && v.trim().toUpperCase() !== "N/A" ? v.trim() : "";
// Assemble the optional ID-card fields for a user (decrypts PII + resolves
// the address codes to readable place names). Authenticated callers only.
const getCardExtras = (userId) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d;
    const empty = {
        birthday: "",
        age: "",
        sex: "",
        phone: "",
        civilStatus: "",
        bloodType: "",
        address: "",
    };
    const user = yield prisma_1.prisma.user.findUnique({
        where: { id: userId },
        select: {
            birthDate: true,
            gender: true,
            phoneNumber: true,
            phoneNumberIv: true,
            submittedApplications: {
                select: {
                    cvilStatus: true,
                    cvilStatusIv: true,
                    bloodType: true,
                    reshouseBlock: true,
                    reshouseBlockIv: true,
                    resStreet: true,
                    resStreetIv: true,
                    resSub: true,
                    resBarangay: true,
                    resBarangayIv: true,
                    resCity: true,
                    resCityIv: true,
                    resProvince: true,
                    resProvinceIv: true,
                },
            },
        },
    });
    if (!user)
        return empty;
    const out = Object.assign(Object.assign({}, empty), { birthday: fmtDate((_a = user.birthDate) !== null && _a !== void 0 ? _a : null), age: ageFrom((_b = user.birthDate) !== null && _b !== void 0 ? _b : null), sex: user.gender && user.gender !== "--/--" ? user.gender : "", phone: yield dec(user.phoneNumber, user.phoneNumberIv) });
    const app = user.submittedApplications;
    if (app) {
        out.civilStatus = yield dec(app.cvilStatus, app.cvilStatusIv);
        out.bloodType = cleanVal((_c = app.bloodType) !== null && _c !== void 0 ? _c : "");
        const house = cleanVal(yield dec(app.reshouseBlock, app.reshouseBlockIv));
        const street = cleanVal(yield dec(app.resStreet, app.resStreetIv));
        const sub = cleanVal((_d = app.resSub) !== null && _d !== void 0 ? _d : "");
        const barangay = cleanVal(yield resolvePlace(yield dec(app.resBarangay, app.resBarangayIv), [
            "barangays",
        ]));
        const city = cleanVal(yield resolvePlace(yield dec(app.resCity, app.resCityIv), [
            "municipalities",
            "cities",
        ]));
        const province = cleanVal(yield resolvePlace(yield dec(app.resProvince, app.resProvinceIv), [
            "provinces",
        ]));
        out.address = [house, street, sub, barangay, city, province]
            .filter(Boolean)
            .join(", ");
    }
    return out;
});
exports.getCardExtras = getCardExtras;
// GET /id/issue-list?lineId=   (authenticated)
// All active (non-archived) employees of a line for the bulk ID picker.
const idIssueList = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const q = req.query;
    if (!q.lineId)
        throw new errors_1.ValidationError("BAD_REQUEST");
    const users = yield prisma_1.prisma.user.findMany({
        where: { lineId: q.lineId, archivedAt: null },
        orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
        select: {
            id: true,
            firstName: true,
            middleName: true,
            lastName: true,
            suffix: true,
            status: true,
            userProfilePictures: { select: { file_url: true } },
            PositionSlot: {
                select: {
                    pos: {
                        select: {
                            name: true,
                            department: { select: { id: true, name: true } },
                        },
                    },
                    unitPosition: {
                        select: { unit: { select: { id: true, name: true } } },
                    },
                },
            },
            Position: { select: { name: true } },
            department: { select: { id: true, name: true } },
        },
    });
    const list = users.map((u) => {
        var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l;
        // the employee's unit/office: their UnitPosition's unit, then the
        // position's department, then their direct department membership
        const dept = ((_b = (_a = u.PositionSlot) === null || _a === void 0 ? void 0 : _a.unitPosition) === null || _b === void 0 ? void 0 : _b.unit) ||
            ((_d = (_c = u.PositionSlot) === null || _c === void 0 ? void 0 : _c.pos) === null || _d === void 0 ? void 0 : _d.department) ||
            u.department ||
            null;
        return {
            userId: u.id,
            fullName: fullNameOf(u),
            position: ((_f = (_e = u.PositionSlot) === null || _e === void 0 ? void 0 : _e.pos) === null || _f === void 0 ? void 0 : _f.name) || ((_g = u.Position) === null || _g === void 0 ? void 0 : _g.name) || u.status || "",
            photoUrl: (_j = (_h = u.userProfilePictures) === null || _h === void 0 ? void 0 : _h.file_url) !== null && _j !== void 0 ? _j : null,
            departmentId: (_k = dept === null || dept === void 0 ? void 0 : dept.id) !== null && _k !== void 0 ? _k : "",
            office: (_l = dept === null || dept === void 0 ? void 0 : dept.name) !== null && _l !== void 0 ? _l : "",
        };
    });
    // every unit/office on the line — even ones with no personnel
    const departments = yield prisma_1.prisma.department.findMany({
        where: { lineId: q.lineId },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
    });
    const units = departments
        .filter((d) => d.name)
        .map((d) => ({ id: d.id, name: d.name }));
    return res.code(200).send({ list, units });
});
exports.idIssueList = idIssueList;
// POST /id/export-batch   (authenticated)
// Lays employees onto the selected paper size (auto fit) and returns two PDFs:
// one with every FRONT, one with every REAR. Rear columns/rows are mirrored so
// fronts and rears land back-to-back when duplex printed.
const idExportBatch = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s, _t, _u, _v, _w, _x, _y, _z, _0, _1, _2, _3, _4, _5, _6;
    const body = req.body;
    if (!body.lineId ||
        !((_a = body.template) === null || _a === void 0 ? void 0 : _a.front) ||
        !Array.isArray(body.userIds) ||
        body.userIds.length === 0) {
        throw new errors_1.ValidationError("BAD_REQUEST");
    }
    const tpl = body.template;
    const paper = {
        size: (_c = (_b = body.paper) === null || _b === void 0 ? void 0 : _b.size) !== null && _c !== void 0 ? _c : "A4",
        orientation: (_e = (_d = body.paper) === null || _d === void 0 ? void 0 : _d.orientation) !== null && _e !== void 0 ? _e : "portrait",
        marginMm: (_g = (_f = body.paper) === null || _f === void 0 ? void 0 : _f.marginMm) !== null && _g !== void 0 ? _g : 8,
        gapMm: (_j = (_h = body.paper) === null || _h === void 0 ? void 0 : _h.gapMm) !== null && _j !== void 0 ? _j : 4,
        flip: (_l = (_k = body.paper) === null || _k === void 0 ? void 0 : _k.flip) !== null && _l !== void 0 ? _l : "long",
        cutMarks: (_o = (_m = body.paper) === null || _m === void 0 ? void 0 : _m.cutMarks) !== null && _o !== void 0 ? _o : true,
    };
    // page + card geometry (points)
    let [pw, ph] = (_p = PAPER_PT[paper.size]) !== null && _p !== void 0 ? _p : PAPER_PT.A4;
    if (paper.orientation === "landscape")
        [pw, ph] = [ph, pw];
    const margin = mm2pt(paper.marginMm);
    const gap = mm2pt(paper.gapMm);
    const cw = tpl.size.unit === "in" ? in2pt(tpl.size.w) : mm2pt(tpl.size.w);
    const ch = tpl.size.unit === "in" ? in2pt(tpl.size.h) : mm2pt(tpl.size.h);
    const cols = Math.max(1, Math.floor((pw - 2 * margin + gap) / (cw + gap)));
    const rows = Math.max(1, Math.floor((ph - 2 * margin + gap) / (ch + gap)));
    const perPage = cols * rows;
    const gridW = cols * cw + (cols - 1) * gap;
    const gridH = rows * ch + (rows - 1) * gap;
    const startX = (pw - gridW) / 2; // symmetric margins → back-to-back aligns
    const startY = (ph - gridH) / 2;
    const scale = cw / DESIGN_W;
    // fetch the chosen employees, preserving the requested order
    const users = yield prisma_1.prisma.user.findMany({
        where: { id: { in: body.userIds }, lineId: body.lineId },
        select: {
            id: true,
            firstName: true,
            middleName: true,
            lastName: true,
            suffix: true,
            status: true,
            verifyCode: true,
            userProfilePictures: { select: { file_url: true, bytes: true } },
            PositionSlot: {
                select: {
                    pos: {
                        select: { name: true, department: { select: { name: true } } },
                    },
                    unitPosition: { select: { unit: { select: { name: true } } } },
                },
            },
            Position: { select: { name: true } },
            department: { select: { name: true } },
        },
    });
    const byId = new Map(users.map((u) => [u.id, u]));
    const ordered = body.userIds
        .map((id) => byId.get(id))
        .filter((u) => Boolean(u));
    const rearSide = tpl.sameBothSides
        ? tpl.front
        : tpl.rear;
    const allPh = [
        ...tpl.front.placeholders,
        ...((_q = rearSide === null || rearSide === void 0 ? void 0 : rearSide.placeholders) !== null && _q !== void 0 ? _q : []),
    ];
    const usesQR = allPh.some((p) => p.field === "qr");
    const usesPhoto = allPh.some((p) => p.field === "photo");
    // The photo placeholder must be filled by the employee's uploaded picture.
    // If the template needs a photo and any selected employee has none, the
    // export is invalid — report who's missing so they can be fixed/deselected.
    if (usesPhoto) {
        const noPhoto = ordered
            .filter((u) => { var _a; return !((_a = u.userProfilePictures) === null || _a === void 0 ? void 0 : _a.file_url); })
            .map((u) => fullNameOf(u));
        if (noPhoto.length) {
            return res.code(422).send({
                error: "MISSING_PHOTO",
                count: noPhoto.length,
                names: noPhoto,
                message: `${noPhoto.length} selected employee(s) have no uploaded photo, which this template requires.`,
            });
        }
    }
    const EXTRA_FIELDS = [
        "address",
        "birthday",
        "phone",
        "age",
        "civilStatus",
        "sex",
        "bloodType",
    ];
    const usesExtras = allPh.some((p) => EXTRA_FIELDS.includes(p.field));
    const base = ((0, url_1.tempURL)() || "").replace(/\/+$/, "");
    const emps = [];
    for (const u of ordered) {
        const emp = {
            fullName: ((_s = (_r = body.nameOverrides) === null || _r === void 0 ? void 0 : _r[u.id]) === null || _s === void 0 ? void 0 : _s.trim()) || fullNameOf(u),
            position: ((_u = (_t = u.PositionSlot) === null || _t === void 0 ? void 0 : _t.pos) === null || _u === void 0 ? void 0 : _u.name) || ((_v = u.Position) === null || _v === void 0 ? void 0 : _v.name) || u.status || "",
            office: ((_y = (_x = (_w = u.PositionSlot) === null || _w === void 0 ? void 0 : _w.unitPosition) === null || _x === void 0 ? void 0 : _x.unit) === null || _y === void 0 ? void 0 : _y.name) ||
                ((_1 = (_0 = (_z = u.PositionSlot) === null || _z === void 0 ? void 0 : _z.pos) === null || _0 === void 0 ? void 0 : _0.department) === null || _1 === void 0 ? void 0 : _1.name) ||
                ((_2 = u.department) === null || _2 === void 0 ? void 0 : _2.name) ||
                "",
            nameScale: Math.min(2, Math.max(0.4, (_4 = (_3 = body.nameScales) === null || _3 === void 0 ? void 0 : _3[u.id]) !== null && _4 !== void 0 ? _4 : 1)),
        };
        if (usesQR) {
            let code = u.verifyCode;
            if (!code) {
                code = (0, crypto_1.randomUUID)().replace(/-/g, "");
                yield prisma_1.prisma.user.update({
                    where: { id: u.id },
                    data: { verifyCode: code },
                });
            }
            emp.qr = yield qrcode_1.default.toBuffer(`${base}/verify-id?code=${code}`, {
                margin: 1,
                width: 1024, // high-res so the printed QR stays crisp at any size
                errorCorrectionLevel: "M",
            });
        }
        if (usesPhoto) {
            // prefer the bytea stored in Postgres; fall back to a URL (legacy)
            if ((_5 = u.userProfilePictures) === null || _5 === void 0 ? void 0 : _5.bytes) {
                emp.photo = Buffer.from(u.userProfilePictures.bytes);
            }
            else if ((_6 = u.userProfilePictures) === null || _6 === void 0 ? void 0 : _6.file_url) {
                try {
                    const r = yield fetch(u.userProfilePictures.file_url);
                    if (r.ok)
                        emp.photo = Buffer.from(yield r.arrayBuffer());
                }
                catch (_7) {
                    /* skip missing/unreachable photo */
                }
            }
        }
        if (usesExtras)
            emp.extras = yield (0, exports.getCardExtras)(u.id);
        emps.push(emp);
    }
    const extraText = (field, e) => {
        var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p;
        switch (field) {
            case "fullName":
                return e.fullName;
            case "position":
                return e.position;
            case "office":
                return e.office;
            case "address":
                return (_b = (_a = e.extras) === null || _a === void 0 ? void 0 : _a.address) !== null && _b !== void 0 ? _b : "";
            case "birthday":
                return (_d = (_c = e.extras) === null || _c === void 0 ? void 0 : _c.birthday) !== null && _d !== void 0 ? _d : "";
            case "phone":
                return (_f = (_e = e.extras) === null || _e === void 0 ? void 0 : _e.phone) !== null && _f !== void 0 ? _f : "";
            case "age":
                return (_h = (_g = e.extras) === null || _g === void 0 ? void 0 : _g.age) !== null && _h !== void 0 ? _h : "";
            case "civilStatus":
                return (_k = (_j = e.extras) === null || _j === void 0 ? void 0 : _j.civilStatus) !== null && _k !== void 0 ? _k : "";
            case "sex":
                return (_m = (_l = e.extras) === null || _l === void 0 ? void 0 : _l.sex) !== null && _m !== void 0 ? _m : "";
            case "bloodType":
                return (_p = (_o = e.extras) === null || _o === void 0 ? void 0 : _o.bloodType) !== null && _p !== void 0 ? _p : "";
            default:
                return "";
        }
    };
    const bgFront = tpl.front.image ? dataUrlToBuffer(tpl.front.image) : null;
    const bgRear = (rearSide === null || rearSide === void 0 ? void 0 : rearSide.image) ? dataUrlToBuffer(rearSide.image) : null;
    const buildPdf = (side, bg, mirror) => new Promise((resolve, reject) => {
        const doc = new PDFDocument({ size: [pw, ph], margin: 0 });
        const chunks = [];
        doc.on("data", (c) => chunks.push(c));
        doc.on("end", () => resolve(Buffer.concat(chunks)));
        doc.on("error", reject);
        // Embed the template image ONCE and reuse the reference for every card —
        // otherwise pdfkit re-embeds it per card and the (high-res) PDF balloons.
        const bgImg = bg ? doc.openImage(bg) : null;
        // A physical 100 mm reference drawn in the bottom margin. Print at 100%
        // and measure it: if it isn't 100 mm, the printer scaled the page (set a
        // custom scale of 100 / measured-mm, or disable "Fit to page").
        const drawRuler = () => {
            const rulerMM = 100;
            const rLen = mm2pt(rulerMM);
            const bottomGap = ph - (startY + gridH);
            if (rLen > pw - mm2pt(8) || bottomGap < mm2pt(6))
                return;
            const rx = (pw - rLen) / 2;
            const ry = ph - mm2pt(4.5);
            doc.save();
            doc.lineWidth(0.4).strokeColor("#444444");
            doc.moveTo(rx, ry).lineTo(rx + rLen, ry).stroke();
            for (let t = 0; t <= rulerMM; t += 10) {
                const tx = rx + mm2pt(t);
                const th = mm2pt(t % 50 === 0 ? 2.5 : 1.5);
                doc.moveTo(tx, ry).lineTo(tx, ry - th).stroke();
            }
            doc.font("Helvetica").fontSize(5).fillColor("#444444");
            doc.text("100 mm reference — must measure 100 mm. If not, print at 100% / Actual size.", rx, ry - mm2pt(4.5), { lineBreak: false });
            doc.restore();
        };
        emps.forEach((emp, i) => {
            var _a, _b, _c, _d;
            const slot = i % perPage;
            if (slot === 0) {
                if (i > 0)
                    doc.addPage({ size: [pw, ph], margin: 0 });
                if (paper.cutMarks)
                    drawRuler();
            }
            const row = Math.floor(slot / cols);
            const col = slot % cols;
            // mirror the axis that the duplex flip happens on
            const placeCol = mirror && paper.flip === "long" ? cols - 1 - col : col;
            const placeRow = mirror && paper.flip === "short" ? rows - 1 - row : row;
            const x = startX + placeCol * (cw + gap);
            const y = startY + placeRow * (ch + gap);
            if (bgImg) {
                try {
                    doc.image(bgImg, x, y, { width: cw, height: ch });
                }
                catch (_e) {
                    /* ignore bad image */
                }
            }
            for (const p of side.placeholders) {
                const centerX = x + (p.xPct / 100) * cw;
                const centerY = y + (p.yPct / 100) * ch;
                if (p.field === "qr") {
                    if (!emp.qr)
                        continue;
                    const s = ((_a = p.size) !== null && _a !== void 0 ? _a : 70) * scale;
                    try {
                        doc.image(emp.qr, centerX - s / 2, centerY - s / 2, {
                            width: s,
                            height: s,
                        });
                    }
                    catch (_f) {
                        /* ignore */
                    }
                }
                else if (p.field === "photo") {
                    if (!emp.photo)
                        continue;
                    const w = ((_b = p.size) !== null && _b !== void 0 ? _b : 90) * scale;
                    const h = ((_c = p.height) !== null && _c !== void 0 ? _c : 110) * scale;
                    try {
                        doc.image(emp.photo, centerX - w / 2, centerY - h / 2, {
                            cover: [w, h],
                            align: "center",
                            valign: "center",
                        });
                    }
                    catch (_g) {
                        /* ignore */
                    }
                }
                else {
                    const text = extraText(p.field, emp);
                    if (!text)
                        continue;
                    // the name can be shrunk per-employee (long names)
                    const fieldScale = p.field === "fullName" ? emp.nameScale : 1;
                    const sizePt = p.fontSize * scale * fieldScale;
                    doc
                        .font(pdfFont(p.fontFamily, !!p.bold))
                        .fontSize(sizePt)
                        .fillColor(safeColor(p.color));
                    const sw = ((_d = p.strokeWidth) !== null && _d !== void 0 ? _d : 0) * scale;
                    if (sw > 0)
                        doc.lineWidth(sw).strokeColor(safeColor(p.strokeColor, "#ffffff"));
                    const draw = sw > 0 ? { fill: true, stroke: true } : {};
                    if (p.field === "fullName") {
                        // long names wrap to multiple lines, centered on the placeholder
                        const boxW = cw * 0.92;
                        const h = doc.heightOfString(text, {
                            width: boxW,
                            align: "center",
                        });
                        doc.text(text, centerX - boxW / 2, centerY - h / 2, Object.assign(Object.assign({}, draw), { width: boxW, align: "center", lineBreak: true }));
                    }
                    else {
                        const tw = doc.widthOfString(text);
                        const th = doc.currentLineHeight();
                        doc.text(text, centerX - tw / 2, centerY - th / 2, Object.assign(Object.assign({}, draw), { lineBreak: false }));
                    }
                }
            }
            // cut guide at the card's true boundary — helps cutting and lets you
            // verify the printed size (measure it: it should equal the card size)
            if (paper.cutMarks) {
                doc.save();
                doc
                    .rect(x, y, cw, ch)
                    .lineWidth(0.3)
                    .strokeColor("#9aa0a6")
                    .stroke();
                doc.restore();
            }
        });
        doc.end();
    });
    const front = yield buildPdf(tpl.front, bgFront, false);
    const rear = rearSide && bgRear ? yield buildPdf(rearSide, bgRear, true) : null;
    return res.code(200).send({
        front: front.toString("base64"),
        rear: rear ? rear.toString("base64") : null,
        meta: {
            cols,
            rows,
            perPage,
            count: emps.length,
            pages: Math.ceil(emps.length / perPage),
        },
    });
});
exports.idExportBatch = idExportBatch;
/**
 * GET /user/my-verify-qr[?png=1] — the logged-in employee's identity-QR
 * payload. Returns the SAME verify URL the printed ID cards encode
 * (`{base}/verify-id?code=<verifyCode>`), generating and persisting the
 * user's verifyCode on first use.
 *
 * The mobile app takes the URL alone and draws the QR itself, offline. The
 * web profile cannot: the browser bundle carries jsQR, which only DECODES.
 * So the web asks for `png=1` and gets the rendered image back. It is opt-in
 * rather than always-on so mobile does not pay for ~25KB of base64 on every
 * profile open only to discard it.
 */
const myVerifyQr = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    const accountId = (_a = req.user) === null || _a === void 0 ? void 0 : _a.id;
    if (!accountId)
        return res.code(401).send({ error: "Unauthorized" });
    const account = yield prisma_1.prisma.account.findUnique({
        where: { id: accountId },
        select: { User: { select: { id: true, verifyCode: true } } },
    });
    const user = account === null || account === void 0 ? void 0 : account.User;
    if (!user)
        throw new errors_1.ValidationError("NO_USER_FOR_ACCOUNT");
    let code = user.verifyCode;
    if (!code) {
        code = (0, crypto_1.randomUUID)().replace(/-/g, "");
        yield prisma_1.prisma.user.update({
            where: { id: user.id },
            data: { verifyCode: code },
        });
    }
    const base = ((0, url_1.tempURL)() || "").replace(/\/+$/, "");
    const url = `${base}/verify-id?code=${code}`;
    const q = ((_b = req.query) !== null && _b !== void 0 ? _b : {});
    const wantPng = q.png === "1" || q.png === "true";
    // 1024px so the download is still sharp when someone prints it on a card
    // or a lanyard tag rather than only ever showing it on a screen.
    const qr = wantPng
        ? yield qrcode_1.default.toDataURL(url, { margin: 1, width: 1024 })
        : undefined;
    return res.code(200).send(Object.assign({ code, url }, (qr ? { qr } : {})));
});
exports.myVerifyQr = myVerifyQr;
