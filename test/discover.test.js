import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  discover,
  readWorkspaceGlobs,
  resolvePackageDirs,
  isEnvFileName,
  isExampleName,
} from "../src/discover.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "fixtures", "monorepo");

test("isEnvFileName recognizes the .env family", () => {
  assert.ok(isEnvFileName(".env"));
  assert.ok(isEnvFileName(".env.local"));
  assert.ok(isEnvFileName(".env.example"));
  assert.ok(!isEnvFileName("env"));
  assert.ok(!isEnvFileName("package.json"));
});

test("isExampleName flags templates only", () => {
  assert.ok(isExampleName(".env.example"));
  assert.ok(isExampleName(".env.sample"));
  assert.ok(!isExampleName(".env"));
  assert.ok(!isExampleName(".env.local"));
});

test("reads workspace globs from both pnpm and package.json", async () => {
  const globs = await readWorkspaceGlobs(ROOT);
  assert.ok(globs.includes("packages/*"));
});

test("resolves workspace globs to package dirs with package.json", () => {
  const dirs = resolvePackageDirs(ROOT, ["packages/*"]);
  const names = dirs.map((d) => path.basename(d)).sort();
  assert.deepEqual(names, ["api", "web"]);
});

test("discover groups env files by package including root", async () => {
  const { packages } = await discover(ROOT);
  const byRel = Object.fromEntries(packages.map((p) => [p.relDir, p]));

  assert.ok(byRel["."], "root node present");
  assert.equal(byRel["."].isRoot, true);
  assert.ok(byRel["packages/web"], "web package present");
  assert.ok(byRel["packages/api"], "api package present");

  const web = byRel["packages/web"];
  const webFileNames = web.envFiles.map((f) => f.name).sort();
  assert.deepEqual(webFileNames, [".env", ".env.example"]);
  assert.equal(web.name, "@fixture/web");

  const example = web.envFiles.find((f) => f.name === ".env.example");
  assert.equal(example.isExample, true);
});
