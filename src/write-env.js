import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Resolve a target env path and assert it is (a) inside `root` (no traversal)
 * and (b) a member of the `.env` family. Throws on violation. Used by the
 * TUI/CLI before any write so a malformed package path can never escape the
 * workspace or clobber a non-env file.
 *
 * @param {string} root absolute workspace root
 * @param {string} candidate absolute or root-relative path to the target file
 * @returns {string} the validated absolute path
 */
export function safeEnvTarget(root, candidate) {
  const absRoot = path.resolve(root);
  const abs = path.resolve(absRoot, candidate);
  const rel = path.relative(absRoot, abs);
  if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(`refusing to write outside workspace: ${candidate}`);
  }
  const base = path.basename(abs);
  if (base !== ".env" && !base.startsWith(".env.")) {
    throw new Error(`refusing to write a non-.env file: ${base}`);
  }
  return abs;
}

/**
 * Apply a set of key->value updates to a .env file ON DISK, preserving the
 * existing file's comments, ordering and formatting where possible.
 *
 * For each updated key:
 *  - if a `KEY=` line exists, its value is replaced in place
 *  - otherwise the `KEY=value` line is appended
 *
 * Values are written verbatim; values containing whitespace or `#` are quoted.
 * This is the one impure helper the TUI/CLI use to persist {@link fillFromSibling}
 * results. It is intentionally separate from the pure domain logic.
 *
 * @param {string} filePath absolute path to the target .env
 * @param {Record<string,string>} updates key->new value
 * @returns {Promise<{applied: string[], appended: string[]}>}
 */
export async function applyEnvUpdates(filePath, updates) {
  let content = "";
  try {
    content = await readFile(filePath, "utf8");
  } catch {
    content = "";
  }

  const keys = Object.keys(updates);
  if (keys.length === 0) return { applied: [], appended: [] };

  const eol = content.includes("\r\n") ? "\r\n" : "\n";
  const lines = content.length ? content.split(/\r?\n/) : [];
  const applied = [];
  const remaining = new Set(keys);

  const updated = lines.map((line) => {
    const trimmed = line.trimStart();
    const bare = trimmed.startsWith("export ")
      ? trimmed.slice("export ".length)
      : trimmed;
    const eq = bare.indexOf("=");
    if (eq === -1) return line;
    const key = bare.slice(0, eq).trim();
    if (remaining.has(key)) {
      remaining.delete(key);
      applied.push(key);
      const prefix = trimmed.startsWith("export ") ? "export " : "";
      return `${prefix}${key}=${formatValue(updates[key])}`;
    }
    return line;
  });

  const appended = [];
  for (const key of remaining) {
    updated.push(`${key}=${formatValue(updates[key])}`);
    appended.push(key);
  }

  let out = updated.join(eol);
  if (!out.endsWith(eol)) out += eol;
  await writeFile(filePath, out, "utf8");

  return { applied, appended };
}

function formatValue(value) {
  if (value === "") return "";
  if (/[\s#"']/.test(value)) {
    return `"${value.replace(/"/g, '\\"')}"`;
  }
  return value;
}
