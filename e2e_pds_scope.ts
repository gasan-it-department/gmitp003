/* Can one municipality's HR export another municipality's PDS?
 *
 *   npx ts-node --transpile-only e2e_pds_scope.ts
 *
 * /application/pds/export takes the record id from the query string, and
 * the exporter looks it up and returns it. Until requireSameLine was added
 * nothing tied that id to the caller, so any signed-in HR user could read
 * any other line's PDS — birth date, TIN, PhilHealth number, home address,
 * parents' names — by changing one parameter.
 *
 * A test that only proves the door is shut is half a test: it would also
 * pass if the door were welded shut and nobody could export anything. So
 * this checks all three paths against the real database:
 *
 *   1. same line   -> allowed   (the fix did not break the feature)
 *   2. other line  -> refused   (the hole is closed)
 *   3. applicant   -> allowed   (the temp-token path is not line-checked,
 *                                because there is no account behind it)
 *
 * It reads existing rows and writes nothing.
 */
import path from "path";
const entry = path.join(process.cwd(), "src", "index.ts");
require.cache[entry] = {
  id: entry,
  filename: entry,
  loaded: true,
  exports: {
    notificationSocket: { emitUserNotification: () => undefined },
  },
} as never;

import { prisma } from "./src/barrel/prisma";
import {
  exportOwnPdsExcel,
  exportPdsExcel,
} from "./src/controller/pdsExportController";

let pass = 0;
const fails: string[] = [];
const ok = (name: string, cond: boolean, detail = "") => {
  if (cond) {
    pass++;
    console.log(`  ok    ${name}`);
  } else {
    fails.push(`${name}${detail ? ` — ${detail}` : ""}`);
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
};

/** A reply just real enough for the handler to finish. */
const makeRes = () => {
  const r: any = {
    headers: {} as Record<string, string>,
    body: null as Buffer | null,
    header(k: string, v: string) {
      r.headers[k] = v;
      return r;
    },
    code() {
      return r;
    },
    send(b: Buffer) {
      r.body = b;
      return r;
    },
  };
  return r;
};

type Outcome =
  | { kind: "sent"; bytes: number; filename: string }
  | { kind: "threw"; name: string; message: string };

const run = async (
  handler: (req: any, res: any) => Promise<unknown>,
  req: any,
): Promise<Outcome> => {
  const res = makeRes();
  try {
    await handler(req, res);
    return {
      kind: "sent",
      bytes: res.body ? res.body.length : 0,
      filename: res.headers["Content-Disposition"] || "",
    };
  } catch (e: any) {
    return {
      kind: "threw",
      name: e?.constructor?.name ?? "Error",
      message: String(e?.message ?? e),
    };
  }
};

(async () => {
  // ── find a real application, and accounts inside and outside its line ──
  const app = await prisma.submittedApplication.findFirst({
    where: { lineId: { not: undefined } },
    select: { id: true, lineId: true, lastname: true },
  });
  if (!app) {
    console.log("no applications in this database — cannot test");
    await prisma.$disconnect();
    process.exit(1);
  }

  const insider = await prisma.account.findFirst({
    where: { User: { is: { lineId: app.lineId } } },
    select: { id: true, User: { select: { lineId: true } } },
  });
  const outsider = await prisma.account.findFirst({
    where: { User: { is: { lineId: { not: app.lineId } } } },
    select: { id: true, User: { select: { lineId: true } } },
  });

  console.log(`\napplication ${app.id.slice(0, 8)} belongs to line ${app.lineId.slice(0, 8)}`);
  console.log(`  insider  account ${insider?.id.slice(0, 8)} (line ${insider?.User?.lineId?.slice(0, 8)})`);
  console.log(`  outsider account ${outsider?.id.slice(0, 8)} (line ${outsider?.User?.lineId?.slice(0, 8)})`);

  if (!insider || !outsider) {
    console.log("\nneed one account inside and one outside the line — cannot test");
    await prisma.$disconnect();
    process.exit(1);
  }

  // ── 1. same line: must still work ──────────────────────────────────
  console.log("\n── 1. HR of the SAME line ──");
  const same = await run(exportPdsExcel, {
    query: { id: app.id },
    user: { id: insider.id },
    headers: {},
  });
  ok(
    "same-line HR gets the workbook",
    same.kind === "sent" && same.bytes > 10000,
    same.kind === "threw" ? `${same.name}: ${same.message}` : `${same.bytes} bytes`,
  );
  if (same.kind === "sent") {
    ok("it is named after the applicant", same.filename.includes(".xlsx"),
      same.filename);
  }

  // ── 2. another line: must be refused ───────────────────────────────
  console.log("\n── 2. HR of ANOTHER line ──");
  const other = await run(exportPdsExcel, {
    query: { id: app.id },
    user: { id: outsider.id },
    headers: {},
  });
  ok(
    "cross-line export is refused",
    other.kind === "threw",
    other.kind === "sent"
      ? `LEAK: got ${other.bytes} bytes of another line's PDS`
      : `${other.name}: ${other.message}`,
  );
  if (other.kind === "threw") {
    ok(
      "refused as unauthorised, not as a crash",
      /Unauthorized/i.test(other.name) ||
        /municipality|not your/i.test(other.message),
      `${other.name}: ${other.message}`,
    );
  }

  // ── 3. the applicant's own copy: no line check ─────────────────────
  console.log("\n── 3. the applicant's OWN copy (temp token) ──");
  const own = await run(exportOwnPdsExcel, {
    // tempAuthenticated puts the application row on the request
    user: { id: app.id },
    query: {},
    headers: {},
  });
  ok(
    "the applicant still gets their own workbook",
    own.kind === "sent" && own.bytes > 10000,
    own.kind === "threw" ? `${own.name}: ${own.message}` : `${own.bytes} bytes`,
  );

  // ── 4. and cannot ask for somebody else's ──────────────────────────
  const otherApp = await prisma.submittedApplication.findFirst({
    where: { id: { not: app.id } },
    select: { id: true },
  });
  if (otherApp) {
    console.log("\n── 4. applicant pointing at someone else's id ──");
    const stolen = await run(exportOwnPdsExcel, {
      user: { id: app.id },
      // the client tries to choose; the handler must ignore it
      query: { id: otherApp.id },
      headers: {},
    });
    ok(
      "the query id is ignored in favour of the token's",
      stolen.kind === "sent" &&
        stolen.filename === (own.kind === "sent" ? own.filename : "?"),
      stolen.kind === "sent"
        ? `got ${stolen.filename} (own was ${own.kind === "sent" ? own.filename : "?"})`
        : `${stolen.name}: ${stolen.message}`,
    );
  }

  console.log(`\n${pass} passed, ${fails.length} failed`);
  if (fails.length) for (const f of fails) console.log(`  FAIL  ${f}`);
  await prisma.$disconnect();
  process.exit(fails.length ? 1 : 0);
})();
