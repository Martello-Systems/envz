/**
 * Parse a .env file's text content into an ordered list of entries plus a
 * key -> value map.
 *
 * Handles:
 *  - `KEY=value`
 *  - quoted values: `KEY="value"` / `KEY='value'` (quotes stripped)
 *  - multi-line quoted values: an opening quote that is not closed on the same
 *    line continues onto following lines until its closing quote (e.g. a PEM
 *    private key pasted verbatim across several lines). The interior line ending
 *    is preserved (a CRLF-authored value round-trips with its `\r\n` intact), as
 *    is trailing whitespace that falls inside the open quote.
 *  - `export KEY=value`
 *  - inline `#` comments, stripped only when OUTSIDE quotes
 *    (`KEY=value # note` -> `value`, but `KEY="a # b"` keeps the `#`)
 *  - full-line comments (`# ...`) and blank lines (ignored)
 *  - empty values: `KEY=` -> `""`
 *
 * Unterminated quote: an opening quote with no closing quote is treated as a
 * multi-line value that continues to EOF — it absorbs every following line. This
 * is the standard line-continuation behavior; if a stray quote appears to
 * swallow the rest of a file, an unbalanced quote upstream is the cause.
 *
 * Pure: takes text, returns data. No filesystem access. A round-trip through
 * `formatValue` (see write-env.js) is lossless for every value shape above.
 *
 * @param {string} content raw file contents
 * @returns {{ keys: string[], values: Record<string,string>, entries: {key:string,value:string,raw:string}[] }}
 */
export function parseEnv(content) {
  const entries = [];
  const values = Object.create(null);
  const keys = [];

  const eol = content.includes("\r\n") ? "\r\n" : "\n";
  const lines = content.split(/\r?\n/);
  let i = 0;
  while (i < lines.length) {
    const entry = readEntry(lines, i, eol);
    if (!entry) {
      i++;
      continue;
    }
    const { key, value, endIdx } = entry;
    if (!(key in values)) keys.push(key);
    values[key] = value;
    entries.push({ key, value, raw: lines.slice(i, endIdx + 1).join(eol) });
    i = endIdx + 1;
  }

  return { keys, values, entries };
}

/**
 * Parse ONE logical `.env` entry starting at physical line `startIdx`, returning
 * its key, decoded value, and `endIdx` — the index of the LAST physical line the
 * entry spans (equal to `startIdx` for a single-line entry, greater when an open
 * quote continues across lines). Returns `null` for blank lines, full-line
 * comments, and lines that are not `KEY=...`.
 *
 * This is the single source of truth for "how many physical lines does this
 * entry occupy", shared by {@link parseEnv} and the on-disk rewriter in
 * write-env.js so the two never diverge — when the rewriter replaces a key whose
 * existing value is multi-line, it must drop exactly the continuation lines this
 * parser consumes (otherwise orphaned continuation lines would re-parse as bogus
 * keys).
 *
 * @param {string[]} lines all physical lines (already split on `\r?\n`)
 * @param {number} startIdx index of the entry's opening line
 * @param {string} [eol] line ending used to rejoin a multi-line value's interior
 * @returns {{ key: string, value: string, endIdx: number } | null}
 */
export function readEntry(lines, startIdx, eol = "\n") {
  const rawLine = lines[startIdx];
  // Left-trim only: trailing whitespace on the opening line may fall INSIDE an
  // open quote (`K="foo   ` continuing on the next line) and must be preserved.
  const leftTrimmed = rawLine.replace(/^\s+/, "");
  if (leftTrimmed === "" || leftTrimmed.startsWith("#")) return null;

  const stripped = leftTrimmed.startsWith("export ")
    ? leftTrimmed.slice("export ".length).replace(/^\s+/, "")
    : leftTrimmed;

  const eq = stripped.indexOf("=");
  if (eq === -1) return null; // not a KEY=VALUE line

  const key = stripped.slice(0, eq).trim();
  if (key === "") return null;

  // Value portion after `=`, leading whitespace removed but trailing kept (it
  // may be interior whitespace of an open-quoted multi-line value).
  const afterEq = stripped.slice(eq + 1).replace(/^[ \t]+/, "");
  const quote = afterEq[0];

  if (quote === '"' || quote === "'") {
    const read = readQuoted(lines, startIdx, afterEq, quote, eol);
    const value = quote === '"' ? unescapeDouble(read.inner) : read.inner;
    return { key, value, endIdx: read.endIdx };
  }
  return { key, value: stripInlineComment(afterEq).trimEnd(), endIdx: startIdx };
}

/**
 * Read a quoted value that begins at `firstContent[0]` on line `startIdx`. If
 * the closing quote is not present on the same line, keep consuming subsequent
 * physical lines (rejoined with `eol`) until it is found, so a multi-line value
 * (PEM key, JSON blob, ...) is captured intact with its original line endings.
 *
 * Returns the RAW interior (between the quotes, with escape sequences still
 * present); the caller unescapes double-quoted interiors. For double quotes a
 * `\"` does not terminate the value; single quotes are literal (first `'` ends).
 *
 * @param {string[]} lines all physical lines
 * @param {number} startIdx index of the opening-quote line
 * @param {string} firstContent the opening-quote line from the quote char onward
 * @param {('"'|"'")} quote the quote character
 * @param {string} eol line ending to reinsert between continued lines
 * @returns {{ inner: string, endIdx: number }}
 */
function readQuoted(lines, startIdx, firstContent, quote, eol) {
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
    buf += eol;
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
