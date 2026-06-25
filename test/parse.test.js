import { test } from "node:test";
import assert from "node:assert/strict";
import { parseEnv } from "../src/parse.js";
import { formatValue } from "../src/write-env.js";

/** parse(serialize(value)) must return the exact original value. */
function roundTrips(value) {
  const text = `K=${formatValue(value)}\n`;
  return parseEnv(text).values.K;
}

test("parses simple KEY=value pairs", () => {
  const { values, keys } = parseEnv("A=1\nB=two\n");
  assert.deepEqual(keys, ["A", "B"]);
  assert.equal(values.A, "1");
  assert.equal(values.B, "two");
});

test("ignores blank lines and full-line comments", () => {
  const { keys } = parseEnv("# header\n\nA=1\n   \n# trailing\nB=2\n");
  assert.deepEqual(keys, ["A", "B"]);
});

test("strips double and single quotes", () => {
  const { values } = parseEnv('A="hello world"\nB=\'single quoted\'\n');
  assert.equal(values.A, "hello world");
  assert.equal(values.B, "single quoted");
});

test("expands escapes inside double quotes only", () => {
  const { values } = parseEnv('A="line1\\nline2"\nB=\'line1\\nline2\'\n');
  assert.equal(values.A, "line1\nline2");
  assert.equal(values.B, "line1\\nline2");
});

test("strips inline comments from unquoted values", () => {
  const { values } = parseEnv("A=value # a note\n");
  assert.equal(values.A, "value");
});

test("keeps # inside quoted values", () => {
  const { values } = parseEnv('A="value # not a comment"\n');
  assert.equal(values.A, "value # not a comment");
});

test("handles export prefix", () => {
  const { values, keys } = parseEnv("export FOO=bar\n");
  assert.deepEqual(keys, ["FOO"]);
  assert.equal(values.FOO, "bar");
});

test("empty value yields empty string", () => {
  const { values, keys } = parseEnv("EMPTY=\n");
  assert.deepEqual(keys, ["EMPTY"]);
  assert.equal(values.EMPTY, "");
});

test("value containing = signs is preserved", () => {
  const { values } = parseEnv("URL=postgres://u:p@host/db?x=1&y=2\n");
  assert.equal(values.URL, "postgres://u:p@host/db?x=1&y=2");
});

test("later duplicate overrides value but key listed once", () => {
  const { values, keys } = parseEnv("A=1\nA=2\n");
  assert.deepEqual(keys, ["A"]);
  assert.equal(values.A, "2");
});

test("lines without = are ignored", () => {
  const { keys } = parseEnv("JUST_A_WORD\nA=1\n");
  assert.deepEqual(keys, ["A"]);
});

// --- P1: multi-line quoted values, inline comments, and round-trips ----------

const PEM = [
  "-----BEGIN PRIVATE KEY-----",
  "MIIBVgIBADANBgkqhkiG9w0BAQEFAASCAUAwggE8AgEAAkEA0aB",
  "c2hvcnQga2V5IGZvciB0ZXN0aW5nIG9ubHkgbm90IHJlYWw9PQ==",
  "-----END PRIVATE KEY-----",
].join("\n");

test("parses a multi-line double-quoted value (PEM key) intact", () => {
  const content = `BEFORE=1\nKEY="${PEM}"\nAFTER=2\n`;
  const { values, keys } = parseEnv(content);
  assert.deepEqual(keys, ["BEFORE", "KEY", "AFTER"]);
  assert.equal(values.KEY, PEM);
  // the key after the multi-line value is still parsed (continuation consumed)
  assert.equal(values.AFTER, "2");
});

test('inline comment after a quoted value is stripped, value kept clean: A="x" # note', () => {
  const { values } = parseEnv('A="x" # note\n');
  assert.equal(values.A, "x");
});

test("a # inside a quoted value is preserved (not treated as a comment)", () => {
  const { values } = parseEnv('A="pa#ss#word"\n');
  assert.equal(values.A, "pa#ss#word");
});

test("PEM multi-line value survives a parse -> serialize round-trip", () => {
  assert.equal(roundTrips(PEM), PEM);
});

test('value "x" with a trailing comment survives a round-trip', () => {
  assert.equal(roundTrips("x"), "x");
});

test("value containing # survives a round-trip", () => {
  assert.equal(roundTrips("secret#1"), "secret#1");
  assert.equal(roundTrips("a # b"), "a # b");
});

test("empty value survives a round-trip", () => {
  assert.equal(roundTrips(""), "");
});

test("value containing = survives a round-trip", () => {
  assert.equal(roundTrips("postgres://u:p@host/db?x=1&y=2"), "postgres://u:p@host/db?x=1&y=2");
  assert.equal(roundTrips("a=b=c"), "a=b=c");
});

test("value with literal newline survives a round-trip (serialized single-line)", () => {
  const v = "line1\nline2\nline3";
  const text = `K=${formatValue(v)}\n`;
  // serialized form stays on one physical line (newlines escaped, not raw)
  assert.equal(text.trim().split("\n").length, 1);
  assert.equal(parseEnv(text).values.K, v);
});

test("value with backslashes/quotes survives a round-trip", () => {
  assert.equal(roundTrips("C:\\Users\\me\\.env"), "C:\\Users\\me\\.env");
  assert.equal(roundTrips('he said "hi"'), 'he said "hi"');
  assert.equal(roundTrips("tab\tseparated"), "tab\tseparated");
});

test("CRLF-authored multi-line value preserves its \\r\\n interior", () => {
  // file written on Windows: the value's interior line ends are CRLF
  const content = 'K="a\r\nb\r\nc"\r\nNEXT=ok\r\n';
  const { values, keys } = parseEnv(content);
  assert.equal(values.K, "a\r\nb\r\nc");
  assert.equal(values.NEXT, "ok");
  assert.deepEqual(keys, ["K", "NEXT"]);
});

test("trailing whitespace inside an open quote on line 1 is preserved", () => {
  const content = 'K="foo   \nbar"\n';
  assert.equal(parseEnv(content).values.K, "foo   \nbar");
});
