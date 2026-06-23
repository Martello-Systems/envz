import { test } from "node:test";
import assert from "node:assert/strict";
import { fillFromSibling } from "../src/fill.js";

test("fills a missing key from sibling", () => {
  const { merged, filled } = fillFromSibling(
    { A: "keep" },
    { A: "other", B: "from-sibling" },
    ["B"]
  );
  assert.equal(merged.A, "keep");
  assert.equal(merged.B, "from-sibling");
  assert.deepEqual(filled, ["B"]);
});

test("never clobbers an existing non-empty value", () => {
  const { merged, filled, skipped } = fillFromSibling(
    { A: "original" },
    { A: "sibling-value" },
    ["A"]
  );
  assert.equal(merged.A, "original");
  assert.deepEqual(filled, []);
  assert.deepEqual(skipped, ["A"]);
});

test("fills an empty value", () => {
  const { merged, filled } = fillFromSibling(
    { A: "" },
    { A: "filled-in" },
    ["A"]
  );
  assert.equal(merged.A, "filled-in");
  assert.deepEqual(filled, ["A"]);
});

test("skips when sibling has no usable value", () => {
  const { merged, filled, skipped } = fillFromSibling(
    { A: "" },
    { A: "" },
    ["A"]
  );
  assert.equal(merged.A, "");
  assert.deepEqual(filled, []);
  assert.deepEqual(skipped, ["A"]);
});

test("skips keys absent from sibling", () => {
  const { filled, skipped } = fillFromSibling({}, {}, ["NOPE"]);
  assert.deepEqual(filled, []);
  assert.deepEqual(skipped, ["NOPE"]);
});

test("does not mutate the input target", () => {
  const target = { A: "" };
  fillFromSibling(target, { A: "v" }, ["A"]);
  assert.equal(target.A, "");
});
