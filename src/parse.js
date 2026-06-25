/**
 * Parse a .env file's text content into an ordered list of entries plus a
 * key -> value map.
 *
 * Handles:
 *  - `KEY=value`
 *  - quoted values: `KEY="value"` / `KEY='value'` (quotes stripped)
 *  - multi-line quoted values: an opening quote that is not closed on the same
 *    line continues onto following lines until its closing quote (e.g. a PEM
 *    private key pasted verbatim across several lines)
 *  - `export KEY=value`
 *  - inline `#` comments, stripped only when OUTSIDE quotes
 *    (`KEY=value # note` -> `value`, but `KEY="a # b"` keeps the `#`)
 *  - full-line comments (`# ...`) and blank lines (ignored)
 *  - empty values: `KEY=` -> `""`
 *
 * Pure: takes text, returns data. No filesystem access. A round-trip through
 * {@link formatValue}/`serialize` (see write-env.js) is lossless for every value
 * shape above.
 *
 * @param {string} content raw file contents
 * @returns {{ keys: string[], values: Record<string,string>, entries: {key:string,value:string,raw:string}[] }}
 */
export function parseEnv(content) {
  const entries = [];
  const values = Object.create(null);
  const keys = [];

  const lines = content.split(/\r?\n/);
  let i = 0;
  while (i < lines.length) {
    const rawLine = lines[i];
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) {
      i++;
      continue;
    }

    // strip optional `export ` prefix
    const stripped = line.startsWith("export ")
      ? line.slice("export ".length).trimStart()
      : line;

    const eq = stripped.indexOf("=");
    if (eq === -1) {
      i++;
      continue; // not a KEY=VALUE line
    }

    const key = stripped.slice(0, eq).trim();
    if (key === "") {
      i++;
      continue;
    }

    // Value portion after `=`, with only leading whitespace removed (a quoted
    // value preserves its own interior/trailing whitespace).
    const afterEq = stripped.slice(eq + 1).replace(/^[ \t]+/, "");
    const quote = afterEq[0];

    let value;
    let consumedTo = i; // index of the last physical line this entry spans

    if (quote === '"' || quote === "'") {
      const read = readQuoted(lines, i, afterEq, quote);
      value = quote === '"' ? unescapeDouble(read.inner) : read.inner;
      consumedTo = read.endIdx;
    } else {
      value = stripInlineComment(afterEq).trimEnd();
    }

    if (!(key in values)) keys.push(key);
    values[key] = value;
    entries.push({
      key,
      value,
      raw: lines.slice(i, consumedTo + 1).join("\n"),
    });

    i = consumedTo + 1;
  }

  return { keys, values, entries };
}

/**
 * Read a quoted value that begins at `firstContent[0]` on line `startIdx`. If
 * the closing quote is not present on the same line, keep consuming subsequent
 * physical lines (joined with `\n`) until it is found, so a multi-line value
 * (PEM key, JSON blob, ...) is captured intact.
 *
 * Returns the RAW interior (between the quotes, with escape sequences still
 * present); the caller unescapes double-quoted interiors. For double quotes a
 * `\"` does not terminate the value; single quotes are literal (first `'` ends).
 *
 * @param {string[]} lines all physical lines
 * @param {number} startIdx index of the opening-quote line
 * @param {string} firstContent the opening-quote line from the quote char onward
 * @param {('"'|"'")} quote the quote character
 * @returns {{ inner: string, endIdx: number }}
 */
function readQuoted(lines, startIdx, firstContent, quote) {
  let buf = "";
  let segment = firstContent.slice(1); // drop the opening quote
  let idx = startIdx;

  for (;;) {
    let j = 0;
    while (j < segment.length) {
      const ch = segment[j];
      if (quote === '"' && ch === "\\" && j + 1 < segment.length) {
        // keep the escape sequence verbatim; unescapeDouble resolves it later
        buf += ch + segment[j + 1];
        j += 2;
        continue;
      }
      if (ch === quote) {
        return { inner: buf, endIdx: idx };
      }
      buf += ch;
      j++;
    }
    // end of this physical line with no closing quote: continue onto the next
    idx++;
    if (idx >= lines.length) {
      // unterminated quote: salvage what we have rather than dropping the key
      return { inner: buf, endIdx: lines.length - 1 };
    }
    buf += "\n";
    segment = lines[idx];
  }
}

/**
 * Resolve the escape sequences a double-quoted value may contain. Only the
 * sequences {@link formatValue} emits are special (`\\`, `\n`, `\r`, `\t`,
 * `\"`); any other `\x` is preserved literally so the round-trip is lossless.
 * @param {string} s raw interior
 * @returns {string}
 */
function unescapeDouble(s) {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "\\" && i + 1 < s.length) {
      const n = s[i + 1];
      if (n === "n") {
        out += "\n";
        i++;
        continue;
      }
      if (n === "r") {
        out += "\r";
        i++;
        continue;
      }
      if (n === "t") {
        out += "\t";
        i++;
        continue;
      }
      if (n === "\\") {
        out += "\\";
        i++;
        continue;
      }
      if (n === '"') {
        out += '"';
        i++;
        continue;
      }
    }
    out += s[i];
  }
  return out;
}

/**
 * Drop a trailing inline `# comment` from an UNquoted value. A `#` only starts a
 * comment when preceded by whitespace, so `foo#bar` (no space) stays intact.
 * @param {string} value
 * @returns {string}
 */
function stripInlineComment(value) {
  const hash = value.search(/\s#/);
  if (hash !== -1) return value.slice(0, hash);
  return value;
}
