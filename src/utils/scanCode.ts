/**
 * ONE canonical reading of a scanned code — used by the API and mirrored
 * byte-for-byte in the mobile app (gmitp003-mobile/src/utils/scanCode.ts).
 * Both must agree or a code registered on the phone won't be found by the
 * web/desktop, and vice versa.
 *
 * The problems this exists to prevent, all of them real on medicine
 * packaging in the field:
 *
 *  1. GS1 QR / DataMatrix (what modern medicine boxes actually carry)
 *     encodes the product GTIN **plus that box's lot and expiry**, either
 *     as a Digital Link URL
 *         https://id.gs1.org/01/09506000134352/17/261231/10/LOT42
 *     or as element strings
 *         (01)09506000134352(17)261231(10)LOT42
 *     Storing the whole payload as the barcode would make EVERY LOT of the
 *     same drug register as a DIFFERENT medicine. We extract the GTIN (AI
 *     01) as the identity and hand the lot/expiry back separately.
 *  2. The same product's 1D barcode (EAN-13) and its QR GTIN-14 differ
 *     only by a leading zero — they must resolve to ONE medicine.
 *  3. Foreign QR codes share the same camera: employee ID cards
 *     (/verify-id?code=…), signature verification (/verify/<id>), document
 *     room codes (RM-XXXXXXX), plus consumer QRs (WiFi, vCard, tel:,
 *     mailto:, random marketing URLs). None of these are medicines; they
 *     must be REFUSED, not silently registered as one.
 *  4. QR payloads can be ~3 KB and contain newlines/control characters —
 *     they would poison the barcode column, the unique index, the UI, and
 *     the desktop keyboard-wedge path (an embedded Enter submits early).
 */

export interface ScanReading {
  /** Canonical identity to store/lookup as Medicine.barcode. */
  code: string;
  /** How it was read — for UI messaging. */
  kind: "gtin" | "plain";
  /** Lot/batch number when the code carried one (GS1 AI 10). */
  lot?: string;
  /** Expiry the code carried (GS1 AI 17), ISO yyyy-mm-dd. */
  expiry?: string;
  /** Set when the payload must NOT be treated as a medicine code. */
  rejected?: string;
}

/** Payloads that belong to OTHER features or aren't product codes. */
const FOREIGN_PATTERNS: Array<{ re: RegExp; why: string }> = [
  {
    re: /\/verify-id\?code=/i,
    why: "That's an employee ID card QR, not a medicine code.",
  },
  {
    re: /\/verify\/[A-Za-z0-9-]+/,
    why: "That's a signature-verification QR, not a medicine code.",
  },
  {
    re: /^RM-[A-Z0-9]{5,}$/i,
    why: "That's a receiving-room code, not a medicine code.",
  },
  { re: /^WIFI:/i, why: "That's a WiFi QR code." },
  { re: /^BEGIN:(VCARD|VEVENT)/i, why: "That's a contact/calendar QR code." },
  { re: /^(tel|mailto|sms|geo|bitcoin):/i, why: "That's not a product code." },
];

const GS1_AI_DATE = /^(\d{2})(\d{2})(\d{2})$/; // YYMMDD

