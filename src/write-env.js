import { readFile, writeFile } from "node:fs/promises";

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
