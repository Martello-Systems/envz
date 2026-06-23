import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { checkReport } from "../src/check.js";

const execFileP = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "fixtures", "monorepo");
const CLEAN_ROOT = path.join(__dirname, "fixtures", "profiles");
const BIN = path.join(__dirname, "..", "bin", "envz.js");

test("checkReport emits a stable machine-readable shape", async () => {
  const r = await checkReport(ROOT);
  assert.equal(r.ok, false);
  assert.equal(typeof r.root, "string");
  assert.equal(r.summary.packages, 3);
  assert.equal(r.summary.missing, 1);
  assert.equal(r.summary.empty, 1);
  assert.equal(r.summary.extra, 2);
  assert.equal(r.summary.driftedPackages, 3);
  assert.equal(r.failures, 2); // 1 missing + 1 empty (allowEmpty=false)
  assert.deepEqual(r.options, { allowEmpty: false, failOnExtra: false });

  const web = r.packages.find((p) => p.relDir === "packages/web");
  assert.deepEqual(web.missing, ["ANALYTICS_KEY"]);
  assert.deepEqual(web.empty, ["FEATURE_FLAG_BETA"]);
  assert.equal(web.hasExample, true);
  assert.equal(web.hasEnv, true);
  assert.equal(web.envFile, "packages/web/.env");
  assert.equal(web.exampleFile, "packages/web/.env.example");

  // JSON-serializable (no functions, no undefined that break round-trip)
  const round = JSON.parse(JSON.stringify(r));
  assert.deepEqual(round.summary, r.summary);
});

test("checkReport honors allowEmpty and failOnExtra in the failure count", async () => {
  const allowEmpty = await checkReport(ROOT, { allowEmpty: true });
  assert.equal(allowEmpty.failures, 1); // only the missing key counts now
  assert.equal(allowEmpty.ok, false);

  const failOnExtra = await checkReport(ROOT, { failOnExtra: true });
  assert.equal(failOnExtra.failures, 4); // 1 missing + 1 empty + 2 extra
});

test("checkReport on a clean workspace is ok with zero failures", async () => {
  const r = await checkReport(CLEAN_ROOT);
  assert.equal(r.ok, true);
  assert.equal(r.failures, 0);
});

test("envz check --json exits 1 and prints valid JSON on drift", async () => {
  let stdout, code;
  try {
    const res = await execFileP(process.execPath, [BIN, "check", ROOT, "--json"]);
    stdout = res.stdout;
    code = 0;
  } catch (err) {
    stdout = err.stdout;
    code = err.code;
  }
  assert.equal(code, 1, "non-zero exit on drift");
  const parsed = JSON.parse(stdout);
  assert.equal(parsed.ok, false);
  assert.equal(parsed.summary.missing, 1);
});

test("envz check --json exits 0 on a clean workspace", async () => {
  const { stdout } = await execFileP(process.execPath, [BIN, "check", CLEAN_ROOT, "--json"]);
  const parsed = JSON.parse(stdout);
  assert.equal(parsed.ok, true);
});

test("envz check --json --allow-empty drops empty from failures", async () => {
  let stdout, code;
  try {
    const res = await execFileP(process.execPath, [
      BIN,
      "check",
      ROOT,
      "--json",
      "--allow-empty",
    ]);
    stdout = res.stdout;
    code = 0;
  } catch (err) {
    stdout = err.stdout;
    code = err.code;
  }
  const parsed = JSON.parse(stdout);
  assert.equal(parsed.options.allowEmpty, true);
  assert.equal(parsed.failures, 1); // only missing remains
  assert.equal(code, 1);
});

test("envz check on a non-existent path errors cleanly (no stack trace)", async () => {
  let stderr, code;
  try {
    await execFileP(process.execPath, [BIN, "check", path.join(ROOT, "does-not-exist")]);
    code = 0;
  } catch (err) {
    stderr = err.stderr;
    code = err.code;
  }
  assert.equal(code, 1);
  assert.match(stderr, /path not found/);
  assert.doesNotMatch(stderr, /at .*\(.*:\d+:\d+\)/); // no JS stack frames
});