/** GS1 YYMMDD → ISO. DD=00 means "end of month" per the GS1 spec. */
const gs1Date = (raw: string): string | undefined => {
  const m = GS1_AI_DATE.exec(raw);
  if (!m) return undefined;
  const yy = parseInt(m[1], 10);
  const mm = parseInt(m[2], 10);
  let dd = parseInt(m[3], 10);
  if (mm < 1 || mm > 12) return undefined;
  // GS1: 00-49 → 20xx, 50-99 → 19xx.
  const year = yy <= 49 ? 2000 + yy : 1900 + yy;
  if (dd === 0) dd = new Date(Date.UTC(year, mm, 0)).getUTCDate();
  if (dd < 1 || dd > 31) return undefined;
  return `${year}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
};

/**
 * GTIN-14 with a leading zero is the same product as its EAN-13, and
 * GTIN-12/UPC-A pads to 13 the same way. Collapse to the shortest
 * equivalent so one product is one medicine however it was scanned.
 */
export const canonicalGtin = (digits: string): string => {
  let d = digits;
  while (d.length > 13 && d.startsWith("0")) d = d.slice(1);
  if (d.length === 12) d = "0" + d; // UPC-A → EAN-13 form
  return d;
};

/** Parse GS1 element strings: (01)…(17)…(10)… or their bare equivalent. */
const parseGs1Elements = (s: string): ScanReading | null => {
  if (!/\(\d{2,4}\)/.test(s)) return null;
  const out: ScanReading = { code: "", kind: "gtin" };
  const re = /\((\d{2,4})\)([^(]*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    const ai = m[1];
    const val = m[2].trim();
    if (ai === "01" && /^\d{8,14}$/.test(val)) out.code = canonicalGtin(val);
    else if (ai === "17") out.expiry = gs1Date(val);
    else if (ai === "10" && val) out.lot = val;
  }
  return out.code ? out : null;
};

/** Parse a GS1 Digital Link URL: …/01/<gtin>/17/<yymmdd>/10/<lot>. */
const parseDigitalLink = (s: string): ScanReading | null => {
  if (!/^https?:\/\//i.test(s)) return null;
  let path: string;
  try {
    path = new URL(s).pathname;
  } catch {
    return null;
  }
  const seg = path.split("/").filter(Boolean);
  const out: ScanReading = { code: "", kind: "gtin" };
  for (let i = 0; i < seg.length - 1; i++) {
    const key = seg[i];
    const val = decodeURIComponent(seg[i + 1]);
    if ((key === "01" || key === "gtin") && /^\d{8,14}$/.test(val))
      out.code = canonicalGtin(val);
    else if (key === "17") out.expiry = gs1Date(val);
    else if (key === "10" && val) out.lot = val;
  }
  return out.code ? out : null;
};

export const MAX_SCAN_CODE_LENGTH = 64;

/**
 * Read a raw scanner payload (QR, DataMatrix, or 1D barcode) into the
 * canonical medicine identity, or refuse it with a reason the UI shows.
 */
export const readScannedCode = (raw: string): ScanReading => {
  // Strip control characters (embedded newlines from multi-line QR would
  // break the keyboard-wedge path and the stored value).
  const s = (raw ?? "")
    .replace(new RegExp("[\u0000-\u001f\u007f]", "g"), " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!s) return { code: "", kind: "plain", rejected: "Empty code." };

  for (const f of FOREIGN_PATTERNS) {
    if (f.re.test(s)) return { code: "", kind: "plain", rejected: f.why };
  }

  const gs1 = parseDigitalLink(s) ?? parseGs1Elements(s);
  if (gs1) return gs1;

  // A bare numeric barcode (EAN/UPC/GTIN) — normalize to one form.
  if (/^\d{8,14}$/.test(s)) return { code: canonicalGtin(s), kind: "gtin" };

  // Any other URL is not a product code — almost always a marketing or
  // foreign QR, and storing it would create a junk "medicine".
  if (/^https?:\/\//i.test(s)) {
    return {
      code: "",
      kind: "plain",
      rejected:
        "That QR is a web link, not a medicine code. Scan the product's " +
        "barcode or its GS1 QR.",
    };
  }

  if (s.length > MAX_SCAN_CODE_LENGTH) {
    return {
      code: "",
      kind: "plain",
      rejected: `That code is too long (${s.length} characters). It doesn't look like a product code.`,
    };
  }

  // Plain alphanumeric code (in-house labels, CODE39/128 prints).
  return { code: s.toUpperCase(), kind: "plain" };
};

/**
 * Every stored form a scan could match. Medicines registered BEFORE
 * normalization existed hold the raw payload (mixed case, un-padded
 * GTIN), so a lookup must try the canonical value AND the raw one, or
 * scanning an already-registered product would read as "not registered"
 * and invite a duplicate.
 */
export const barcodeLookupCandidates = (raw: string): string[] => {
  const reading = readScannedCode(raw);
  const out = new Set<string>();
  if (reading.code) {
    out.add(reading.code);
    // EAN-13 ↔ GTIN-14 ↔ UPC-A: match whichever form was stored first.
    if (/^\d+$/.test(reading.code)) {
      out.add(reading.code.replace(/^0+/, ""));
      out.add("0" + reading.code);
      out.add(reading.code.padStart(14, "0"));
    } else {
      out.add(reading.code.toLowerCase());
    }
  }
  const trimmed = (raw ?? "").trim();
  if (trimmed) out.add(trimmed);
  return [...out].filter(Boolean);
};
