import { FastifyRequest, FastifyReply } from "../barrel/fastify";
import { prisma } from "../barrel/prisma";
import { ValidationError } from "../errors/errors";
import QRCode from "qrcode";
import { randomUUID } from "crypto";
import { tempURL } from "../service/url";
import { EncryptionService } from "../service/encryption";
// pdfkit ships no types and @types/pdfkit isn't installed; require keeps it
// loosely typed and works under both tsc and ts-node (no ambient .d.ts needed).
// eslint-disable-next-line @typescript-eslint/no-var-requires
const PDFDocument: any = require("pdfkit");

// ── Shared shapes (mirror the frontend ID-card template) ───────────────────
type Field =
  | "fullName"
  | "position"
  | "office"
  | "address"
  | "birthday"
  | "phone"
  | "age"
  | "civilStatus"
  | "sex"
  | "bloodType"
  | "qr"
  | "photo";
interface Placeholder {
  id: string;
  field: Field;
  xPct: number;
  yPct: number;
  fontSize: number;
  color: string;
  bold: boolean;
  align: "left" | "center" | "right";
  size?: number;
  height?: number;
  strokeWidth?: number;
  strokeColor?: string;
  fontFamily?: string;
}

// pdfkit built-in font families (no embedding) — keys match the frontend
const PDF_FONT: Record<string, { normal: string; bold: string }> = {
  sans: { normal: "Helvetica", bold: "Helvetica-Bold" },
  serif: { normal: "Times-Roman", bold: "Times-Bold" },
  mono: { normal: "Courier", bold: "Courier-Bold" },
};
const pdfFont = (key: string | undefined, bold: boolean) => {
  const f = PDF_FONT[key || "sans"] || PDF_FONT.sans;
  return bold ? f.bold : f.normal;
};
interface SideData {
  image: string | null;
  placeholders: Placeholder[];
}
interface Template {
  size: { w: number; h: number; unit: "mm" | "in" };
  front: SideData;
  rear: SideData;
  sameBothSides?: boolean;
}
interface PaperOpts {
  size: string;
  orientation: "portrait" | "landscape";
  marginMm: number;
  gapMm: number;
  flip: "long" | "short";
  cutMarks: boolean;
}

// placeholder font/QR/photo px are authored against this editor width
const DESIGN_W = 460;
const mm2pt = (mm: number) => (mm * 72) / 25.4;
const in2pt = (i: number) => i * 72;

// page sizes in points (portrait)
const PAPER_PT: Record<string, [number, number]> = {
  A4: [mm2pt(210), mm2pt(297)],
  Letter: [612, 792],
  "Folio 8.5×13": [in2pt(8.5), in2pt(13)], // PH long bond / folio
  Legal: [612, 1008],
  A3: [mm2pt(297), mm2pt(420)],
};

const dataUrlToBuffer = (d: string): Buffer | null => {
  const m = /^data:image\/[a-zA-Z+]+;base64,(.+)$/.exec(d);
  return m ? Buffer.from(m[1], "base64") : null;
};

const safeColor = (c?: string, fallback = "#111827") =>
  c && /^#[0-9a-fA-F]{6}$/.test(c) ? c : fallback;

const fullNameOf = (u: {
  firstName: string | null;
  middleName: string | null;
  lastName: string | null;
  suffix: string | null;
}) =>
  [u.firstName, u.middleName, u.lastName, u.suffix].filter(Boolean).join(" ");

// ── Extra personal fields for ID cards (PII — authenticated paths only) ─────
const dec = async (
  data: string | null,
  iv: string | null,
): Promise<string> => {
  if (data && iv) {
    try {
      return (await EncryptionService.decrypt(data, iv)) ?? "";
    } catch {
      return data;
    }
  }
  return data ?? "";
};
const fmtDate = (d: Date | null): string => {
  if (!d) return "";
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${d.getFullYear()}`;
};
const ageFrom = (d: Date | null): string => {
  if (!d) return "";
  const now = new Date();
  let a = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) a--;
  return a >= 0 && a < 150 ? String(a) : "";
};
// PSGC code → place name (address parts store codes, not names)
const psgcCache = new Map<string, string>();
const psgcName = async (kind: string, code: string): Promise<string | null> => {
  const key = `${kind}:${code}`;
  if (psgcCache.has(key)) return psgcCache.get(key)!;
  try {
    const r = await fetch(`https://psgc.gitlab.io/api/${kind}/${code}/`);
    if (r.ok) {
      const j: any = await r.json();
      if (j?.name) {
        psgcCache.set(key, j.name);
        return j.name;
      }
    }
  } catch {
    /* offline → fall back to raw */
  }
  return null;
};
const resolvePlace = async (
  value: string,
  kinds: string[],
): Promise<string> => {
  const v = (value || "").trim();
  if (!v || !/^\d{6,}$/.test(v)) return v;
  for (const k of kinds) {
    const n = await psgcName(k, v);
    if (n) return n;
  }
  return v;
};
const cleanVal = (v: string) =>
  v && v.trim().toUpperCase() !== "N/A" ? v.trim() : "";

