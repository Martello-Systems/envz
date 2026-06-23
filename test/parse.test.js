import { test } from "node:test";
import assert from "node:assert/strict";
import { parseEnv } from "../src/parse.js";

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
