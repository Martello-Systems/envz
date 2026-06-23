import { parseEnv } from "./parse.js";

/**
 * @typedef {"present"|"missing"|"extra"|"empty"} KeyStatus
 * present : key in example AND in env with a non-empty value
 * missing : key in example, absent from env
 * empty   : key in example, present in env but value is "" (blank)
 * extra   : key in env, NOT in example
 */

/**
 * Diff a parsed env against a parsed example.
 *
 * Pure: operates on already-parsed maps (or raw text via {@link diffText}).
 *
 * @param {{values: Record<string,string>, keys: string[]}} env
 * @param {{values: Record<string,string>, keys: string[]}} example
 * @returns {{
 *   keys: { key: string, status: KeyStatus, value: string }[],
 *   missing: string[], extra: string[], empty: string[], present: string[]
 * }}
 */
export function diff(env, example) {
  const result = [];
  const missing = [];
  const extra = [];
  const empty = [];
  const present = [];

  const seen = new Set();

  // example drives the "required" set
  for (const key of example.keys) {
    seen.add(key);
    if (!(key in env.values)) {
      result.push({ key, status: "missing", value: "" });
      missing.push(key);
    } else if (env.values[key] === "") {
      result.push({ key, status: "empty", value: "" });
      empty.push(key);
    } else {
      result.push({ key, status: "present", value: env.values[key] });
      present.push(key);
    }
  }

  // keys in env but not in example are "extra"
  for (const key of env.keys) {
    if (seen.has(key)) continue;
    result.push({ key, status: "extra", value: env.values[key] });
    extra.push(key);
  }

  return { keys: result, missing, extra, empty, present };
}

/**
 * Convenience: diff from raw text.
 * @param {string} envText
 * @param {string} exampleText
 */
export function diffText(envText, exampleText) {
  return diff(parseEnv(envText), parseEnv(exampleText));
}
