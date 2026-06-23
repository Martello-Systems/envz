import { summarize } from "./summarize.js";

/**
 * Build a structured, machine-readable report of a workspace's env health.
 *
 * This is the single source of truth for both the human-readable `check`
 * output and the `--json` output, so the two can never disagree.
 *
 * @param {string} root absolute workspace root
 * @param {{ allowEmpty?: boolean, failOnExtra?: boolean }} [opts]
 * @returns {Promise<{
 *   ok: boolean,
 *   root: string,
 *   summary: { packages: number, missing: number, empty: number, extra: number, driftedPackages: number },
 *   failures: number,
 *   options: { allowEmpty: boolean, failOnExtra: boolean },
 *   packages: {
 *     name: string, relDir: string, isRoot: boolean,
 *     hasExample: boolean, hasEnv: boolean,
 *     exampleFile: string|null, envFile: string|null,
 *     missing: string[], empty: string[], extra: string[], present: string[]
 *   }[]
 * }>}
 */
export async function checkReport(root, opts = {}) {
  const { allowEmpty = false, failOnExtra = false } = opts;
  const summary = await summarize(root);

  let failures = 0;
  const packages = [];

  for (const pkg of summary.analysis.packages) {
    const d = pkg.diff;
    const missing = d ? d.missing : [];
    const empty = d ? d.empty : [];
    const extra = d ? d.extra : [];
    const present = d ? d.present : [];

    packages.push({
      name: pkg.name,
      relDir: pkg.relDir,
      isRoot: pkg.isRoot,
      hasExample: pkg.hasExample,
      hasEnv: pkg.hasEnv,
      exampleFile: pkg.exampleFile,
      envFile: pkg.envFile,
      missing,
      empty,
      extra,
      present,
    });

    failures += missing.length;
    if (!allowEmpty) failures += empty.length;
    if (failOnExtra) failures += extra.length;
  }

  return {
    ok: failures === 0,
    root: summary.root,
    summary: {
      packages: summary.packageCount,
      missing: summary.missingTotal,
      empty: summary.emptyTotal,
      extra: summary.extraTotal,
      driftedPackages: summary.driftedPackages,
    },
    failures,
    options: { allowEmpty, failOnExtra },
    packages,
  };
}

/**
 * Run a non-interactive check over a workspace and produce a human-readable
 * report plus an exit-worthy `ok` flag. By default any MISSING or EMPTY
 * required key fails the check.
 *
 * @param {string} root absolute workspace root
 * @param {{ allowEmpty?: boolean, failOnExtra?: boolean }} [opts]
 * @returns {Promise<{ ok: boolean, lines: string[], report: Awaited<ReturnType<typeof checkReport>> }>}
 */
export async function check(root, opts = {}) {
  const { allowEmpty = false, failOnExtra = false } = opts;
  const report = await checkReport(root, opts);
  const lines = [];

  lines.push(
    `envz check: ${report.summary.packages} package${report.summary.packages === 1 ? "" : "s"}, ` +
      `${report.summary.missing} missing key${report.summary.missing === 1 ? "" : "s"}, ` +
      `${report.summary.driftedPackages} package${report.summary.driftedPackages === 1 ? "" : "s"} drifted`
  );
  lines.push("");

  for (const pkg of report.packages) {
    if (!pkg.hasExample && !pkg.hasEnv) {
      lines.push(`  ${label(pkg)}  (no env files)`);
      continue;
    }
    const { missing, empty, extra } = pkg;
    const issues = [];
    if (missing.length) issues.push(`${missing.length} missing`);
    if (empty.length) issues.push(`${empty.length} empty`);
    if (extra.length) issues.push(`${extra.length} extra`);

    const status = issues.length ? issues.join(", ") : "ok";
    lines.push(`  ${label(pkg)}  ${status}`);

    for (const k of missing) lines.push(`      - missing: ${k}`);
    if (!allowEmpty) for (const k of empty) lines.push(`      - empty:   ${k}`);
    if (failOnExtra) for (const k of extra) lines.push(`      - extra:   ${k}`);
  }

  lines.push("");
  lines.push(
    report.ok ? "PASS — all required keys satisfied." : `FAIL — ${report.failures} issue(s).`
  );

  return { ok: report.ok, lines, report };
}

function label(pkg) {
  const tag = pkg.isRoot ? "(root)" : pkg.relDir;
  return `${pkg.name} [${tag}]`.padEnd(40);
}
