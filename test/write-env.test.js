import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { applyEnvUpdates } from "../src/write-env.js";
import { parseEnv } from "../src/parse.js";

async function tmpFile(content) {
  const dir = await mkdtemp(path.join(tmpdir(), "envz-"));
  const file = path.join(dir, ".env");
  await writeFile(file, content, "utf8");
  return file;
}

test("replaces an existing key's value in place, keeping comments", async () => {
  const file = await tmpFile("# top\nA=old\nB=keep\n");
  const { applied, appended } = await applyEnvUpdates(file, { A: "new" });
  assert.deepEqual(applied, ["A"]);
  assert.deepEqual(appended, []);
  const out = await readFile(file, "utf8");
  assert.ok(out.includes("# top"));
  assert.ok(out.includes("A=new"));
  assert.ok(out.includes("B=keep"));
});

test("appends a key that does not exist", async () => {
  const file = await tmpFile("A=1\n");
  const { applied, appended } = await applyEnvUpdates(file, { NEW: "value" });
  assert.deepEqual(applied, []);
  assert.deepEqual(appended, ["NEW"]);
  const out = parseEnv(await readFile(file, "utf8"));
  assert.equal(out.values.NEW, "value");
  assert.equal(out.values.A, "1");
});

test("quotes values containing spaces", async () => {
  const file = await tmpFile("");
  await applyEnvUpdates(file, { MSG: "hello world" });
  const out = await readFile(file, "utf8");
  assert.ok(out.includes('MSG="hello world"'));
  assert.equal(parseEnv(out).values.MSG, "hello world");
});

test("preserves export prefix when updating", async () => {
  const file = await tmpFile("export PORT=3000\n");
  await applyEnvUpdates(file, { PORT: "4000" });
  const out = await readFile(file, "utf8");
  assert.ok(out.includes("export PORT=4000"));
});
