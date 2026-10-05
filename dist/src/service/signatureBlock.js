"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.drawSignatureCaption = exports.drawSerialMicrotext = void 0;
const pdf_lib_1 = require("pdf-lib");
/** 05 Oct 2026 2:32 pm, in Philippine time — the same rule the stamp uses. */
const stampedWhen = (d) => {
    if (!d)
        return "";
    const p = new Intl.DateTimeFormat("en-GB", {
        timeZone: "Asia/Manila",
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
    }).formatToParts(d);
    const g = (t) => { var _a, _b; return (_b = (_a = p.find((x) => x.type === t)) === null || _a === void 0 ? void 0 : _a.value) !== null && _b !== void 0 ? _b : ""; };
    return `${g("day")} ${g("month")} ${g("year")} ${g("hour")}:${g("minute")} ${g("dayPeriod").toLowerCase().replace(/\./g, "")}`;
};
/**
 * Lay the serial across the ink, faintly and repeatedly.
 *
 * Deliberately weak: 3pt at 88% grey is legible under magnification and
 * close to invisible at reading distance, so it does not make a signature
 * look dirty or spoil a printed page. It is evidence, not decoration.
 */
const drawSerialMicrotext = (page, font, ink, serial) => {
    const size = 3;
    const text = `${serial} · `;
    const unit = font.widthOfTextAtSize(text, size);
    if (unit <= 0 || ink.width <= 0 || ink.height <= 0)
        return;
    /*
      Tuned by looking at a rendered page. 0.88 grey at 7pt spacing read as a
      smear across the signature — forensically fine, visually dirty, and a
      signature that looks dirty is one an officer will ask to have removed.
      0.93 at 10pt spacing survives a screenshot and a JPEG round-trip while
      staying out of the way at reading distance.
    */
    const grey = (0, pdf_lib_1.rgb)(0.93, 0.93, 0.93);
    const rows = Math.max(1, Math.floor(ink.height / 10));
    for (let r = 0; r < rows; r++) {
        const y = ink.y + 3 + r * 10;
        if (y > ink.y + ink.height - 2)
            break;
        // Offset alternate rows so the pattern cannot be cropped out along one
        // clean horizontal band.
        const start = ink.x + (r % 2 ? unit / 2 : 0);
        for (let x = start; x < ink.x + ink.width; x += unit) {
            const room = ink.x + ink.width - x;
            if (room < unit * 0.4)
                break;
            page.drawText(text, { x, y, size, font, color: grey });
        }
    }
};
exports.drawSerialMicrotext = drawSerialMicrotext;
/**
 * The caption under a signature.
 *
 * Returns false when there is genuinely nowhere to put it — near the foot
 * of a page the block would either overlap the signature's own descender or
 * run off the sheet, and a caption printed through somebody's handwriting
 * is worse than no caption. The microtext still carries the serial in that
 * case, so the signature is never left completely unbound.
 */
const drawSignatureCaption = (page, font, box, who) => {
    var _a;
    const size = 5.5;
    const lead = 6.2;
    const when = stampedWhen(who.signedAt);
    const lines = [
        who.name.toUpperCase(),
        (_a = who.position) !== null && _a !== void 0 ? _a : "",
        when ? `Signed ${when}` : "",
        who.serial,
    ].filter(Boolean);
    const needed = lines.length * lead + 4;
    // Below the box if it fits on the sheet, otherwise above it.
    let top = box.y - 3;
    if (top - needed < 6) {
        top = box.y + box.height + needed + 1;
        if (top > page.getSize().height - 6)
            return false;
    }
    page.drawLine({
        start: { x: box.x, y: top },
        end: { x: box.x + box.width, y: top },
        thickness: 0.4,
        color: (0, pdf_lib_1.rgb)(0.72, 0.72, 0.72),
    });
    let y = top - lead;
    for (const [i, line] of lines.entries()) {
        // The name carries the weight; everything under it is supporting detail.
        const color = i === 0 ? (0, pdf_lib_1.rgb)(0.15, 0.15, 0.15) : (0, pdf_lib_1.rgb)(0.45, 0.45, 0.45);
        let text = line;
        // Never let a long position run outside the box it belongs to.
        while (text.length > 4 && font.widthOfTextAtSize(text, size) > box.width) {
            text = text.slice(0, -2);
        }
        if (text !== line && text.length > 1)
            text = text.slice(0, -1) + "…";
        page.drawText(text, { x: box.x, y, size, font, color });
        y -= lead;
    }
    return true;
};
exports.drawSignatureCaption = drawSignatureCaption;
