/**
 * Where a signature image actually lands inside its placement box.
 *
 * The old rule was "shrink the whole file to fit the box, then centre it".
 * That treats a signature like a logo, and a signature is not a logo: the
 * file is mostly empty space, the writing sits somewhere in the middle, and
 * a long tail sweeps down and left past everything else. Fitting the FILE
 * meant the visible mark floated near the top of the box while the tail ran
 * down through the printed name underneath it.
 *
 * A pen does something simpler. It puts the writing ON a line, at whatever
 * size the hand writes, and lets descenders hang below that line. So:
 *
 *   - size comes from the signature, not the box (`inkHeightPt`), because
 *     the box is only the area someone dragged out on the page;
 *   - the ink's WRITING LINE (`baselinePct` down its own height) is placed
 *     on the bottom edge of the box;
 *   - anything below that line — the tail — is allowed to hang past the box.
 *
 * With no height set, the old fit-to-box behaviour is returned unchanged, so
 * existing signatures keep stamping exactly as they did until their owner
 * chooses a size.
 */

/** The ink's bounds inside the image file, 0-1, y measured from the TOP. */
export interface InkBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface PlacementSettings {
  /** Printed height of the INK, in points. Null/0 → fit to the box. */
  inkHeightPt?: number | null;
  /** 0-100 down the ink's own height. 100 = bottom of the ink. */
  baselinePct?: number | null;
  /** Nulls are what the database hands back for an unmeasured signature. */
  ink?: { [K in keyof InkBox]?: number | null } | null;
}

/** A box on the page, in PDF user units (origin bottom-left). */
export interface TargetBox {
  x: number;
  /** Bottom edge. */
  y: number;
  width: number;
  height: number;
}

export interface DrawRect {
  x: number;
  y: number;
  width: number;
  height: number;
  /** True when the size came from the signature rather than the box. */
  sized: boolean;
}

/** The whole file, used when nothing was measured at upload. */
export const FULL_INK: InkBox = { x0: 0, y0: 0, x1: 1, y1: 1 };

const clamp = (v: number, lo: number, hi: number) =>
  Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : lo;

/**
 * Normalises whatever came out of the database (or a client) into an ink box
 * that is inside the image and has real area. A degenerate or inverted box
 * would divide by zero below, so it falls back to the whole file.
 */
export const normalizeInk = (
  ink?: { [K in keyof InkBox]?: number | null } | null,
): InkBox => {
  if (!ink) return FULL_INK;
  const x0 = clamp(Number(ink.x0 ?? 0), 0, 1);
  const y0 = clamp(Number(ink.y0 ?? 0), 0, 1);
  const x1 = clamp(Number(ink.x1 ?? 1), 0, 1);
  const y1 = clamp(Number(ink.y1 ?? 1), 0, 1);
  if (x1 - x0 < 0.01 || y1 - y0 < 0.01) return FULL_INK;
  return { x0, y0, x1, y1 };
};

/**
 * Work out where to draw the signature image.
 *
 * `imgW`/`imgH` are the image's own pixel dimensions — only their ratio
 * matters. The returned rect is for the WHOLE image; the ink lands where the
 * caller wants it because the rest of the file is transparent.
 */
export const placeSignature = (
  box: TargetBox,
  imgW: number,
  imgH: number,
  settings: PlacementSettings,
): DrawRect => {
  const ratio = imgW > 0 && imgH > 0 ? imgW / imgH : 1;
  const height = Number(settings.inkHeightPt ?? 0);
  const ink = normalizeInk(settings.ink);
  const inkW = ink.x1 - ink.x0;
  const inkH = ink.y1 - ink.y0;
  /** Did someone actually mark out part of the file, or is it the lot? */
  const bounded = inkW < 0.995 || inkH < 0.995;

  // Nothing said about this signature at all: the original behaviour, so a
  // signature nobody has touched keeps stamping exactly as it always did.
  if (!(height > 0) && !bounded) {
    let width = box.width;
    let h = box.width / ratio;
    if (h > box.height) {
      h = box.height;
      width = box.height * ratio;
    }
    return {
      x: box.x + (box.width - width) / 2,
      y: box.y + (box.height - h) / 2,
      width,
      height: h,
      sized: false,
    };
  }

  /**
   * How tall the marked-out writing prints.
   *
   * An explicit height wins. Otherwise the BOUNDARY is what gets fitted to
   * the box — not the file. That distinction is the entire point of drawing
   * one: fitting the file means the tail and the empty margins eat the box
   * and the writing comes out small and floating, which is what it did
   * before and what drawing a boundary is supposed to stop.
   */
  let inkPt: number;
  if (height > 0) {
    inkPt = height;
  } else {
    // Aspect ratio of the boundary itself, not of the file.
    const boundedRatio = ratio * (inkW / inkH);
    inkPt = box.width / boundedRatio;
    if (inkPt > box.height) inkPt = box.height;
  }

  // Scale the whole file so the marked-out part comes out `inkPt` tall.
  const drawH = inkPt / inkH;
  const drawW = drawH * ratio;

  // The writing line, as a fraction measured down from the image's top.
  // With a boundary and the default 100, that is the boundary's bottom edge
  // — so whatever was deliberately left outside it hangs below the line.
  const baseline = clamp(Number(settings.baselinePct ?? 100), 0, 100) / 100;
  const lineFromTop = ink.y0 + baseline * inkH;

  // Put that line on the bottom edge of the box. PDF y grows upward, so the
  // image's bottom sits below the line by however much of the file is under
  // it — which is exactly what lets the tail hang past the box.
  const y = box.y - (1 - lineFromTop) * drawH;

  // Centre the marked-out part — not the file — across the box.
  const x = box.x + box.width / 2 - (ink.x0 + inkW / 2) * drawW;

  return { x, y, width: drawW, height: drawH, sized: true };
};