export interface CardExtras {
  birthday: string;
  age: string;
  sex: string;
  phone: string;
  civilStatus: string;
  bloodType: string;
  address: string;
}

// Assemble the optional ID-card fields for a user (decrypts PII + resolves
// the address codes to readable place names). Authenticated callers only.
export const getCardExtras = async (userId: string): Promise<CardExtras> => {
  const empty: CardExtras = {
    birthday: "",
    age: "",
    sex: "",
    phone: "",
    civilStatus: "",
    bloodType: "",
    address: "",
  };
  const user = await prisma.user.findUnique({
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
  if (!user) return empty;

  const out: CardExtras = {
    ...empty,
    birthday: fmtDate(user.birthDate ?? null),
    age: ageFrom(user.birthDate ?? null),
    sex: user.gender && user.gender !== "--/--" ? user.gender : "",
    phone: await dec(user.phoneNumber, user.phoneNumberIv),
  };

  const app = user.submittedApplications;
  if (app) {
    out.civilStatus = await dec(app.cvilStatus, app.cvilStatusIv);
    out.bloodType = cleanVal(app.bloodType ?? "");
    const house = cleanVal(await dec(app.reshouseBlock, app.reshouseBlockIv));
    const street = cleanVal(await dec(app.resStreet, app.resStreetIv));
    const sub = cleanVal(app.resSub ?? "");
    const barangay = cleanVal(
      await resolvePlace(await dec(app.resBarangay, app.resBarangayIv), [
        "barangays",
      ]),
    );
    const city = cleanVal(
      await resolvePlace(await dec(app.resCity, app.resCityIv), [
        "municipalities",
        "cities",
      ]),
    );
    const province = cleanVal(
      await resolvePlace(await dec(app.resProvince, app.resProvinceIv), [
        "provinces",
      ]),
    );
    out.address = [house, street, sub, barangay, city, province]
      .filter(Boolean)
      .join(", ");
  }
  return out;
};

// GET /id/issue-list?lineId=   (authenticated)
// All active (non-archived) employees of a line for the bulk ID picker.
export const idIssueList = async (req: FastifyRequest, res: FastifyReply) => {
  const q = req.query as { lineId?: string };
  if (!q.lineId) throw new ValidationError("BAD_REQUEST");

  const users = await prisma.user.findMany({
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
    // the employee's unit/office: their UnitPosition's unit, then the
    // position's department, then their direct department membership
    const dept =
      u.PositionSlot?.unitPosition?.unit ||
      u.PositionSlot?.pos?.department ||
      u.department ||
      null;
    return {
      userId: u.id,
      fullName: fullNameOf(u),
      position:
        u.PositionSlot?.pos?.name || u.Position?.name || u.status || "",
      photoUrl: u.userProfilePictures?.file_url ?? null,
      departmentId: dept?.id ?? "",
      office: dept?.name ?? "",
    };
  });

  // every unit/office on the line — even ones with no personnel
  const departments = await prisma.department.findMany({
    where: { lineId: q.lineId },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
  const units = departments
    .filter((d) => d.name)
    .map((d) => ({ id: d.id, name: d.name as string }));

  return res.code(200).send({ list, units });
};

// POST /id/export-batch   (authenticated)
// Lays employees onto the selected paper size (auto fit) and returns two PDFs:
// one with every FRONT, one with every REAR. Rear columns/rows are mirrored so
// fronts and rears land back-to-back when duplex printed.
export const idExportBatch = async (req: FastifyRequest, res: FastifyReply) => {
  const body = req.body as {
    lineId?: string;
    userIds?: string[];
    template?: Template;
    paper?: Partial<PaperOpts>;
    nameOverrides?: Record<string, string>;
    nameScales?: Record<string, number>; // per-employee name font multiplier
  };
  if (
    !body.lineId ||
    !body.template?.front ||
    !Array.isArray(body.userIds) ||
    body.userIds.length === 0
  ) {
    throw new ValidationError("BAD_REQUEST");
  }

  const tpl = body.template;
  const paper: PaperOpts = {
    size: body.paper?.size ?? "A4",
    orientation: body.paper?.orientation ?? "portrait",
    marginMm: body.paper?.marginMm ?? 8,
    gapMm: body.paper?.gapMm ?? 4,
    flip: body.paper?.flip ?? "long",
    cutMarks: body.paper?.cutMarks ?? true,
  };

  // page + card geometry (points)
  let [pw, ph] = PAPER_PT[paper.size] ?? PAPER_PT.A4;
  if (paper.orientation === "landscape") [pw, ph] = [ph, pw];
  const margin = mm2pt(paper.marginMm);
  const gap = mm2pt(paper.gapMm);
  const cw =
    tpl.size.unit === "in" ? in2pt(tpl.size.w) : mm2pt(tpl.size.w);
  const ch =
    tpl.size.unit === "in" ? in2pt(tpl.size.h) : mm2pt(tpl.size.h);

  const cols = Math.max(1, Math.floor((pw - 2 * margin + gap) / (cw + gap)));
  const rows = Math.max(1, Math.floor((ph - 2 * margin + gap) / (ch + gap)));
  const perPage = cols * rows;
  const gridW = cols * cw + (cols - 1) * gap;
  const gridH = rows * ch + (rows - 1) * gap;
  const startX = (pw - gridW) / 2; // symmetric margins → back-to-back aligns
  const startY = (ph - gridH) / 2;
  const scale = cw / DESIGN_W;

  // fetch the chosen employees, preserving the requested order
  const users = await prisma.user.findMany({
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
    .filter((u): u is (typeof users)[number] => Boolean(u));

  const rearSide: SideData | undefined = tpl.sameBothSides
    ? tpl.front
    : tpl.rear;
  const allPh = [
    ...tpl.front.placeholders,
    ...(rearSide?.placeholders ?? []),
  ];
  const usesQR = allPh.some((p) => p.field === "qr");
  const usesPhoto = allPh.some((p) => p.field === "photo");
  // The photo placeholder must be filled by the employee's uploaded picture.
  // If the template needs a photo and any selected employee has none, the
  // export is invalid — report who's missing so they can be fixed/deselected.
  if (usesPhoto) {
    const noPhoto = ordered
      .filter((u) => !u.userProfilePictures?.file_url)
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
  const EXTRA_FIELDS: Field[] = [
    "address",
    "birthday",
    "phone",
    "age",
    "civilStatus",
    "sex",
    "bloodType",
  ];
  const usesExtras = allPh.some((p) => EXTRA_FIELDS.includes(p.field));
  const base = (tempURL() || "").replace(/\/+$/, "");

  // build per-employee assets (QR + photo bytes + extras) once, reused on both sides
  interface Emp {
    fullName: string;
    position: string;
    office: string;
    nameScale: number;
    qr?: Buffer;
    photo?: Buffer;
    extras?: CardExtras;
  }
  const emps: Emp[] = [];
  for (const u of ordered) {
    const emp: Emp = {
      fullName: body.nameOverrides?.[u.id]?.trim() || fullNameOf(u),
      position:
        u.PositionSlot?.pos?.name || u.Position?.name || u.status || "",
      office:
        u.PositionSlot?.unitPosition?.unit?.name ||
        u.PositionSlot?.pos?.department?.name ||
        u.department?.name ||
        "",
      nameScale: Math.min(2, Math.max(0.4, body.nameScales?.[u.id] ?? 1)),
    };
    if (usesQR) {
      let code = u.verifyCode;
      if (!code) {
        code = randomUUID().replace(/-/g, "");
        await prisma.user.update({
          where: { id: u.id },
          data: { verifyCode: code },
        });
      }
      emp.qr = await QRCode.toBuffer(`${base}/verify-id?code=${code}`, {
        margin: 1,
        width: 1024, // high-res so the printed QR stays crisp at any size
        errorCorrectionLevel: "M",
      });
    }
    if (usesPhoto) {
      // prefer the bytea stored in Postgres; fall back to a URL (legacy)
      if (u.userProfilePictures?.bytes) {
        emp.photo = Buffer.from(u.userProfilePictures.bytes);
      } else if (u.userProfilePictures?.file_url) {
        try {
          const r = await fetch(u.userProfilePictures.file_url);
          if (r.ok) emp.photo = Buffer.from(await r.arrayBuffer());
        } catch {
          /* skip missing/unreachable photo */
        }
      }
    }
    if (usesExtras) emp.extras = await getCardExtras(u.id);
    emps.push(emp);
  }

  const extraText = (field: Field, e: Emp): string => {
    switch (field) {
      case "fullName":
        return e.fullName;
      case "position":
        return e.position;
      case "office":
        return e.office;
      case "address":
        return e.extras?.address ?? "";
      case "birthday":
        return e.extras?.birthday ?? "";
      case "phone":
        return e.extras?.phone ?? "";
      case "age":
        return e.extras?.age ?? "";
      case "civilStatus":
        return e.extras?.civilStatus ?? "";
      case "sex":
        return e.extras?.sex ?? "";
      case "bloodType":
        return e.extras?.bloodType ?? "";
      default:
        return "";
    }
  };

  const bgFront = tpl.front.image ? dataUrlToBuffer(tpl.front.image) : null;
  const bgRear = rearSide?.image ? dataUrlToBuffer(rearSide.image) : null;

  const buildPdf = (
    side: SideData,
    bg: Buffer | null,
    mirror: boolean,
  ): Promise<Buffer> =>
    new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: [pw, ph], margin: 0 });
      const chunks: Buffer[] = [];
      doc.on("data", (c: Buffer) => chunks.push(c));
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
        if (rLen > pw - mm2pt(8) || bottomGap < mm2pt(6)) return;
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
        doc.text(
          "100 mm reference — must measure 100 mm. If not, print at 100% / Actual size.",
          rx,
          ry - mm2pt(4.5),
          { lineBreak: false },
        );
        doc.restore();
      };

      emps.forEach((emp, i) => {
        const slot = i % perPage;
        if (slot === 0) {
          if (i > 0) doc.addPage({ size: [pw, ph], margin: 0 });
          if (paper.cutMarks) drawRuler();
        }
        const row = Math.floor(slot / cols);
        const col = slot % cols;
        // mirror the axis that the duplex flip happens on
        const placeCol =
          mirror && paper.flip === "long" ? cols - 1 - col : col;
        const placeRow =
          mirror && paper.flip === "short" ? rows - 1 - row : row;
        const x = startX + placeCol * (cw + gap);
        const y = startY + placeRow * (ch + gap);

        if (bgImg) {
          try {
            doc.image(bgImg, x, y, { width: cw, height: ch });
          } catch {
            /* ignore bad image */
          }
        }
        for (const p of side.placeholders) {
          const centerX = x + (p.xPct / 100) * cw;
          const centerY = y + (p.yPct / 100) * ch;
          if (p.field === "qr") {
            if (!emp.qr) continue;
            const s = (p.size ?? 70) * scale;
            try {
              doc.image(emp.qr, centerX - s / 2, centerY - s / 2, {
                width: s,
                height: s,
              });
            } catch {
              /* ignore */
            }
          } else if (p.field === "photo") {
            if (!emp.photo) continue;
            const w = (p.size ?? 90) * scale;
            const h = (p.height ?? 110) * scale;
            try {
              doc.image(emp.photo, centerX - w / 2, centerY - h / 2, {
                cover: [w, h],
                align: "center",
                valign: "center",
              });
            } catch {
              /* ignore */
            }
          } else {
            const text = extraText(p.field, emp);
            if (!text) continue;
            // the name can be shrunk per-employee (long names)
            const fieldScale = p.field === "fullName" ? emp.nameScale : 1;
            const sizePt = p.fontSize * scale * fieldScale;
            doc
              .font(pdfFont(p.fontFamily, !!p.bold))
              .fontSize(sizePt)
              .fillColor(safeColor(p.color));
            const sw = (p.strokeWidth ?? 0) * scale;
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
              doc.text(text, centerX - boxW / 2, centerY - h / 2, {
                ...draw,
                width: boxW,
                align: "center",
                lineBreak: true,
              });
            } else {
              const tw = doc.widthOfString(text);
              const th = doc.currentLineHeight();
              doc.text(text, centerX - tw / 2, centerY - th / 2, {
                ...draw,
                lineBreak: false,
              });
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

  const front = await buildPdf(tpl.front, bgFront, false);
  const rear =
    rearSide && bgRear ? await buildPdf(rearSide, bgRear, true) : null;

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
};

/**
 * GET /user/my-verify-qr — the logged-in employee's identity-QR payload for
 * the mobile app's profile screen. Returns the SAME verify URL the printed
 * ID cards encode (`{base}/verify-id?code=<verifyCode>`), generating and
 * persisting the user's verifyCode on first use. The mobile caches the URL
 * locally and renders the QR fully offline afterwards.
 */
export const myVerifyQr = async (req: FastifyRequest, res: FastifyReply) => {
  const accountId = (req.user as { id?: string } | undefined)?.id;
  if (!accountId) return res.code(401).send({ error: "Unauthorized" });

  const account = await prisma.account.findUnique({
    where: { id: accountId },
    select: { User: { select: { id: true, verifyCode: true } } },
  });
  const user = account?.User;
  if (!user) throw new ValidationError("NO_USER_FOR_ACCOUNT");

  let code = user.verifyCode;
  if (!code) {
    code = randomUUID().replace(/-/g, "");
    await prisma.user.update({
      where: { id: user.id },
      data: { verifyCode: code },
    });
  }

  const base = (tempURL() || "").replace(/\/+$/, "");
  return res.code(200).send({ code, url: `${base}/verify-id?code=${code}` });
};
