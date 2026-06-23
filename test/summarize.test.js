import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { analyze, summarize, headline } from "../src/summarize.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "fixtures", "monorepo");

test("analyze diffs each package against its example", async () => {
  const { packages } = await analyze(ROOT);
  const byRel = Object.fromEntries(packages.map((p) => [p.relDir, p]));

  // root: all present, plus one extra
  const root = byRel["."];
  assert.deepEqual(root.diff.missing, []);
  assert.deepEqual(root.diff.empty, []);
  assert.deepEqual(root.diff.extra, ["EXTRA_ROOT_FLAG"]);

  // web: ANALYTICS_KEY missing, FEATURE_FLAG_BETA empty
  const web = byRel["packages/web"];
  assert.deepEqual(web.diff.missing, ["ANALYTICS_KEY"]);
  assert.deepEqual(web.diff.empty, ["FEATURE_FLAG_BETA"]);

  // web inline comment was stripped from the api url
  const apiUrl = web.diff.keys.find((k) => k.key === "NEXT_PUBLIC_API_URL");
  assert.equal(apiUrl.value, "http://localhost:3001");

  // api: fully populated, one extra
  const api = byRel["packages/api"];
  assert.deepEqual(api.diff.missing, []);
  assert.deepEqual(api.diff.empty, []);
  assert.deepEqual(api.diff.extra, ["DEBUG_SQL"]);
  assert.equal(api.diff.keys.find((k) => k.key === "ANALYTICS_KEY").value, "analytics-shared-value");
});

test("summarize rolls up totals", async () => {
  const s = await summarize(ROOT);
  assert.equal(s.packageCount, 3);
  assert.equal(s.missingTotal, 1); // ANALYTICS_KEY in web
  assert.equal(s.emptyTotal, 1); // FEATURE_FLAG_BETA in web
  assert.equal(s.extraTotal, 2); // EXTRA_ROOT_FLAG + DEBUG_SQL
  assert.equal(s.driftedPackages, 3); // all three have some drift
});

test("headline reads cleanly", async () => {
  const s = await summarize(ROOT);
  assert.equal(headline(s), "3 packages, 1 missing key, 3 packages drifted");
});
