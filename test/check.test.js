import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { check } from "../src/check.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "fixtures", "monorepo");

test("check fails when required keys are missing/empty", async () => {
  const r = await check(ROOT);
  assert.equal(r.ok, false);
  const text = r.lines.join("\n");
  assert.ok(text.includes("missing: ANALYTICS_KEY"));
  assert.ok(text.includes("empty:   FEATURE_FLAG_BETA"));
  assert.ok(text.includes("FAIL"));
});

test("check still fails on missing even with --allow-empty (missing remains)", async () => {
  const r = await check(ROOT, { allowEmpty: true });
  assert.equal(r.ok, false); // ANALYTICS_KEY still missing
});

test("failOnExtra surfaces extra keys", async () => {
  const r = await check(ROOT, { failOnExtra: true });
  const text = r.lines.join("\n");
  assert.ok(text.includes("extra:   DEBUG_SQL"));
});
