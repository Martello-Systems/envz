import { summarize, headline } from "./summarize.js";

/**
 * Run a non-interactive check over a workspace and produce a report plus an
 * exit code. By default any MISSING or EMPTY required key fails the check
 * (these are keys declared in a `.env.example` that aren't satisfied).
 *
 * @param {string} root absolute workspace root
 * @param {{ allowEmpty?: boolean, failOnExtra?: boolean }} [opts]
 * @returns {Promise<{ ok: boolean, lines: string[], summary: Awaited<ReturnType<typeof summarize>> }>}
 */
export async function check(root, opts = {}) {
  const { allowEmpty = false, failOnExtra = false } = opts;
  const summary = await summarize(root);
  const lines = [];

  lines.push(`envz check: ${headline(summary)}`);
  lines.push("");

  let failures = 0;

  for (const pkg of summary.analysis.packages) {
    if (!pkg.diff) {
      lines.push(`  ${label(pkg)}  (no env files)`);
      continue;
    }
    const { missing, empty, extra } = pkg.diff;
    const issues = [];
    if (missing.length) issues.push(`${missing.length} missing`);
    if (empty.length) issues.push(`${empty.length} empty`);
    if (extra.length) issues.push(`${extra.length} extra`);

    const status = issues.length ? issues.join(", ") : "ok";
    lines.push(`  ${label(pkg)}  ${status}`);

    for (const k of missing) lines.push(`      - missing: ${k}`);
    if (!allowEmpty) for (const k of empty) lines.push(`      - empty:   ${k}`);
    if (failOnExtra) for (const k of extra) lines.push(`      - extra:   ${k}`);

    failures += missing.length;
    if (!allowEmpty) failures += empty.length;
    if (failOnExtra) failures += extra.length;
  }

  lines.push("");
  const ok = failures === 0;
  lines.push(ok ? "PASS — all required keys satisfied." : `FAIL — ${failures} issue(s).`);

  return { ok, lines, summary };
}

function label(pkg) {
  const tag = pkg.isRoot ? "(root)" : pkg.relDir;
  return `${pkg.name} [${tag}]`.padEnd(40);
}
