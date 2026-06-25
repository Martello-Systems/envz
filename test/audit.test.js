import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { auditCommittedSecrets, formatAudit } from "../src/audit.js";

const execFileP = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.join(__dirname, "..", "bin", "envz.js");

/** A throwaway git repo with a known mix of env files. */
async function gitWorkspace() {
  const dir = await mkdtemp(path.join(tmpdir(), "envz-audit-"));
  await execFileP("git", ["-C", dir, "init", "-q"]);
  await execFileP("git", ["-C", dir, "config", "user.email", "t@example.com"]);
  await execFileP("git", ["-C", dir, "config", "user.name", "Test"]);
  // neutralize any global excludesFile so the test's .gitignore is authoritative
  await writeFile(path.join(dir, ".empty-excludes"), "");
  await execFileP("git", ["-C", dir, "config", "core.excludesFile", path.join(dir, ".empty-excludes")]);

  await writeFile(path.join(dir, "package.json"), JSON.stringify({ name: "root" }) + "\n");
  await writeFile(path.join(dir, ".gitignore"), ".env.local\n");

  // tracked real secret -> at risk (tracked)
  await writeFile(path.join(dir, ".env"), "API_KEY=real-secret\n");
  // template -> skipped entirely (meant to be committed)
  await writeFile(path.join(dir, ".env.example"), "API_KEY=\n");
  // gitignored + untracked -> safe
  await writeFile(path.join(dir, ".env.local"), "API_KEY=local-secret\n");
  // untracked AND not gitignored -> at risk (not gitignored)
  await writeFile(path.join(dir, ".env.production"), "DB_URL=postgres://x\n");

  await execFileP("git", ["-C", dir, "add", ".env", ".env.example", ".gitignore", "package.json"]);
  return dir;
}

test("auditCommittedSecrets flags tracked and un-ignored env files, ignores safe ones", async () => {
  const dir = await gitWorkspace();
  try {
    const report = await auditCommittedSecrets(dir);
    assert.equal(report.gitRepo, true);
    assert.equal(report.ok, false);
    assert.equal(report.scanned, 3); // .env, .env.local, .env.production (.env.example skipped)

    const byPath = Object.fromEntries(report.atRisk.map((f) => [f.relPath, f]));
    const flagged = Object.keys(byPath).sort();
    assert.deepEqual(flagged, [".env", ".env.production"]);

    assert.equal(byPath[".env"].tracked, true);
    assert.equal(byPath[".env"].reason, "tracked by git");
    assert.equal(byPath[".env.production"].tracked, false);
    assert.equal(byPath[".env.production"].ignored, false);
    assert.equal(byPath[".env.production"].reason, "not gitignored");

    // .env.local is gitignored + untracked -> never flagged
    assert.ok(!byPath[".env.local"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("auditCommittedSecrets is clean when every real env file is gitignored", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "envz-audit-clean-"));
  try {
    await execFileP("git", ["-C", dir, "init", "-q"]);
    await writeFile(path.join(dir, ".empty-excludes"), "");
    await execFileP("git", ["-C", dir, "config", "core.excludesFile", path.join(dir, ".empty-excludes")]);
    await writeFile(path.join(dir, "package.json"), JSON.stringify({ name: "root" }) + "\n");
    await writeFile(path.join(dir, ".gitignore"), ".env\n.env.*\n!.env.example\n");
    await writeFile(path.join(dir, ".env"), "SECRET=value\n");
    await writeFile(path.join(dir, ".env.example"), "SECRET=\n");

    const report = await auditCommittedSecrets(dir);
    assert.equal(report.ok, true);
    assert.deepEqual(report.atRisk, []);
    assert.equal(report.scanned, 1); // only .env has real values
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("auditCommittedSecrets degrades cleanly outside a git repo", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "envz-audit-nogit-"));
  try {
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "package.json"), JSON.stringify({ name: "root" }) + "\n");
    await writeFile(path.join(dir, ".env"), "SECRET=value\n");

    const report = await auditCommittedSecrets(dir);
    assert.equal(report.gitRepo, false);
    assert.equal(report.ok, true);
    assert.deepEqual(report.atRisk, []);

    const lines = formatAudit(report);
    assert.match(lines.join("\n"), /not a git repository/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("envz audit exits non-zero and reports the at-risk file on the CLI", async () => {
  const dir = await gitWorkspace();
  try {
    let stdout, code;
    try {
      const res = await execFileP(process.execPath, [BIN, "audit", dir]);
      stdout = res.stdout;
      code = 0;
    } catch (err) {
      stdout = err.stdout;
      code = err.code;
    }
    assert.equal(code, 1, "non-zero exit when a secret is committable");
    assert.match(stdout, /\.env/);
    assert.match(stdout, /at risk/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("envz audit --json emits a machine-readable report", async () => {
  const dir = await gitWorkspace();
  try {
    let stdout;
    try {
      const res = await execFileP(process.execPath, [BIN, "audit", dir, "--json"]);
      stdout = res.stdout;
    } catch (err) {
      stdout = err.stdout;
    }
    const parsed = JSON.parse(stdout);
    assert.equal(parsed.gitRepo, true);
    assert.equal(parsed.ok, false);
    assert.ok(Array.isArray(parsed.atRisk));
    assert.ok(parsed.atRisk.some((f) => f.relPath === ".env"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
