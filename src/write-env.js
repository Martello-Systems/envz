import { readFile, open, rename as fsRename, unlink } from "node:fs/promises";
import path from "node:path";
import { readEntry } from "./parse.js";

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
 * Multi-line aware: if the replaced key currently holds a multi-line (open-quote
 * continuation) value, ALL of its continuation lines are dropped, not just the
 * opening line — so the result re-parses cleanly with no orphaned lines masquera-
 * ding as bogus keys. Lines belonging to keys that are NOT being updated are
 * emitted byte-for-byte, so an untouched multi-line value stays identical. The
 * span of each entry is computed by {@link readEntry}, the same logic the parser
 * uses, so writer and parser never disagree.
 *
 * Values are written verbatim; values containing whitespace or `#` are quoted.
 * This is the one impure helper the TUI/CLI use to persist {@link fillFromSibling}
 * results. It is intentionally separate from the pure domain logic.
 *
 * The write is ATOMIC: the new contents are written to a temp file in the same
 * directory (fsync'd) and then renamed over the target, so a crash mid-write can
 * never leave the user's real `.env` truncated or half-written.
 *
 * @param {string} filePath absolute path to the target .env
 * @param {Record<string,string>} updates key->new value
 * @param {{ rename?: (from:string,to:string)=>Promise<void> }} [opts]
 *   `rename` is injectable so the atomic-swap path can be exercised in tests;
 *   it defaults to `fs.promises.rename`.
 * @returns {Promise<{applied: string[], appended: string[]}>}
 */
export async function applyEnvUpdates(filePath, updates, opts = {}) {
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

  const updated = [];
  let i = 0;
  while (i < lines.length) {
    const entry = readEntry(lines, i, eol);
    if (!entry) {
      updated.push(lines[i]); // blank line, comment, or non-KEY=VALUE line
      i++;
      continue;
    }
    if (remaining.has(entry.key)) {
      remaining.delete(entry.key);
      applied.push(entry.key);
      const prefix = lines[i].trimStart().startsWith("export ") ? "export " : "";
      updated.push(`${prefix}${entry.key}=${formatValue(updates[entry.key])}`);
      // Skip the whole existing entry, including any continuation lines, so a
      // replaced multi-line value leaves no orphaned lines behind.
      i = entry.endIdx + 1;
    } else {
      // Untouched entry: emit every physical line it spans verbatim.
      for (let j = i; j <= entry.endIdx; j++) updated.push(lines[j]);
      i = entry.endIdx + 1;
    }
  }

  const appended = [];
  for (const key of remaining) {
    updated.push(`${key}=${formatValue(updates[key])}`);
    appended.push(key);
  }

  let out = updated.join(eol);
  if (!out.endsWith(eol)) out += eol;
  await atomicWrite(filePath, out, opts.rename || fsRename);

  return { applied, appended };
}

/**
 * Write `data` to `filePath` atomically: stage it in a sibling temp file (fsync'd
 * to disk), then rename the temp over the target. Because the rename is the only
 * operation that touches `filePath`, an interruption (crash, power loss, thrown
 * error) leaves the original file's previous contents intact rather than
 * truncated.
 *
 * Windows can refuse a rename-over-existing with EEXIST/EPERM/EACCES (the target
 * may be momentarily locked). In that case the original is moved aside to a
 * sibling `.bak` first — so its contents are always recoverable — before the
 * temp is swapped in. Guarantee: the original is never truncated; on a failed
 * swap the prior contents remain either at the path (restored) or in the sibling
 * `.bak`. If even the restore fails, that is surfaced as an error naming the
 * `.bak` so the caller knows where the data is — it is never silently swallowed.
 *
 * @param {string} filePath target path
 * @param {string} data contents to write
 * @param {(from:string,to:string)=>Promise<void>} rename rename implementation
 */
async function atomicWrite(filePath, data, rename) {
  const dir = path.dirname(filePath);
  const base = path.basename(filePath);
  const tag = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const tmp = path.join(dir, `.${base}.${tag}.tmp`);

  // Write + fsync the temp so its bytes are durable before we swap it in.
  const fh = await open(tmp, "w");
  try {
    await fh.writeFile(data, "utf8");
    await fh.sync();
  } finally {
    await fh.close();
  }

  try {
    await rename(tmp, filePath);
    return;
  } catch (err) {
    if (err && (err.code === "EEXIST" || err.code === "EPERM" || err.code === "EACCES")) {
      const bak = path.join(dir, `.${base}.${tag}.bak`);
      try {
        await rename(filePath, bak); // move original aside (still recoverable)
      } catch {
        await unlink(tmp).catch(() => {});
        throw err; // original untouched; drop the temp
      }
      try {
        await rename(tmp, filePath);
        await unlink(bak).catch(() => {});
        return;
      } catch (err2) {
        await unlink(tmp).catch(() => {});
        // Try to put the original back; if THAT fails the prior contents survive
        // only in `.bak`, so surface it loudly rather than swallowing it.
        try {
          await rename(bak, filePath);
        } catch (restoreErr) {
          const e = new Error(
            `atomic write failed and the original could not be restored; its ` +
              `previous contents are preserved at ${bak} (${restoreErr.code || restoreErr.message})`
          );
          e.code = "EENVZRESTORE";
          e.backupPath = bak;
          e.cause = restoreErr;
          throw e;
        }
        throw err2;
      }
    }
    await unlink(tmp).catch(() => {}); // original untouched; drop the temp
    throw err;
  }
}

/**
 * Serialize a single value for a `.env` file. Empty -> bare `KEY=`. Anything
 * with whitespace, `#`, quotes, a backslash, or a newline is double-quoted with
 * `\\`, `\n`, `\r`, `\t`, and `"` escaped, so that {@link parseEnv} reads back
 * the exact original value (a lossless parse<->serialize round-trip).
 * @param {string} value
 * @returns {string}
 */
export function formatValue(value) {
  if (value === "") return "";
  if (/[\s#"'\\]/.test(value)) {
    const esc = value
      .replace(/\\/g, "\\\\")
      .replace(/"/g, '\\"')
      .replace(/\n/g, "\\n")
      .replace(/\r/g, "\\r")
      .replace(/\t/g, "\\t");
    return `"${esc}"`;
  }
  return value;
}
