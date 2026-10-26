/* Run the end-to-end suite and say plainly what broke.
 *
 *   npm run e2e                 # everything
 *   npm run e2e -- --only=pds   # just the ones whose name contains "pds"
 *   npm run e2e -- --list       # name them and stop
 *
 * There were 74 of these files and no way to run them together, so they
 * were run one at a time by hand — which is to say, mostly not run at
 * all. Thirteen had been failing for days before anyone looked.
 *
 * Each file is a standalone script that exits non-zero on failure, so the
 * runner stays dumb on purpose: spawn, read the exit code, scrape the
 * "N passed, M failed" line if there is one. No framework to adopt, no
 * rewriting 74 files to earn a summary.
 *
 * Some tests need a live local API on :3000 and are skipped by default —
 * they fail for want of a server, not a bug, and a suite that cries wolf
 * is one people stop reading. --with-server includes them.
 */
import { spawn } from "child_process";
import fs from "fs";
import path from "path";

const ROOT = process.cwd();

/** Tests that talk to a running API rather than the database directly. */
const NEEDS_SERVER = new Set([
  "e2e_invite_once.ts",
  "e2e_jobpost_reg.ts",
  "e2e_mobile_upload.ts",
  "e2e_quickreg.ts",
]);

const argOf = (name: string) =>
  (process.argv.find((a) => a.startsWith(`--${name}=`)) || "").split("=")[1];

const ONLY = argOf("only");
const LIST = process.argv.includes("--list");
const WITH_SERVER = process.argv.includes("--with-server");
const BAIL = process.argv.includes("--bail");
const TIMEOUT_MS = Number(argOf("timeout") || 420_000);

const files = fs
  .readdirSync(ROOT)
  .filter((f) => /^e2e_.*\.ts$/.test(f))
  .filter((f) => (ONLY ? f.includes(ONLY) : true))
  .filter((f) => (WITH_SERVER ? true : !NEEDS_SERVER.has(f)))
  .sort();

if (LIST) {
  for (const f of files) console.log(f);
  process.exit(0);
}

interface Outcome {
  file: string;
  code: number | null;
  passed: number | null;
  failed: number | null;
  ms: number;
  timedOut: boolean;
  firstFailure: string | null;
}

/** Scrape whatever the script chose to print; they are not uniform. */
const scrape = (out: string) => {
  const m =
    out.match(/(\d+)\s+passed,\s*(\d+)\s+failed/i) ||
    out.match(/RESULT:\s*(\d+)\s+passed,\s*(\d+)\s+failed/i);
  const fail =
    out.match(/^\s*FAIL\s+(.*)$/m) || out.match(/^\s*✗\s+(.*)$/m) || null;
  return {
    passed: m ? Number(m[1]) : null,
    failed: m ? Number(m[2]) : null,
    firstFailure: fail ? fail[1].trim().slice(0, 100) : null,
  };
};

const run = (file: string): Promise<Outcome> =>
  new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(
      process.platform === "win32" ? "npx.cmd" : "npx",
      ["ts-node", "--transpile-only", file],
      { cwd: ROOT, shell: process.platform === "win32" },
    );
    let out = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, TIMEOUT_MS);

    child.stdout.on("data", (d) => (out += d.toString()));
    child.stderr.on("data", (d) => (out += d.toString()));
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({
        file,
        code,
        ms: Date.now() - started,
        timedOut,
        ...scrape(out),
      });
    });
  });

(async () => {
  console.log(
    `${files.length} test file(s)` +
      (WITH_SERVER ? "" : `, ${NEEDS_SERVER.size} skipped (need a local API)`) +
      "\n",
  );

  const results: Outcome[] = [];
  for (const file of files) {
    const r = await run(file);
    results.push(r);
    const ok = r.code === 0 && !r.timedOut;
    const counts =
      r.passed !== null ? `${r.passed}/${r.passed + (r.failed ?? 0)}` : "—";
    console.log(
      `${ok ? "PASS" : "FAIL"}  ${file.padEnd(34)} ${counts.padStart(7)}  ` +
        `${String(Math.round(r.ms / 1000)).padStart(3)}s` +
        (r.timedOut ? "  TIMED OUT" : "") +
        (!ok && r.firstFailure ? `\n        ${r.firstFailure}` : ""),
    );
    if (BAIL && !ok) break;
  }

  const failed = results.filter((r) => r.code !== 0 || r.timedOut);
  const checks = results.reduce((a, r) => a + (r.passed ?? 0), 0);

  console.log(
    `\n${results.length - failed.length}/${results.length} files passed` +
      `, ${checks} individual checks`,
  );
  if (failed.length) {
    console.log("\nFailing files:");
    for (const f of failed) {
      console.log(
        `  ${f.file}${f.timedOut ? " (timed out)" : ""}` +
          (f.firstFailure ? ` — ${f.firstFailure}` : ""),
      );
    }
  }
  /*
    A non-zero exit is the whole point: without it this is just another
    script somebody runs occasionally and ignores.
  */
  process.exit(failed.length ? 1 : 0);
})();
