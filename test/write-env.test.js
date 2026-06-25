import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, readdir, rename as fsRename } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { applyEnvUpdates, safeEnvTarget } from "../src/write-env.js";
import { parseEnv } from "../src/parse.js";

async function tmpFile(content) {
  const dir = await mkdtemp(path.join(tmpdir(), "envz-"));
  const file = path.join(dir, ".env");
  await writeFile(file, content, "utf8");
  return file;
}

const PEM_BLOCK = [
  "-----BEGIN PRIVATE KEY-----",
  "MIIBVgIBADANBgkqhkiG9w0BAQEFAASCAUAwggE8AgEAAkEA0aB",
  "c2hvcnQga2V5IGZvciB0ZXN0aW5nIG9ubHkgbm90IHJlYWw9PQ==",
  "-----END PRIVATE KEY-----",
].join("\n");

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

test("writes a multi-line value and reads it back unchanged (disk round-trip)", async () => {
  const PEM = [
    "-----BEGIN PRIVATE KEY-----",
    "MIIBVgIBADANBgkqhkiG9w0BAQEFAASCAUAwggE8AgEAAkEA0aB",
    "c2hvcnQga2V5IGZvciB0ZXN0aW5nIG9ubHkgbm90IHJlYWw9PQ==",
    "-----END PRIVATE KEY-----",
  ].join("\n");
  const file = await tmpFile("");
  const dir = path.dirname(file);
  await applyEnvUpdates(file, { TLS_KEY: PEM, NOTE: "a # b" });

  const parsed = parseEnv(await readFile(file, "utf8"));
  assert.equal(parsed.values.TLS_KEY, PEM);
  assert.equal(parsed.values.NOTE, "a # b");
  assert.deepEqual(await readdir(dir), [".env"]);
});

test("interrupted write leaves the original file fully intact", async () => {
  const original = "# keep me\nA=original\nB=alsoKeep\n";
  const file = await tmpFile(original);
  const dir = path.dirname(file);

  // Simulate a crash during the atomic rename: the swap never completes.
  const boom = () => Promise.reject(new Error("simulated crash during rename"));
  await assert.rejects(
    applyEnvUpdates(file, { A: "new" }, { rename: boom }),
    /simulated crash during rename/
  );

  // The real .env is untouched (never truncated or half-written)...
  assert.equal(await readFile(file, "utf8"), original);
  // ...and no temp/backup turd is left behind.
  const left = await readdir(dir);
  assert.deepEqual(left, [".env"]);
});

test("a normal write produces correct content with no leftover temp file", async () => {
  const file = await tmpFile("A=old\n");
  const dir = path.dirname(file);
  const { applied } = await applyEnvUpdates(file, { A: "new", C: "added" });
  assert.deepEqual(applied, ["A"]);

  const parsed = parseEnv(await readFile(file, "utf8"));
  assert.equal(parsed.values.A, "new");
  assert.equal(parsed.values.C, "added");

  const left = await readdir(dir);
  assert.deepEqual(left, [".env"]); // only the target, no .tmp/.bak
});

test("replacing a key whose value is multi-line drops its continuation lines (no orphans)", async () => {
  const file = await tmpFile(`TLS_KEY="${PEM_BLOCK}"\nOTHER=foo\n`);
  const { applied, appended } = await applyEnvUpdates(file, { TLS_KEY: "short" });
  assert.deepEqual(applied, ["TLS_KEY"]);
  assert.deepEqual(appended, []);

  const out = await readFile(file, "utf8");
  const parsed = parseEnv(out);
  // exactly two keys remain — no orphaned PEM lines re-parsed as bogus keys
  assert.deepEqual(parsed.keys, ["TLS_KEY", "OTHER"]);
  assert.equal(parsed.values.TLS_KEY, "short");
  assert.equal(parsed.values.OTHER, "foo");
  assert.ok(out.includes("TLS_KEY=short"));
  assert.ok(out.includes("OTHER=foo"));
  assert.ok(!out.includes("BEGIN PRIVATE KEY"), "old PEM body must be gone");
  assert.deepEqual(await readdir(path.dirname(file)), [".env"]);
});

test("updating a DIFFERENT key leaves a multi-line value byte-identical", async () => {
  const original = `TLS_KEY="${PEM_BLOCK}"\nOTHER=foo\n`;
  const file = await tmpFile(original);
  await applyEnvUpdates(file, { OTHER: "bar" });

  const out = await readFile(file, "utf8");
  assert.ok(out.includes(`TLS_KEY="${PEM_BLOCK}"`), "multi-line block untouched");
  const parsed = parseEnv(out);
  assert.equal(parsed.values.TLS_KEY, PEM_BLOCK);
  assert.equal(parsed.values.OTHER, "bar");
  assert.deepEqual(parsed.keys, ["TLS_KEY", "OTHER"]);
});

test("a failed restore surfaces an error naming the backup (never silently swallowed)", async () => {
  const original = "# keep me\nA=original\nB=keepme\n";
  const file = await tmpFile(original);

  // Simulate Windows: swap onto the target keeps failing with EPERM, and the
  // final restore (bak -> target) also fails. The original must end up in .bak
  // and the thrown error must point at it.
  const rename = async (from, to) => {
    if (from.endsWith(".bak")) throw new Error("restore boom"); // restore fails
    if (from.endsWith(".tmp")) {
      throw Object.assign(new Error("locked"), { code: "EPERM" }); // swap fails
    }
    return fsRename(from, to); // original -> .bak (real move)
  };

  let caught;
  await assert.rejects(
    applyEnvUpdates(file, { A: "new" }, { rename }),
    (err) => {
      caught = err;
      return err.code === "EENVZRESTORE" && typeof err.backupPath === "string";
    }
  );

  // The prior contents are intact in the backup the error names...
  assert.equal(await readFile(caught.backupPath, "utf8"), original);
  // ...and the temp file was cleaned up (only the .bak remains).
  const left = await readdir(path.dirname(file));
  assert.deepEqual(left, [path.basename(caught.backupPath)]);
});

test("safeEnvTarget accepts an in-workspace .env path", () => {
  const root = "/work/repo";
  // Compare against path.resolve (what safeEnvTarget computes): on Windows a
  // bare POSIX root like "/work/repo" resolves to the current drive, so the
  // expectation must resolve the same way to stay cross-platform.
  assert.equal(safeEnvTarget(root, "packages/web/.env"), path.resolve(root, "packages/web/.env"));
  assert.equal(safeEnvTarget(root, "packages/web/.env.local"), path.resolve(root, "packages/web/.env.local"));
});

test("safeEnvTarget rejects path traversal outside the workspace", () => {
  assert.throws(() => safeEnvTarget("/work/repo", "../../etc/.env"), /outside workspace/);
  assert.throws(() => safeEnvTarget("/work/repo", "/etc/.env"), /outside workspace/);
});

test("safeEnvTarget rejects non-.env target files", () => {
  assert.throws(() => safeEnvTarget("/work/repo", "packages/web/config.json"), /non-.env file/);
  assert.throws(() => safeEnvTarget("/work/repo", "secrets.txt"), /non-.env file/);
});
