import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { discover, toPosix } from "./discover.js";
import { parseEnv } from "./parse.js";

const execFileP = promisify(execFile);

/**
 * Run a git command inside `root`. Never throws: a non-zero exit (e.g.
 * `check-ignore` with no matches) or a missing git binary resolves to
 * `{ ok:false, stdout:"" }` so callers can treat it as "no information".
 * @param {string} root
 * @param {string[]} gitArgs
 * @returns {Promise<{ ok: boolean, stdout: string }>}
 */
async function git(root, gitArgs) {
  try {
    const { stdout } = await execFileP("git", ["-C", root, ...gitArgs], {
      windowsHide: true,
      maxBuffer: 16 * 1024 * 1024,
    });
    return { ok: true, stdout };
  } catch (err) {
    return { ok: false, stdout: (err && err.stdout) || "" };
  }
}

/** Is `root` inside a git work tree? */
async function isGitRepo(root) {
  const r = await git(root, ["rev-parse", "--is-inside-work-tree"]);
  return r.ok && r.stdout.trim() === "true";
}

/** Set of the given relative paths that git currently tracks. */
async function trackedSet(root, relPaths) {
  if (relPaths.length === 0) return new Set();
  const r = await git(root, ["ls-files", "-z", "--", ...relPaths]);
  return new Set(r.stdout.split("\0").filter(Boolean).map(toPosix));
}

/** Set of the given relative paths that git would ignore (.gitignore-aware). */
async function ignoredSet(root, relPaths) {
  if (relPaths.length === 0) return new Set();
  // `check-ignore` prints one ignored path per line and exits 1 when nothing
  // matches; git() swallows that non-zero exit to stdout "". (`-z` is rejected
  // here unless paired with --stdin, so we parse newlines.)
  const r = await git(root, ["check-ignore", "--", ...relPaths]);
  return new Set(
    r.stdout
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .map(toPosix)
  );
}

async function safeRead(p) {
  try {
    return await readFile(p, "utf8");
  } catch {
    return null;
  }
}

/**
 * Audit a workspace for `.env*` files that carry REAL values and are also
 * committable — i.e. tracked by git, or not covered by `.gitignore`. Template
 * files (`.env.example` / `.sample` / `.template` / `.dist`) are skipped; they
 * are meant to be committed and hold placeholders, not secrets.
 *
 * This is the ".env tooling" angle on the classic "did a secret get committed?"
 * mistake: a real `.env` that git is tracking, or one sitting un-ignored where
 * the next `git add .` will sweep it in.
 *
 * @param {string} root absolute workspace root
 * @returns {Promise<{
 *   ok: boolean,
 *   root: string,
 *   gitRepo: boolean,
 *   scanned: number,
 *   atRisk: { relPath: string, valueCount: number, tracked: boolean, ignored: boolean, reason: string }[]
 * }>}
 */
export async function auditCommittedSecrets(root) {
  const abs = path.resolve(root);
  const { packages } = await discover(abs);

  // collect real (non-template) env files that actually hold a non-empty value
  const candidates = [];
  for (const pkg of packages) {
    for (const f of pkg.envFiles) {
      if (f.isExample) continue;
      const parsed = parseEnv((await safeRead(f.path)) ?? "");
      const valued = parsed.keys.filter((k) => parsed.values[k] !== "");
      if (valued.length === 0) continue;
      candidates.push({ relPath: toPosix(f.relPath), valueCount: valued.length });
    }
  }

  const gitRepo = await isGitRepo(abs);
  if (!gitRepo) {
    // Outside a git work tree we can't know what's tracked/ignored — report
    // cleanly rather than guessing.
    return { ok: true, root: abs, gitRepo: false, scanned: candidates.length, atRisk: [] };
  }

  const rels = candidates.map((c) => c.relPath);
  const tracked = await trackedSet(abs, rels);
  const ignored = await ignoredSet(abs, rels);

  const atRisk = [];
  for (const c of candidates) {
    const isTracked = tracked.has(c.relPath);
    const isIgnored = ignored.has(c.relPath);
    if (!isTracked && isIgnored) continue; // ignored and untracked: safe
    atRisk.push({
      relPath: c.relPath,
      valueCount: c.valueCount,
      tracked: isTracked,
      ignored: isIgnored,
      reason: isTracked ? "tracked by git" : "not gitignored",
    });
  }

  return { ok: atRisk.length === 0, root: abs, gitRepo: true, scanned: candidates.length, atRisk };
}

/**
 * Render an audit report as human-readable lines for the CLI.
 * @param {Awaited<ReturnType<typeof auditCommittedSecrets>>} report
 * @returns {string[]}
 */
export function formatAudit(report) {
  const lines = [];
  if (!report.gitRepo) {
    lines.push("envz audit: not a git repository — cannot check tracked/ignored status.");
    lines.push(`Scanned ${report.scanned} env file(s) with real values.`);
    return lines;
  }

  lines.push(
    `envz audit: scanned ${report.scanned} env file${report.scanned === 1 ? "" : "s"} with real values, ` +
      `${report.atRisk.length} at risk of being committed`
  );
  lines.push("");

  if (report.atRisk.length === 0) {
    lines.push("PASS: no env files with real values are tracked or un-gitignored.");
    return lines;
  }

  for (const f of report.atRisk) {
    lines.push(`  ✗ ${f.relPath}  (${f.valueCount} value${f.valueCount === 1 ? "" : "s"}, ${f.reason})`);
  }
  lines.push("");
  lines.push(
    `FAIL: ${report.atRisk.length} env file(s) with real values are committable. ` +
      "Add them to .gitignore (and `git rm --cached` if already tracked)."
  );
  return lines;
}
