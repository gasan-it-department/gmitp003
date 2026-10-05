/**
 * Binding a signature to the document it was made on.
 *
 * The problem this solves is not forgery detection — the Ed25519 seal and
 * the PAdES signature already catch an altered file. It is THEFT of the
 * signature itself: until now the ink was drawn as a clean, standalone PNG
 * with nothing attached, so converting the PDF to Word and lifting the
 * image gave you a pristine, reusable signature for any document you liked.
 *
 * Nothing can prevent that. A visible signature must be visible, so it can
 * always be screenshotted. What CAN be done is make the stolen image
 * worthless and traceable:
 *
 *   1. A caption block naming the signer, their position, when they signed
 *      and this document's serial. Every genuine signature in this system
 *      carries one, so bare ink pasted onto a letter is visibly missing
 *      what everyone is used to seeing.
 *
 *   2. Microtext of the serial laid across the ink itself. Lift the
 *      signature and you lift the serial of the document you took it from,
 *      which turns "someone forged this" into "this was copied from
 *      GAS-0007" — a provable origin rather than a suspicion.
 *
 * Deterrence and forensics. Not prevention, and it should never be sold as
 * prevention.
 */
import type { PDFFont, PDFPage } from "pdf-lib";
import { rgb } from "pdf-lib";

export interface SignatureIdentity {
  name: string;
  position: string | null;
  signedAt: Date | null;
  serial: string;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 05 Oct 2026 2:32 pm, in Philippine time — the same rule the stamp uses. */
const stampedWhen = (d: Date | null): string => {
  if (!d) return "";
  const p = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Manila",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).formatToParts(d);
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  return `${g("day")} ${g("month")} ${g("year")} ${g("hour")}:${g("minute")} ${g("dayPeriod").toLowerCase().replace(/\./g, "")}`;
};

/**
 * Lay the serial across the ink, faintly and repeatedly.
 *
 * Deliberately weak: 3pt at 88% grey is legible under magnification and
 * close to invisible at reading distance, so it does not make a signature
 * look dirty or spoil a printed page. It is evidence, not decoration.
 */
export const drawSerialMicrotext = (
  page: PDFPage,
  font: PDFFont,
  ink: Rect,
  serial: string,
) => {
  const size = 3;
  const text = `${serial} · `;
  const unit = font.widthOfTextAtSize(text, size);
  if (unit <= 0 || ink.width <= 0 || ink.height <= 0) return;

  /*
    Tuned by looking at a rendered page. 0.88 grey at 7pt spacing read as a
    smear across the signature — forensically fine, visually dirty, and a
    signature that looks dirty is one an officer will ask to have removed.
    0.93 at 10pt spacing survives a screenshot and a JPEG round-trip while
    staying out of the way at reading distance.
  */
  const grey = rgb(0.93, 0.93, 0.93);
  const rows = Math.max(1, Math.floor(ink.height / 10));
  for (let r = 0; r < rows; r++) {
    const y = ink.y + 3 + r * 10;
    if (y > ink.y + ink.height - 2) break;
    // Offset alternate rows so the pattern cannot be cropped out along one
    // clean horizontal band.
    const start = ink.x + (r % 2 ? unit / 2 : 0);
    for (let x = start; x < ink.x + ink.width; x += unit) {
      const room = ink.x + ink.width - x;
      if (room < unit * 0.4) break;
      page.drawText(text, { x, y, size, font, color: grey });
    }
  }
};

/**
 * The caption under a signature.
 *
 * Returns false when there is genuinely nowhere to put it — near the foot
 * of a page the block would either overlap the signature's own descender or
 * run off the sheet, and a caption printed through somebody's handwriting
 * is worse than no caption. The microtext still carries the serial in that
 * case, so the signature is never left completely unbound.
 */
export const drawSignatureCaption = (
  page: PDFPage,
  font: PDFFont,
  box: Rect,
  who: SignatureIdentity,
): boolean => {
  const size = 5.5;
  const lead = 6.2;
  const when = stampedWhen(who.signedAt);
  const lines = [
    who.name.toUpperCase(),
    who.position ?? "",
    when ? `Signed ${when}` : "",
    who.serial,
  ].filter(Boolean);

  const needed = lines.length * lead + 4;
  // Below the box if it fits on the sheet, otherwise above it.
  let top = box.y - 3;
  if (top - needed < 6) {
    top = box.y + box.height + needed + 1;
    if (top > page.getSize().height - 6) return false;
  }

  page.drawLine({
    start: { x: box.x, y: top },
    end: { x: box.x + box.width, y: top },
    thickness: 0.4,
    color: rgb(0.72, 0.72, 0.72),
  });

  let y = top - lead;
  for (const [i, line] of lines.entries()) {
    // The name carries the weight; everything under it is supporting detail.
    const color = i === 0 ? rgb(0.15, 0.15, 0.15) : rgb(0.45, 0.45, 0.45);
    let text = line;
    // Never let a long position run outside the box it belongs to.
    while (text.length > 4 && font.widthOfTextAtSize(text, size) > box.width) {
      text = text.slice(0, -2);
    }
    if (text !== line && text.length > 1) text = text.slice(0, -1) + "…";
    page.drawText(text, { x: box.x, y, size, font, color });
    y -= lead;
  }
  return true;
};
