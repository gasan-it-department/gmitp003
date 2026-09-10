// Turning a routing's PDF into something a phone can show.
//
// The portal renders PDFs in the browser with pdf.js. A React Native app
// has no such thing: there is no WebView in this app and no PDF viewer,
// and adding either means a native module and a bigger build. Rendering
// server-side costs one dependency here and nothing there — the phone
// receives an ordinary PNG.
//
// mupdf is a WASM build: one package, no native compilation, so it
// installs the same on this machine and on Railway. It is ESM-only with
// top-level await, which a CommonJS build cannot `require`, hence the
// Function-wrapped import below — the same shape as the pdf-lib dynamic
// imports elsewhere, for a stricter reason.

/**
 * Import an ESM-only module from CommonJS.
 *
 * `await import()` would be correct, but TypeScript with module=commonjs
 * rewrites it to require(), which throws ERR_REQUIRE_ASYNC_MODULE for a
 * module with top-level await. Building the import through Function keeps
 * it an import all the way to runtime.
 */
const esmImport = new Function("s", "return import(s)") as (
  s: string,
) => Promise<any>;

let mupdfPromise: Promise<any> | null = null;
/** Loaded once and reused; the WASM instance is ~14MB of module. */
const mupdf = () => (mupdfPromise ??= esmImport("mupdf"));

export interface PdfPageSize {
  /** 1-based, matching DocumentPage.page and SignatureCoor's page. */
  page: number;
  widthPt: number;
  heightPt: number;
}

/** Nobody is signing a thousand-page PDF from a phone. */
const MAX_PAGES = 200;

/**
 * Every page's size, in PDF points.
 *
 * The phone needs these before the images arrive so it can lay out the
 * page boxes at the right aspect ratio and put the signature overlays in
 * place — otherwise the list reflows as each image loads and the boxes
 * visibly slide.
 */
export const pdfPageSizes = async (bytes: Buffer): Promise<PdfPageSize[]> => {
  const m = await mupdf();
  const doc = m.Document.openDocument(bytes, "application/pdf");
  try {
    const count = Math.min(doc.countPages(), MAX_PAGES);
    const out: PdfPageSize[] = [];
    for (let i = 0; i < count; i++) {
      const page = doc.loadPage(i);
      try {
        const [x0, y0, x1, y1] = page.getBounds();
        out.push({
          page: i + 1,
          widthPt: Math.round((x1 - x0) * 100) / 100,
          heightPt: Math.round((y1 - y0) * 100) / 100,
        });
      } finally {
        page.destroy?.();
      }
    }
    return out;
  } finally {
    doc.destroy?.();
  }
};

/**
 * How many pages may be rasterising at once.
 *
 * A ScrollView mounts every <Image> it contains, so opening a twenty-page
 * memo fires twenty requests at once and each one allocates a pixmap of a
 * few megabytes and burns a core. Unbounded, that is a self-inflicted
 * denial of service on a small instance — and it is triggered by somebody
 * doing nothing worse than reading a long document.
 *
 * Two at a time keeps the instance responsive; the rest wait a few tens of
 * milliseconds each, which is invisible next to the network round-trip.
 */
const MAX_CONCURRENT_RENDERS = 2;
let active = 0;
const waiting: (() => void)[] = [];

const acquire = (): Promise<void> =>
  new Promise((resolve) => {
    if (active < MAX_CONCURRENT_RENDERS) {
      active++;
      resolve();
      return;
    }
    waiting.push(() => {
      active++;
      resolve();
    });
  });

const release = () => {
  active--;
  waiting.shift()?.();
};

/** Sane bounds for a phone screen at 2-3x pixel density. */
export const MIN_RENDER_PX = 320;
export const MAX_RENDER_PX = 1600;
export const DEFAULT_RENDER_PX = 1100;

/**
 * One page as a PNG, scaled so the image is `targetWidthPx` across.
 *
 * Throws NotFound-shaped errors to the caller rather than guessing: a page
 * number past the end of the document is a bad request, not a blank image.
 */
export const renderPdfPage = async (
  bytes: Buffer,
  page: number,
  targetWidthPx = DEFAULT_RENDER_PX,
): Promise<{ png: Buffer; widthPx: number; heightPx: number }> => {
  const width = Math.max(
    MIN_RENDER_PX,
    Math.min(MAX_RENDER_PX, Math.round(targetWidthPx) || DEFAULT_RENDER_PX),
  );
  const m = await mupdf();
  await acquire();
  try {
    return renderNow(m, bytes, page, width);
  } finally {
    release();
  }
};

const renderNow = (
  m: any,
  bytes: Buffer,
  page: number,
  width: number,
): { png: Buffer; widthPx: number; heightPx: number } => {
  const doc = m.Document.openDocument(bytes, "application/pdf");
  try {
    const count = doc.countPages();
    const idx = page - 1;
    if (idx < 0 || idx >= count) {
      throw new Error(`page ${page} is outside this document (${count} pages)`);
    }
    const pg = doc.loadPage(idx);
    try {
      const [x0, , x1] = pg.getBounds();
      const wPt = x1 - x0;
      const scale = wPt > 0 ? width / wPt : 1;
      // No alpha: a transparent background renders as black on some image
      // views, and a scanned memo should look like paper.
      const pix = pg.toPixmap(
        m.Matrix.scale(scale, scale),
        m.ColorSpace.DeviceRGB,
        false,
        true,
      );
      try {
        return {
          png: Buffer.from(pix.asPNG()),
          widthPx: pix.getWidth(),
          heightPx: pix.getHeight(),
        };
      } finally {
        pix.destroy?.();
      }
    } finally {
      pg.destroy?.();
    }
  } finally {
    doc.destroy?.();
  }
};
