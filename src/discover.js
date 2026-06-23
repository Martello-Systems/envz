import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { globSync } from "tinyglobby";
import YAML from "yaml";

/**
 * @typedef {Object} EnvFile
 * @property {string} name      file name, e.g. ".env" or ".env.local"
 * @property {string} path      absolute path
 * @property {string} relPath   path relative to workspace root
 * @property {boolean} isExample whether this is a `.env.example`/`.env.sample` template
 *
 * @typedef {Object} PackageNode
 * @property {string} name      package name (from package.json) or dir name
 * @property {string} dir       absolute package directory
 * @property {string} relDir    package dir relative to workspace root ("." for root)
 * @property {boolean} isRoot
 * @property {EnvFile[]} envFiles
 */

const EXAMPLE_RE = /\.(example|sample|template|dist)$/i;

/**
 * Is this filename a .env-family file?
 * Matches `.env`, `.env.local`, `.env.example`, `.env.production`, etc.
 * @param {string} name
 */
export function isEnvFileName(name) {
  return name === ".env" || name.startsWith(".env.");
}

/**
 * Is this a template/example env file rather than a real one?
 * @param {string} name
 */
export function isExampleName(name) {
  return EXAMPLE_RE.test(name);
}

/**
 * Read workspace package globs from pnpm-workspace.yaml and/or package.json
 * `workspaces`. Returns an array of glob patterns (relative to root).
 * @param {string} root absolute workspace root
 * @returns {Promise<string[]>}
 */
export async function readWorkspaceGlobs(root) {
  const globs = [];

  // pnpm-workspace.yaml
  try {
    const raw = await readFile(path.join(root, "pnpm-workspace.yaml"), "utf8");
    const doc = YAML.parse(raw);
    if (doc && Array.isArray(doc.packages)) globs.push(...doc.packages);
  } catch {
    /* not a pnpm workspace */
  }

  // package.json "workspaces" (npm/yarn) — array or { packages: [...] }
  try {
    const raw = await readFile(path.join(root, "package.json"), "utf8");
    const pkg = JSON.parse(raw);
    if (Array.isArray(pkg.workspaces)) {
      globs.push(...pkg.workspaces);
    } else if (pkg.workspaces && Array.isArray(pkg.workspaces.packages)) {
      globs.push(...pkg.workspaces.packages);
    }
  } catch {
    /* no/invalid root package.json */
  }

  // dedupe
  return [...new Set(globs)];
}

/**
 * Resolve workspace globs to a list of absolute package directories.
 * Negation patterns (`!...`) are honored. Only directories containing a
 * package.json are kept (matching pnpm/npm behavior).
 * @param {string} root
 * @param {string[]} globs
 * @returns {string[]}
 */
export function resolvePackageDirs(root, globs) {
  if (globs.length === 0) return [];
  // tinyglobby: treat each glob as "<glob>/package.json" to find packages
  const patterns = [];
  const ignore = [];
  for (const g of globs) {
    if (g.startsWith("!")) {
      ignore.push(joinGlob(g.slice(1), "package.json"));
    } else {
      patterns.push(joinGlob(g, "package.json"));
    }
  }
  const matches = globSync(patterns, {
    cwd: root,
    ignore: ["**/node_modules/**", ...ignore],
    dot: false,
    absolute: true,
  });
  const dirs = matches.map((m) => path.dirname(m));
  return [...new Set(dirs)].sort();
}

function joinGlob(glob, suffix) {
  const trimmed = glob.replace(/\/+$/, "");
  return `${trimmed}/${suffix}`;
}

/**
 * List .env-family files directly inside a directory (non-recursive).
 * @param {string} dir absolute dir
 * @param {string} root absolute workspace root (for relPath)
 * @returns {Promise<EnvFile[]>}
 */
export async function listEnvFiles(dir, root) {
  let names = [];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  const out = [];
  for (const name of names) {
    if (!isEnvFileName(name)) continue;
    const abs = path.join(dir, name);
    let isFile = false;
    try {
      isFile = (await stat(abs)).isFile();
    } catch {
      continue;
    }
    if (!isFile) continue;
    out.push({
      name,
      path: abs,
      relPath: path.relative(root, abs) || name,
      isExample: isExampleName(name),
    });
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

/**
 * Read a package's display name from its package.json (falls back to dir name).
 * @param {string} dir
 */
async function readPkgName(dir) {
  try {
    const raw = await readFile(path.join(dir, "package.json"), "utf8");
    const pkg = JSON.parse(raw);
    if (pkg && typeof pkg.name === "string" && pkg.name) return pkg.name;
  } catch {
    /* ignore */
  }
  return path.basename(dir);
}

/**
 * Discover the env landscape of a workspace.
 *
 * Returns one node for the root plus one per workspace package, each carrying
 * its directly-contained .env files. Packages with no env files are still
 * included (so you can see they're clean / un-configured).
 *
 * @param {string} root absolute workspace root
 * @returns {Promise<{ root: string, packages: PackageNode[] }>}
 */
export async function discover(root) {
  const abs = path.resolve(root);
  const globs = await readWorkspaceGlobs(abs);
  const pkgDirs = resolvePackageDirs(abs, globs).filter((d) => d !== abs);

  /** @type {PackageNode[]} */
  const packages = [];

  // root node
  packages.push({
    name: await readPkgName(abs),
    dir: abs,
    relDir: ".",
    isRoot: true,
    envFiles: await listEnvFiles(abs, abs),
  });

  for (const dir of pkgDirs) {
    packages.push({
      name: await readPkgName(dir),
      dir,
      relDir: path.relative(abs, dir),
      isRoot: false,
      envFiles: await listEnvFiles(dir, abs),
    });
  }

  return { root: abs, packages };
}
