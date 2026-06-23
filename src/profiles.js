/**
 * Profile model for the `.env*` family.
 *
 * A monorepo package can hold many env files: `.env`, `.env.local`,
 * `.env.production`, `.env.production.local`, `.env.example`,
 * `.env.production.example`, etc. envz groups these into *profiles* (named
 * environments) and applies a single, explicit precedence rule so that
 * "what value is actually in effect for profile X" and "which template declares
 * the required keys for profile X" are both well-defined.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * Filename → (profile, kind, isLocal) classification
 * ──────────────────────────────────────────────────────────────────────────
 *   .env                       → profile "default", real,     local=false
 *   .env.local                 → profile "default", real,     local=true
 *   .env.production            → profile "production", real,  local=false
 *   .env.production.local      → profile "production", real,  local=true
 *   .env.example               → profile "default", template
 *   .env.sample/.template/.dist→ profile "default", template
 *   .env.production.example    → profile "production", template
 *
 * Recognised template suffixes: example, sample, template, dist.
 * "local" is a layered override (gitignored personal values), not its own
 * profile — `.env.local` overrides `.env` within the *default* profile, and
 * `.env.<p>.local` overrides `.env.<p>` within profile <p>.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * Effective-value precedence within a profile (highest wins)
 * ──────────────────────────────────────────────────────────────────────────
 * Mirrors the Next.js / dotenv-flow convention so envz agrees with what your
 * app actually loads at runtime:
 *
 *   profile "default":
 *     .env.local   >   .env
 *
 *   profile "<p>" (e.g. production):
 *     .env.<p>.local   >   .env.local   >   .env.<p>   >   .env
 *
 * The template that declares the *required* keys for a profile is, in order of
 * preference: `.env.<p>.example` (profile-specific) else `.env.example`
 * (default template). A real value present in ANY layer of the profile counts
 * as "satisfied".
 */

const TEMPLATE_SUFFIXES = ["example", "sample", "template", "dist"];
const TEMPLATE_SET = new Set(TEMPLATE_SUFFIXES);

export const DEFAULT_PROFILE = "default";

/**
 * @typedef {Object} EnvFileClass
 * @property {string} name        original filename
 * @property {string} profile     profile name ("default" for plain `.env`)
 * @property {boolean} isTemplate true for `.env.example` / `.sample` / etc.
 * @property {boolean} isLocal    true for `.env.local` / `.env.<p>.local`
 */

/**
 * Classify a single `.env*` filename into its profile / kind.
 * Returns null if the name is not part of the `.env` family.
 * @param {string} name
 * @returns {EnvFileClass|null}
 */
export function classifyEnvFile(name) {
  if (name !== ".env" && !name.startsWith(".env.")) return null;

  if (name === ".env") {
    return { name, profile: DEFAULT_PROFILE, isTemplate: false, isLocal: false };
  }

  // ".env.<segments>" — split into dot-separated segments.
  let segments = name.slice(".env.".length).split("."); // e.g. ["production","local"]

  // template suffix is the LAST segment if it's a known suffix
  const last = segments[segments.length - 1].toLowerCase();
  if (TEMPLATE_SET.has(last)) {
    segments = segments.slice(0, -1); // drop "example"/"sample"/...
    // ".env.example" -> [] -> default profile template
    // ".env.production.example" -> ["production"] -> production template
    const profile = segments.length === 0 ? DEFAULT_PROFILE : segments.join(".");
    return { name, profile, isTemplate: true, isLocal: false };
  }

  // ".local" override is the LAST segment
  let isLocal = false;
  if (segments[segments.length - 1] === "local") {
    isLocal = true;
    segments = segments.slice(0, -1);
  }

  const profile = segments.length === 0 ? DEFAULT_PROFILE : segments.join(".");
  return { name, profile, isTemplate: false, isLocal };
}

/**
 * Layer order (lowest → highest precedence) of REAL files for a profile.
 * Default profile:  .env  <  .env.local
 * Named profile <p>: .env  <  .env.<p>  <  .env.local  <  .env.<p>.local
 * @param {string} profile
 * @returns {string[]} ordered filenames, lowest precedence first
 */
export function precedenceOrder(profile) {
  if (profile === DEFAULT_PROFILE) {
    return [".env", ".env.local"];
  }
  return [".env", `.env.${profile}`, ".env.local", `.env.${profile}.local`];
}

/**
 * Given a package's env files (with their classifications) plus a map of
 * filename → parsed values, compute the effective value map for one profile by
 * layering files in precedence order (highest wins).
 *
 * @param {string} profile
 * @param {Record<string, Record<string,string>>} valuesByFile filename → values
 * @returns {{ values: Record<string,string>, keys: string[], layers: string[] }}
 *   layers = filenames that actually contributed, lowest→highest precedence.
 */
export function effectiveValues(profile, valuesByFile) {
  const order = precedenceOrder(profile);
  const values = Object.create(null);
  const keyOrder = [];
  const layers = [];

  for (const fname of order) {
    const vals = valuesByFile[fname];
    if (!vals) continue;
    layers.push(fname);
    for (const k of Object.keys(vals)) {
      if (!(k in values)) keyOrder.push(k);
      values[k] = vals[k];
    }
  }

  return { values, keys: keyOrder, layers };
}

/**
 * Pick the template file that declares required keys for a profile.
 * Preference: profile-specific `.env.<p>.example` (any template suffix), else
 * the default `.env.example`.
 * @param {EnvFileClass[]} classified
 * @param {string} profile
 * @returns {EnvFileClass|null}
 */
export function templateForProfile(classified, profile) {
  const templates = classified.filter((c) => c.isTemplate);
  // prefer an exact `.example` for the profile, then any template for it
  const profileExact =
    templates.find((c) => c.profile === profile && c.name.endsWith(".example")) ||
    templates.find((c) => c.profile === profile);
  if (profileExact) return profileExact;
  if (profile === DEFAULT_PROFILE) return null;
  // fall back to the default-profile template
  return (
    templates.find((c) => c.profile === DEFAULT_PROFILE && c.name.endsWith(".example")) ||
    templates.find((c) => c.profile === DEFAULT_PROFILE) ||
    null
  );
}

/**
 * List the distinct profiles present in a package, given its classified files.
 * "default" is always included if any non-template real file or default
 * template exists; named profiles appear if any file references them.
 * @param {EnvFileClass[]} classified
 * @returns {string[]} sorted, with "default" first if present
 */
export function profilesPresent(classified) {
  const set = new Set();
  for (const c of classified) set.add(c.profile);
  const arr = [...set];
  arr.sort((a, b) => {
    if (a === DEFAULT_PROFILE) return -1;
    if (b === DEFAULT_PROFILE) return 1;
    return a.localeCompare(b);
  });
  return arr;
}
