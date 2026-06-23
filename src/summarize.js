import { readFile } from "node:fs/promises";
import { parseEnv } from "./parse.js";
import { diff } from "./diff.js";
import { discover } from "./discover.js";
import {
  classifyEnvFile,
  effectiveValues,
  templateForProfile,
  profilesPresent,
  precedenceOrder,
  DEFAULT_PROFILE,
} from "./profiles.js";

/**
 * Pick the "primary" example file and the "primary" real env file for a package.
 * Convention: `.env.example` is the canonical template; `.env` is the canonical
 * real file. Falls back to the first example / first non-example present.
 *
 * Retained for the programmatic API and as the default-profile primary picker.
 * @param {import("./discover.js").EnvFile[]} envFiles
 */
export function pickPrimary(envFiles) {
  const example =
    envFiles.find((f) => f.name === ".env.example") ||
    envFiles.find((f) => f.isExample) ||
    null;
  const env =
    envFiles.find((f) => f.name === ".env") ||
    envFiles.find((f) => !f.isExample) ||
    null;
  return { example, env };
}

async function safeRead(p) {
  try {
    return await readFile(p, "utf8");
  } catch {
    return null;
  }
}

/**
 * Diff every profile of a package using the explicit precedence rules in
 * profiles.js. For each profile we layer its real files (e.g. `.env` then
 * `.env.local`) into one effective value map and diff that against the
 * profile's template (`.env.<p>.example` else `.env.example`).
 *
 * @param {import("./discover.js").EnvFile[]} envFiles
 * @returns {Promise<{
 *   profile: string,
 *   templateFile: string|null,
 *   layers: string[],
 *   diff: ReturnType<typeof diff>
 * }[]>}
 */
async function diffProfiles(envFiles) {
  const classified = envFiles
    .map((f) => ({ file: f, cls: classifyEnvFile(f.name) }))
    .filter((c) => c.cls);
  const classes = classified.map((c) => c.cls);

  // filename -> parsed values, read once
  const valuesByFile = {};
  for (const { file } of classified) {
    valuesByFile[file.name] = parseEnv((await safeRead(file.path)) ?? "").values;
  }
  // filename -> EnvFile (for relPaths)
  const fileByName = Object.fromEntries(classified.map((c) => [c.file.name, c.file]));

  const out = [];
  for (const profile of profilesPresent(classes)) {
    const tmpl = templateForProfile(classes, profile);
    // does this profile have any real (non-template) file?
    const hasReal = classes.some((c) => !c.isTemplate && c.profile === profile);
    // skip a profile that is ONLY a template with no default real layers either
    if (!tmpl && !hasReal) continue;

    const { values, keys, layers } = effectiveValues(
      profile,
      // only real files participate in effective values
      Object.fromEntries(
        Object.entries(valuesByFile).filter(([name]) => {
          const c = classifyEnvFile(name);
          return c && !c.isTemplate;
        })
      )
    );

    const envParsed = { values, keys };
    const exampleParsed = tmpl
      ? parseEnv((await safeRead(fileByName[tmpl.name].path)) ?? "")
      : { keys: [], values: {} };

    out.push({
      profile,
      templateFile: tmpl ? fileByName[tmpl.name].relPath : null,
      layers,
      diff: diff(envParsed, exampleParsed),
    });
  }

  // ensure deterministic order with default first
  out.sort((a, b) => {
    if (a.profile === DEFAULT_PROFILE) return -1;
    if (b.profile === DEFAULT_PROFILE) return 1;
    return a.profile.localeCompare(b.profile);
  });
  return out;
}

/**
 * Build a full per-package analysis of a workspace.
 *
 * `diff` (top-level) reflects the DEFAULT profile (the `.env` + `.env.local`
 * stack vs `.env.example`) — the common case and what `check`/`summary` report
 * on. `profiles` carries the per-profile breakdown for richer consumers.
 *
 * @param {string} root absolute workspace root
 */
export async function analyze(root) {
  const { root: abs, packages } = await discover(root);
  const out = [];

  for (const pkg of packages) {
    const { example, env } = pickPrimary(pkg.envFiles);
    const profiles = await diffProfiles(pkg.envFiles);
    const defaultProfile = profiles.find((p) => p.profile === DEFAULT_PROFILE) || null;
    const pkgDiff = defaultProfile ? defaultProfile.diff : null;

    out.push({
      name: pkg.name,
      relDir: pkg.relDir,
      isRoot: pkg.isRoot,
      hasExample: Boolean(example),
      hasEnv: Boolean(env),
      exampleFile: example ? example.relPath : null,
      envFile: env ? env.relPath : null,
      diff: pkgDiff,
      profiles,
    });
  }

  return { root: abs, packages: out };
}

/**
 * Roll an analysis up into a one-shot summary. Totals are computed over the
 * default profile of every package (the same view `check` enforces).
 * @param {string} root
 */
export async function summarize(root) {
  const analysis = await analyze(root);
  let missingTotal = 0;
  let emptyTotal = 0;
  let extraTotal = 0;
  let driftedPackages = 0;

  for (const pkg of analysis.packages) {
    if (!pkg.diff) continue;
    const m = pkg.diff.missing.length;
    const e = pkg.diff.empty.length;
    const x = pkg.diff.extra.length;
    missingTotal += m;
    emptyTotal += e;
    extraTotal += x;
    if (m > 0 || e > 0 || x > 0) driftedPackages += 1;
  }

  return {
    root: analysis.root,
    packageCount: analysis.packages.length,
    missingTotal,
    emptyTotal,
    extraTotal,
    driftedPackages,
    analysis,
  };
}

/**
 * Human-readable one-line headline, e.g.
 * "3 packages, 4 missing keys, 2 packages drifted".
 * @param {Awaited<ReturnType<typeof summarize>>} s
 */
export function headline(s) {
  return `${s.packageCount} package${s.packageCount === 1 ? "" : "s"}, ${s.missingTotal} missing key${s.missingTotal === 1 ? "" : "s"}, ${s.driftedPackages} package${s.driftedPackages === 1 ? "" : "s"} drifted`;
}

export { precedenceOrder };
