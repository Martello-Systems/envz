import { readFile } from "node:fs/promises";
import { parseEnv } from "./parse.js";
import { diff } from "./diff.js";
import { discover } from "./discover.js";

/**
 * Pick the "primary" example file and the "primary" real env file for a package.
 * Convention: `.env.example` is the canonical template; `.env` is the canonical
 * real file. Falls back to the first example / first non-example present.
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
 * Build a full per-package analysis of a workspace: for each package, diff its
 * primary `.env` against its primary `.env.example`.
 *
 * @param {string} root absolute workspace root
 * @returns {Promise<{
 *   root: string,
 *   packages: {
 *     name: string, relDir: string, isRoot: boolean,
 *     hasExample: boolean, hasEnv: boolean,
 *     exampleFile: string|null, envFile: string|null,
 *     diff: import("./diff.js").ReturnType|null
 *   }[]
 * }>}
 */
export async function analyze(root) {
  const { root: abs, packages } = await discover(root);
  const out = [];

  for (const pkg of packages) {
    const { example, env } = pickPrimary(pkg.envFiles);
    let pkgDiff = null;

    if (example) {
      const exText = (await safeRead(example.path)) ?? "";
      const envText = env ? ((await safeRead(env.path)) ?? "") : "";
      pkgDiff = diff(parseEnv(envText), parseEnv(exText));
    } else if (env) {
      // no example to compare against; everything present counts as present
      const envText = (await safeRead(env.path)) ?? "";
      const parsed = parseEnv(envText);
      pkgDiff = diff(parsed, { keys: [], values: {} });
    }

    out.push({
      name: pkg.name,
      relDir: pkg.relDir,
      isRoot: pkg.isRoot,
      hasExample: Boolean(example),
      hasEnv: Boolean(env),
      exampleFile: example ? example.relPath : null,
      envFile: env ? env.relPath : null,
      diff: pkgDiff,
    });
  }

  return { root: abs, packages: out };
}

/**
 * Roll an analysis up into a one-shot summary.
 * @param {string} root
 * @returns {Promise<{
 *   root: string,
 *   packageCount: number,
 *   missingTotal: number,
 *   emptyTotal: number,
 *   extraTotal: number,
 *   driftedPackages: number,
 *   analysis: Awaited<ReturnType<typeof analyze>>
 * }>}
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
