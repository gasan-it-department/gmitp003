/* PROOF of the scanned-code reader: QR is accepted like a barcode, but
 * every conflict a QR introduces is handled explicitly.
 * Run: npx ts-node --transpile-only e2e_scancode.ts */
import { readScannedCode } from "./src/utils/scanCode";

let pass = 0,
  fail = 0;
const ok = (l: string, c: boolean, d = "") => {
  if (c) {
    pass++;
    console.log("PASS  " + l);
  } else {
    fail++;
    console.log("FAIL  " + l + (d ? "  → " + d : ""));
  }
};

// ── 1. plain 1D barcodes still behave exactly as before ────────────────
const ean = readScannedCode("4806509782314");
ok("EAN-13 reads unchanged", ean.code === "4806509782314" && !ean.rejected,
  JSON.stringify(ean));

// ── 2. GS1 QR (Digital Link): every LOT must map to ONE medicine ───────
const dlA = readScannedCode(
  "https://id.gs1.org/01/04806509782314/17/261231/10/LOT-A",
);
const dlB = readScannedCode(
  "https://id.gs1.org/01/04806509782314/17/270630/10/LOT-B",
);
ok("GS1 QR yields the GTIN, not the whole URL", dlA.code === "4806509782314",
  JSON.stringify(dlA));
ok("two different LOTS of the same drug → SAME medicine code",
  dlA.code === dlB.code, `${dlA.code} vs ${dlB.code}`);
ok("GS1 QR hands back that box's expiry + lot",
  dlA.expiry === "2026-12-31" && dlA.lot === "LOT-A", JSON.stringify(dlA));

// ── 3. the SAME product scanned as 1D EAN-13 vs QR GTIN-14 ─────────────
ok("QR GTIN-14 and the printed EAN-13 resolve to one identity",
  readScannedCode("04806509782314").code === ean.code);

// ── 4. GS1 element-string form (DataMatrix on many PH boxes) ───────────
const es = readScannedCode("(01)04806509782314(17)261200(10)AB12");
ok("(01)(17)(10) element string parses to the same GTIN",
  es.code === ean.code, JSON.stringify(es));
ok("GS1 'day 00' expiry resolves to end of month",
  es.expiry === "2026-12-31", JSON.stringify(es));

// ── 5. FOREIGN QR codes must be REFUSED, never registered ──────────────
const idCard = readScannedCode(
  "https://www.lgu-portal.xyz/verify-id?code=9f2c1ab34de5",
);
ok("employee ID QR is refused", !!idCard.rejected && !idCard.code,
  JSON.stringify(idCard));
const sig = readScannedCode("https://www.lgu-portal.xyz/verify/abc123");
ok("signature QR is refused", !!sig.rejected && !sig.code, JSON.stringify(sig));
ok("receiving-room code is refused", !!readScannedCode("RM-7QX2ZK9").rejected);
ok("WiFi QR is refused", !!readScannedCode("WIFI:S:Clinic;T:WPA;P:x;;").rejected);
ok("vCard QR is refused", !!readScannedCode("BEGIN:VCARD\nFN:Juan\nEND:VCARD").rejected);
ok("random marketing URL is refused",
  !!readScannedCode("https://example.com/promo").rejected);

// ── 6. hostile payload shapes ──────────────────────────────────────────
const multi = readScannedCode("  ABC-123\r\nEXTRA  ");
ok("newlines inside a QR never reach the stored code",
  !/[\r\n]/.test(multi.code), JSON.stringify(multi));
const huge = readScannedCode("X".repeat(900));
ok("3KB-class payload is refused, not stored", !!huge.rejected && !huge.code);
ok("empty scan is refused", !!readScannedCode("   ").rejected);

// ── 7. in-house alphanumeric labels still work, case-stable ────────────
ok("in-house label normalizes case (one medicine, not two)",
  readScannedCode("abc-123").code === readScannedCode("ABC-123").code);

console.log(`RESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
