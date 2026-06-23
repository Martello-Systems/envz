/**
 * Parse a .env file's text content into an ordered list of entries plus a
 * key -> value map.
 *
 * Handles:
 *  - `KEY=value`
 *  - quoted values: `KEY="value"` / `KEY='value'` (quotes stripped)
 *  - `export KEY=value`
 *  - inline `#` comments on UNquoted values (`KEY=value # note` -> `value`)
 *  - full-line comments (`# ...`) and blank lines (ignored)
 *  - empty values: `KEY=` -> `""`
 *
 * Pure: takes text, returns data. No filesystem access.
 *
 * @param {string} content raw file contents
 * @returns {{ keys: string[], values: Record<string,string>, entries: {key:string,value:string,raw:string}[] }}
 */
export function parseEnv(content) {
  const entries = [];
  const values = Object.create(null);
  const keys = [];

  const lines = content.split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;

    // strip optional `export ` prefix
    const stripped = line.startsWith("export ")
      ? line.slice("export ".length).trimStart()
      : line;

    const eq = stripped.indexOf("=");
    if (eq === -1) continue; // not a KEY=VALUE line

    const key = stripped.slice(0, eq).trim();
    if (key === "") continue;

    let value = stripped.slice(eq + 1).trim();
    value = unquote(value);

    if (!(key in values)) keys.push(key);
    values[key] = value;
    entries.push({ key, value, raw });
  }

  return { keys, values, entries };
}

/**
 * Strip surrounding quotes from a value. For unquoted values, also strips an
 * inline `# comment`. Quoted values keep `#` and surrounding whitespace intact.
 * @param {string} value
 * @returns {string}
 */
function unquote(value) {
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      const inner = value.slice(1, -1);
      if (first === '"') {
        // expand common escapes inside double quotes
        return inner.replace(/\\n/g, "\n").replace(/\\r/g, "\r").replace(/\\t/g, "\t");
      }
      return inner;
    }
  }
  // unquoted: drop inline comment
  const hash = value.indexOf(" #");
  if (hash !== -1) value = value.slice(0, hash).trimEnd();
  return value;
}
